import { api } from '../api.js';
import { h, icon, cover, statusDot, fmtTime, fmtSize, toast, clear,
         STATUS_LABEL, RESOURCE_META } from '../ui.js';
import { render } from '../app.js';

const openModules = new Set();

/** Convierte un título en un campo de texto en el lugar, sin sacarte de la página. */
function inlineRename(node, current, onSave) {
  const input = h('input', { class: 'control', value: current, style: { width: '100%', maxWidth: '520px' } });
  // Enter confirma y además provoca blur: sin esta guarda, se intentaba restaurar
  // el título dos veces y la segunda tiraba un error de DOM.
  let closed = false;
  const finish = async (commit) => {
    if (closed) return;
    closed = true;
    const value = input.value.trim();
    input.replaceWith(node);
    if (commit && value && value !== current) {
      try { await onSave(value); } catch (err) { toast(err.message, 'bad'); }
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  node.replaceWith(input);
  input.focus();
  input.select();
}

function lessonRow(ctx, lesson, index) {
  const title = h('span', { class: 'lesson-title' }, lesson.title);
  const playable = lesson.playable || lesson.remux_rel;

  const body = h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '1px' } },
    title,
    h('span', { class: 'lesson-file' }, lesson.file_name));

  return h('div', {
    class: `lesson-row ${lesson.watched ? 'is-watched' : ''}`,
    draggable: true,
    dataset: { lessonId: String(lesson.id) },
    onclick: (e) => { if (!e.target.closest('button')) ctx.go(`/clase/${lesson.id}`); },
  },
    h('span', { class: 'drag-handle', title: 'Arrastrá para reordenar' },
      icon('grip', 14, { stroke: 'var(--ink-4)' })),
    statusDot(lesson),
    h('span', { class: 'lesson-n' }, String(index + 1)),
    body,
    !playable ? h('span', { class: 'pill', style: { background: 'var(--st-going-bg)', color: 'var(--accent-ink)' } },
      icon('warning', 12, { width: 2 }), lesson.ext.replace('.', '').toUpperCase()) : null,
    h('button', {
      class: 'btn btn-sm rename-btn', title: 'Renombrar sin tocar el archivo',
      onclick: (e) => { e.stopPropagation(); inlineRename(title, lesson.title, async (value) => {
        await api.updateLesson(lesson.id, { title: value });
        lesson.title = value;
        title.textContent = value;
      }); },
    }, icon('pencil', 12, { width: 2 }), 'Renombrar'),
    h('span', { class: 'lesson-dur' }, lesson.duration ? fmtTime(lesson.duration) : '—'),
    h('button', {
      class: `icon-btn ${lesson.flagged ? 'is-on' : ''}`, title: 'Volver a esto',
      onclick: async (e) => {
        e.stopPropagation();
        const next = !lesson.flagged;
        await api.updateLesson(lesson.id, { flagged: next });
        lesson.flagged = next ? 1 : 0;
        e.currentTarget.classList.toggle('is-on', next);
        e.currentTarget.replaceChildren(icon('flag', 16, next ? { fill: 'var(--accent)', stroke: 'var(--accent)' } : {}));
        await ctx.refreshState();
      },
    }, icon('flag', 16, lesson.flagged ? { fill: 'var(--accent)', stroke: 'var(--accent)' } : {})));
}

/**
 * Reordenar arrastrando, dentro del módulo. Al soltar se guarda el orden y el
 * módulo queda marcado como ordenado a mano: el escaneo ya no lo reacomoda.
 */
