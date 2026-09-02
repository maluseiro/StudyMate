import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
export const COVERS_DIR = path.join(DATA_DIR, 'covers');
fs.mkdirSync(COVERS_DIR, { recursive: true });

// SQLite viene dentro de Node desde la 22.5. Usarlo en vez de un módulo nativo deja
// a la app sin nada que compilar: instalar no necesita Python ni compilador, que es
// justo lo que no hay en una máquina de trabajo.
export const db = new DatabaseSync(path.join(DATA_DIR, 'studymate.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS roots (
  id         INTEGER PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  added_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id             INTEGER PRIMARY KEY,
  path           TEXT NOT NULL UNIQUE,
  root_id        INTEGER REFERENCES roots(id) ON DELETE SET NULL,
  folder_name    TEXT NOT NULL,
  title          TEXT NOT NULL,
  title_edited   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'sin_empezar',
  status_edited  INTEGER NOT NULL DEFAULT 0,
  kind           TEXT NOT NULL DEFAULT 'estudio',
  cover_color    TEXT NOT NULL DEFAULT '#2C4A6E',
  cover_file     TEXT,
  speed          REAL NOT NULL DEFAULT 1,
  missing        INTEGER NOT NULL DEFAULT 0,
  last_lesson_id INTEGER,
  last_opened_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS modules (
  id           INTEGER PRIMARY KEY,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  rel_path     TEXT NOT NULL,
  folder_name  TEXT NOT NULL,
  title        TEXT NOT NULL,
  title_edited INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  missing      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (course_id, rel_path)
);

CREATE TABLE IF NOT EXISTS lessons (
  id            INTEGER PRIMARY KEY,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  rel_path      TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  title         TEXT NOT NULL,
  title_edited  INTEGER NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL DEFAULT 'video',
  ext           TEXT NOT NULL DEFAULT '',
  playable      INTEGER NOT NULL DEFAULT 1,
  needs_remux   INTEGER NOT NULL DEFAULT 0,
  remux_rel     TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  size          INTEGER NOT NULL DEFAULT 0,
  duration      REAL,
  position      REAL NOT NULL DEFAULT 0,
  watched       INTEGER NOT NULL DEFAULT 0,
  flagged       INTEGER NOT NULL DEFAULT 0,
  missing       INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT,
  UNIQUE (course_id, rel_path)
);

CREATE TABLE IF NOT EXISTS notes (
  lesson_id  INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lessons_course  ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_module  ON lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_lessons_flagged ON lessons(flagged) WHERE flagged = 1;
CREATE INDEX IF NOT EXISTS idx_modules_course  ON modules(course_id);
`);

/**
 * Agrega columnas nuevas a bases ya creadas. CREATE TABLE IF NOT EXISTS no toca una
 * tabla existente, así que sin esto una versión vieja de la base rompería al abrir.
 */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn('lessons', 'remux_rel', 'remux_rel TEXT');
ensureColumn('lessons', 'needs_remux', 'needs_remux INTEGER NOT NULL DEFAULT 0');
ensureColumn('courses', 'cover_file', 'cover_file TEXT');
ensureColumn('courses', 'speed', 'speed REAL NOT NULL DEFAULT 1');
ensureColumn('courses', 'status_edited', 'status_edited INTEGER NOT NULL DEFAULT 0');

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export const STATUSES = ['sin_empezar', 'en_curso', 'en_pausa', 'terminado'];
export const KINDS = ['estudio', 'entretenimiento'];

/**
 * El progreso se calcula siempre desde las clases, nunca se guarda: así no puede
 * quedar desincronizado con la realidad.
 */
export const progressFor = db.prepare(`
  SELECT
    COUNT(*)                                        AS total,
    COALESCE(SUM(watched), 0)                       AS watched
  FROM lessons
  WHERE course_id = ? AND kind = 'video' AND missing = 0
`);

/** La próxima clase pendiente, en orden de módulo y después de clase. */
export const nextLessonFor = db.prepare(`
  SELECT l.*
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  WHERE l.course_id = ? AND l.kind = 'video' AND l.watched = 0 AND l.missing = 0
  ORDER BY m.sort_order, l.sort_order
  LIMIT 1
`);
