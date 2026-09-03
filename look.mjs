import { chromium } from 'playwright';
const shots = '/tmp/claude-0/-home-user-StudyMate/ce0edf1f-f5a0-53cb-93ec-50ab12315c2f/scratchpad/shots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
page.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('sm.theme', 'dark'));
await page.goto('http://localhost:4173/#/ajustes', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const txt = await page.locator('main').textContent();
console.log('  dice ffprobe no encontrado:', txt.includes('ffprobe') && txt.includes('no encontrado'));
console.log('  botón de duraciones deshabilitado:',
  await page.locator('button', { hasText: 'Calcular duraciones' }).isDisabled());
console.log('  ofrece volver a comprobar:', await page.locator('button', { hasText: 'Volver a comprobar' }).count() > 0);
await page.screenshot({ path: `${shots}/ffprobe-falta.png`, fullPage: true });
await browser.close();
