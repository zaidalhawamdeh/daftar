/// <reference lib="dom" />
// node scripts/screenshots.ts   rebuilds docs/images/*.png from the built app (run `npm run build` first).
// Uses the Edge already installed on Windows through playwright-core; no browser is downloaded.

import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { preview } from 'vite';

const EDGE = process.env.DAFTAR_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out = new URL('../docs/images/', import.meta.url);
mkdirSync(out, { recursive: true });

const server = await preview({ root: new URL('../app/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), preview: { port: 5199, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function open(lang: 'en' | 'ar', theme: 'light' | 'dark'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5199/');
  await page.evaluate(([l, t]) => {
    localStorage.setItem('daftar.lang', l!);
    localStorage.setItem('daftar.theme', t!);
  }, [lang, theme]);
  await page.reload();
  await page.getByRole('button', { name: lang === 'ar' ? 'جرّب الشركة النموذجية' : 'Try the sample company' }).click();
  await page.waitForSelector('.stat');
  return page;
}
const nav = (page: Page, label: string) => page.locator('nav button', { hasText: label }).first().click();
// Wait for the autosave to settle and put the menu back at its top, so every picture is a still.
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForFunction(() => /^(Saved|محفوظ)$/.test(document.querySelector('.saved')?.textContent?.trim() ?? ''));
  await page.evaluate(() => document.querySelector('nav')?.scrollTo(0, 0));
  await page.screenshot({ path: new URL(name, out).pathname.replace(/^\/(\w:)/, '$1') });
}

{
  const p = await open('en', 'light');
  await shot(p, 'home.png');
  await nav(p, 'Invoices');
  await p.getByRole('button', { name: /New · Invoice/ }).click();
  await p.locator('select').first().selectOption({ label: 'Atlas Hotel' });
  await p.locator('tbody select').first().selectOption({ label: 'Design hour' });
  await p.locator('tbody input[aria-label="Quantity"]').first().fill('7.5');
  await p.locator('tbody select').nth(1).selectOption({ label: 'Logo package' });
  await shot(p, 'invoice.png');
  await p.close();
}
{
  const p = await open('ar', 'light');
  await nav(p, 'التقارير');
  await p.waitForSelector('.report table');
  await shot(p, 'reports-arabic.png');
  await p.close();
}
{
  const p = await open('en', 'dark');
  await nav(p, 'Reconcile');
  await p.locator('main select').first().selectOption({ label: '1010 · Checking Account' });
  await p.locator('input[type="checkbox"]').first().check();
  await shot(p, 'reconcile-dark.png');
  await p.close();
}

await browser.close();
server.httpServer.close();
console.log('screenshots written to docs/images/');
