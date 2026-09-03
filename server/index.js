import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { db, COVERS_DIR, STATUSES, KINDS, getSetting, setSetting, progressFor, nextLessonFor } from './db.js';
import { scanLibrary, scanCourse, registerCourse } from './scanner.js';
import { resolveLessonFile, lessonWithCourse, openExternally, ffmpegAvailable, ffprobeAvailable,
         probeTools, remuxLesson, mimeFor, probeDuration, extractFrame } from './media.js';
import { monogram, cleanFolderTitle, COVER_COLORS } from './naming.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(here, '..', 'web');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, message) => res.status(code).json({ error: message });

// ---------------------------------------------------------------- consultas

function courseProgress(courseId) {
  const { total, watched } = progressFor.get(courseId);
  return { total, watched, percent: total ? Math.round((watched / total) * 100) : 0 };
}

/**
 * Marca de versión de la portada: la fecha del archivo. Va en la URL para que el
 * navegador pida la imagen nueva cuando la cambiás. Sin esto la URL era siempre la
 * misma y la caché seguía mostrando la anterior.
 */
function coverVersion(course) {
  if (!course.cover_file) return 0;
  try {
    return Math.round(fs.statSync(path.join(COVERS_DIR, course.cover_file)).mtimeMs);
  } catch {
    return 0;
  }
}

function decorateCourse(course) {
  const progress = courseProgress(course.id);
  const counts = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN missing = 0 THEN module_id END)          AS modules,
      COUNT(CASE WHEN kind <> 'video' AND kind <> 'subtitulo'
                  AND missing = 0 THEN 1 END)                           AS resources
    FROM lessons WHERE course_id = ?
  `).get(course.id);
  return {
    ...course,
    monogram: monogram(course.title),
    hasCover: Boolean(course.cover_file),
    coverVersion: coverVersion(course),
    progress,
    modules: counts.modules,
    resources: counts.resources,
  };
}

/**
 * El estado se mueve solo, salvo que lo hayas tocado a mano: ahí manda tu decisión.
 * Sin esto habría que marcar "en curso" a mano en cada curso que empezás.
 */
function refreshAutoStatus(courseId) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course || course.status_edited) return;
  const { total, watched } = progressFor.get(courseId);
  let status = course.status;
  if (total > 0 && watched >= total) status = 'terminado';
  else if (watched > 0) status = 'en_curso';
  else status = 'sin_empezar';
  if (status !== course.status) {
    db.prepare('UPDATE courses SET status = ? WHERE id = ?').run(status, courseId);
  }
}

// ---------------------------------------------------------------- estado general

app.get('/api/state', wrap(async (req, res) => {
  const roots = db.prepare('SELECT * FROM roots ORDER BY id').all();
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM courses WHERE missing = 0)                          AS courses,
      (SELECT COUNT(*) FROM lessons WHERE kind = 'video' AND missing = 0)       AS lessons,
      (SELECT COUNT(*) FROM lessons WHERE flagged = 1 AND missing = 0)          AS flagged
  `).get();
  const byStatus = Object.fromEntries(
    db.prepare("SELECT status, COUNT(*) n FROM courses WHERE missing = 0 GROUP BY status").all()
      .map((r) => [r.status, r.n])
  );
  const lastScan = getSetting('last_scan');
  res.json({
    configured: roots.length > 0 || totals.courses > 0,
    roots,
    totals,
    byStatus,
    lastScan: lastScan ? JSON.parse(lastScan) : null,
    ...(await probeTools()),
    platform: process.platform,
    addresses: localAddresses(),
    coverColors: COVER_COLORS,
  });
}));

app.post('/api/roots', wrap((req, res) => {
  const raw = String(req.body?.path ?? '').trim().replace(/^"|"$/g, '');
  if (!raw) return fail(res, 400, 'Pegá la ruta de una carpeta.');
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) return fail(res, 400, `No existe la carpeta ${abs}`);
  if (!fs.statSync(abs).isDirectory()) return fail(res, 400, 'Esa ruta es un archivo, no una carpeta.');
  db.prepare('INSERT OR IGNORE INTO roots (path) VALUES (?)').run(abs);
  res.json({ stats: scanLibrary() });
}));

