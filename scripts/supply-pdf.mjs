// 자재(소모품) 자동화 정리 → docs/analysis/supply.html → PDF
//   node scripts/supply-pdf.mjs && node scripts/make-pdf.mjs docs/analysis/supply.html "docs/analysis/자재-자동화-정리.pdf"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPLY_PLAN, DRIVERS, HOW_TO_COUNT } from './lib/supply-plan.mjs';
import { SEED_SUPPLY_ITEMS, SEED_SUPPLY_GROUPS } from '../src/data/supplies.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'analysis');
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n0 = (x) => Math.round(x).toLocaleString('ko-KR');
const n1 = (x) => (x >= 10 ? n0(x) : x.toFixed(1));

const itemById = Object.fromEntries(SEED_SUPPLY_ITEMS.map((i) => [i.id, i]));
const groupTitle = Object.fromEntries(SEED_SUPPLY_GROUPS.map((g) => [g.id, g.title]));
const rows = SUPPLY_PLAN.map((r) => ({ ...r, item: itemById[r.id] })).filter((r) => r.item);
const posRows = rows.filter((r) => r.tier === 'pos');
const askRows = rows.filter((r) => r.tier === 'ask');

const perDay = (year) => year / 365;
const parLabel = (it) => (it.par == null ? '—' : `${it.par}${it.unitName || ''}`);

const posTable = `<table>
<thead><tr><th>#</th><th>품목</th><th>무엇에 비례하나 (POS)</th><th class="r">1년</th><th class="r">하루</th><th>확인해 주실 것</th></tr></thead>
<tbody>${posRows
  .map((r, i) => {
    const d = DRIVERS[r.driver];
    const day = perDay(d.year);
    const mine = r.perDriver != null ? `${n1(day * r.perDriver)}개` : '<span class="q">?</span>';
    return `<tr><td class="no">${i + 1}</td><td class="lead">${esc(r.item.name)}<span class="grp">${esc(groupTitle[r.item.group] || '')}</span></td>
      <td>${esc(d.label)}${d.note ? `<span class="sub">${esc(d.note)}</span>` : ''}${r.perDriver != null ? `<span class="sub">1건당 ${r.perDriver}개</span>` : ''}</td>
      <td class="r num">${n0(d.year)}</td><td class="r num">${mine}</td>
      <td class="askq">${esc(r.ask || '—')}</td></tr>`;
  })
  .join('')}</tbody></table>`;

const askTable = `<table>
<thead><tr><th>#</th><th>품목</th><th class="r">지금 시트 기준</th><th>참고</th><th class="ansh">요즘 주당 몇 개?</th></tr></thead>
<tbody>${askRows
  .map(
    (r, i) => `<tr><td class="no">${i + 1}</td><td class="lead">${esc(r.item.name)}<span class="grp">${esc(groupTitle[r.item.group] || '')}</span></td>
      <td class="r num">${esc(parLabel(r.item))}</td>
      <td class="hint">${esc(r.hint)}${r.why ? `<span class="sub">${esc(r.why)}</span>` : ''}</td>
      <td class="ans"><div class="box"></div></td></tr>`,
  )
  .join('')}</tbody></table>`;

