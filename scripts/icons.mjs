// Erzeugt die PNG-Icons der PWA aus den SVGs (einmalig; nutzt Playwright/Chromium).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const jobs = [
  ['icons/icon.svg', 'icons/icon-192.png', 192],
  ['icons/icon.svg', 'icons/icon-512.png', 512],
  ['icons/maskable.svg', 'icons/maskable-512.png', 512],
  ['icons/maskable.svg', 'icons/apple-touch-icon.png', 180],
  ['icons/icon.svg', 'icons/favicon-32.png', 32],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = readFileSync(src, 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('✓', out);
}
await browser.close();
