// 채워 주실 값 목록 → docs/analysis/checklist.html → PDF
//   node scripts/checklist-pdf.mjs && node scripts/make-pdf.mjs docs/analysis/checklist.html "docs/analysis/채워야-할-값-목록.pdf"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChecklist } from './lib/checklist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = JSON.parse(fs.readFileSync(path.join(root, 'data', 'analysis.json'), 'utf8'));
const outDir = path.join(root, 'docs', 'analysis');
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sections = buildChecklist(a);
let no = 0;

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>채워 주실 값 목록</title>
<style>
  @font-face { font-family: 'Noto Sans KR'; font-weight: 400; src: url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family: 'Noto Sans KR'; font-weight: 700; src: url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --red:#c93a3a; }
  @page { size: A4; margin: 14mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Sans KR', sans-serif; font-size:10pt; line-height:1.5; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:20pt; margin:0 0 1.5mm; }
  h2 { font-size:12.5pt; margin:6mm 0 2mm; padding-bottom:1mm; border-bottom:1.5px solid var(--ink); page-break-after: avoid; }
  p { margin:0 0 2mm; }
  .muted { color:var(--muted); } .small { font-size:8.5pt; }
  table { width:100%; border-collapse:collapse; font-size:9pt; margin:1mm 0 3mm; }
  tr { page-break-inside: avoid; }
  th, td { text-align:left; vertical-align:top; padding:1.6mm 1.8mm; border-bottom:1px solid var(--line); }
  th { font-size:8pt; color:var(--muted); background:var(--tint); border-bottom:1.5px solid var(--ink); }
  td.no { width:7mm; color:var(--muted); font-variant-numeric:tabular-nums; }
  td.lead { width:34mm; font-weight:700; }
  td.now { width:26mm; font-size:8pt; color:var(--muted); }
  td.est { width:34mm; font-size:8pt; }
  td.ans { width:30mm; }
  td.ans .box { border:1px solid #9aa1a8; border-radius:1.5mm; height:8mm; background:#fff; }
  .eyebrow { font-size:8pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
  .note { border-left:3px solid var(--red); background:#fbe9e9; padding:2.5mm 3.5mm; border-radius:0 2mm 2mm 0; margin:3mm 0 4mm; }
</style></head><body>
<div class="eyebrow">카페 재고관리 · 확인 목록 · 2026년 9월</div>
<h1>채워 주실 값 목록</h1>
<p class="muted">판매 자료 × 레시피로 재고 소비량을 계산하면서 자료에 없던 값입니다. 계산은 "지금 쓰는 추정값"으로 진행 중이며, 그 품목은 보고서와 앱에 <strong>추정</strong>으로 표시됩니다. <strong>틀린 것만</strong> 실제 값을 적어 주시면 됩니다. "추정 안 함"인 항목은 값을 주시면 그때 계산에 들어갑니다.</p>
<div class="note"><strong>쓰는 법</strong> — 포장에 적힌 값(용량·무게·개수)을 그대로 적어 주세요. 사진으로 찍어 보내 주셔도 됩니다. "지금 집계된 양"은 지난 12개월 판매로 계산한 사용량이며 참고용입니다.</div>
${sections
  .map(
    (sec) => `<h2>${esc(sec.title)}</h2>
<table>
<thead><tr><th></th><th>${esc(sec.head[0])}</th><th>${esc(sec.head[1])}</th><th>${esc(sec.head[2] || '')}</th><th>지금 쓰는 추정값</th><th>실제 값 (틀린 것만)</th></tr></thead>
<tbody>${sec.rows
  .map((r) => `<tr><td class="no">${++no}</td><td class="lead">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="now">${esc(r[2])}</td><td class="est">${esc(r[3] || '')}</td><td class="ans"><div class="box"></div></td></tr>`)
  .join('')}</tbody>
</table>`,
  )
  .join('')}
<p class="small muted">총 ${no}개 항목. 답을 주시면 확정 연결표(src/data/pos-map.js)에 값을 넣고 추정값(src/data/pos-estimates.js)에서 지운 뒤, 분석과 앱의 예상 재고를 다시 계산합니다.</p>
</body></html>`;
fs.writeFileSync(path.join(outDir, 'checklist.html'), html);
console.log(`docs/analysis/checklist.html (${no} items)`);
