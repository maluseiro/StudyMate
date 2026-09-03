import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { db, getSetting } from './db.js';

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

/**
 * ffmpeg y ffprobe son binarios distintos: convertir usa el primero y leer
 * duraciones el segundo. Chequear solo uno hacía que un botón se habilitara para
 * después fallar en silencio.
 *
 * Tampoco alcanza con confiar en el PATH: en Windows, un programa lanzado desde el
 * Explorador hereda el entorno de cuando el Explorador arrancó, así que ffmpeg
 * recién instalado no aparece hasta cerrar sesión. Por eso, si el PATH falla,
 * buscamos en los lugares donde winget y los instaladores habituales lo dejan.
 */
export const FFMPEG_DIR_SETTING = 'ffmpeg_dir';

const EXE = process.platform === 'win32' ? '.exe' : '';
const resolved = { ffmpeg: null, ffprobe: null };

function wingetPackageDirs() {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
    : null;
  if (!base) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/ffmpeg/i.test(entry.name)) continue;
    const pkg = path.join(base, entry.name);
    out.push(pkg, path.join(pkg, 'bin'));
    // winget descomprime en una subcarpeta con la versión adentro del paquete
    try {
      for (const sub of fs.readdirSync(pkg, { withFileTypes: true })) {
        if (sub.isDirectory()) out.push(path.join(pkg, sub.name), path.join(pkg, sub.name, 'bin'));
      }
    } catch { /* paquete ilegible */ }
  }
  return out;
}

function candidateDirs() {
  const dirs = [];
  const configured = getSetting(FFMPEG_DIR_SETTING);
  if (configured) dirs.push(configured, path.join(configured, 'bin'));

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) dirs.push(path.join(local, 'Microsoft', 'WinGet', 'Links'));
    dirs.push(...wingetPackageDirs());
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (root) dirs.push(path.join(root, 'ffmpeg', 'bin'));
    }
    if (process.env.ProgramData) dirs.push(path.join(process.env.ProgramData, 'chocolatey', 'bin'));
    dirs.push('C:\\ffmpeg\\bin');
  } else {
    dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/snap/bin');
  }
  return dirs;
}

const runs = (command) => new Promise((resolve) => {
  execFile(command, ['-version'], { timeout: 8000 }, (err) => resolve(!err));
});

/**
 * Devuelve con qué comando invocar la herramienta: su nombre si el PATH alcanza, o
 * la ruta completa si hubo que salir a buscarla. `null` si no está en ningún lado.
 */
export async function resolveTool(name) {
  if (resolved[name] && (resolved[name] === name || fs.existsSync(resolved[name]))) {
    return resolved[name];
  }
  if (await runs(name)) {
    resolved[name] = name;
    return name;
  }
  for (const dir of candidateDirs()) {
    const full = path.join(dir, name + EXE);
    if (!fs.existsSync(full)) continue;
    if (await runs(full)) {
      resolved[name] = full;
      return full;
    }
  }
  return null;
}

export async function probeTools() {
  const [ffmpeg, ffprobe] = await Promise.all([resolveTool('ffmpeg'), resolveTool('ffprobe')]);
  return {
    ffmpeg: Boolean(ffmpeg), ffprobe: Boolean(ffprobe),
    ffmpegPath: ffmpeg, ffprobePath: ffprobe,
    ffmpegDir: getSetting(FFMPEG_DIR_SETTING) ?? null,
  };
}

export async function ffmpegAvailable() { return Boolean(await resolveTool('ffmpeg')); }
export async function ffprobeAvailable() { return Boolean(await resolveTool('ffprobe')); }

/** Olvida lo encontrado, para que "Volver a comprobar" busque de nuevo de verdad. */
export function forgetTools() {
  resolved.ffmpeg = null;
  resolved.ffprobe = null;
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
  return new Promise(async (resolve) => {
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
    const cmd = await resolveTool('ffmpeg');
    if (!cmd) return resolve({ ok: false, error: 'No se encontró ffmpeg.' });
    const proc = spawn(cmd, args);
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
    resolveTool('ffprobe').then((cmd) => {
    if (!cmd) return resolve({ seconds: null, error: 'No se encontró ffprobe.' });
    execFile(cmd, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absPath,
    ], { timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) {
        const detalle = err.code === 'ENOENT'
          ? 'No se encontró ffprobe en el PATH.'
          : (String(stderr || '').trim().split('\n').pop() || err.message);
        return resolve({ seconds: null, error: detalle });
      }
      const seconds = Number.parseFloat(String(stdout).trim());
      return Number.isFinite(seconds) && seconds > 0
        ? resolve({ seconds })
        : resolve({ seconds: null, error: 'ffprobe no devolvió una duración para este archivo.' });
    });
    });
  });
}

/**
 * Saca un fotograma del video para usarlo de portada. Apunta al 12% de la duración:
 * el principio suele ser una placa negra o un logo, y el medio puede ser una
 * diapositiva cualquiera.
 */
export function extractFrame(absPath, outPath, durationSeconds) {
  return new Promise(async (resolve) => {
    const cmd = await resolveTool('ffmpeg');
    if (!cmd) return resolve(false);
    const at = durationSeconds && durationSeconds > 20 ? durationSeconds * 0.12 : 1;
    const proc = spawn(cmd, [
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
