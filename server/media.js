import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { db } from './db.js';

/**
 * Resuelve el archivo de una clase y verifica que siga dentro de la carpeta de su
 * curso. Sin esto, un rel_path manipulado podría leer cualquier archivo del disco.
 */
export function resolveLessonFile(lesson, course, { preferRemux = true } = {}) {
  const courseRoot = path.resolve(course.path);
  const rel = preferRemux && lesson.remux_rel ? lesson.remux_rel : lesson.rel_path;
  const abs = path.resolve(courseRoot, rel);

  const inside = process.platform === 'win32'
    ? abs.toLowerCase().startsWith(courseRoot.toLowerCase() + path.sep)
    : abs.startsWith(courseRoot + path.sep);
  if (!inside) return null;
  return abs;
}

export function lessonWithCourse(id) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
  if (!lesson) return null;
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(lesson.course_id);
  if (!course) return null;
  return { lesson, course };
}

/** Abre el archivo con el programa por defecto del sistema (VLC, Acrobat, lo que sea). */
export function openExternally(absPath) {
  if (process.platform === 'win32') {
    // El "" vacío es el título de ventana que start consume; sin él, una ruta con
    // espacios entre comillas se interpreta como título y no abre nada.
    spawn('cmd', ['/c', 'start', '', absPath], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [absPath], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [absPath], { detached: true, stdio: 'ignore' }).unref();
  }
}

let ffmpegCache = null;

/** ¿Hay ffmpeg disponible? Se consulta una vez por arranque. */
export function ffmpegAvailable() {
  if (ffmpegCache !== null) return Promise.resolve(ffmpegCache);
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (err) => {
      ffmpegCache = !err;
      resolve(ffmpegCache);
    });
  });
}

export const REMUX_DIR = '.studymate';

/**
 * Cambia el envase del video sin tocar el video: MPEG-TS o Matroska a MP4 con
 * `-c copy`. No recomprime, no pierde calidad y tarda lo que tarda copiar el archivo.
 *
 * El resultado va a una subcarpeta que el escáner ignora, así el curso no termina
 * con dos clases duplicadas. El original nunca se toca.
 */
export function remuxLesson(lesson, course) {
  return new Promise((resolve) => {
    const source = resolveLessonFile(lesson, course, { preferRemux: false });
    if (!source || !fs.existsSync(source)) {
      return resolve({ ok: false, error: 'El archivo original no está en el disco.' });
    }

    const outDir = path.join(path.resolve(course.path), REMUX_DIR);
    fs.mkdirSync(outDir, { recursive: true });
    const outName = `${lesson.id}-${path.basename(lesson.rel_path, path.extname(lesson.rel_path))}.mp4`
      .replace(/[<>:"/\\|?*]/g, '_');
    const outAbs = path.join(outDir, outName);
    const outRel = path.join(REMUX_DIR, outName);

    if (fs.existsSync(outAbs)) {
      db.prepare('UPDATE lessons SET remux_rel = ?, playable = 1 WHERE id = ?').run(outRel, lesson.id);
      return resolve({ ok: true, alreadyExisted: true, remux_rel: outRel });
    }

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', source,
      '-c', 'copy',
      '-movflags', '+faststart',
      outAbs,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(0, 2000); });

    proc.on('error', () => resolve({ ok: false, error: 'No se encontró ffmpeg en el PATH.' }));

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0) {
        db.prepare('UPDATE lessons SET remux_rel = ?, playable = 1 WHERE id = ?').run(outRel, lesson.id);
        return resolve({ ok: true, remux_rel: outRel });
      }
      try { fs.unlinkSync(outAbs); } catch { /* el archivo parcial puede no existir */ }
      resolve({
        ok: false,
        error: stderr.trim().split('\n').slice(-2).join(' ')
          || 'ffmpeg no pudo cambiar el envase de este archivo. Probá abrirlo con VLC.',
      });
    });
  });
}

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.ts': 'video/mp2t', '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt', '.srt': 'text/plain',
  '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json',
};

export function mimeFor(ext) {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** Duración en segundos según ffprobe, o null si no la puede leer. */
export function probeDuration(absPath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absPath,
    ], { timeout: 20_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const seconds = Number.parseFloat(String(stdout).trim());
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
  });
}

/**
 * Saca un fotograma del video para usarlo de portada. Apunta al 12% de la duración:
 * el principio suele ser una placa negra o un logo, y el medio puede ser una
 * diapositiva cualquiera.
 */
export function extractFrame(absPath, outPath, durationSeconds) {
  return new Promise((resolve) => {
    const at = durationSeconds && durationSeconds > 20 ? durationSeconds * 0.12 : 1;
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(at.toFixed(2)),
      '-i', absPath,
      '-frames:v', '1',
      '-vf', 'scale=640:-2',
      outPath,
    ]);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0));
  });
}