app.delete('/api/roots/:id', wrap((req, res) => {
  db.prepare('DELETE FROM roots WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/scan', wrap((req, res) => res.json({ stats: scanLibrary() })));

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// ---------------------------------------------------------------- cursos

app.get('/api/courses', wrap((req, res) => {
  const { status, kind } = req.query;
  const where = ['missing = 0'];
  const params = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (kind && KINDS.includes(kind)) { where.push('kind = ?'); params.push(kind); }
  const rows = db.prepare(`SELECT * FROM courses WHERE ${where.join(' AND ')} ORDER BY title COLLATE NOCASE`).all(...params);
  res.json({ courses: rows.map(decorateCourse) });
}));

app.get('/api/continue', wrap((req, res) => {
  const course = db.prepare(`
    SELECT * FROM courses
    WHERE missing = 0 AND last_opened_at IS NOT NULL AND status <> 'terminado'
    ORDER BY last_opened_at DESC LIMIT 1
  `).get();
  if (!course) return res.json({ course: null });

  const last = course.last_lesson_id
    ? db.prepare('SELECT * FROM lessons WHERE id = ? AND missing = 0').get(course.last_lesson_id)
    : null;
  const lesson = last && !last.watched ? last : nextLessonFor.get(course.id) ?? last;
  const module = lesson ? db.prepare('SELECT * FROM modules WHERE id = ?').get(lesson.module_id) : null;
  res.json({ course: decorateCourse(course), lesson, module });
}));

app.get('/api/flagged', wrap((req, res) => {
  const rows = db.prepare(`
    SELECT l.*, c.title AS course_title, c.cover_color, c.id AS course_id, m.title AS module_title
    FROM lessons l
    JOIN courses c ON c.id = l.course_id
    JOIN modules m ON m.id = l.module_id
    WHERE l.flagged = 1 AND l.missing = 0
    ORDER BY c.title COLLATE NOCASE, m.sort_order, l.sort_order
  `).all();
  res.json({ lessons: rows });
}));

app.post('/api/courses', wrap((req, res) => {
  const raw = String(req.body?.path ?? '').trim().replace(/^"|"$/g, '');
  if (!raw) return fail(res, 400, 'Pegá la ruta de la carpeta del curso.');
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return fail(res, 400, `No existe la carpeta ${abs}`);
  }
  const { course } = registerCourse(abs, {
    title: req.body?.title?.trim() || null,
    kind: KINDS.includes(req.body?.kind) ? req.body.kind : 'estudio',
  });
  const stats = scanCourse(course);
  res.json({ course: decorateCourse(db.prepare('SELECT * FROM courses WHERE id = ?').get(course.id)), stats });
}));

/** Previsualiza qué hay en una carpeta antes de agregarla, sin tocar la base. */
app.post('/api/courses/preview', wrap((req, res) => {
  const raw = String(req.body?.path ?? '').trim().replace(/^"|"$/g, '');
  const abs = path.resolve(raw || '.');
  if (!raw || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return fail(res, 400, `No existe la carpeta ${abs}`);
  }
  const already = db.prepare('SELECT id FROM courses WHERE path = ?').get(abs);
  res.json({ path: abs, already: Boolean(already), suggestedTitle: cleanFolderTitle(path.basename(abs)) });
}));

app.get('/api/courses/:id', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');

  const modules = db.prepare('SELECT * FROM modules WHERE course_id = ? AND missing = 0 ORDER BY sort_order').all(course.id);
  const lessons = db.prepare('SELECT * FROM lessons WHERE course_id = ? AND missing = 0 ORDER BY sort_order').all(course.id);

  const byModule = new Map(modules.map((m) => [m.id, { ...m, lessons: [], resources: [] }]));
  for (const lesson of lessons) {
    const group = byModule.get(lesson.module_id);
    if (!group) continue;
    if (lesson.kind === 'video') group.lessons.push(lesson);
    else if (lesson.kind !== 'subtitulo') group.resources.push(lesson);
  }

  res.json({
    course: decorateCourse(course),
    modules: [...byModule.values()].filter((m) => m.lessons.length || m.resources.length),
    next: nextLessonFor.get(course.id) ?? null,
  });
}));

