import { api } from './api.js';
import { h, clear, icon, toast, applyTheme, currentTheme } from './ui.js';
import { renderLibrary, renderFlagged } from './views/library.js';
import { renderCourse } from './views/course.js';
import { renderLesson, disposeLesson } from './views/lesson.js';
import { renderSetup, openAddCourse, openAddRoot } from './views/setup.js';
import { renderSearch } from './views/search.js';

const root = document.getElementById('root');

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

function navItem(label, iconName, active, onClick, count) {
  return h('button', { class: `nav-item ${active ? 'is-active' : ''}`, onclick: onClick },
    icon(iconName, 17),
    h('span', { class: 'grow' }, label),
    count ? h('span', { class: 'nav-count' }, String(count)) : null);
}

function themeToggle() {
  const active = currentTheme();
  const row = h('div', { class: 'theme-toggle' },
    ...[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([value, label]) =>
      h('button', {
        class: value === active ? 'is-active' : '',
        onclick: (e) => {
          applyTheme(value);
          row.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
        },
      }, label)));
  return row;
}

function sidebar(route) {
  const s = ctx.state;
  return h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark' }, icon('play', 13, { fill: 'var(--solid-fg)', stroke: 'none' })),
      h('span', { class: 'brand-name' }, 'StudyMate')),

    h('div', { class: 'search-box' },
      icon('search', 15),
      h('input', {
        type: 'search', placeholder: 'Buscar…  /',
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          const q = e.currentTarget.value.trim();
          if (q) ctx.go('/buscar/' + encodeURIComponent(q));
        },
      })),

    h('nav', { class: 'nav' },
      navItem('Biblioteca', 'library', route.name === 'library' || route.name === 'course', () => ctx.go('/')),
      navItem('Buscar', 'search', route.name === 'search', () => ctx.go('/buscar/')),
      navItem('Volver a esto', 'flag', route.name === 'flagged', () => ctx.go('/marcadas'), s.totals.flagged),
      navItem('Ajustes', 'gear', route.name === 'settings', () => ctx.go('/ajustes'))),

    h('div', { class: 'side-block' },
      h('div', { class: 'side-label' }, 'Carpetas de biblioteca'),
      ...(s.roots.length
        ? s.roots.map((r) => h('div', { class: 'root-row' },
            icon('folder', 14, { stroke: 'var(--ink-3)' }),
            h('span', { class: 'mono grow' }, r.path)))
        : [h('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--ink-3)' } }, 'Ninguna todavía')]),
      h('button', { class: 'btn btn-ghost btn-sm', style: { justifyContent: 'flex-start', padding: 0 }, onclick: ctx.openAddRoot },
        icon('plus', 13, { width: 2.1 }), 'Agregar carpeta')),

    h('div', { class: 'grow' }),

    h('div', { class: 'side-block' },
      h('div', { class: 'side-label' }, 'Tema'),
      themeToggle()),

    h('div', { class: 'side-foot side-block' },
      s.lastScan
        ? h('div', { class: 'mono', style: { fontSize: '10.5px', color: 'var(--ink-3)' } },
            `Escaneado ${new Date(s.lastScan.at).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
        : null,
      h('button', {
        class: 'btn btn-sm',
        onclick: async (e) => {
          const button = e.currentTarget;
          button.disabled = true;
          button.textContent = 'Escaneando…';
          try {
            const { stats } = await api.scan();
            await ctx.refreshState();
            toast(`${stats.courses} cursos · ${stats.lessons} archivos en ${(stats.ms / 1000).toFixed(1)} s`);
            render();
          } catch (err) {
            toast(err.message, 'bad');
            button.disabled = false;
            button.textContent = 'Reescanear';
          }
        },
      }, icon('refresh', 14, { width: 1.9 }), 'Reescanear')));
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
    clear(root).appendChild(h('div', { class: 'app' }, sidebar(route), renderSetup(ctx)));
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

  clear(root).appendChild(h('div', { class: 'app' }, sidebar(route), main));
  window.scrollTo(0, 0);
}

// "/" desde cualquier pantalla lleva al buscador, como en tantas apps.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.target.matches('input, textarea, select')) return;
  if (parseRoute().name === 'lesson') return; // ahí las teclas son del reproductor
  e.preventDefault();
  ctx.go('/buscar/');
});

window.addEventListener('hashchange', render);
render();
