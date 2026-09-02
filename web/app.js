import { api } from './api.js';
import { h, clear, icon, toast, applyTheme, currentTheme } from './ui.js';
import { renderLibrary, renderFlagged } from './views/library.js';
import { renderCourse } from './views/course.js';
import { renderLesson, disposeLesson } from './views/lesson.js';
import { renderSetup, openAddCourse, openAddRoot } from './views/setup.js';
import { renderSearch } from './views/search.js';

const root = document.getElementById('root');

/** Referencia al campo de la barra, para que la tecla "/" lo enfoque. */
let searchInput = null;

export const ctx = {
  state: null,
  async refreshState() {
    ctx.state = await api.state();
    return ctx.state;
  },
  go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = path;
  },
  openAddCourse: () => openAddCourse(ctx),
  openAddRoot: () => openAddRoot(ctx),
};

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'library' };
  if (parts[0] === 'marcadas') return { name: 'flagged' };
  if (parts[0] === 'buscar') return { name: 'search', q: decodeURIComponent(parts.slice(1).join('/')) };
  if (parts[0] === 'ajustes') return { name: 'settings' };
  if (parts[0] === 'curso' && parts[1]) return { name: 'course', id: parts[1], tab: parts[2] === 'recursos' ? 'recursos' : 'contenido' };
  if (parts[0] === 'clase' && parts[1]) return { name: 'lesson', id: parts[1] };
  return { name: 'library' };
}

const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: 'monitor', light: 'sun', dark: 'moon' };
const THEME_NAME = { auto: 'Tema: sigue al sistema', light: 'Tema: claro', dark: 'Tema: oscuro' };

/** Un solo botón que cicla auto -> claro -> oscuro. El selector completo va en Ajustes. */
function themeButton() {
  const paint = (button) => {
    const theme = currentTheme();
    button.replaceChildren(icon(THEME_ICON[theme], 17));
    button.title = THEME_NAME[theme];
  };
  const button = h('button', {
    class: 'icon-btn', 'aria-label': 'Cambiar tema',
    onclick: () => {
      applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length]);
      paint(button);
    },
  });
  paint(button);
  return button;
}

function navItem(label, iconName, active, onClick, count) {
  return h('button', { class: `nav-item ${active ? 'is-active' : ''}`, onclick: onClick },
    icon(iconName, 17),
    h('span', { class: 'nav-label' }, label),
    count ? h('span', { class: 'nav-count' }, String(count)) : null);
}

function appbar(route) {
  const s = ctx.state;

  const search = h('input', {
    type: 'search', placeholder: 'Buscar clases, archivos y tus notas…',
    value: route.name === 'search' ? (route.q ?? '') : '',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const q = e.currentTarget.value.trim();
      if (q) ctx.go('/buscar/' + encodeURIComponent(q));
    },
  });
  searchInput = search;

  return h('header', { class: 'appbar' },
    h('button', { class: 'brand', onclick: () => ctx.go('/') },
      h('div', { class: 'brand-mark' }, icon('play', 14, { fill: 'var(--solid-fg)', stroke: 'none' })),
      h('span', { class: 'brand-name' }, 'StudyMate')),

    h('nav', { class: 'nav' },
      navItem('Biblioteca', 'library', route.name === 'library' || route.name === 'course', () => ctx.go('/')),
      navItem('Volver a esto', 'flag', route.name === 'flagged', () => ctx.go('/marcadas'), s.totals.flagged)),

    h('div', { class: 'appbar-search' },
      h('div', {}, icon('search', 17), search, h('span', { class: 'kbd' }, '/'))),

    h('div', { class: 'appbar-actions' },
      themeButton(),
      h('button', {
        class: `icon-btn ${route.name === 'settings' ? 'is-active' : ''}`,
        title: 'Ajustes', onclick: () => ctx.go('/ajustes'),
      }, icon('gear', 17)),
      h('button', { class: 'btn btn-primary', onclick: ctx.openAddCourse },
        icon('plus', 15, { width: 2.1 }), 'Agregar curso')));
}

let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  const route = parseRoute();
  disposeLesson();

  if (!ctx.state) {
    try {
      await ctx.refreshState();
    } catch (err) {
      clear(root).appendChild(h('div', { class: 'main' },
        h('div', { class: 'empty' },
          h('h2', {}, 'No se puede hablar con el servidor'),
          h('p', {}, err.message))));
      return;
    }
  }
  if (token !== renderToken) return;

  // La pantalla de clase usa todo el ancho: no lleva la barra lateral.
  if (route.name === 'lesson') {
    const view = await renderLesson(ctx, route.id);
    if (token !== renderToken) return;
    clear(root).appendChild(view);
    window.scrollTo(0, 0);
    return;
  }

  if (!ctx.state.configured) {
    clear(root).appendChild(h('div', { class: 'app' }, appbar(route), renderSetup(ctx)));
    return;
  }

  let main;
  try {
    if (route.name === 'course') main = await renderCourse(ctx, route.id, route.tab);
    else if (route.name === 'search') main = await renderSearch(ctx, route.q);
    else if (route.name === 'flagged') main = await renderFlagged(ctx);
    else if (route.name === 'settings') main = renderSetup(ctx, { asSettings: true });
    else main = await renderLibrary(ctx);
  } catch (err) {
    main = h('main', { class: 'main' },
      h('div', { class: 'empty' }, h('h2', {}, 'Algo se rompió'), h('p', {}, err.message)));
  }
  if (token !== renderToken) return;

  clear(root).appendChild(h('div', { class: 'app' }, appbar(route), main));
  window.scrollTo(0, 0);
}

// "/" enfoca el campo de la barra, como en tantas apps. En la clase no: ahí las
// teclas son del reproductor.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.target.matches('input, textarea, select')) return;
  if (parseRoute().name === 'lesson') return;
  e.preventDefault();
  if (searchInput?.isConnected) { searchInput.focus(); searchInput.select(); }
  else ctx.go('/buscar/');
});

window.addEventListener('hashchange', render);
render();