app.patch('/api/courses/:id', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');

  const { title, status, kind, cover_color: coverColorValue, speed } = req.body ?? {};
  if (typeof title === 'string' && title.trim()) {
    db.prepare('UPDATE courses SET title = ?, title_edited = 1 WHERE id = ?').run(title.trim(), course.id);
  }
  if (STATUSES.includes(status)) {
    db.prepare('UPDATE courses SET status = ?, status_edited = 1 WHERE id = ?').run(status, course.id);
  }
  if (KINDS.includes(kind)) db.prepare('UPDATE courses SET kind = ? WHERE id = ?').run(kind, course.id);
  if (typeof coverColorValue === 'string' && /^#[0-9a-f]{6}$/i.test(coverColorValue)) {
    db.prepare('UPDATE courses SET cover_color = ? WHERE id = ?').run(coverColorValue, course.id);
  }
  if (typeof speed === 'number' && speed >= 0.5 && speed <= 3) {
    db.prepare('UPDATE courses SET speed = ? WHERE id = ?').run(speed, course.id);
  }
  res.json({ course: decorateCourse(db.prepare('SELECT * FROM courses WHERE id = ?').get(course.id)) });
}));

app.post('/api/courses/:id/rescan', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');
  res.json({ stats: scanCourse(course) });
}));

/** Saca el curso de la biblioteca. Los archivos del disco no se tocan. */
app.delete('/api/courses/:id', wrap((req, res) => {
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// portada: se sube el archivo crudo con su Content-Type
app.post('/api/courses/:id/cover',
  express.raw({ type: ['image/*'], limit: '8mb' }),
  wrap((req, res) => {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
    if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');
    if (!req.body?.length) return fail(res, 400, 'No llegó ninguna imagen.');

    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[req.get('content-type')] ?? '.png';
    const name = `${course.id}${ext}`;
    fs.writeFileSync(path.join(COVERS_DIR, name), req.body);
    if (course.cover_file && course.cover_file !== name) {
      try { fs.unlinkSync(path.join(COVERS_DIR, course.cover_file)); } catch { /* ya no estaba */ }
    }
    db.prepare('UPDATE courses SET cover_file = ? WHERE id = ?').run(name, course.id);
    res.json({ ok: true });
  }));

app.delete('/api/courses/:id/cover', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');
  if (course.cover_file) {
    try { fs.unlinkSync(path.join(COVERS_DIR, course.cover_file)); } catch { /* ya no estaba */ }
  }
  db.prepare('UPDATE courses SET cover_file = NULL WHERE id = ?').run(course.id);
  res.json({ ok: true });
}));

app.get('/cover/:id', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course?.cover_file) return res.sendStatus(404);
  // Revalidar siempre: la portada se reemplaza en el lugar y el navegador no tiene
  // forma de enterarse solo.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(COVERS_DIR, course.cover_file));
}));

// ---------------------------------------------------------------- módulos

