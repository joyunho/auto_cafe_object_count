// "일주일에 몇 개 나가나요?" 질문지 → docs/analysis/weekly-usage.html → PDF
//   node scripts/weekly-usage-pdf.mjs && node scripts/make-pdf.mjs docs/analysis/weekly-usage.html "docs/analysis/음료재료-주당-사용량-질문지.pdf"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECS, PRIORITY } from './lib/weekly-usage.mjs';
import { SEED_ITEMS, SEED_GROUPS } from '../src/data/items.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'analysis');
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DRINK_GROUPS = ['cheong', 'juice', 'coffee', 'syrup', 'tea', 'topping'];
const groupTitle = Object.fromEntries(SEED_GROUPS.map((g) => [g.id, g.title]));
const items = SEED_ITEMS.filter((i) => DRINK_GROUPS.includes(i.group) && i.active !== false);
const byGroup = DRINK_GROUPS.map((g) => [groupTitle[g] || g, items.filter((i) => i.group === g)]).filter(([, l]) => l.length);
const nameOf = Object.fromEntries(SEED_ITEMS.map((i) => [i.id, i.name]));

const rows = (list) =>
  list
    .map((it) => {
      const [spec, unit, extra] = SPECS[it.id] || ['', '개', ''];
      return `<tr>
        <td class="lead">${esc(it.name.replace(/\(1box>6\)/, ''))}</td>
        <td class="spec">${esc(spec)}</td>
        <td class="ans"><span class="pre">주에</span><span class="blank"></span><span class="unit">${esc(unit)}</span></td>
        <td class="extra">${esc(extra || '')}</td>
      </tr>`;
    })
    .join('');

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>음료 재료 · 주당 사용량 질문지</title>
<style>
  @font-face { font-family:'Noto Sans KR'; font-weight:400; src:url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family:'Noto Sans KR'; font-weight:500; src:url('../proposal/fonts/NotoSansKR-500.ttf') format('truetype'); }
  @font-face { font-family:'Noto Sans KR'; font-weight:700; src:url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --red:#c93a3a; --blue:#2f5d7c; }
  @page { size:A4; margin:14mm 16mm 16mm 16mm; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Noto Sans KR',sans-serif; font-size:10pt; line-height:1.55; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:20pt; margin:0 0 2mm; letter-spacing:-.02em; }
  h2 { font-size:12pt; margin:6mm 0 2mm; padding-bottom:1.2mm; border-bottom:1.5px solid var(--ink); page-break-after:avoid; }
  p { margin:0 0 2.5mm; }
  .eyebrow { font-size:8pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
  .muted { color:var(--muted); } .small { font-size:8.5pt; }
  .how { background:var(--tint); border-radius:2mm; padding:3.5mm 4.5mm; margin:3mm 0 4mm; font-size:9.5pt; }
  .how b { font-weight:700; }
  .how ul { margin:1.5mm 0 0; padding-left:5mm; }
  .how li { margin-bottom:1mm; }
  .pri { border-left:3px solid var(--red); background:#fbe9e9; padding:3mm 4mm; border-radius:0 2mm 2mm 0; margin:0 0 4mm; page-break-inside:avoid; }
  .pri h3 { font-size:10pt; margin:0 0 2mm; }
  .pri ol { margin:0; padding-left:5mm; font-size:9pt; }
  .pri li { margin-bottom:1.5mm; }
  .pri b { font-weight:700; }
  table { width:100%; border-collapse:collapse; font-size:9.5pt; margin:1.5mm 0 3mm; }
  tr { page-break-inside:avoid; }
  th, td { text-align:left; vertical-align:middle; padding:1.9mm 2mm; border-bottom:1px solid var(--line); }
  th { font-size:7.5pt; color:var(--muted); background:var(--tint); border-bottom:1.5px solid var(--ink); font-weight:500; }
  td.lead { width:34mm; font-weight:700; }
  td.spec { width:48mm; font-size:8.5pt; color:var(--muted); }
  td.ans { width:36mm; white-space:nowrap; }
  td.ans .pre { font-size:8.5pt; color:var(--muted); margin-right:1.5mm; }
  td.ans .blank { display:inline-block; width:17mm; border-bottom:1px solid #8d949b; height:5mm; vertical-align:-1mm; }
  td.ans .unit { font-size:9pt; font-weight:700; margin-left:1.5mm; }
  td.extra { font-size:8.2pt; color:var(--blue); }
  footer { margin-top:5mm; padding-top:2mm; border-top:1px solid var(--line); font-size:8.5pt; color:var(--muted); }
</style></head><body>

<div class="eyebrow">카페 재고관리 · 질문지 · 2026년 9월</div>
<h1>음료 재료 — 일주일에 몇 개 나가나요?</h1>
<p class="muted">이 한 가지만 알면 나머지가 거의 다 풀립니다. 판매 자료로 “바닐라시럽 주에 6.9kg”은 이미 계산돼 있어서, <b>“주에 5병”</b>만 들으면 <b>1병이 1.38kg</b>이라는 것까지 저절로 나옵니다. 그래서 “병이 몇 g인가요” 같은 건 안 여쭤도 됩니다.</p>

<div class="how">
<b>답하실 때</b>
<ul>
  <li><b>대충이면 됩니다.</b> “3~4개쯤”, “두 주에 한 번” 이렇게 적으셔도 됩니다.</li>
  <li><b>요즘 기준</b>으로요. 여름·겨울이 많이 다른 품목은 옆에 적어 주시면 좋습니다.</li>
  <li><b>단위를 꼭 확인해 주세요.</b> 칸마다 병·통·단지·봉·박스를 적어 뒀습니다. 다르게 세시면 그 단위로 고쳐 적어 주세요.</li>
  <li><b>모르는 건 비워 두세요.</b> 억지로 채우면 계산이 더 틀어집니다. 빈칸은 나중에 실제 재고로 알아냅니다.</li>
  <li>파란 글씨는 <b>같이 알면 좋은 것</b>입니다. 아시면 옆에 적어 주세요.</li>
</ul>
</div>

<div class="pri">
<h3>이것만이라도 (답 하나로 여러 개가 풀리는 것)</h3>
<ol>${PRIORITY.map(([id, label, why]) => `<li><b>${esc(label)}</b> — ${esc(why)}</li>`).join('')}</ol>
</div>

${byGroup
  .map(
    ([title, list]) => `<h2>${esc(title)}</h2>
<table>
<thead><tr><th>품목</th><th>어떤 물건인지</th><th>일주일에</th><th>같이 알면 좋은 것</th></tr></thead>
<tbody>${rows(list)}</tbody></table>`,
  )
  .join('')}

<footer>음료 재료 ${items.length}품목. 브런치·라면 재료(재고표 3장)와 자재(소모품)는 따로 여쭙겠습니다.
답을 주시면 판매 자료로 계산한 소비량과 맞춰 보고, 어긋나는 품목만 다시 확인합니다.</footer>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'weekly-usage.html'), html);
console.log(`docs/analysis/weekly-usage.html (${items.length} items)`);
