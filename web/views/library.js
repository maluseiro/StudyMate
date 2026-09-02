import { api } from '../api.js';
import { h, icon, cover, statusPill, fmtLeft, STATUS_COLOR } from '../ui.js';

const FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'en_curso', label: 'En curso' },
  { key: 'sin_empezar', label: 'Sin empezar' },
  { key: 'en_pausa', label: 'En pausa' },
  { key: 'terminado', label: 'Terminado' },
];

// El filtro vive en la sesión, no en la URL: así volver de un curso no lo pierde.
const readFilter = () => sessionStorage.getItem('sm.filter') ?? 'todos';
const readKind = () => sessionStorage.getItem('sm.kind') ?? '';

function courseCard(ctx, course) {
  const meta = [
    course.modules ? `${course.modules} ${course.modules === 1 ? 'módulo' : 'módulos'}` : null,
    `${course.progress.total} ${course.progress.total === 1 ? 'clase' : 'clases'}`,
    course.resources ? `${course.resources} recursos` : null,
  ].filter(Boolean).join(' · ');

  return h('button', { class: 'card', onclick: () => ctx.go(`/curso/${course.id}`) },
    cover(course, { height: 141 }),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, course.title),
      h('div', { class: 'card-meta' }, meta),
      h('div', { class: 'card-foot' },
        course.kind === 'entretenimiento'
          ? h('span', { class: 'pill', style: { border: '1px dashed var(--ring-empty)', color: 'var(--ink-2)' } }, 'Entretenimiento')
          : statusPill(course.status),
        h('span', { class: 'pill-count mono' },
          course.progress.total
            ? `${course.progress.watched}/${course.progress.total} · ${course.progress.percent}%`
            : 'sin videos'))));
}

function continueBlock(ctx, data) {
  const { course, lesson, module } = data;
  if (!course || !lesson) return null;

  const left = lesson.duration ? lesson.duration - (lesson.position ?? 0) : null;
  const where = [module?.title, lesson.title].filter(Boolean).join(' · ');

  return h('div', { class: 'continue' },
    cover(course, { width: 218, height: 123, play: true }),
    h('div', { class: 'continue-body' },
      h('div', { class: 'eyebrow' }, 'Seguir donde quedaste'),
      h('div', { class: 'continue-title' }, course.title),
      h('div', { style: { fontSize: '14px', color: 'var(--ink-2)' } }, where),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '6px', flexWrap: 'wrap' } },
        h('div', { class: 'bar', style: { width: '300px', maxWidth: '100%' } },
          h('i', { style: { width: `${course.progress.percent}%` } })),
        h('span', { class: 'mono', style: { fontSize: '12px', color: 'var(--ink-2)' } },
          `${course.progress.watched}/${course.progress.total} · ${course.progress.percent}%`),
        left > 0 ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `quedan ${fmtLeft(left)} de esta clase`) : null)),
    h('div', { style: { display: 'flex', alignItems: 'center' } },
      h('button', { class: 'btn btn-accent btn-lg', onclick: () => ctx.go(`/clase/${lesson.id}`) },
        icon('play', 16, { fill: '#fff', stroke: 'none' }), 'Continuar')));
}

export async function renderLibrary(ctx) {
  const active = readFilter();
  const kind = readKind();

  const [{ courses }, cont] = await Promise.all([
    api.courses(active === 'todos' ? (kind ? { kind } : {}) : (kind ? { status: active, kind } : { status: active })),
    api.continueWith(),
  ]);

  const counts = ctx.state.byStatus ?? {};
  const total = ctx.state.totals.courses;

  const setFilter = (key) => { sessionStorage.setItem('sm.filter', key); ctx.go('/'); };
  const toggleKind = () => {
    sessionStorage.setItem('sm.kind', kind === 'entretenimiento' ? '' : 'entretenimiento');
    ctx.go('/');
  };

  const chips = h('div', { class: 'chips' },
    ...FILTERS.map((f) => h('button', {
      class: `chip ${active === f.key ? 'is-active' : ''}`, onclick: () => setFilter(f.key),
    },
      f.key !== 'todos' ? h('span', { class: 'chip-dot', style: { background: STATUS_COLOR[f.key].dot } }) : null,
      f.label,
      h('span', { class: 'chip-n' }, String(f.key === 'todos' ? total : counts[f.key] ?? 0)))),
    h('span', { class: 'divider-v' }),
    h('button', { class: `chip dashed ${kind === 'entretenimiento' ? 'is-active' : ''}`, onclick: toggleKind },
      'Solo entretenimiento'));

  return h('main', { class: 'main' },
    // Sin botones acá: "Agregar curso" vive en la barra superior y las carpetas en
    // Ajustes. Repetirlos era ruido, y en el celular se veía el doble.
    h('div', { class: 'page-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
        h('h1', {}, 'Biblioteca'),
        h('span', { class: 'subtitle' },
          `${total} ${total === 1 ? 'curso' : 'cursos'} · ${ctx.state.totals.lessons} clases`
          + (counts.en_curso ? ` · ${counts.en_curso} en curso` : '')))),

    continueBlock(ctx, cont),
    chips,

    courses.length
      ? h('div', { class: 'grid' }, ...courses.map((c) => courseCard(ctx, c)))
      : h('div', { class: 'empty' },
          h('h2', {}, 'No hay cursos con ese filtro'),
          h('p', {}, active === 'todos'
            ? 'Agregá un curso desde la barra de arriba, o una carpeta entera desde Ajustes.'
            : 'Probá con otro estado, o sacá el filtro de entretenimiento.'),
          active === 'todos'
            ? h('button', { class: 'btn btn-primary', onclick: ctx.openAddCourse },
                icon('plus', 15, { width: 2.1 }), 'Agregar curso')
            : null));
}

export async function renderFlagged(ctx) {
  const { lessons } = await api.flagged();

  const rows = lessons.map((lesson) => h('button', {
    class: 'lesson-row', style: { paddingLeft: '16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '10px', marginBottom: '8px' },
    onclick: () => ctx.go(`/clase/${lesson.id}`),
  },
    h('div', { class: 'cover', style: { width: '54px', height: '31px', flex: 'none', background: lesson.cover_color, borderRadius: '5px' } }),
    h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      h('span', { class: 'lesson-title' }, lesson.title),
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `${lesson.course_title} · ${lesson.module_title}`)),
    icon('flag', 16, { fill: 'var(--accent)', stroke: 'var(--accent)' })));

  return h('main', { class: 'main' },
    h('div', { class: 'page-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
        h('h1', {}, 'Volver a esto'),
        h('span', { class: 'subtitle' }, `${lessons.length} ${lessons.length === 1 ? 'clase marcada' : 'clases marcadas'}`))),
    lessons.length
      ? h('div', {}, ...rows)
      : h('div', { class: 'empty' },
          icon('flag', 32, { stroke: 'var(--ring-empty)' }),
          h('h2', {}, 'Nada marcado todavía'),
          h('p', {}, 'Mientras mirás una clase, tocá "Volver a esto" para dejarla acá y encontrarla después.')));
}