function makeSortable(list, module) {
  let dragging = null;

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.lesson-row');
    if (!row) return;
    dragging = row;
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.lessonId);
  });

  list.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest('.lesson-row');
    if (!over || over === dragging) return;
    const box = over.getBoundingClientRect();
    const below = e.clientY > box.top + box.height / 2;
    list.insertBefore(dragging, below ? over.nextSibling : over);
  });

  list.addEventListener('dragend', async () => {
    if (!dragging) return;
    dragging.classList.remove('is-dragging');
    dragging = null;

    const rows = [...list.querySelectorAll('.lesson-row')];
    rows.forEach((row, i) => { row.querySelector('.lesson-n').textContent = String(i + 1); });
    try {
      await api.reorderModule(module.id, rows.map((row) => Number(row.dataset.lessonId)));
      toast('Orden guardado');
      module.order_edited = 1;
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

function moduleBlock(ctx, module, isOpen) {
  const watched = module.lessons.filter((l) => l.watched).length;
  const totalSeconds = module.lessons.reduce((sum, l) => sum + (l.duration ?? 0), 0);
  const complete = module.lessons.length > 0 && watched === module.lessons.length;

  const titleNode = h('span', { class: 'module-title' }, module.title);
  const chevron = icon(isOpen ? 'chevronDown' : 'chevronRight', 15, { width: 2.2 });

  // Abrir y cerrar es local: redibujar la página entera en cada clic hacía que un
  // curso de 33 módulos se sintiera pesado, y encima volvía a pedir el curso al
  // servidor. Las filas se construyen la primera vez que se abre el módulo.
  const body = h('div', { class: isOpen ? '' : 'hidden' });
  let built = false;
  const buildRows = () => {
    if (built) return;
    built = true;
    module.lessons.forEach((l, i) => body.appendChild(lessonRow(ctx, l, i)));
    makeSortable(body, module);
  };
  if (isOpen) buildRows();

  const toggle = () => {
    const open = !openModules.has(module.id);
    if (open) { openModules.add(module.id); buildRows(); }
    else openModules.delete(module.id);
    wrapper.classList.toggle('is-open', open);
    body.classList.toggle('hidden', !open);
    foot?.classList.toggle('hidden', !open);
    // Hay que reemplazar la flecha que está en el DOM ahora, no la original: en el
    // segundo clic esa ya no es hija de nadie.
    const next = icon(open ? 'chevronDown' : 'chevronRight', 15, { width: 2.2 });
    currentChevron.replaceWith(next);
    currentChevron = next;
  };

  let currentChevron = chevron;

  const head = h('button', { class: 'module-head', onclick: toggle },
    chevron,
    h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      titleNode,
      module.folder_name !== module.title ? h('span', { class: 'module-file' }, module.folder_name) : null),
    h('button', {
      class: 'icon-btn', title: 'Renombrar módulo',
      onclick: (e) => { e.stopPropagation(); inlineRename(titleNode, module.title, async (value) => {
        await api.updateModule(module.id, { title: value });
        module.title = value;
        titleNode.textContent = value;
      }); },
    }, icon('pencil', 14)),
    h('span', { class: 'muted', style: { fontSize: '12.5px' } },
      `${module.lessons.length} ${module.lessons.length === 1 ? 'clase' : 'clases'}${totalSeconds ? ` · ${fmtTime(totalSeconds)}` : ''}`),
    h('span', {
      class: 'pill',
      style: complete
        ? { background: 'var(--ok-soft)', color: 'var(--ok)' }
        : (watched ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' } : { background: 'var(--surface-2)', color: 'var(--ink-3)' }),
    }, complete ? icon('check', 11, { width: 3 }) : null, `${watched}/${module.lessons.length}`));

  const foot = module.order_edited
      ? h('div', { class: `module-foot ${isOpen ? '' : 'hidden'}` },
          icon('pencil', 12, { stroke: 'var(--ink-3)' }),
          h('span', { class: 'grow' }, 'Ordenado a mano. Las clases nuevas se agregan al final.'),
          h('button', {
            class: 'btn btn-sm',
            onclick: async () => {
              try {
                await api.resetOrder(module.id);
                toast('Volvió al orden de los archivos');
                render();
              } catch (err) { toast(err.message, 'bad'); }
            },
          }, 'Volver al orden original'))
      : null;

  const wrapper = h('div', { class: `module ${isOpen ? 'is-open' : ''}` }, head, body, foot);
  return wrapper;
}

// ---------------------------------------------------------------- recursos

function resourceCard(ctx, resource) {
  const meta = RESOURCE_META[resource.kind] ?? RESOURCE_META.otro;
  const isImage = resource.kind === 'imagen';

  const thumb = h('div', { class: 'res-thumb', style: { background: meta.bg } },
    isImage
      ? h('img', { src: `/media/${resource.id}`, alt: '', loading: 'lazy' })
      : icon(meta.icon, 34, { stroke: meta.color, width: 1.5 }));

  return h('button', {
    class: 'res-card',
    title: 'Abrir',
    onclick: () => {
      if (resource.kind === 'pdf' || isImage) window.open(`/media/${resource.id}`, '_blank', 'noopener');
      else api.openFolder(resource.id).catch((err) => toast(err.message, 'bad'));
    },
  },
    thumb,
    h('div', { class: 'res-body' },
      h('div', { class: 'res-title' }, resource.title),
      h('span', { class: 'lesson-file' }, resource.file_name),
      h('span', { class: 'mono muted', style: { fontSize: '10.5px', paddingTop: '2px' } }, fmtSize(resource.size))));
}

function resourcesTab(ctx, data) {
  const groups = data.modules.filter((m) => m.resources.length);
  const all = groups.flatMap((m) => m.resources);

  if (!all.length) {
    return h('div', { class: 'empty' },
      icon('folder', 32, { stroke: 'var(--ring-empty)' }),
      h('h2', {}, 'Este curso no trae material aparte'),
      h('p', {}, 'Acá aparecen los PDFs, imágenes, código y comprimidos que vengan en la carpeta del curso.'));
  }

  const kinds = ['pdf', 'imagen', 'codigo', 'comprimido', 'otro']
    .map((kind) => ({ kind, n: all.filter((r) => r.kind === kind).length }))
    .filter((k) => k.n > 0);

  let active = 'todos';
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '22px' } });

  const paint = () => {
    clear(body);
    for (const module of groups) {
      const items = active === 'todos' ? module.resources : module.resources.filter((r) => r.kind === active);
      if (!items.length) continue;
      body.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '11px' } },
        h('div', { class: 'group-head' },
          h('span', { style: { fontFamily: 'var(--display)', fontWeight: 600, fontSize: '14px' } }, module.title),
          h('span', { class: 'rule' }),
          h('span', { class: 'mono muted', style: { fontSize: '11px' } }, String(items.length))),
        h('div', { class: 'res-grid' }, ...items.map((r) => resourceCard(ctx, r)))));
    }
  };

  const chips = h('div', { class: 'chips' },
    ...[{ kind: 'todos', n: all.length }, ...kinds].map((k) => h('button', {
      class: `chip ${active === k.kind ? 'is-active' : ''}`,
      onclick: (e) => {
        active = k.kind;
        chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
        paint();
      },
    },
      k.kind !== 'todos' ? icon(RESOURCE_META[k.kind].icon, 13, { stroke: RESOURCE_META[k.kind].color }) : null,
      k.kind === 'todos' ? 'Todos' : RESOURCE_META[k.kind].label,
      h('span', { class: 'chip-n' }, String(k.n)))));

  paint();

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' } },
      chips,
      h('span', { class: 'muted', style: { fontSize: '12.5px' } },
        `${fmtSize(all.reduce((sum, r) => sum + r.size, 0))} en total`)),
    body);
}

