// icons/icon.svg → icons/icon-192.png, icons/icon-512.png (PWA 아이콘)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');

const browser = await launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
    await page.screenshot({ path: path.join(root, 'icons', `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
