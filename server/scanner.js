import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import {
  classify, cleanTitle, cleanFolderTitle, coverColor, isIgnored, isIgnoredDir,
  leadingNumber, naturalCompare,
} from './naming.js';

/**
 * Un MPEG-TS lleva el byte de sincronismo 0x47 al principio de cada paquete de 188
 * bytes. Dos aciertos seguidos alcanzan para distinguirlo de un archivo TypeScript.
 */
function looksLikeTransportStream(absPath) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(189);
    const read = fs.readSync(fd, buf, 0, 189, 0);
    return read === 189 && buf[0] === 0x47 && buf[188] === 0x47;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Recorre una carpeta de curso y devuelve sus archivos agrupados por subcarpeta. */
function walkCourse(courseDir) {
  /** @type {Map<string, {relDir: string, folderName: string, files: {name: string, size: number}[]}>} */
  const groups = new Map();

  const visit = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // carpeta ilegible: la salteamos en vez de romper el escaneo entero
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue;
        visit(path.join(absDir, entry.name), relDir ? path.join(relDir, entry.name) : entry.name);
      } else if (entry.isFile()) {
        if (isIgnored(entry.name)) continue;
        let size = 0;
        try {
          size = fs.statSync(path.join(absDir, entry.name)).size;
        } catch {
          continue;
        }
        if (!groups.has(relDir)) {
          groups.set(relDir, {
            relDir,
            folderName: relDir ? path.basename(relDir) : path.basename(courseDir),
            files: [],
          });
        }
        groups.get(relDir).files.push({ name: entry.name, size });
      }
    }
  };

  visit(courseDir, '');
  return [...groups.values()];
}

/** Los módulos se ordenan por el número que traen en el nombre; si no traen, alfabético natural. */
function sortModules(groups) {
  return groups.sort((a, b) => {
    if (a.relDir === '') return -1; // los archivos sueltos del curso van primero
    if (b.relDir === '') return 1;
    const na = leadingNumber(a.folderName);
    const nb = leadingNumber(b.folderName);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    return naturalCompare(a.relDir, b.relDir);
  });
}

const relPathFor = (relDir, name) => (relDir ? path.join(relDir, name) : name);

const findModule = db.prepare('SELECT * FROM modules WHERE course_id = ? AND rel_path = ?');
const insertModule = db.prepare(`
  INSERT INTO modules (course_id, rel_path, folder_name, title, sort_order)
  VALUES (@course_id, @rel_path, @folder_name, @title, @sort_order)
`);
const updateModule = db.prepare(`
  UPDATE modules SET folder_name = @folder_name, sort_order = @sort_order, missing = 0,
    title = CASE WHEN title_edited = 1 THEN title ELSE @title END
  WHERE id = @id
`);

const findLesson = db.prepare('SELECT * FROM lessons WHERE course_id = ? AND rel_path = ?');
const insertLesson = db.prepare(`
  INSERT INTO lessons (course_id, module_id, rel_path, file_name, title, kind, ext,
                       playable, needs_remux, sort_order, size)
  VALUES (@course_id, @module_id, @rel_path, @file_name, @title, @kind, @ext,
          @playable, @needs_remux, @sort_order, @size)
`);
const updateLesson = db.prepare(`
  UPDATE lessons SET module_id = @module_id, file_name = @file_name, kind = @kind, ext = @ext,
    playable = CASE WHEN remux_rel IS NOT NULL THEN 1 ELSE @playable END,
    needs_remux = @needs_remux, sort_order = @sort_order, size = @size,
    missing = 0,
    title = CASE WHEN title_edited = 1 THEN title ELSE @title END
  WHERE id = @id
`);

/**
 * Reindexa un curso.
 *
 * La identidad de una clase es su ruta relativa dentro del curso, no su id: por eso
 * reescanear no duplica nada ni pierde progreso, notas ni títulos editados. Lo que
 * ya no está en el disco se marca `missing`, nunca se borra.
 */
/**
 * Agrupa muchas escrituras en una sola transacción. Sin esto, cada INSERT confirma
 * por su cuenta y un curso de mil archivos tarda segundos en vez de milisegundos.
 */
function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* la transacción ya se cerró sola */ }
    throw error;
  }
}

export function scanCourse(course, { wrap = true } = {}) {
  return wrap ? inTransaction(() => scanCourseInner(course)) : scanCourseInner(course);
}

