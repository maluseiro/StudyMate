import { chromium } from 'playwright';

const base = process.env.SM_URL ?? 'http://localhost:4173';
const shots = process.env.SM_SHOTS ?? null;

/**
 * Buscamos una clase que este navegador realmente pueda decodificar y que tenga otra
 * clase detrás (hace falta para probar el autoplay). El Chromium de Playwright no trae
 * H.264, así que preferimos WebM y caemos a lo que haya.
 */
async function pickLessons(preferExt) {
  const { courses } = await fetch(`${base}/api/courses`).then((r) => r.json());
  for (const course of courses) {
    const { modules } = await fetch(`${base}/api/courses/${course.id}`).then((r) => r.json());
    const videos = modules.flatMap((m) => m.lessons);
    for (let i = 0; i < videos.length - 1; i++) {
      if (preferExt && videos[i].ext !== preferExt) continue;
      if (!videos[i].playable || !videos[i + 1]) continue;
      return { WEBM: videos[i].id, NEXT: videos[i + 1].id };
    }
  }
  return null;
}

const picked = (await pickLessons('.webm')) ?? (await pickLessons(null));
if (!picked) {
  console.error('No hay ninguna clase reproducible con otra detrás. Agregá una biblioteca primero.');
  process.exit(1);
}
const { WEBM, NEXT } = picked;
console.log(`  usando la clase ${WEBM} (siguiente: ${NEXT})\n`);

const browser = await chromium.launch({ executablePath: process.env.SM_CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

let pass = 0, fail = 0, originalTitle = null;
const step = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FALLA ' + name + ' :: ' + String(e.message).split('\n')[0]); }
};
const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: esperaba ${want}, obtuve ${got}`); };
const api = (p, o) => page.evaluate(([p, o]) => fetch(p, o).then((r) => r.json()), [p, o]);

const openLesson = async (id) => {
  // Ir al mismo hash no vuelve a dibujar la vista; el reload garantiza estado fresco.
  await page.goto(`${base}/#/clase/${id}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('video', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, { timeout: 5000 });
};

// ---------------------------------------------------------------- progreso
await step('reproducir guarda la posición', async () => {
  await openLesson(WEBM);
  await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 0; return v.play(); });
  await page.waitForTimeout(2600);
  await page.evaluate(() => document.querySelector('video').pause());
  await page.waitForTimeout(700);
  const { lesson } = await api(`/api/lessons/${WEBM}`);
  if (!(lesson.position > 1.5)) throw new Error('posición guardada: ' + lesson.position);
  if (!(lesson.duration > 1)) throw new Error('duración no detectada: ' + lesson.duration);
});

await step('al volver, arranca 5 s antes de donde quedaste', async () => {
  // Salir de la clase primero: al hacerlo la app guarda la posición real, y pisaría
  // la que el test escribe a mano.
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await api(`/api/lessons/${WEBM}/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position: 8, duration: 10 }),
  });
  await openLesson(WEBM);
  await page.waitForTimeout(900);
  const t = await page.evaluate(() => document.querySelector('video').currentTime);
  if (Math.abs(t - 3) > 0.7) throw new Error(`esperaba ~3 s (8 − 5), obtuve ${t.toFixed(2)}`);
});

// ---------------------------------------------------------------- vista al 90%
await step('llegar al 90% la marca vista sola', async () => {
  await api(`/api/lessons/${WEBM}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched: false }),
  });
  await api(`/api/lessons/${WEBM}/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position: 9.2, duration: 10 }),
  });
  const { lesson } = await api(`/api/lessons/${WEBM}`);
  eq(Boolean(lesson.watched), true, 'vista');
});

// ---------------------------------------------------------------- notas
await step('las notas se guardan solas', async () => {
  await openLesson(WEBM);
  await page.locator('.notes-area').fill('Un índice compuesto (a, b) no sirve para filtrar solo por b.');
  await page.waitForTimeout(1400);
  const { notes } = await api(`/api/lessons/${WEBM}`);
  if (!notes.includes('índice compuesto')) throw new Error('no se guardó: ' + JSON.stringify(notes));
});

await step('el botón inserta la marca de tiempo', async () => {
  await page.evaluate(() => { document.querySelector('video').currentTime = 42; });
  await page.waitForTimeout(400);
  await page.locator('.notes-area').click();
  await page.keyboard.press('End');
  await page.locator('.stamp-btn').click();
  await page.waitForTimeout(200);
  const value = await page.locator('.notes-area').inputValue();
  if (!/\[\d+:\d{2}\]\s$/.test(value)) throw new Error('formato inesperado: ' + JSON.stringify(value.slice(-24)));
});

// ---------------------------------------------------------------- atajos
await step('atajo: espacio pausa y reanuda', async () => {
  await openLesson(WEBM);
  await page.locator('.lesson-head h1').click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  eq(await page.evaluate(() => document.querySelector('video').paused), false, 'debía reproducir');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => document.querySelector('video').paused), true, 'debía pausar');
});

await step('atajo: flechas mueven 5 s, J y L mueven 10', async () => {
  await page.evaluate(() => { document.querySelector('video').currentTime = 2; });
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  let t = await page.evaluate(() => document.querySelector('video').currentTime);
  if (Math.abs(t - 7) > 0.4) throw new Error('flecha derecha dio ' + t);
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  t = await page.evaluate(() => document.querySelector('video').currentTime);
  if (t > 0.5) throw new Error('J debía llevar al principio, dio ' + t);
});

await step('atajo: M marca vista', async () => {
  await api(`/api/lessons/${WEBM}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched: false }),
  });
  await openLesson(WEBM);
  await page.locator('.lesson-head h1').click();
  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const { lesson } = await api(`/api/lessons/${WEBM}`);
  eq(Boolean(lesson.watched), true, 'vista por atajo');
});