app.patch('/api/modules/:id', wrap((req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return fail(res, 400, 'El módulo necesita un título.');
  db.prepare('UPDATE modules SET title = ?, title_edited = 1 WHERE id = ?').run(title, req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- clases

app.get('/api/lessons/:id', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  const { lesson, course } = found;

  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(lesson.module_id);
  const note = db.prepare('SELECT body FROM notes WHERE lesson_id = ?').get(lesson.id);

  const ordered = db.prepare(`
    SELECT l.id, l.title, l.kind, l.sort_order, l.watched, l.flagged, l.duration, l.position,
           l.playable, l.needs_remux, l.ext, l.remux_rel, m.id AS module_id, m.title AS module_title, m.sort_order AS module_order
    FROM lessons l JOIN modules m ON m.id = l.module_id
    WHERE l.course_id = ? AND l.missing = 0
    ORDER BY m.sort_order, l.sort_order
  `).all(course.id);

  const videos = ordered.filter((l) => l.kind === 'video');
  const index = videos.findIndex((l) => l.id === lesson.id);

  db.prepare("UPDATE courses SET last_lesson_id = ?, last_opened_at = datetime('now') WHERE id = ?")
    .run(lesson.id, course.id);

  res.json({
    lesson,
    course: decorateCourse(course),
    module,
    notes: note?.body ?? '',
    outline: ordered,
    resources: db.prepare(`
      SELECT * FROM lessons
      WHERE module_id = ? AND kind NOT IN ('video', 'subtitulo') AND missing = 0
      ORDER BY sort_order
    `).all(lesson.module_id),
    prev: index > 0 ? videos[index - 1] : null,
    next: index >= 0 && index < videos.length - 1 ? videos[index + 1] : null,
    progress: courseProgress(course.id),
  });
}));

app.patch('/api/lessons/:id', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  const { lesson } = found;
  const { title, flagged, watched } = req.body ?? {};

  if (typeof title === 'string' && title.trim()) {
    db.prepare('UPDATE lessons SET title = ?, title_edited = 1 WHERE id = ?').run(title.trim(), lesson.id);
  }
  if (typeof flagged === 'boolean') {
    db.prepare('UPDATE lessons SET flagged = ? WHERE id = ?').run(flagged ? 1 : 0, lesson.id);
  }
  if (typeof watched === 'boolean') {
    db.prepare("UPDATE lessons SET watched = ?, updated_at = datetime('now') WHERE id = ?")
      .run(watched ? 1 : 0, lesson.id);
    refreshAutoStatus(lesson.course_id);
  }
  res.json({
    lesson: db.prepare('SELECT * FROM lessons WHERE id = ?').get(lesson.id),
    progress: courseProgress(lesson.course_id),
  });
}));

/**
 * Guarda dónde ibas. La duración la reporta el navegador la primera vez que se abre
 * la clase: sin ffprobe no hay otra forma de conocerla.
 */
app.post('/api/lessons/:id/progress', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  const { lesson } = found;

  const position = Number(req.body?.position);
  const duration = Number(req.body?.duration);
  if (!Number.isFinite(position) || position < 0) return fail(res, 400, 'Posición inválida.');

  const knownDuration = Number.isFinite(duration) && duration > 0 ? duration : lesson.duration;
  const watched = knownDuration && position / knownDuration >= 0.9 ? 1 : lesson.watched;

  db.prepare(`
    UPDATE lessons SET position = ?, duration = COALESCE(?, duration), watched = ?,
                       updated_at = datetime('now')
    WHERE id = ?
  `).run(position, knownDuration ?? null, watched, lesson.id);

  db.prepare("UPDATE courses SET last_lesson_id = ?, last_opened_at = datetime('now') WHERE id = ?")
    .run(lesson.id, lesson.course_id);
  refreshAutoStatus(lesson.course_id);

  res.json({ watched: Boolean(watched), progress: courseProgress(lesson.course_id) });
}));

app.put('/api/lessons/:id/notes', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  const body = String(req.body?.body ?? '');
  db.prepare(`
    INSERT INTO notes (lesson_id, body, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(lesson_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at
  `).run(found.lesson.id, body);
  res.json({ ok: true, savedAt: new Date().toISOString() });
}));

app.post('/api/lessons/:id/open-external', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  const abs = resolveLessonFile(found.lesson, found.course);
  if (!abs || !fs.existsSync(abs)) return fail(res, 404, 'El archivo ya no está en el disco.');
  openExternally(abs);
  res.json({ ok: true });
}));

app.post('/api/lessons/:id/open-folder', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  const abs = resolveLessonFile(found.lesson, found.course, { preferRemux: false });
  if (!abs) return fail(res, 404, 'El archivo ya no está en el disco.');
  openExternally(path.dirname(abs));
  res.json({ ok: true });
}));