const howTable = HOW_TO_COUNT.map(
  (q, i) => `<div class="qbox"><div class="qh"><span class="qn">${i + 1}</span>${esc(q[0])}</div>
  <p class="qd">${esc(q[1])}</p>
  <div class="opts">${q[2].map((o) => `<span class="opt">○ ${esc(o)}</span>`).join('')}</div></div>`,
).join('');

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>자재 자동화 정리</title>
<style>
  @font-face { font-family: 'Noto Sans KR'; font-weight: 400; src: url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family: 'Noto Sans KR'; font-weight: 500; src: url('../proposal/fonts/NotoSansKR-500.ttf') format('truetype'); }
  @font-face { font-family: 'Noto Sans KR'; font-weight: 700; src: url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --red:#c93a3a; --blue:#2f5d7c; --green:#3d6b47; }
  @page { size: A4; margin: 14mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Sans KR', sans-serif; font-size:10pt; line-height:1.55; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:21pt; margin:0 0 2mm; letter-spacing:-.02em; }
  h2 { font-size:13pt; margin:7mm 0 2.5mm; padding-bottom:1.2mm; border-bottom:1.5px solid var(--ink); page-break-after:avoid; }
  h3 { font-size:10.5pt; margin:4mm 0 1.5mm; page-break-after:avoid; }
  p { margin:0 0 2.5mm; }
  .muted { color:var(--muted); } .small { font-size:8.5pt; }
  .eyebrow { font-size:8pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
  .lede { font-size:10.5pt; }
  .flow { background:var(--tint); border-radius:2mm; padding:4mm 5mm; margin:3mm 0 4mm; font-size:10.5pt; line-height:1.9; }
  .flow b { font-weight:700; }
  .flow .eq { font-size:11.5pt; }
  .flow .tag { display:inline-block; font-size:8pt; color:var(--muted); }
  .cards { display:flex; gap:4mm; margin:3mm 0 4mm; }
  .card { flex:1; border:1px solid var(--line); border-top:3px solid var(--blue); border-radius:0 0 2mm 2mm; padding:3mm 3.5mm; }
  .card.b { border-top-color:var(--red); }
  .card .n { font-size:17pt; font-weight:700; line-height:1.1; }
  .card .t { font-weight:700; font-size:10pt; margin-bottom:1mm; }
  .card .d { font-size:8.5pt; color:var(--muted); }
  table { width:100%; border-collapse:collapse; font-size:8.8pt; margin:1.5mm 0 3mm; }
  tr { page-break-inside:avoid; }
  th, td { text-align:left; vertical-align:top; padding:1.5mm 1.8mm; border-bottom:1px solid var(--line); }
  th { font-size:7.5pt; color:var(--muted); background:var(--tint); border-bottom:1.5px solid var(--ink); font-weight:500; }
  td.no, th:first-child { width:6mm; color:var(--muted); font-variant-numeric:tabular-nums; }
  td.lead { width:30mm; font-weight:700; }
  td.lead .grp { display:block; font-weight:400; font-size:7.5pt; color:var(--muted); }
  .r { text-align:right; } .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  td .sub { display:block; font-size:7.5pt; color:var(--muted); }
  td.askq { width:52mm; font-size:8.2pt; }
  td.hint { font-size:8.2pt; }
  td.ans, th.ansh { width:26mm; }
  td.ans .box { border:1px solid #9aa1a8; border-radius:1.5mm; height:8mm; background:#fff; }
  .q { color:var(--red); font-weight:700; }
  .qbox { border-left:3px solid var(--blue); background:#f2f6f8; padding:3mm 4mm; border-radius:0 2mm 2mm 0; margin:0 0 3mm; page-break-inside:avoid; }
  .qh { font-weight:700; font-size:10pt; }
  .qn { display:inline-block; width:5mm; color:var(--blue); }
  .qd { font-size:8.5pt; color:var(--muted); margin:1mm 0 2mm 5mm; }
  .opts { margin-left:5mm; }
  .opt { display:inline-block; border:1px solid var(--line); background:#fff; border-radius:1.5mm; padding:1mm 2.5mm; margin:0 2mm 1.5mm 0; font-size:8.5pt; }
  .note { border-left:3px solid var(--red); background:#fbe9e9; padding:2.5mm 3.5mm; border-radius:0 2mm 2mm 0; margin:3mm 0 4mm; font-size:9pt; }
  .ba { width:100%; border-collapse:collapse; font-size:9pt; margin-top:2mm; }
  .ba th, .ba td { border:1px solid var(--line); padding:2mm 2.5mm; }
  .ba th { background:var(--tint); }
  .ba td.after { background:#f1f7f2; font-weight:500; }
  .pb { page-break-before:always; }
  footer { margin-top:6mm; padding-top:2mm; border-top:1px solid var(--line); font-size:8pt; color:var(--muted); }
</style></head><body>

<div class="eyebrow">카페 재고관리 · 자재(소모품) · 2026년 9월</div>
<h1>자재는 이렇게 자동화합니다</h1>
<p class="lede muted">제품(원두·시럽·청)은 레시피가 있어서 "아메리카노 1잔 = 원두 20g"으로 계산이 됩니다. 자재는 그런 표가 없습니다. 그런데 자재에도 레시피가 있습니다 — <b>재료 레시피가 아니라 손님 한 명이 쓰고 가는 물건 목록</b>입니다.</p>

<div class="flow">
<span class="eq">지금 몇 개 있나 &nbsp;=&nbsp; <b>시작점</b> &nbsp;+&nbsp; <b>들어온 것</b> &nbsp;−&nbsp; <b>나간 것</b></span><br />
<span class="tag">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;딱 한 번만 셈 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 앱이 이미 앎 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 이것만 알면 끝</span>
</div>
<p><b>나간 것</b>을 알아내는 방법이 두 가지 있습니다. 어느 쪽이든 <b>알아내고 나면 그 품목은 다시 안 세도 됩니다.</b></p>

<div class="cards">
  <div class="card"><div class="t">가. POS가 이미 알고 있는 것</div><div class="n">${posRows.length}개</div>
    <div class="d">컵·뚜껑·빨대·홀더·빵봉투·케이크포장·영수증지처럼 <b>팔린 잔 수·건수에 비례</b>하는 것. 한 달에 한 번 POS 자료만 넣으면 계산됩니다. 제품(원두·시럽)과 완전히 같은 원리입니다.</div></div>
  <div class="card b"><div class="t">나. 알려 주셔야 하는 것</div><div class="n">${askRows.length}개</div>
    <div class="d">장갑·물티슈·점보롤·쓰레기봉투처럼 <b>POS가 전혀 모르는</b> 것. "주당 몇 개"를 한 번만 적어 주시면 그날부터 자동입니다. 비워 두시면 재고조사 3~4주치로 앱이 스스로 배웁니다.</div></div>
</div>

<div class="note"><b>세는 일은 이렇게 줄어듭니다.</b> 매주 43품목을 전부 세는 대신 → <b>처음 딱 한 번</b> 전체 수량을 넣고(사진 자동 인식 가능), 그 뒤로는 앱이 "이번 주엔 이 2~3개만 확인해 보세요"라고 짚어 주는 것만 세시면 됩니다. 재고가 마이너스로 내려가거나, 오차 때문에 발주 수량이 갈리는 품목만 골라 알려 줍니다.</div>

<h2>바쁠 때 더 쓰는 건 어떻게 되나</h2>
<p>"100L 쓰레기봉투 하루 2장"처럼 <b>하루 몇 개</b>로 기억하면, 바쁜 날도 2장 한가한 날도 2장으로 계산해서 재고가 쌓이거나 모자라게 됩니다. 그래서 앱은 <b>"하루 몇 개"가 아니라 "손님 몇 명당 몇 개"로 바꿔서 기억합니다.</b></p>
<div class="flow" style="font-size:9.5pt;line-height:1.75">
<b>하루 2장</b> → 1년 730장. 지난 12개월 음료가 158,380잔이었으니 &nbsp;→&nbsp; <b>217잔당 1장</b><br />
&nbsp;&nbsp;&nbsp;가장 바쁜 8월 (하루 512잔) &nbsp;→&nbsp; <b>하루 2.36장</b><br />
&nbsp;&nbsp;&nbsp;가장 한가한 11월 (하루 377잔) &nbsp;→&nbsp; <b>하루 1.74장</b>
</div>
<p>같은 "2장"을 적어 주셔도 앱은 바쁜 달에 더 시키고 한가한 달에 덜 시킵니다. 한 달로 치면 18장 차이입니다.</p>
<h3>그래도 어긋나면 — 셀 때마다 앱이 스스로 고칩니다</h3>
<p>보일러 온도조절기와 같습니다. 목표만 정해 두고 계속 조금씩 맞춥니다.</p>
<div class="flow" style="font-size:9.5pt;line-height:1.8">
앱이 예상한 값 <b>8장</b> &nbsp;·&nbsp; 실제로 세어 보니 <b>5장</b><br />
&nbsp;&nbsp;&nbsp;→ "생각보다 많이 쓰고 있구나" &nbsp;→&nbsp; 비율을 올리고, 부족한 3장을 다음 발주에 얹습니다<br />
&nbsp;&nbsp;&nbsp;→ 반대로 남아돌면 비율을 내리고, 다음 발주를 그만큼 줄입니다
</div>
<p>그래서 <b>처음 적어 주시는 숫자가 좀 틀려도 괜찮습니다.</b> 몇 번 세고 나면 앱이 실제 값으로 수렴합니다. 여기에 더해 두 가지 경보를 띄웁니다 — <b>예상 재고가 바닥에 가까워지면</b> "이것만 확인해 보세요", <b>기준의 두 배 넘게 쌓이면</b> "이번 주는 건너뛰세요".</p>

<h2 class="pb">가. POS가 아는 것 — ${posRows.length}품목</h2>
<p class="small muted">아래 "하루"는 지난 12개월(2025-08~2026-07) 판매 자료로 계산한 값입니다. <span class="q">?</span> 는 환산 비율을 아직 몰라 계산이 안 되는 것 — 오른쪽 질문에 답해 주시면 채워집니다.</p>
${posTable}

<h2 class="pb">나. 알려 주실 것 — ${askRows.length}품목</h2>
<p class="small muted">정확할 필요 전혀 없습니다. "요즘 대충 이 정도"면 됩니다 — 앱이 그 숫자를 "손님 몇 명당 몇 개"로 바꿔서 기억하고, 셀 때마다 실제와 대조해 스스로 고쳐 나갑니다(앞 장 참고). 모르시겠으면 비워 두세요. 그 품목만 3~4주 세면 앱이 알아서 배웁니다.</p>
${askTable}

<h2>다. 세는 방법 — 네 가지만 정해 주세요</h2>
${howTable}

<h2>라. 이렇게 되면 무엇이 달라지나</h2>
<table class="ba">
<thead><tr><th style="width:34mm"></th><th style="width:50mm">지금</th><th>자동화 후</th></tr></thead>
<tbody>
<tr><td><b>매주 수요일</b></td><td>자재 43품목 전부 세기</td><td class="after">앱이 짚어 주는 2~3개만 확인 (또는 사진 한 장)</td></tr>
<tr><td><b>한 달에 한 번</b></td><td>—</td><td class="after">POS 그룹별 매출분석 붙여넣기 (1분)</td></tr>
<tr><td><b>발주 수량</b></td><td>눈대중 + 기준 수량</td><td class="after">앱이 "다음 주까지 쓸 양 + 안전분"으로 계산해 미리 채움</td></tr>
<tr><td><b>재고 현황</b></td><td>센 날에만 앎</td><td class="after">매일 "지금 대략 몇 개"가 오차 범위와 함께 보임</td></tr>
<tr><td><b>처음 딱 한 번</b></td><td>—</td><td class="after">전체 수량 1회 입력 + 이 종이의 나·다 칸 채우기</td></tr>
</tbody></table>

<footer>계산에 쓴 자료: POS "그룹별 매출분석" 12개월(2025-08 ~ 2026-07) · 씨앤비 자재 재고조사표(수요일). 금액 자료는 쓰지 않았습니다. — 자재 ${rows.length}품목 전부 다루었습니다.</footer>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'supply.html'), html);
console.log(`docs/analysis/supply.html (POS ${posRows.length} · 문의 ${askRows.length} · 합 ${rows.length})`);