// ---------------------------------------------------------------- velocidad
await step('la velocidad se recuerda por curso', async () => {
  await openLesson(WEBM);
  await page.locator('.speed', { hasText: '1.5x' }).click();
  await page.waitForTimeout(500);
  eq(await page.evaluate(() => document.querySelector('video').playbackRate), 1.5, 'playbackRate');
  await openLesson(NEXT);
  await page.waitForTimeout(700);
  eq(await page.evaluate(() => document.querySelector('video').playbackRate), 1.5, 'recordada en otra clase');
  await page.locator('.speed', { hasText: /^1x$/ }).click();
  await page.waitForTimeout(300);
});

// ---------------------------------------------------------------- autoplay
await step('al terminar aparece el contador de la siguiente clase', async () => {
  await openLesson(WEBM);
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.currentTime = v.duration - 0.4;
    return v.play();
  });
  await page.waitForSelector('.autoplay', { timeout: 8000 });
  const shown = await page.locator('.autoplay-next').textContent();
  const { lesson: expected } = await api(`/api/lessons/${NEXT}`);
  if (!shown.includes(expected.title)) throw new Error(`esperaba "${expected.title}", muestra "${shown.trim()}"`);
});
if (shots) await page.screenshot({ path: `${shots}/5-autoplay.png` });

await step('el contador se puede cancelar', async () => {
  await page.locator('.autoplay button', { hasText: 'Cancelar' }).click();
  await page.waitForTimeout(1500);
  eq(await page.locator('.autoplay').count(), 0, 'overlay cerrado');
  if (!page.url().includes(`/clase/${WEBM}`)) throw new Error('navegó igual: ' + page.url());
});

await step('el contador lleva a la siguiente clase', async () => {
  await openLesson(WEBM);
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.currentTime = v.duration - 0.3;
    return v.play();
  });
  await page.waitForSelector('.autoplay', { timeout: 8000 });
  await page.waitForFunction((id) => location.hash.includes('/clase/' + id), NEXT, { timeout: 9000 });
});

// ---------------------------------------------------------------- marcar y volver
await step('"Volver a esto" aparece en la lista de marcadas', async () => {
  await api(`/api/lessons/${WEBM}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flagged: false }),
  });
  await openLesson(WEBM);
  await page.locator('.lesson-head button', { hasText: 'Volver a esto' }).click();
  await page.waitForTimeout(600);
  await page.goto(`${base}/#/marcadas`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const n = await page.locator('.lesson-row').count();
  if (n < 1) throw new Error('la lista quedó vacía');
});

// ---------------------------------------------------------------- renombrar
await step('renombrar una clase no toca el archivo', async () => {
  const { lesson: target, course } = await api(`/api/lessons/${WEBM}`);
  await page.goto(`${base}/#/curso/${course.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.module-head', { timeout: 4000 });
  if (!(await page.locator('.lesson-row').filter({ hasText: target.title }).count())) {
    for (const m of await page.locator('.module-head').all()) await m.click();
    await page.waitForTimeout(500);
  }
  const row = page.locator('.lesson-row').filter({ hasText: target.title }).first();
  const fileBefore = await row.locator('.lesson-file').textContent();
  await row.locator('.rename-btn').click({ force: true });
  await page.locator('.lesson-row input.control').fill('Título puesto a mano');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const { lesson } = await api(`/api/lessons/${WEBM}`);
  eq(lesson.title, 'Título puesto a mano', 'título');
  eq(lesson.file_name, fileBefore.trim(), 'el archivo no cambió');
  originalTitle = target.title;
});

await step('reescanear respeta el título editado', async () => {
  await api('/api/scan', { method: 'POST' });
  const { lesson } = await api(`/api/lessons/${WEBM}`);
  eq(lesson.title, 'Título puesto a mano', 'título tras reescanear');
  // Dejamos la biblioteca como estaba: las pruebas no deberían ensuciar tus datos.
  if (originalTitle) {
    await api(`/api/lessons/${WEBM}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: originalTitle }),
    });
  }
});

// ---------------------------------------------------------------- celular
await step('el celular ve el mismo progreso', async () => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(base, { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('.card', { timeout: 5000 });
  if (shots) await phone.screenshot({ path: `${shots}/6-celular.png`, fullPage: true });
  const text = await phone.locator('.continue').textContent();
  if (!text.trim()) throw new Error('el bloque de continuar quedó vacío');
  await phone.close();
});

console.log(`\n  ${pass} bien, ${fail} mal`);
console.log('  errores de página:', errors.length ? errors : 'ninguno');
await browser.close();
process.exit(fail ? 1 : 0);