app.post('/api/lessons/:id/remux', wrap(async (req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return fail(res, 404, 'Esa clase ya no está en la biblioteca.');
  if (!(await ffmpegAvailable())) {
    return fail(res, 400, 'No se encontró ffmpeg. Instalalo y volvé a intentar.');
  }
  if (found.lesson.kind !== 'video') {
    return fail(res, 400, 'Solo se pueden convertir videos.');
  }
  if (found.lesson.playable && !found.lesson.remux_rel) {
    return fail(res, 400, 'El navegador ya puede reproducir este archivo: no hace falta convertirlo.');
  }
  const result = await remuxLesson(found.lesson, found.course);
  if (!result.ok) return fail(res, 500, result.error);
  res.json({ ...result, lesson: db.prepare('SELECT * FROM lessons WHERE id = ?').get(found.lesson.id) });
}));

// ---------------------------------------------------------------- reordenar

/**
 * Guarda el orden manual de un módulo. A partir de acá el escaneo no vuelve a
 * ordenarlo por nombre de archivo: las clases nuevas se agregan al final.
 */
app.post('/api/modules/:id/reorder', wrap((req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return fail(res, 404, 'Ese módulo ya no existe.');

  const ids = Array.isArray(req.body?.lesson_ids) ? req.body.lesson_ids.map(Number) : null;
  if (!ids?.length) return fail(res, 400, 'Falta el orden de las clases.');

  const belong = new Set(
    db.prepare('SELECT id FROM lessons WHERE module_id = ?').all(module.id).map((r) => r.id)
  );
  if (ids.some((id) => !belong.has(id))) {
    return fail(res, 400, 'Alguna de esas clases no es de este módulo.');
  }

  const setOrder = db.prepare('UPDATE lessons SET sort_order = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => setOrder.run(index, id));
    db.prepare('UPDATE modules SET order_edited = 1 WHERE id = ?').run(module.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json({ ok: true });
}));

/** Vuelve al orden que sale del nombre de los archivos. */
app.delete('/api/modules/:id/reorder', wrap((req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return fail(res, 404, 'Ese módulo ya no existe.');
  db.prepare('UPDATE modules SET order_edited = 0 WHERE id = ?').run(module.id);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(module.course_id);
  scanCourse(course);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- marcar en bloque

/**
 * Marcar de a una es tedioso cuando ya viste medio curso antes de tener la app.
 * No se toca la posición: desmarcar una clase te deja volver donde ibas.
 */
const setWatchedIn = (where) => db.prepare(`
  UPDATE lessons SET watched = @watched, updated_at = datetime('now')
  WHERE ${where} AND kind = 'video' AND missing = 0 AND watched <> @watched
`);

const setWatchedModule = setWatchedIn('module_id = @id');
const setWatchedCourse = setWatchedIn('course_id = @id');

app.post('/api/modules/:id/watched', wrap((req, res) => {
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return fail(res, 404, 'Ese módulo ya no existe.');
  const watched = req.body?.watched ? 1 : 0;

  const { changes } = setWatchedModule.run({ id: module.id, watched });
  refreshAutoStatus(module.course_id);
  res.json({ changed: changes, watched: Boolean(watched), progress: courseProgress(module.course_id) });
}));

app.post('/api/courses/:id/watched', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');
  const watched = req.body?.watched ? 1 : 0;

  const { changes } = setWatchedCourse.run({ id: course.id, watched });
  refreshAutoStatus(course.id);
  res.json({ changed: changes, watched: Boolean(watched), progress: courseProgress(course.id) });
}));

// ---------------------------------------------------------------- exportar notas


app.get('/api/courses/:id/notes.md', wrap((req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');

  const rows = db.prepare(`
    SELECT n.body, l.title AS lesson_title, l.duration, m.title AS module_title,
           m.sort_order AS module_order, l.sort_order AS lesson_order
    FROM notes n
    JOIN lessons l ON l.id = n.lesson_id
    JOIN modules m ON m.id = l.module_id
    WHERE l.course_id = ? AND TRIM(n.body) <> ''
    ORDER BY m.sort_order, l.sort_order
  `).all(course.id);

  const lines = [`# ${course.title}`, ''];
  if (rows.length === 0) {
    lines.push('_Todavía no hay notas en este curso._', '');
  } else {
    lines.push(`_${rows.length} ${rows.length === 1 ? 'clase con notas' : 'clases con notas'}._`, '');
    let currentModule = null;
    for (const row of rows) {
      if (row.module_title !== currentModule) {
        currentModule = row.module_title;
        lines.push(`## ${currentModule}`, '');
      }
      lines.push(`### ${row.lesson_title}`, '');
      lines.push(row.body.trim(), '');
    }
  }

  const fileName = `${course.title.replace(/[<>:"/\\|?*]/g, '-').slice(0, 80)} - notas.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(lines.join('\n'));
}));

// ---------------------------------------------------------------- buscador

/** Un fragmento del texto alrededor de lo que buscaste, para no mostrar la nota entera. */
function snippet(text, needle, radius = 70) {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return text.slice(0, radius * 2).trim();
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + needle.length + radius);
  return (from > 0 ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : '');
}

app.get('/api/search', wrap((req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ q, courses: [], lessons: [], notes: [] });
  const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;

  const courses = db.prepare(`
    SELECT id, title, cover_color, cover_file, status, kind FROM courses
    WHERE missing = 0 AND title LIKE ? ESCAPE '\\'
    ORDER BY title COLLATE NOCASE LIMIT 12
  `).all(like).map((c) => ({
    ...c, monogram: monogram(c.title),
    hasCover: Boolean(c.cover_file), coverVersion: coverVersion(c),
  }));

  const lessons = db.prepare(`
    SELECT l.id, l.title, l.file_name, l.kind, l.watched, l.duration,
           c.id AS course_id, c.title AS course_title, c.cover_color, m.title AS module_title
    FROM lessons l
    JOIN courses c ON c.id = l.course_id
    JOIN modules m ON m.id = l.module_id
    WHERE l.missing = 0 AND (l.title LIKE ? ESCAPE '\\' OR l.file_name LIKE ? ESCAPE '\\')
    ORDER BY c.title COLLATE NOCASE, m.sort_order, l.sort_order
    LIMIT 60
  `).all(like, like);

  const notes = db.prepare(`
    SELECT n.body, l.id, l.title, c.id AS course_id, c.title AS course_title,
           c.cover_color, m.title AS module_title
    FROM notes n
    JOIN lessons l ON l.id = n.lesson_id
    JOIN courses c ON c.id = l.course_id
    JOIN modules m ON m.id = l.module_id
    WHERE l.missing = 0 AND n.body LIKE ? ESCAPE '\\'
    ORDER BY c.title COLLATE NOCASE, m.sort_order, l.sort_order
    LIMIT 40
  `).all(like).map((n) => ({ ...n, snippet: snippet(n.body, q) }));

  res.json({ q, courses, lessons, notes });
}));

// ---------------------------------------------------------------- duraciones

/**
 * Sin ffprobe la duración solo se conoce al abrir la clase. Este trabajo la completa
 * de a poco en segundo plano; el cliente pregunta cómo viene.
 */
const durationJob = {
  running: false, done: 0, total: 0, updated: 0, failed: 0,
  error: null, lastFailure: null,
};

app.get('/api/durations/status', wrap((req, res) => {
  const pending = db.prepare(
    "SELECT COUNT(*) AS n FROM lessons WHERE kind = 'video' AND missing = 0 AND duration IS NULL"
  ).get().n;
  res.json({ ...durationJob, pending });
}));

app.post('/api/durations/scan', wrap(async (req, res) => {
  if (durationJob.running) return res.json({ ...durationJob, alreadyRunning: true });
  // Acá manda ffprobe, no ffmpeg: son binarios distintos y uno puede faltar.
  if (!(await ffprobeAvailable())) {
    return fail(res, 400, 'No se encontró ffprobe en el PATH. Viene con ffmpeg; si lo instalaste recién, cerrá y volvé a abrir StudyMate.');
  }

  const pending = db.prepare(`
    SELECT l.id, l.rel_path, l.remux_rel, c.path AS course_path
    FROM lessons l JOIN courses c ON c.id = l.course_id
    WHERE l.kind = 'video' AND l.missing = 0 AND l.duration IS NULL
  `).all();

  Object.assign(durationJob, {
    running: true, done: 0, total: pending.length, updated: 0, failed: 0,
    error: null, lastFailure: null,
  });
  res.json({ ...durationJob, started: true });

  const save = db.prepare('UPDATE lessons SET duration = ? WHERE id = ?');
  const WORKERS = 4;
  let cursor = 0;

  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      const abs = resolveLessonFile(
        { rel_path: item.rel_path, remux_rel: item.remux_rel },
        { path: item.course_path }
      );
      const result = abs
        ? await probeDuration(abs)
        : { seconds: null, error: 'La ruta del archivo quedó fuera de la carpeta del curso.' };
      if (result.seconds) {
        save.run(result.seconds, item.id);
        durationJob.updated++;
      } else {
        durationJob.failed++;
        // Guardamos el primero: repetir el mismo error mil veces no aporta.
        durationJob.lastFailure ??= result.error;
      }
      durationJob.done++;
    }
  };

  try {
    await Promise.all(Array.from({ length: WORKERS }, worker));
  } catch (error) {
    durationJob.error = error.message;
  } finally {
    durationJob.running = false;
  }
}));

// ---------------------------------------------------------------- portada por fotograma

app.post('/api/courses/:id/cover/frame', wrap(async (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return fail(res, 404, 'Ese curso no está en la biblioteca.');
  if (!(await ffmpegAvailable())) return fail(res, 400, 'Hace falta ffmpeg para sacar el fotograma.');

  const source = req.body?.lesson_id
    ? db.prepare("SELECT * FROM lessons WHERE id = ? AND course_id = ?").get(req.body.lesson_id, course.id)
    : db.prepare(`
        SELECT l.* FROM lessons l JOIN modules m ON m.id = l.module_id
        WHERE l.course_id = ? AND l.kind = 'video' AND l.missing = 0
        ORDER BY m.sort_order, l.sort_order LIMIT 1
      `).get(course.id);
  if (!source) return fail(res, 400, 'Este curso no tiene ninguna clase de video.');

  const abs = resolveLessonFile(source, course);
  if (!abs || !fs.existsSync(abs)) return fail(res, 404, 'El archivo de esa clase no está en el disco.');

  const name = `${course.id}.jpg`;
  const ok = await extractFrame(abs, path.join(COVERS_DIR, name), source.duration);
  if (!ok) return fail(res, 500, 'ffmpeg no pudo sacar un fotograma de ese archivo.');

  if (course.cover_file && course.cover_file !== name) {
    try { fs.unlinkSync(path.join(COVERS_DIR, course.cover_file)); } catch { /* ya no estaba */ }
  }
  db.prepare('UPDATE courses SET cover_file = ? WHERE id = ?').run(name, course.id);
  res.json({ ok: true, from: source.title });
}));

// ---------------------------------------------------------------- archivos

/** Sirve el archivo con soporte de Range, que es lo que permite mover la barra. */
app.get('/media/:id', wrap((req, res) => {
  const found = lessonWithCourse(req.params.id);
  if (!found) return res.sendStatus(404);
  const abs = resolveLessonFile(found.lesson, found.course);
  if (!abs || !fs.existsSync(abs)) return res.sendStatus(404);

  res.type(mimeFor(path.extname(abs)));
  res.sendFile(abs, { acceptRanges: true, cacheControl: false, dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.sendStatus(err.status ?? 500);
  });
}));

// ---------------------------------------------------------------- estáticos

app.use(express.static(WEB_DIR, { extensions: ['html'] }));
app.get(/^\/(?!api|media|cover).*/, (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Algo falló del lado del servidor.' });
});

app.listen(PORT, HOST, () => {
  const lan = localAddresses();
  // studymate.bat pone SM_OPEN=1 para que el doble clic abra el navegador solo.
  if (process.env.SM_OPEN === '1') openExternally(`http://localhost:${PORT}`);
  console.log('\n  StudyMate');
  console.log(`  En esta PC        http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Desde el celular  http://${ip}:${PORT}`);
  if (lan.length && process.platform === 'win32') {
    console.log('\n  La primera vez, Windows va a pedir permiso de red: aceptá "redes privadas".');
  }
  console.log('');
});
