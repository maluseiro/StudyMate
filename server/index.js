import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { db, COVERS_DIR, STATUSES, KINDS, getSetting, setSetting, progressFor, nextLessonFor } from './db.js';
import { scanLibrary, scanCourse, registerCourse } from './scanner.js';
import { resolveLessonFile, lessonWithCourse, openExternally, ffmpegAvailable, remuxLesson, mimeFor } from './media.js';
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
    ffmpeg: await ffmpegAvailable(),
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