// ---------------------------------------------------------------- vista

export async function renderCourse(ctx, id, tab) {
  const data = await api.course(id);
  const { course, modules, next } = data;

  if (!openModules.size && modules.length) {
    // Al entrar, se abre el módulo donde estás, no el primero.
    const target = next ? modules.find((m) => m.lessons.some((l) => l.id === next.id)) : modules[0];
    if (target) openModules.add(target.id);
  }

  const titleNode = h('h1', {}, course.title);
  const resourceCount = modules.reduce((sum, m) => sum + m.resources.length, 0);
  const lessonCount = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  const coverNode = cover(course, { width: 296, height: 167 });
  const coverInput = h('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await api.uploadCover(course.id, file);
        toast('Portada actualizada');
        render();
      } catch (err) { toast(err.message, 'bad'); }
    },
  });

  const patch = async (body) => {
    try {
      await api.updateCourse(course.id, body);
      await ctx.refreshState();
    } catch (err) { toast(err.message, 'bad'); }
  };

  const hero = h('div', { class: 'course-hero' },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px', flex: 'none' } },
      coverNode,
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn btn-sm grow', onclick: () => coverInput.click() },
          icon('upload', 14), 'Subir portada'),
        course.hasCover ? h('button', {
          class: 'btn btn-sm', title: 'Volver a la portada generada',
          onclick: async () => { await api.clearCover(course.id); render(); },
        }, icon('x', 14)) : null),
      ctx.state.ffmpeg ? h('button', {
        class: 'btn btn-sm',
        title: 'Saca un fotograma de la primera clase y lo usa de portada',
        onclick: async (e) => {
          const button = e.currentTarget;
          button.disabled = true;
          try {
            const r = await api.frameCover(course.id);
            toast(`Portada tomada de "${r.from}"`);
            render();
          } catch (err) { toast(err.message, 'bad'); button.disabled = false; }
        },
      }, icon('image', 14), 'Usar un fotograma') : null,
      coverInput),

    h('div', { class: 'hero-body' },
      h('div', { class: 'hero-title-row' },
        titleNode,
        h('button', {
          class: 'icon-btn', title: 'Renombrar curso',
          onclick: () => inlineRename(titleNode, course.title, async (value) => {
            await patch({ title: value });
            titleNode.textContent = value;
          }),
        }, icon('pencil', 14))),

      h('div', { class: 'path-row' }, icon('folder', 14, { stroke: 'var(--ink-3)' }),
        h('span', { class: 'mono' }, course.path)),

      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' } },
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Estado'),
          h('select', { class: 'control', onchange: (e) => patch({ status: e.target.value }) },
            ...Object.entries(STATUS_LABEL).map(([value, label]) =>
              h('option', { value, selected: course.status === value }, label)))),
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Tipo'),
          h('select', { class: 'control', onchange: (e) => patch({ kind: e.target.value }) },
            h('option', { value: 'estudio', selected: course.kind === 'estudio' }, 'Estudio'),
            h('option', { value: 'entretenimiento', selected: course.kind === 'entretenimiento' }, 'Entretenimiento'))),
        h('button', {
          class: 'btn', style: { marginBottom: '0' },
          onclick: async () => {
            try {
              const { stats } = await api.rescanCourse(course.id);
              toast(`${stats.modules} módulos · ${stats.lessons} archivos`);
              render();
            } catch (err) { toast(err.message, 'bad'); }
          },
        }, icon('refresh', 14, { width: 1.9 }), 'Reescanear'),
        h('a', {
          class: 'btn', href: `/api/courses/${course.id}/notes.md`, download: '',
          title: 'Baja todas tus notas de este curso en un archivo Markdown',
        }, icon('download', 14), 'Exportar notas')),

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' } },
          h('span', { style: { fontSize: '13px', color: 'var(--ink-2)' } },
            `${modules.length} ${modules.length === 1 ? 'módulo' : 'módulos'} · ${lessonCount} clases`),
          h('span', { class: 'mono', style: { fontSize: '13px', fontWeight: 500 } },
            `${course.progress.watched} de ${course.progress.total} · ${course.progress.percent}%`)),
        h('div', { class: 'bar', style: { height: '7px' } },
          h('i', { class: course.progress.percent >= 100 ? 'done' : '', style: { width: `${course.progress.percent}%` } }))),

      h('div', { style: { display: 'flex', alignItems: 'center', gap: '11px', paddingTop: '2px', flexWrap: 'wrap' } },
        next
          ? h('button', { class: 'btn btn-accent btn-lg', onclick: () => ctx.go(`/clase/${next.id}`) },
              icon('play', 15, { fill: '#fff', stroke: 'none' }), 'Seguir curso')
          : h('span', { class: 'pill', style: { background: 'var(--ok-soft)', color: 'var(--ok)', height: '34px', padding: '0 14px' } },
              icon('check', 13, { width: 3 }), 'Curso terminado'),
        next ? h('span', { class: 'muted', style: { fontSize: '13px' } },
          'Sigue en ', h('b', { style: { color: 'var(--ink-2)' } }, next.title)) : null)));

  const tabs = h('div', { class: 'tabs' },
    h('div', { class: 'tab-list' },
      h('button', { class: `tab ${tab === 'contenido' ? 'is-active' : ''}`, onclick: () => ctx.go(`/curso/${course.id}`) },
        icon('list', 16), 'Contenido del curso', h('span', { class: 'tab-n' }, String(lessonCount))),
      h('button', { class: `tab ${tab === 'recursos' ? 'is-active' : ''}`, onclick: () => ctx.go(`/curso/${course.id}/recursos`) },
        icon('folder', 16), 'Recursos', h('span', { class: 'tab-n' }, String(resourceCount)))),
    tab === 'contenido'
      ? h('span', { class: 'muted', style: { fontSize: '12.5px', paddingBottom: '12px' } },
          'Pasá el mouse sobre una clase para renombrarla')
      : null);

  return h('main', { class: 'main' },
    h('div', { class: 'crumbs' },
      h('button', { onclick: () => ctx.go('/') }, 'Biblioteca'),
      icon('chevronRight', 13, { stroke: 'var(--ring-empty)', width: 2.2 }),
      h('span', { class: 'now' }, course.title)),
    hero,
    tabs,
    tab === 'recursos'
      ? resourcesTab(ctx, data)
      : h('div', { class: 'modules' },
          ...modules.filter((m) => m.lessons.length).map((m) => moduleBlock(ctx, m, openModules.has(m.id)))));
}
