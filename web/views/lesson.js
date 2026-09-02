import { api } from '../api.js';
import { h, icon, statusDot, fmtTime, fmtLeft, fmtSize, toast, debounce, clear,
         RESOURCE_META } from '../ui.js';

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

/** Limpieza de la clase que está en pantalla, para que el router la suelte al salir. */
let activeCleanup = null;
export function disposeLesson() {
  activeCleanup?.();
  activeCleanup = null;
}

const SAVE_EVERY_MS = 10_000;
const REWIND_ON_RESUME = 5;   // volver unos segundos atrás recupera el contexto
const AUTOPLAY_SECONDS = 5;

export async function renderLesson(ctx, id) {
  const data = await api.lesson(id);
  const { lesson, course, module, notes, outline, resources, prev, next } = data;

  const playable = Boolean(lesson.playable || lesson.remux_rel);
  let progress = data.progress;
  let watched = Boolean(lesson.watched);

  // ------------------------------------------------------------- reproductor
  const video = h('video', {
    src: `/media/${lesson.id}`,
    controls: true,
    preload: 'metadata',
    playsInline: true,
  });

  const playerWrap = h('div', { class: 'player-wrap' });
  const fallback = () => h('div', { class: 'player-fallback' },
    icon('warning', 30, { stroke: 'var(--accent)' }),
    h('h3', {}, 'El navegador no puede reproducir este archivo'),
    h('p', {}, lesson.ext === '.mkv' || lesson.ext === '.ts' || lesson.ext === '.avi'
      ? `Los archivos ${lesson.ext} no los abre ningún navegador. Casi siempre es solo el envase: convertirlo a MP4 no recomprime nada ni pierde calidad.`
      : 'Puede ser un códec que el navegador no soporta. Probá convertirlo, o abrilo con tu reproductor de siempre.'),
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' } },
      ctx.state.ffmpeg
        ? h('button', {
            class: 'btn btn-accent',
            onclick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              button.textContent = 'Convirtiendo…';
              try {
                await api.remux(lesson.id);
                toast('Convertido. Recargando la clase…');
                ctx.go(`/clase/${lesson.id}`);
                location.reload();
              } catch (err) {
                toast(err.message, 'bad');
                button.disabled = false;
                button.textContent = 'Convertir a MP4';
              }
            },
          }, icon('convert', 15, { stroke: '#fff' }), 'Convertir a MP4')
        : null,
      h('button', {
        class: 'btn', style: { background: 'rgba(255,255,255,.12)', borderColor: 'rgba(255,255,255,.24)', color: '#fff' },
        onclick: () => api.openExternal(lesson.id).then(() => toast('Abriendo en tu reproductor')).catch((e) => toast(e.message, 'bad')),
      }, icon('external', 15), 'Abrir en el reproductor de Windows')),
    !ctx.state.ffmpeg
      ? h('p', { style: { fontSize: '12.5px' } }, 'Instalá ffmpeg y agregalo al PATH para poder convertir desde acá.')
      : null);

  if (playable) playerWrap.appendChild(video);
  else playerWrap.appendChild(fallback());

  // Si el navegador acepta el archivo pero después falla, mostramos el mismo camino.
  // Cuidado: al salir de la clase el elemento se desmonta y eso también dispara
  // `error`. Sin este filtro, cambiar de clase mostraba un cartel de error falso.
  video.addEventListener('error', () => {
    if (!video.isConnected) return;
    if (video.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
    if (playerWrap.querySelector('.player-fallback')) return;
    clear(playerWrap).appendChild(fallback());
  });

  // ------------------------------------------------------------- progreso
  const save = (extra = {}) => {
    if (!Number.isFinite(video.currentTime)) return;
    const payload = { position: video.currentTime, duration: video.duration, ...extra };
    api.saveProgress(lesson.id, payload).then((res) => {
      progress = res.progress;
      if (res.watched && !watched) {
        watched = true;
        markWatchedBtn.replaceChildren(icon('check', 15, { width: 2.2 }), 'Vista');
        markWatchedBtn.classList.add('btn-primary');
      }
      paintProgress();
    }).catch(() => { /* si el guardado falla, se reintenta en el próximo tick */ });
  };

  let saveTimer;
  video.addEventListener('play', () => {
    clearInterval(saveTimer);
    saveTimer = setInterval(save, SAVE_EVERY_MS);
  });
  video.addEventListener('pause', () => { clearInterval(saveTimer); save(); });

  // Al cerrar la pestaña no da tiempo a un fetch normal: sendBeacon sí llega.
  const beacon = () => {
    if (!Number.isFinite(video.currentTime) || video.currentTime < 1) return;
    navigator.sendBeacon?.(
      `/api/lessons/${lesson.id}/progress`,
      new Blob([JSON.stringify({ position: video.currentTime, duration: video.duration })], { type: 'application/json' })
    );
  };
  window.addEventListener('pagehide', beacon);

  video.addEventListener('loadedmetadata', () => {
    video.playbackRate = course.speed || 1;
    const start = Math.max(0, (lesson.position ?? 0) - REWIND_ON_RESUME);
    if (start > 0 && start < video.duration - 1) video.currentTime = start;
    paintProgress();
  });

  // ------------------------------------------------------------- autoplay
  let countdown;
  video.addEventListener('ended', () => {
    save({ position: video.duration });
    if (!next) return;
    let left = AUTOPLAY_SECONDS;

    const number = h('span', {}, String(left));
    const ring = h('div', { class: 'ring', html: `
      <svg width="62" height="62" viewBox="0 0 62 62">
        <circle class="track" cx="31" cy="31" r="27"></circle>
        <circle class="run" cx="31" cy="31" r="27" stroke-dashoffset="0"></circle>
      </svg>` });
    ring.appendChild(number);
    const runCircle = ring.querySelector('.run');

    const overlay = h('div', { class: 'autoplay' },
      h('div', { class: 'autoplay-card' },
        h('span', { style: { fontSize: '11px', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.45)' } }, 'Siguiente clase'),
        h('div', { class: 'autoplay-next' },
          ring,
          h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
            h('span', { style: { fontFamily: 'var(--display)', fontWeight: 600, fontSize: '16px', color: '#fff' } }, next.title),
            h('span', { style: { fontSize: '12.5px', color: 'rgba(255,255,255,.5)' } },
              [next.duration ? fmtTime(next.duration) : null, next.module_title].filter(Boolean).join(' · ')))),
        h('div', { style: { display: 'flex', gap: '10px', width: '100%' } },
          h('button', { class: 'btn btn-accent grow', onclick: () => ctx.go(`/clase/${next.id}`) },
            icon('play', 15, { fill: '#fff', stroke: 'none' }), 'Reproducir ahora'),
          h('button', {
            class: 'btn', style: { background: 'transparent', borderColor: 'rgba(255,255,255,.24)', color: 'rgba(255,255,255,.85)' },
            onclick: () => { clearInterval(countdown); overlay.remove(); },
          }, 'Cancelar')),
        watched ? h('span', { style: { fontSize: '12.5px', color: 'rgba(255,255,255,.42)' } }, 'Clase marcada como vista') : null));

    playerWrap.appendChild(overlay);
    requestAnimationFrame(() => { runCircle.style.strokeDashoffset = '170'; runCircle.style.transitionDuration = `${AUTOPLAY_SECONDS}s`; });

    countdown = setInterval(() => {
      left -= 1;
      number.textContent = String(Math.max(0, left));
      if (left <= 0) { clearInterval(countdown); ctx.go(`/clase/${next.id}`); }
    }, 1000);
  });

  // ------------------------------------------------------------- velocidad
  const speedRow = h('div', { class: 'speeds' }, ...SPEEDS.map((value) =>
    h('button', {
      class: `speed ${(course.speed || 1) === value ? 'is-active' : ''}`,
      onclick: (e) => {
        video.playbackRate = value;
        speedRow.querySelectorAll('.speed').forEach((b) => b.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
        api.updateCourse(course.id, { speed: value }).catch(() => { /* la velocidad ya cambió igual */ });
      },
    }, `${value}x`)));

  // ------------------------------------------------------------- cabecera
  const leftLabel = h('span', {});
  const paintProgress = () => {
    const remaining = video.duration ? video.duration - video.currentTime : (lesson.duration ? lesson.duration - (lesson.position ?? 0) : null);
    leftLabel.replaceChildren(
      remaining > 0
        ? h('span', {}, 'Quedan ', h('b', {}, fmtLeft(remaining)), ' · se marca vista al 90%')
        : h('span', {}, 'Se marca vista al 90%'));
    outlineBar.style.width = `${progress.percent}%`;
    outlineCount.textContent = `${progress.watched}/${progress.total} · ${progress.percent}%`;
  };
  video.addEventListener('timeupdate', () => { paintProgress(); });

  const markWatchedBtn = h('button', {
    class: `btn ${watched ? 'btn-primary' : ''}`,
    onclick: async () => {
      watched = !watched;
      const res = await api.updateLesson(lesson.id, { watched });
      progress = res.progress;
      markWatchedBtn.classList.toggle('btn-primary', watched);
      markWatchedBtn.replaceChildren(icon('check', 15, { width: 2.2 }), watched ? 'Vista' : 'Marcar vista');
      paintProgress();
      await ctx.refreshState();
    },
  }, icon('check', 15, { width: 2.2 }), watched ? 'Vista' : 'Marcar vista');

  const flagBtn = h('button', {
    class: 'btn', style: lesson.flagged ? { background: 'var(--accent-soft)', borderColor: 'transparent', color: 'var(--accent-ink)' } : {},
    onclick: async () => {
      const value = !lesson.flagged;
      await api.updateLesson(lesson.id, { flagged: value });
      lesson.flagged = value ? 1 : 0;
      flagBtn.replaceChildren(icon('flag', 15, value ? { fill: 'var(--accent)', stroke: 'var(--accent)' } : {}), 'Volver a esto');
      Object.assign(flagBtn.style, value
        ? { background: 'var(--accent-soft)', borderColor: 'transparent', color: 'var(--accent-ink)' }
        : { background: '', borderColor: '', color: '' });
      await ctx.refreshState();
    },
  }, icon('flag', 15, lesson.flagged ? { fill: 'var(--accent)', stroke: 'var(--accent)' } : {}), 'Volver a esto');

  // ------------------------------------------------------------- notas
  const saveState = h('span', { class: 'save-state' });
  const notesArea = h('textarea', {
    class: 'notes-area', value: notes,
    placeholder: 'Lo que escribas se guarda solo. Usá el botón de la izquierda para dejar la marca de tiempo.',
  });

  const persistNotes = debounce(async () => {
    try {
      await api.saveNotes(lesson.id, notesArea.value);
      saveState.replaceChildren(icon('check', 13, { width: 2.6 }), 'Guardado');
    } catch (err) {
      saveState.replaceChildren(icon('warning', 13, { width: 2.2 }), 'No se pudo guardar');
      saveState.style.color = 'var(--danger)';
    }
  }, 700);

  notesArea.addEventListener('input', () => {
    saveState.replaceChildren(h('span', { class: 'muted' }, 'Guardando…'));
    persistNotes();
  });
  const flushNotes = () => persistNotes.flush();
  window.addEventListener('pagehide', flushNotes);

  const stampBtn = h('button', { class: 'stamp-btn', onclick: () => {
    const stamp = fmtTime(video.currentTime || 0);
    const at = notesArea.selectionStart ?? notesArea.value.length;
    const before = notesArea.value.slice(0, at);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const insert = `${prefix}[${stamp}] `;
    notesArea.value = before + insert + notesArea.value.slice(at);
    notesArea.focus();
    notesArea.selectionStart = notesArea.selectionEnd = at + insert.length;
    notesArea.dispatchEvent(new Event('input'));
  } }, icon('plus', 14, { width: 2.1 }), h('span', { class: 'mono' }, fmtTime(lesson.position ?? 0)));

  video.addEventListener('timeupdate', () => {
    stampBtn.querySelector('.mono').textContent = fmtTime(video.currentTime);
  });

  // ------------------------------------------------------------- pestañas
  const notesPanel = h('div', { class: 'notes-panel' },
    h('div', { class: 'notes-bar' },
      stampBtn,
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Insertá la marca de tiempo del minuto actual'),
      h('div', { class: 'grow' }),
      saveState),
    notesArea);

  const resourcesPanel = h('div', { class: 'notes-panel', style: { padding: '18px' } },
    resources.length
      ? h('div', { class: 'res-grid' }, ...resources.map((r) => h('button', {
          class: 'res-card',
          onclick: () => {
            if (r.kind === 'pdf' || r.kind === 'imagen') window.open(`/media/${r.id}`, '_blank', 'noopener');
            else api.openFolder(r.id).catch((err) => toast(err.message, 'bad'));
          },
        },
          h('div', { class: 'res-thumb', style: { background: (RESOURCE_META[r.kind] ?? RESOURCE_META.otro).bg } },
            r.kind === 'imagen'
              ? h('img', { src: `/media/${r.id}`, alt: '', loading: 'lazy' })
              : icon((RESOURCE_META[r.kind] ?? RESOURCE_META.otro).icon, 32, { stroke: (RESOURCE_META[r.kind] ?? RESOURCE_META.otro).color, width: 1.5 })),
          h('div', { class: 'res-body' },
            h('div', { class: 'res-title' }, r.title),
            h('span', { class: 'lesson-file' }, r.file_name),
            h('span', { class: 'mono muted', style: { fontSize: '10.5px' } }, fmtSize(r.size))))))
      : h('span', { class: 'muted', style: { fontSize: '13.5px' } }, 'Este módulo no trae material aparte.'));
  resourcesPanel.classList.add('hidden');

  const tabNotes = h('button', { class: 'tab is-active' }, icon('notes', 16), 'Notas');
  const tabFiles = h('button', { class: 'tab' }, icon('folder', 16), 'Recursos',
    h('span', { class: 'tab-n' }, String(resources.length)));
  const selectTab = (which) => {
    tabNotes.classList.toggle('is-active', which === 'notas');
    tabFiles.classList.toggle('is-active', which === 'recursos');
    notesPanel.classList.toggle('hidden', which !== 'notas');
    resourcesPanel.classList.toggle('hidden', which !== 'recursos');
  };
  tabNotes.addEventListener('click', () => selectTab('notas'));
  tabFiles.addEventListener('click', () => selectTab('recursos'));

  // ------------------------------------------------------------- índice lateral
  const outlineBar = h('i', { style: { width: `${progress.percent}%` } });
  const outlineCount = h('span', { class: 'mono', style: { fontSize: '12px', color: 'var(--ink-2)' } },
    `${progress.watched}/${progress.total} · ${progress.percent}%`);

  const outlineList = h('div', { class: 'outline-list' });
  let lastModule = null;
  for (const item of outline) {
    if (item.module_id !== lastModule) {
      lastModule = item.module_id;
      outlineList.appendChild(h('div', { class: 'outline-module' },
        h('span', { class: 'grow' }, item.module_title)));
    }
    const isCurrent = item.id === lesson.id;
    const meta = RESOURCE_META[item.kind];
    outlineList.appendChild(h('button', {
      class: `outline-item ${isCurrent ? 'is-current' : ''} ${item.watched ? 'is-watched' : ''}`,
      onclick: () => {
        if (item.kind === 'video') ctx.go(`/clase/${item.id}`);
        else if (item.kind === 'pdf' || item.kind === 'imagen') window.open(`/media/${item.id}`, '_blank', 'noopener');
        else api.openFolder(item.id).catch((err) => toast(err.message, 'bad'));
      },
    },
      item.kind === 'video' ? statusDot(item, isCurrent) : icon(meta?.icon ?? 'doc', 17, { stroke: 'var(--ink-3)', width: 1.7 }),
      h('span', { class: 'grow' }, item.title),
      item.flagged ? icon('flag', 14, { fill: 'var(--accent)', stroke: 'var(--accent)' }) : null,
      h('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--ink-4)' } },
        item.kind === 'video' ? (item.duration ? fmtTime(item.duration) : '—') : (meta?.label ?? ''))));
  }

  // ------------------------------------------------------------- atajos
  const onKey = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const keys = {
      ' ': () => (video.paused ? video.play() : video.pause()),
      ArrowRight: () => { video.currentTime += 5; },
      ArrowLeft: () => { video.currentTime -= 5; },
      l: () => { video.currentTime += 10; },
      j: () => { video.currentTime -= 10; },
      n: () => next && ctx.go(`/clase/${next.id}`),
      p: () => prev && ctx.go(`/clase/${prev.id}`),
      m: () => markWatchedBtn.click(),
      f: () => flagBtn.click(),
    };
    const action = keys[e.key] ?? keys[e.key.toLowerCase()];
    if (!action) return;
    e.preventDefault();
    action();
  };
  document.addEventListener('keydown', onKey);

  // Al salir de la pantalla hay que soltar el intervalo, los listeners y el contador.
  // Se llama desde el router antes de dibujar la vista siguiente: engancharlo a
  // `hashchange` dejaba atajos de teclado de clases viejas escuchando en paralelo.
  disposeLesson();
  activeCleanup = () => {
    clearInterval(saveTimer);
    clearInterval(countdown);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', beacon);
    window.removeEventListener('pagehide', flushNotes);
    persistNotes.flush();
    save();
  };

  paintProgress();

  return h('div', { class: 'lesson-page' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-sm', onclick: () => ctx.go(`/curso/${course.id}`) },
        icon('chevronLeft', 15, { width: 2.2 }), 'Volver al curso'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 } },
        h('div', { class: 'cover', style: { width: '26px', height: '26px', flex: 'none', borderRadius: '6px', background: course.cover_color } }),
        h('span', { style: { fontFamily: 'var(--display)', fontWeight: 600, fontSize: '14.5px' } }, course.title)),
      h('div', { class: 'grow' }),
      speedRow),

    h('div', { class: 'lesson-cols' },
      h('div', { class: 'lesson-main' },
        playerWrap,
        h('div', { class: 'lesson-head' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 } },
            h('span', { style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--ink-3)' } },
              `${module?.title ?? ''} · Clase ${outline.filter((o) => o.kind === 'video').findIndex((o) => o.id === lesson.id) + 1} de ${progress.total}`),
            h('h1', {}, lesson.title),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13.5px', color: 'var(--ink-2)' } },
              icon('clock', 14, { stroke: 'var(--ink-3)', width: 1.9 }), leftLabel)),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            flagBtn,
            markWatchedBtn,
            next
              ? h('button', { class: 'btn btn-primary', onclick: () => ctx.go(`/clase/${next.id}`) },
                  'Siguiente clase', icon('chevronRight', 15, { width: 2.2 }))
              : null)),

        h('div', {},
          h('div', { class: 'tabs' }, h('div', { class: 'tab-list' }, tabNotes, tabFiles)),
          notesPanel,
          resourcesPanel)),

      h('aside', { class: 'outline' },
        h('div', { class: 'outline-head' },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' } },
            h('span', { style: { fontFamily: 'var(--display)', fontWeight: 600, fontSize: '14.5px' } }, 'Contenido del curso'),
            outlineCount),
          h('div', { class: 'bar' }, outlineBar)),
        outlineList)));
}