function scanCourseInner(course) {
  if (!fs.existsSync(course.path)) {
    db.prepare('UPDATE courses SET missing = 1 WHERE id = ?').run(course.id);
    return { modules: 0, lessons: 0, missing: true };
  }
  db.prepare('UPDATE courses SET missing = 0 WHERE id = ?').run(course.id);

  const groups = sortModules(walkCourse(course.path));
  const seenModules = new Set();
  const seenLessons = new Set();
  let lessonCount = 0;

  groups.forEach((group, moduleIndex) => {
    const title = group.relDir === '' ? 'General' : cleanFolderTitle(group.folderName);
    const row = findModule.get(course.id, group.relDir);
    let moduleId;
    if (row) {
      updateModule.run({
        id: row.id, folder_name: group.folderName, title, sort_order: moduleIndex,
      });
      moduleId = row.id;
    } else {
      moduleId = insertModule.run({
        course_id: course.id, rel_path: group.relDir, folder_name: group.folderName,
        title, sort_order: moduleIndex,
      }).lastInsertRowid;
    }
    seenModules.add(moduleId);

    const files = group.files.sort((a, b) => naturalCompare(a.name, b.name));
    files.forEach((file, fileIndex) => {
      const relPath = relPathFor(group.relDir, file.name);
      const ext = path.extname(file.name).toLowerCase();
      const { kind, playable, needsRemux } = classify(ext, file.size, {
        isTransportStream: ext === '.ts'
          && looksLikeTransportStream(path.resolve(course.path, relPathFor(group.relDir, file.name))),
      });
      // Cada sentencia recibe exactamente los parámetros que nombra: SQLite rechaza
      // los de más, así que el INSERT y el UPDATE no comparten el mismo objeto.
      const common = {
        module_id: moduleId, file_name: file.name, title: cleanTitle(file.name),
        kind, ext, playable, needs_remux: needsRemux, sort_order: fileIndex, size: file.size,
      };
      const existing = findLesson.get(course.id, relPath);
      if (existing) {
        updateLesson.run({ ...common, id: existing.id });
        seenLessons.add(existing.id);
      } else {
        seenLessons.add(insertLesson.run({
          ...common, course_id: course.id, rel_path: relPath,
        }).lastInsertRowid);
      }
      lessonCount++;
    });
  });

  // Lo que dejó de existir se marca, no se borra: si el archivo vuelve, vuelven sus notas.
  for (const row of db.prepare('SELECT id FROM lessons WHERE course_id = ?').all(course.id)) {
    if (!seenLessons.has(row.id)) db.prepare('UPDATE lessons SET missing = 1 WHERE id = ?').run(row.id);
  }
  for (const row of db.prepare('SELECT id FROM modules WHERE course_id = ?').all(course.id)) {
    if (!seenModules.has(row.id)) db.prepare('UPDATE modules SET missing = 1 WHERE id = ?').run(row.id);
  }

  return { modules: seenModules.size, lessons: lessonCount, missing: false };
}

const findCourseByPath = db.prepare('SELECT * FROM courses WHERE path = ?');

/** Da de alta un curso a partir de una carpeta. Idempotente. */
export function registerCourse(coursePath, { rootId = null, title = null, kind = 'estudio' } = {}) {
  const abs = path.resolve(coursePath);
  const existing = findCourseByPath.get(abs);
  if (existing) {
    if (rootId && !existing.root_id) {
      db.prepare('UPDATE courses SET root_id = ? WHERE id = ?').run(rootId, existing.id);
    }
    return { course: findCourseByPath.get(abs), created: false };
  }
  const folderName = path.basename(abs);
  const finalTitle = title || cleanFolderTitle(folderName);
  db.prepare(`
    INSERT INTO courses (path, root_id, folder_name, title, title_edited, kind, cover_color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(abs, rootId, folderName, finalTitle, title ? 1 : 0, kind, coverColor(finalTitle));
  return { course: findCourseByPath.get(abs), created: true };
}

/**
 * Escanea todas las raíces de la biblioteca: cada subcarpeta directa de una raíz
 * es un curso. Después reindexa cada curso conocido, incluidos los agregados a mano.
 */
export function scanLibrary() {
  const started = Date.now();
  const roots = db.prepare('SELECT * FROM roots ORDER BY id').all();
  let created = 0;

  inTransaction(() => {
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root.path, { withFileTypes: true });
    } catch {
      continue; // raíz desconectada (disco externo): la salteamos, no la borramos
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredDir(entry.name)) continue;
      const result = registerCourse(path.join(root.path, entry.name), { rootId: root.id });
      if (result.created) created++;
    }
  }
  });

  const courses = db.prepare('SELECT * FROM courses').all();
  let lessons = 0;
  let missingCourses = 0;
  inTransaction(() => {
    for (const course of courses) {
      const result = scanCourse(course, { wrap: false });
      lessons += result.lessons;
      if (result.missing) missingCourses++;
    }
  });

  const stats = {
    roots: roots.length,
    courses: courses.length,
    created,
    lessons,
    missingCourses,
    ms: Date.now() - started,
    at: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('last_scan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(stats));
  return stats;
}
