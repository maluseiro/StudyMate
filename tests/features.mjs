import { chromium } from 'playwright';
const base = process.env.SM_URL ?? 'http://localhost:4173';
const shots = process.env.SM_SHOTS ?? null;

// Elegimos un curso con notas y otro con video, en vez de fijar ids a mano.
const courses = await fetch(`${base}/api/courses`).then((r) => r.json()).then((d) => d.courses);
if (!courses.length) { console.error('No hay cursos en la biblioteca.'); process.exit(1); }
const withVideo = courses.find((c) => c.progress.total > 0) ?? courses[0];
const other = courses.find((c) => c.id !== withVideo.id) ?? withVideo;
const detail = await fetch(`${base}/api/courses/${withVideo.id}`).then((r) => r.json());
const anyLesson = detail.modules.flatMap((m) => m.lessons).find((l) => l.playable || l.remux_rel);
if (!anyLesson) { console.error('No hay ninguna clase reproducible.'); process.exit(1); }
console.log(`  curso ${withVideo.id} · clase ${anyLesson.id}\n`);

const browser = await chromium.launch({ executablePath: process.env.SM_CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION')) errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
const step = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FALLA ' + name + ' :: ' + String(e.message).split('\n')[0]); }
};

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.card');

await step('el tema arranca en claro', async () => {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg !== 'rgb(244, 246, 248)') throw new Error('fondo: ' + bg);
});

await step('el interruptor cambia a oscuro', async () => {
  await page.locator('.theme-toggle button', { hasText: 'Oscuro' }).click();
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg !== 'rgb(14, 20, 26)') throw new Error('fondo: ' + bg);
});
if (shots) await page.screenshot({ path: `${shots}/dark-1-biblioteca.png`, fullPage: true });

await step('el tema sobrevive a recargar', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (attr !== 'dark') throw new Error('data-theme: ' + attr);
});

await step('las píldoras de estado se adaptan al tema', async () => {
  const color = await page.locator('.pill').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  if (color === 'rgb(241, 244, 248)') throw new Error('quedó el color del tema claro');
});

await step('buscar por título de clase', async () => {
  await page.goto(`${base}/#/buscar/index`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.result-row', { timeout: 4000 });
  const n = await page.locator('.result-row').count();
  if (n < 2) throw new Error('resultados: ' + n);
});
if (shots) await page.screenshot({ path: `${shots}/dark-2-buscador.png`, fullPage: true });

await step('buscar dentro de las notas', async () => {
  await page.goto(`${base}/#/buscar/compuesto`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.note-snippet', { timeout: 4000 });
  const text = await page.locator('.note-snippet').first().textContent();
  if (!text.toLowerCase().includes('compuesto')) throw new Error(text.slice(0, 60));
});

await step('el buscador resalta lo que buscaste', async () => {
  if (!(await page.locator('mark').count())) throw new Error('sin <mark>');
});

await step('la tecla / abre el buscador', async () => {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  await page.locator('h1').click();
  await page.keyboard.press('/');
  await page.waitForTimeout(600);
  if (!page.url().includes('/buscar')) throw new Error('no navegó: ' + page.url());
});

await step('exportar notas descarga un Markdown', async () => {
  await page.goto(`${base}/#/curso/${withVideo.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.course-hero');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('a.btn', { hasText: 'Exportar notas' }).click(),
  ]);
  const name = download.suggestedFilename();
  if (!name.endsWith('.md')) throw new Error('archivo: ' + name);
});

await step('reordenar arrastrando guarda el orden', async () => {
  await page.goto(`${base}/#/curso/${withVideo.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.module-head');
  await page.locator('.module-head').first().click();
  await page.waitForTimeout(400);
  const rows = page.locator('.module.is-open .lesson-row');
  const before = await rows.first().getAttribute('data-lesson-id');
  const secondId = await rows.nth(1).getAttribute('data-lesson-id');

  // HTML5 drag & drop no se dispara con mouse sintético; lo hacemos con eventos.
  await page.evaluate(([fromId, toId]) => {
    const list = document.querySelector('.module.is-open .lesson-row').parentElement;
    const from = list.querySelector(`[data-lesson-id="${fromId}"]`);
    const to = list.querySelector(`[data-lesson-id="${toId}"]`);
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const box = to.getBoundingClientRect();
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: box.bottom - 2 }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  }, [before, secondId]);
  await page.waitForTimeout(900);

  const order = await page.evaluate((id) => fetch(`/api/courses/${id}`).then((r) => r.json())
    .then((d) => d.modules[0].lessons.map((l) => l.id)), withVideo.id);
  if (order[0] === Number(before)) throw new Error('el orden no cambió: ' + order.join(','));
});

await step('el módulo queda marcado como ordenado a mano', async () => {
  // Salimos y volvemos en vez de recargar: probamos lo mismo (que quedó guardado
  // en el servidor) sin depender de una recarga completa del documento.
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.goto(`${base}/#/curso/${withVideo.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.module-head');
  await page.locator('.module-head').first().click();
  await page.waitForTimeout(500);
  if (!(await page.locator('.module-foot').count())) throw new Error('sin aviso de orden manual');
});

await step('volver al orden original', async () => {
  await page.locator('.module-foot button').click();
  await page.waitForTimeout(1200);
  const edited = await page.evaluate((id) => fetch(`/api/courses/${id}`).then((r) => r.json())
    .then((d) => d.modules[0].order_edited), withVideo.id);
  if (edited) throw new Error('sigue marcado como manual');
});

await step('panel de duraciones en Ajustes', async () => {
  await page.goto(`${base}/#/ajustes`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const text = await page.locator('main').textContent();
  if (!text.includes('duración') && !text.includes('duraciones')) throw new Error('sin panel');
});
if (shots) await page.screenshot({ path: `${shots}/dark-3-ajustes.png`, fullPage: true });

await step('portada desde un fotograma', async () => {
  await page.goto(`${base}/#/curso/${other.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.course-hero');
  await page.locator('button', { hasText: 'Usar un fotograma' }).click();
  await page.waitForTimeout(2500);
  const has = await page.evaluate((id) => fetch(`/api/courses/${id}`).then((r) => r.json()).then((d) => d.course.hasCover), other.id);
  if (!has) throw new Error('no quedó portada');
});

await step('la pantalla de clase también respeta el tema', async () => {
  await page.goto(`${base}/#/clase/${anyLesson.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('video');
  await page.waitForTimeout(900);
  const bg = await page.locator('.outline').evaluate((el) => getComputedStyle(el).backgroundColor);
  if (bg === 'rgb(255, 255, 255)') throw new Error('la barra lateral quedó blanca');
});
if (shots) await page.screenshot({ path: `${shots}/dark-4-clase.png`, fullPage: true });

console.log(`\n  ${pass} bien, ${fail} mal`);
console.log('  errores de página:', errors.length ? errors.slice(0, 5) : 'ninguno');
await browser.close();
process.exit(fail ? 1 : 0);
