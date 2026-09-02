/** Crea un elemento. `h('div', {class: 'x', onclick: fn}, 'texto', otroNodo)` */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---------------------------------------------------------------- iconos
const PATHS = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 6h3.2v12H9zM14.8 6H18v12h-3.2z" fill="currentColor" stroke="none"/>',
  library: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="15" width="7" height="5" rx="1.5"/><rect x="14" y="15" width="7" height="5" rx="1.5"/>',
  flag: '<path d="M6 4h12v16l-6-4.2L6 20z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.7 2.7 1.7 1.7 0 0 0-1.9.3 1.7 1.7 0 0 0-1 1.5 2 2 0 1 1-4 0 1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3 2 2 0 1 1-2.7-2.7 1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9 2 2 0 1 1 2.7-2.7 1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5 2 2 0 1 1 4 0 1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3 2 2 0 1 1 2.7 2.7 1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-6 6"/>',
  code: '<path d="M9 18l-5-6 5-6"/><path d="M15 6l5 6-5 6"/>',
  archive: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M11 6V4h2v2"/>',
  upload: '<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  warning: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.4 17.5A1.8 1.8 0 0 0 4 20.3h16a1.8 1.8 0 0 0 1.6-2.8L13.7 3.9a1.8 1.8 0 0 0-3.4 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  notes: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H18a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  convert: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  checkAll: '<path d="M2 13l3.5 3.5L11 11"/><path d="M11 16.5l1.5 1.5L22 8.5"/><path d="M16 7l-3.5 3.5"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  download: '<path d="M12 4v12"/><path d="M8 12l4 4 4-4"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
};

export function icon(name, size = 16, extra = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', extra.width ?? 1.8);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.flex = 'none';
  svg.innerHTML = PATHS[name] ?? '';
  // Como estilo y no como atributo: un atributo de presentación no resuelve var().
  if (extra.stroke) svg.style.stroke = extra.stroke;
  if (extra.fill) svg.style.fill = extra.fill;
  return svg;
}

/** Círculo de estado de una clase: vista, en curso, o pendiente. */
export function statusDot(lesson, current = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', 18);
  svg.setAttribute('height', 18);
  svg.style.flex = 'none';
  if (current) {
    svg.innerHTML = '<circle cx="12" cy="12" r="9.5" style="fill: var(--accent)"/><path d="M10 8.6v6.8l5.6-3.4z" style="fill: #fff"/>';
  } else if (lesson.watched) {
    svg.innerHTML = '<circle cx="12" cy="12" r="9.5" style="fill: var(--st-done-bg)"/><path d="M16.5 9.5L10.8 15.2 7.8 12.2" style="fill: none; stroke: var(--st-done-fg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  } else {
    svg.innerHTML = '<circle cx="12" cy="12" r="8.8" style="fill: none; stroke: var(--ring-empty)" stroke-width="1.9"/>';
  }
  return svg;
}

