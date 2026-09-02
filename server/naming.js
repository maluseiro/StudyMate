// Convierte nombres de archivo de cursos en títulos legibles y los ordena
// como los ordenaría una persona (2 antes que 10).

const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.ts', '.avi', '.wmv', '.flv', '.mpg', '.mpeg']);

// El navegador puede intentar estos; si falla, el cliente muestra el fallback.
const TRY_IN_BROWSER = new Set(['.mp4', '.m4v', '.webm', '.mov']);

// Estos necesitan remux sí o sí: el navegador ni lo intenta.
const NEEDS_REMUX = new Set(['.mkv', '.ts', '.avi', '.wmv', '.flv', '.mpg', '.mpeg']);

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg']);
const ARCHIVE = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz']);
const CODE = new Set([
  '.sql', '.py', '.js', '.jsx', '.tsx', '.java', '.c', '.h', '.cpp', '.cs', '.go',
  '.rb', '.php', '.html', '.htm', '.css', '.scss', '.json', '.yml', '.yaml', '.sh',
  '.ps1', '.md', '.txt', '.ipynb', '.xml', '.env', '.toml', '.rs', '.kt', '.swift',
]);
const SUBTITLE = new Set(['.srt', '.vtt', '.ass', '.sub']);

// Basura que no queremos indexar.
const IGNORED_NAMES = new Set(['thumbs.db', '.ds_store', 'desktop.ini']);
const IGNORED_DIRS = new Set(['.git', '.svn', '__macosx', 'node_modules', '.studymate']);

/**
 * `.ts` es ambiguo: puede ser video MPEG-TS o código TypeScript. El tamaño es una
 * pista floja, así que quien llama mira la firma binaria del archivo (ver
 * `looksLikeTransportStream`) y nos pasa el resultado.
 */
export function classify(ext, sizeBytes = 0, { isTransportStream = false } = {}) {
  const e = ext.toLowerCase();

  if (e === '.ts') {
    return isTransportStream
      ? { kind: 'video', playable: 0, needsRemux: 1 }
      : { kind: 'codigo', playable: 0, needsRemux: 0 };
  }
  if (VIDEO.has(e)) {
    return {
      kind: 'video',
      playable: TRY_IN_BROWSER.has(e) ? 1 : 0,
      needsRemux: NEEDS_REMUX.has(e) ? 1 : 0,
    };
  }
  if (e === '.pdf') return { kind: 'pdf', playable: 0, needsRemux: 0 };
  if (IMAGE.has(e)) return { kind: 'imagen', playable: 0, needsRemux: 0 };
  if (ARCHIVE.has(e)) return { kind: 'comprimido', playable: 0, needsRemux: 0 };
  if (CODE.has(e)) return { kind: 'codigo', playable: 0, needsRemux: 0 };
  if (SUBTITLE.has(e)) return { kind: 'subtitulo', playable: 0, needsRemux: 0 };
  return { kind: 'otro', playable: 0, needsRemux: 0 };
}

export function isIgnored(name) {
  const lower = name.toLowerCase();
  return lower.startsWith('.') || IGNORED_NAMES.has(lower);
}

export function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name.toLowerCase()) || name.startsWith('.');
}

/** Ordena "2" antes que "10", y "1.5" antes que "1.10". */
export function naturalCompare(a, b) {
  const chunk = (s) => String(s).match(/(\d+|\D+)/g) ?? [];
  const ca = chunk(a.toLowerCase());
  const cb = chunk(b.toLowerCase());
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// Prefijos y sufijos que los sitios de descarga meten en los nombres.
const JUNK_PATTERNS = [
  /^\s*\[[^\]]{1,40}\]\s*/,               // [TutsNode] al principio
  /\s*\[[^\]]{1,40}\]\s*$/,               // [1080p] al final
  /^\s*www\.[^\s]+\s*[-–_]\s*/i,          // www.sitio.com -
  /^\s*[a-z0-9-]+\.(com|net|org|io)\s*[-–_]\s*/i,
  /\s*[-–_]\s*por\s+[^-–_]+$/i,
];

// "01 - ", "1.", "02_", "Lesson 3 -", "Clase 4:"
const LEADING_INDEX = /^\s*(?:(?:lesson|leccion|lección|clase|class|video|vid|part|parte|cap|capitulo|capítulo|module|modulo|módulo|section|seccion|sección)\s*)?[0-9]{1,3}\s*[.)\-–_:]*\s+/i;
const BARE_LEADING_NUMBER = /^\s*[0-9]{1,3}\s*[.)\-–_:]\s*/;

function tidy(text) {
  let t = text;
  for (const p of JUNK_PATTERNS) t = t.replace(p, '');
  t = t.replace(/[_]+/g, ' ');
  // Nombres tipo slug ("explain-plan-annotated") se leen mejor con espacios; los que
  // ya traen espacios se dejan como están, para no romper "01 - Welcome".
  if (!/\s/.test(t)) t = t.replace(/-+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-–_:.\s]+/, '').replace(/[-–_:\s]+$/, '');
  return t;
}

/**
 * "19 - Composite and covering indexes.mp4" -> "Composite and covering indexes"
 * Si limpiar deja el título vacío, se devuelve el nombre original: es mejor un
 * título feo que uno en blanco.
 */
export function cleanTitle(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  let t = tidy(base);
  const withoutIndex = tidy(t.replace(LEADING_INDEX, '').replace(BARE_LEADING_NUMBER, ''));
  if (withoutIndex.length >= 2) t = withoutIndex;
  if (!t) return base || fileName;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function cleanFolderTitle(folderName) {
  const t = cleanTitle(folderName + '.x');
  return t || folderName;
}

/** Extrae el número que trae el nombre, para ordenar cuando existe. */
export function leadingNumber(name) {
  const m = name.match(/^\s*(?:[a-zé]+\s*)?([0-9]{1,3})\b/i);
  return m ? Number(m[1]) : null;
}

/** Iniciales para la portada generada: "PostgreSQL para desarrolladores" -> "PP". */
export function monogram(title) {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(de|del|la|el|los|las|un|una|y|the|of|for|and|to|in|con|para|por)$/i.test(w));
  if (words.length === 0) return title.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const COVER_COLORS = ['#2C4A6E', '#7A3B2E', '#3F4A66', '#2F5D4F', '#4A3A6B', '#6B5638', '#5C2F3E', '#2E5560'];

/** Color estable: el mismo título siempre da el mismo color. */
export function coverColor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

export { COVER_COLORS };
