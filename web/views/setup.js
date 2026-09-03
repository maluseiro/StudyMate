import { api } from '../api.js';
import { h, icon, toast, applyTheme, currentTheme } from '../ui.js';
import { render } from '../app.js';

function dialogShell(title, subtitle, body, actions) {
  const dlg = h('dialog', {},
    h('div', { class: 'dialog-head' },
      h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
        h('h2', {}, title),
        h('span', { class: 'subtitle' }, subtitle)),
      h('button', { class: 'icon-btn', onclick: () => dlg.close(), 'aria-label': 'Cerrar' }, icon('x', 17, { width: 2.1 }))),
    body,
    h('div', { class: 'dialog-foot' }, ...actions));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}

export function openAddRoot(ctx) {
  const input = h('input', {
    class: 'control', placeholder: 'D:\\Cursos', style: { fontFamily: 'var(--mono)', fontSize: '13px' },
  });
  const message = h('div', { class: 'note-box note-warn hidden' });

  const submit = async () => {
    message.classList.add('hidden');
    try {
      const { stats } = await api.addRoot(input.value);
      await ctx.refreshState();
      dlg.close();
      toast(`${stats.courses} cursos · ${stats.lessons} archivos`);
      render();
    } catch (err) {
      message.textContent = err.message;
      message.classList.remove('hidden');
    }
  };

  const dlg = dialogShell(
    'Agregar carpeta de biblioteca',
    'Cada subcarpeta que haya adentro se toma como un curso.',
    h('div', { class: 'dialog-body' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Ruta de la carpeta'),
        input,
        h('span', { class: 'muted', style: { fontSize: '12.5px' } },
          'Copiala desde la barra de direcciones del Explorador y pegala acá.')),
      message),
    [h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancelar'),
     h('button', { class: 'btn btn-primary', onclick: submit }, icon('plus', 15, { width: 2.1 }), 'Agregar')]
  );
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 50);
}

export function openAddCourse(ctx) {
  const state = { path: '', title: '', kind: 'estudio', cover: null, coverColor: ctx.state.coverColors[0] };

  const pathInput = h('input', {
    class: 'control grow', placeholder: 'D:\\Cursos\\PostgreSQL for Developers',
    style: { fontFamily: 'var(--mono)', fontSize: '13px' },
  });
  const titleInput = h('input', { class: 'control', placeholder: 'Título del curso' });
  const preview = h('div', { class: 'note-box note-ok hidden' });
  const message = h('div', { class: 'note-box note-bad hidden' });

  const monoPreview = h('span', {
    class: 'cover-mono',
    style: { fontSize: '54px', bottom: '-15px', position: 'absolute', right: '-5px' },
  }, '··');
  const coverPreview = h('div', {
    class: 'cover', style: { height: '108px', background: state.coverColor, borderRadius: '8px' },
  }, monoPreview);

  const swatches = h('div', { class: 'swatches' }, ...ctx.state.coverColors.map((color) =>
    h('button', {
      class: `swatch ${color === state.coverColor ? 'is-active' : ''}`,
      style: { background: color }, 'aria-label': color,
      onclick: (e) => {
        state.coverColor = color;
        state.cover = null;
        coverPreview.style.background = color;
        monoPreview.classList.remove('hidden');
        coverPreview.querySelector('img')?.remove();
        swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
      },
    })));

  const fileInput = h('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden',
    onchange: (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      state.cover = file;
      coverPreview.querySelector('img')?.remove();
      monoPreview.classList.add('hidden');
      coverPreview.appendChild(h('img', { src: URL.createObjectURL(file), alt: '' }));
    },
  });

  const kindSwitch = h('div', { class: 'segmented' },
    ...[['estudio', 'Estudio'], ['entretenimiento', 'Entretenimiento']].map(([value, label]) =>
      h('button', {
        class: value === state.kind ? 'is-active' : '',
        onclick: (e) => {
          state.kind = value;
          kindSwitch.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
        },
      }, label)));

  const checkFolder = async () => {
    message.classList.add('hidden');
    preview.classList.add('hidden');
    if (!pathInput.value.trim()) return;
    try {
      const info = await api.previewFolder(pathInput.value);
      state.path = info.path;
      if (!titleInput.value) titleInput.value = info.suggestedTitle;
      monoPreview.textContent = (titleInput.value || '··').slice(0, 2).toUpperCase();
      preview.textContent = info.already
        ? 'Esa carpeta ya está en la biblioteca. Al agregarla se vuelve a escanear.'
        : `Carpeta encontrada: ${info.path}`;
      preview.classList.remove('hidden');
    } catch (err) {
      message.textContent = err.message;
      message.classList.remove('hidden');
    }
  };

  const submit = async () => {
    message.classList.add('hidden');
    try {
      const { course, stats } = await api.addCourse({
        path: pathInput.value, title: titleInput.value.trim() || null, kind: state.kind,
      });
      if (state.cover) await api.uploadCover(course.id, state.cover);
      else if (state.coverColor) await api.updateCourse(course.id, { cover_color: state.coverColor });
      await ctx.refreshState();
      dlg.close();
      toast(`${stats.modules} módulos · ${stats.lessons} archivos`);
      ctx.go(`/curso/${course.id}`);
    } catch (err) {
      message.textContent = err.message;
      message.classList.remove('hidden');
    }
  };

  const dlg = dialogShell(
    'Agregar curso',
    'StudyMate solo lee la carpeta. No mueve, copia ni renombra archivos.',
    h('div', { class: 'dialog-body' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Carpeta del curso'),
        h('div', { style: { display: 'flex', gap: '9px' } }, pathInput,
          h('button', { class: 'btn', onclick: checkFolder }, 'Comprobar'))),
      preview,
      message,
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Título'),
        titleInput,
        h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Se detecta del nombre de la carpeta. Podés cambiarlo cuando quieras.')),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Portada'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', border: '1px solid var(--line)', borderRadius: '11px' } },
            coverPreview, swatches,
            h('span', { style: { fontSize: '12.5px', fontWeight: 600 } }, 'Generada')),
          h('button', {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '9px', padding: '12px', border: '1.5px dashed var(--ring-empty)', borderRadius: '11px', minHeight: '158px' },
            onclick: () => fileInput.click(),
          }, icon('upload', 24), h('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--ink-2)' } }, 'Subir una imagen'),
             h('span', { class: 'muted', style: { fontSize: '12px' } }, 'JPG, PNG o WEBP')),
          fileInput)),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Tipo'),
        kindSwitch)),
    [h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancelar'),
     h('button', { class: 'btn btn-primary', onclick: submit }, icon('plus', 15, { width: 2.1 }), 'Agregar curso')]
  );

  pathInput.addEventListener('blur', checkFolder);
  titleInput.addEventListener('input', () => {
    monoPreview.textContent = (titleInput.value || '··').slice(0, 2).toUpperCase();
  });
  setTimeout(() => pathInput.focus(), 50);
}

