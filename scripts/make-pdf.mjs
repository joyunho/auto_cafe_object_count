// HTML 문서 → PDF (크로미움 인쇄). 사용: node scripts/make-pdf.mjs docs/proposal/index.html docs/기획안.pdf
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('사용법: node scripts/make-pdf.mjs <input.html> <output.pdf>');
  process.exit(1);
}

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.resolve(input)).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const title = await page.title();
  await page.pdf({
    path: path.resolve(output),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:'Noto Sans KR',sans-serif;font-size:8px;color:#8a8f94;padding:0 18mm;display:flex;justify-content:space-between">
        <span>${title.replace(/</g, '&lt;')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '18mm', right: '18mm' },
  });
  console.log(`${output} 생성`);
} finally {
  await browser.close();
}
