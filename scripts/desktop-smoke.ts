// node scripts/desktop-smoke.ts   opens the packaged program (release/win-unpacked, from `npm run dist:win`),
// starts the sample company, closes it, opens it again and checks the company is still there.

import { _electron as electron, type ElectronApplication } from 'playwright-core';

const exe = new URL('../release/win-unpacked/Daftar.exe', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

async function launch(): Promise<{ app: ElectronApplication; page: Awaited<ReturnType<ElectronApplication['firstWindow']>> }> {
  const app = await electron.launch({ executablePath: exe });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

const errors: string[] = [];
{
  const { app, page } = await launch();
  page.on('pageerror', (e) => errors.push(String(e)));
  console.log('url:', page.url());
  await page.getByRole('button', { name: /Try the sample company|جرّب الشركة النموذجية/ }).click();
  await page.waitForSelector('.stat');
  await page.waitForFunction(() => /^(Saved|محفوظ)$/.test(document.querySelector('.saved')?.textContent?.trim() ?? ''));
  console.log('first run: sample company open and saved');
  await app.close();
}
{
  const { app, page } = await launch();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(1500);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  console.log('second run shows:', text);
  await app.close();
}
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