/**
 * Sin ffprobe, la duración de una clase solo se conoce al abrirla. Este panel la
 * completa de una pasada y muestra cómo va, porque en una biblioteca grande tarda.
 */
function durationsPanel(ctx) {
  const bar = h('i', { style: { width: '0%' } });
  const label = h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Consultando…');
  const progress = h('div', { class: 'bar hidden', style: { marginTop: '4px' } }, bar);

  const button = h('button', { class: 'btn btn-primary', disabled: true },
    icon('clock', 15), 'Calcular duraciones');

  let timer = null;
  const stopPolling = () => { clearInterval(timer); timer = null; };

  const detail = h('div', { class: 'note-box note-bad hidden' });

  const paint = (state) => {
    if (state.running) {
      progress.classList.remove('hidden');
      detail.classList.add('hidden');
      const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      bar.style.width = `${pct}%`;
      label.textContent = `Leyendo ${state.done} de ${state.total}…`
        + (state.failed ? ` · ${state.failed} sin poder leer` : '');
      button.disabled = true;
      button.replaceChildren(icon('clock', 15), 'Calculando…');
      return;
    }
    stopPolling();
    progress.classList.add('hidden');
    button.replaceChildren(icon('clock', 15), 'Calcular duraciones');
    // Las duraciones las lee ffprobe, no ffmpeg: son binarios distintos.
    button.disabled = state.pending === 0 || !ctx.state.ffprobe;

    if (!ctx.state.ffprobe) {
      label.textContent = 'Hace falta ffprobe (viene con ffmpeg) para leer las duraciones sin abrir cada clase.';
    } else if (state.pending === 0) {
      label.textContent = 'Todas las clases tienen su duración.';
    } else {
      label.textContent = `${state.pending} ${state.pending === 1 ? 'clase' : 'clases'} sin duración. `
        + 'Hasta calcularlas, "cuánto le falta" aparece vacío.';
    }

    // Si el trabajo corrió y falló, hay que decir por qué: antes mostraba el mismo
    // mensaje que si no hubiera nada pendiente.
    if (state.failed && state.lastFailure) {
      detail.replaceChildren(
        h('span', { style: { fontWeight: 600 } },
          `${state.failed} ${state.failed === 1 ? 'clase no se pudo leer' : 'clases no se pudieron leer'}`),
        h('span', { class: 'mono', style: { fontSize: '12px' } }, state.lastFailure));
      detail.classList.remove('hidden');
    }
  };

  const refresh = async () => { try { paint(await api.durationStatus()); } catch { stopPolling(); } };

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api.scanDurations();
      timer = setInterval(refresh, 600);
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
      refresh();
    }
  });

  refresh();

  return h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 18px',
             background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '10px' },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' } },
      h('div', { class: 'grow', style: { minWidth: '260px' } }, label),
      button),
    progress,
    detail);
}

