// node scripts/icon.ts   renders app/public/icon.svg to desktop/icon.png (512×512) for the desktop
// program and its installer. Uses the Edge already installed on Windows through playwright-core.

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const EDGE = process.env.DAFTAR_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const svg = readFileSync(new URL('../app/public/icon.svg', import.meta.url), 'utf8');
const out = new URL('../desktop/icon.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${svg}`);
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(`icon written to ${out}`);