// ---------------------------------------------------------------- formato
export function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const hrs = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hrs ? `${hrs}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return 'menos de un minuto';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hrs} h ${rest} min` : `${hrs} h`;
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value < 10 && i > 0 ? value.toFixed(1).replace('.', ',') : Math.round(value)} ${units[i]}`;
}

export const STATUS_LABEL = {
  sin_empezar: 'Sin empezar',
  en_curso: 'En curso',
  en_pausa: 'En pausa',
  terminado: 'Terminado',
};

export const STATUS_COLOR = {
  sin_empezar: { dot: 'var(--st-start-dot)', bg: 'var(--st-start-bg)', fg: 'var(--st-start-fg)' },
  en_curso: { dot: 'var(--st-going-dot)', bg: 'var(--st-going-bg)', fg: 'var(--st-going-fg)' },
  en_pausa: { dot: 'var(--st-pause-dot)', bg: 'var(--st-pause-bg)', fg: 'var(--st-pause-fg)' },
  terminado: { dot: 'var(--st-done-dot)', bg: 'var(--st-done-bg)', fg: 'var(--st-done-fg)' },
};

export const RESOURCE_META = {
  pdf: { label: 'PDF', icon: 'doc', color: 'var(--res-pdf)', bg: 'var(--res-pdf-bg)' },
  imagen: { label: 'Imagen', icon: 'image', color: 'var(--res-img)', bg: 'var(--res-img-bg)' },
  codigo: { label: 'Código', icon: 'code', color: 'var(--res-code)', bg: 'var(--res-code-bg)' },
  comprimido: { label: 'Comprimido', icon: 'archive', color: 'var(--res-zip)', bg: 'var(--res-zip-bg)' },
  otro: { label: 'Archivo', icon: 'doc', color: 'var(--res-any)', bg: 'var(--res-any-bg)' },
};

/** Portada del curso: la imagen que subiste, o el color y monograma generados. */
export function cover(course, { height, width, progress = true, play = false, flag = false } = {}) {
  const node = h('div', { class: 'cover', style: { background: course.cover_color } });
  if (width) node.style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) node.style.height = typeof height === 'number' ? `${height}px` : height;

  if (course.hasCover) {
    node.appendChild(h('img', { src: `/cover/${course.id}?v=${course.id}`, alt: '', loading: 'lazy' }));
  } else {
    const size = Math.max(28, Math.round((typeof height === 'number' ? height : 141) * 0.47));
    node.appendChild(h('span', {
      class: 'cover-mono',
      style: { fontSize: `${size}px`, bottom: `${-size * 0.28}px` },
    }, course.monogram));
  }
  if (play) {
    node.appendChild(h('div', { class: 'cover-play' }, h('span', {}, icon('play', 17))));
  }
  if (flag) {
    node.appendChild(h('div', { class: 'cover-flag' }, icon('flag', 13, { fill: '#fff', stroke: '#fff' })));
  }
  if (progress && course.progress) {
    const done = course.progress.percent >= 100;
    node.appendChild(h('div', { class: 'cover-bar' },
      h('i', { class: done ? 'done' : '', style: { width: `${course.progress.percent}%` } })));
  }
  return node;
}

export function statusPill(status) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.sin_empezar;
  return h('span', { class: 'pill', style: { background: c.bg, color: c.fg } },
    status === 'terminado'
      ? icon('check', 11, { width: 3 })
      : h('span', { class: 'chip-dot', style: { background: c.dot } }),
    STATUS_LABEL[status] ?? status);
}

let toastTimer;
export function toast(message, kind = 'ok') {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: `toast ${kind === 'bad' ? 'is-bad' : ''}` },
    icon(kind === 'bad' ? 'warning' : 'check', 15, { width: 2.2 }), message);
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === 'bad' ? 6000 : 3000);
}

/** Evita que se pierda lo que estás escribiendo mientras se guarda en segundo plano. */
export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

// ---------------------------------------------------------------- tema
const THEME_KEY = 'sm.theme';

export function currentTheme() {
  return localStorage.getItem(THEME_KEY) ?? 'auto';
}

/** 'auto' deja mandar al sistema; 'light' y 'dark' lo fuerzan. */
export function applyTheme(theme) {
  if (theme === 'auto') {
    localStorage.removeItem(THEME_KEY);
    document.documentElement.removeAttribute('data-theme');
  } else {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Confirmación para acciones que tocan muchas clases de una. Devuelve una promesa
 * que resuelve true o false; el <dialog> nativo ya maneja Escape y el foco.
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const dlg = h('dialog', { style: { width: '460px' } },
      h('div', { class: 'dialog-head' },
        h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('h2', {}, title),
          h('span', { class: 'subtitle' }, body))),
      h('div', { class: 'dialog-foot' },
        h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancelar'),
        h('button', {
          class: danger ? 'btn' : 'btn btn-primary',
          style: danger ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' } : {},
          onclick: () => { answer = true; dlg.close(); },
        }, confirmLabel)));

    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