export function renderSetup(ctx, { asSettings = false } = {}) {
  const s = ctx.state;

  const rootRows = s.roots.map((root) => h('div', { class: 'root-row' },
    icon('folder', 16, { stroke: 'var(--ink-3)' }),
    h('span', { class: 'mono grow' }, root.path),
    h('button', {
      class: 'icon-btn', title: 'Quitar de la biblioteca',
      onclick: async () => {
        await api.removeRoot(root.id);
        await ctx.refreshState();
        render();
      },
    }, icon('trash', 15))));

  const rescanButton = h('button', {
    class: 'btn',
    onclick: async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.replaceChildren(icon('refresh', 15, { width: 1.9 }), 'Escaneando…');
      try {
        const { stats } = await api.scan();
        await ctx.refreshState();
        toast(`${stats.courses} cursos · ${stats.lessons} archivos en ${(stats.ms / 1000).toFixed(1)} s`);
        render();
      } catch (err) {
        toast(err.message, 'bad');
        button.disabled = false;
        button.replaceChildren(icon('refresh', 15, { width: 1.9 }), 'Reescanear todo');
      }
    },
  }, icon('refresh', 15, { width: 1.9 }), 'Reescanear todo');

  const themeRow = h('div', { class: 'segmented' },
    ...[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([value, label]) =>
      h('button', {
        class: value === currentTheme() ? 'is-active' : '',
        onclick: (e) => {
          applyTheme(value);
          themeRow.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
        },
      }, label)));

  return h('main', { class: `main ${asSettings ? 'narrow' : ''}` },
    h('div', { class: 'page-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
        h('h1', {}, asSettings ? 'Ajustes' : 'Empecemos'),
        h('span', { class: 'subtitle' }, asSettings
          ? 'Las carpetas de tu biblioteca, el tema y el estado del sistema.'
          : 'Decile a StudyMate dónde están tus cursos.')),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: ctx.openAddCourse }, icon('plus', 15, { width: 2.1 }), 'Curso suelto'),
        h('button', { class: 'btn', onclick: ctx.openAddRoot }, icon('folder', 15), 'Agregar carpeta'),
        s.roots.length ? rescanButton : null)),

    asSettings && s.lastScan
      ? h('span', { class: 'mono muted', style: { fontSize: '12px', marginTop: '-14px' } },
          `Último escaneo: ${new Date(s.lastScan.at).toLocaleString('es')} · ${s.lastScan.lessons} archivos`)
      : null,

    !s.roots.length
      ? h('div', { class: 'empty' },
          icon('folder', 34, { stroke: 'var(--ring-empty)' }),
          h('h2', {}, 'Todavía no hay ninguna carpeta'),
          h('p', {}, 'Agregá la carpeta donde guardás tus cursos. Cada subcarpeta que haya adentro se toma como un curso, y StudyMate arma el índice solo.'),
          h('button', { class: 'btn btn-primary btn-lg', onclick: ctx.openAddRoot }, icon('plus', 15, { width: 2.1 }), 'Agregar carpeta'))
      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, ...rootRows),

    asSettings ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' } },
      h('h2', {}, 'Tema'),
      themeRow,
      h('h2', { style: { marginTop: '10px' } }, 'Duraciones'),
      durationsPanel(ctx),
      h('h2', { style: { marginTop: '10px' } }, 'Sistema'),
      // Dos binarios, dos filas: uno puede estar y el otro no.
      ...[
        { ok: s.ffmpeg, name: 'ffmpeg', para: 'Convertir a MP4 las clases en .mkv, .ts o .avi, y sacar portadas de un fotograma.' },
        { ok: s.ffprobe, name: 'ffprobe', para: 'Leer la duración de cada clase sin tener que abrirla.' },
      ].map((t) => h('div', { class: t.ok ? 'note-box note-ok' : 'note-box note-warn' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          icon(t.ok ? 'check' : 'warning', 16, { width: 2.2 }),
          h('span', { class: 'mono', style: { fontWeight: 600 } }, t.name),
          h('span', { style: { fontWeight: 600 } }, t.ok ? 'disponible' : 'no encontrado en el PATH')),
        h('span', {}, t.para))),

      !(s.ffmpeg && s.ffprobe)
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
            h('span', { class: 'muted', style: { fontSize: '13px' } },
              'Si lo instalaste con StudyMate abierto, el programa todavía no ve el PATH nuevo.'),
            h('button', {
              class: 'btn',
              onclick: async (e) => {
                const button = e.currentTarget;
                button.disabled = true;
                await ctx.refreshState();
                const ahora = ctx.state.ffmpeg && ctx.state.ffprobe;
                toast(ahora ? 'Encontrados' : 'Sigue sin encontrarlos', ahora ? 'ok' : 'bad');
                render();
              },
            }, icon('refresh', 15, { width: 1.9 }), 'Volver a comprobar'))
        : null,
      s.addresses.length ? h('div', { class: 'note-box', style: { background: 'var(--surface)', border: '1px solid var(--line)' } },
        h('span', { style: { fontWeight: 600 } }, 'Desde el celular, en la misma red WiFi:'),
        ...s.addresses.map((ip) => h('span', { class: 'mono' }, `http://${ip}:${location.port || 4173}`))) : null,
    ) : null);
}
