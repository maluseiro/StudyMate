import { api } from '../api.js';
import { h, icon, clear, debounce, fmtTime, statusPill, RESOURCE_META } from '../ui.js';

function miniCover(color, mono) {
  return h('div', {
    class: 'cover', style: { width: '54px', height: '31px', flex: 'none', background: color, borderRadius: '5px' },
  }, h('span', {
    class: 'cover-mono', style: { fontSize: '20px', bottom: '-5px', right: '-2px' },
  }, mono ?? ''));
}

function highlight(text, needle) {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1 || !needle) return h('span', {}, text);
  return h('span', {},
    text.slice(0, at),
    h('mark', {}, text.slice(at, at + needle.length)),
    text.slice(at + needle.length));
}

function section(title, count, children) {
  if (!children.length) return null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '11px' } },
    h('div', { class: 'group-head' },
      h('span', { style: { fontFamily: 'var(--display)', fontWeight: 600, fontSize: '14px' } }, title),
      h('span', { class: 'rule' }),
      h('span', { class: 'mono muted', style: { fontSize: '11px' } }, String(count))),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, ...children));
}

export async function renderSearch(ctx, initialQuery) {
  const input = h('input', {
    class: 'control', type: 'search', value: initialQuery ?? '',
    placeholder: 'Buscar en títulos de clase, nombres de archivo y tus notas…',
    style: { width: '100%', height: '44px', fontSize: '15px' },
  });

  const results = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '24px' } });
  const summary = h('span', { class: 'subtitle' });

  // Una sección vacía devuelve null; sin este filtro, agregarla al DOM tira error.
  const add = (node) => { if (node) results.appendChild(node); };

  const paint = (data) => {
    clear(results);
    const q = data.q;
    const total = data.courses.length + data.lessons.length + data.notes.length;

    if (q.length < 2) {
      summary.textContent = 'Escribí al menos dos letras.';
      results.appendChild(h('div', { class: 'empty' },
        icon('search', 32, { stroke: 'var(--ring-empty)' }),
        h('h2', {}, 'Buscá en toda tu biblioteca'),
        h('p', {}, 'Encuentra clases por título o por el nombre real del archivo, y también dentro de las notas que escribiste.')));
      return;
    }

    summary.textContent = total
      ? `${total} ${total === 1 ? 'resultado' : 'resultados'} para “${q}”`
      : `Nada para “${q}”`;

    if (!total) {
      results.appendChild(h('div', { class: 'empty' },
        h('h2', {}, 'Sin resultados'),
        h('p', {}, 'Probá con menos palabras, o con el nombre del archivo tal como está en el disco.')));
      return;
    }

    add(section('Cursos', data.courses.length, data.courses.map((c) =>
      h('button', {
        class: 'result-row', onclick: () => ctx.go(`/curso/${c.id}`),
      },
        c.hasCover
          ? h('div', { class: 'cover', style: { width: '54px', height: '31px', flex: 'none', borderRadius: '5px' } },
              h('img', { src: `/cover/${c.id}`, alt: '' }))
          : miniCover(c.cover_color, c.monogram),
        h('div', { class: 'grow' }, highlight(c.title, data.q)),
        statusPill(c.status)))));

    add(section('Clases', data.lessons.length, data.lessons.map((l) =>
      h('button', {
        class: 'result-row',
        onclick: () => {
          if (l.kind === 'video') ctx.go(`/clase/${l.id}`);
          else window.open(`/media/${l.id}`, '_blank', 'noopener');
        },
      },
        l.kind === 'video'
          ? miniCover(l.cover_color, '')
          : h('div', { class: 'res-thumb', style: { width: '54px', height: '31px', flex: 'none', borderRadius: '5px', background: (RESOURCE_META[l.kind] ?? RESOURCE_META.otro).bg, border: 'none' } },
              icon((RESOURCE_META[l.kind] ?? RESOURCE_META.otro).icon, 16, { stroke: (RESOURCE_META[l.kind] ?? RESOURCE_META.otro).color })),
        h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('span', { style: { fontWeight: 500 } }, highlight(l.title, data.q)),
          h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `${l.course_title} · ${l.module_title}`),
          h('span', { class: 'lesson-file' }, highlight(l.file_name, data.q))),
        l.watched ? icon('check', 15, { stroke: 'var(--ok)', width: 2.4 }) : null,
        h('span', { class: 'lesson-dur' }, l.duration ? fmtTime(l.duration) : '')))));

    add(section('En tus notas', data.notes.length, data.notes.map((n) =>
      h('button', {
        class: 'result-row', onclick: () => ctx.go(`/clase/${n.id}`),
      },
        icon('notes', 17, { stroke: 'var(--ink-3)' }),
        h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
          h('span', { style: { fontWeight: 500 } }, n.title),
          h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `${n.course_title} · ${n.module_title}`),
          h('span', { class: 'note-snippet' }, highlight(n.snippet, data.q)))))));
  };

  const run = async (q) => {
    try {
      paint(await api.search(q));
    } catch (err) {
      clear(results).appendChild(h('div', { class: 'empty' }, h('p', {}, err.message)));
    }
  };

  const runDebounced = debounce((q) => run(q), 250);
  input.addEventListener('input', () => runDebounced(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runDebounced.cancel();
      const q = input.value.trim();
      history.replaceState(null, '', '#/buscar/' + encodeURIComponent(q));
      run(q);
    }
  });

  await run((initialQuery ?? '').trim());
  setTimeout(() => { input.focus(); input.select(); }, 30);

  return h('main', { class: 'main' },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
      h('h1', {}, 'Buscar'),
      summary),
    input,
    results);
}
