// data/analysis.json → docs/analysis/index.html (판매 데이터 기반 소비량 분석 보고서)
//   node scripts/pos-report.mjs && node scripts/make-pdf.mjs docs/analysis/index.html "docs/판매데이터-소비량-분석.pdf"
// 보고서에는 매출 금액이 들어가지 않는다 (잔 수·재료 소비량만).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChecklist } from './lib/checklist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = JSON.parse(fs.readFileSync(path.join(root, 'data', 'analysis.json'), 'utf8'));
const outDir = path.join(root, 'docs', 'analysis');
fs.mkdirSync(outDir, { recursive: true });

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n0 = (x) => (x == null ? '–' : Math.round(x).toLocaleString('ko-KR'));
const n1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toLocaleString('ko-KR'));
const n2 = (x) => (x == null ? '–' : (Math.round(x * 100) / 100).toLocaleString('ko-KR', { minimumFractionDigits: 2 }));
const mLabel = (m) => `${Number(m.slice(5))}월`;
const unitKo = { g: 'g', ml: 'ml', ea: '개', bag: '봉', shot: '샷', pump: '펌프', serving: '잔' };

// ── 차트: 월별 음료 잔 수 (막대) ─────────────────────────────
function barChart(months, values, { w = 720, h = 170, color = '#2a78d6', label = '' } = {}) {
  const pad = { l: 44, r: 12, t: 18, b: 28 };
  const max = Math.max(...values) * 1.1;
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const bw = iw / months.length;
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((max * f) / 1000) * 1000);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label)}" style="font-family:'Noto Sans KR',sans-serif">`;
  for (const t of ticks) s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e4e6e8" stroke-width="1"/><text x="${pad.l - 6}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="#5f666d">${(t / 1000).toFixed(0)}k</text>`;
  months.forEach((m, i) => {
    const v = values[i];
    const x = pad.l + i * bw + bw * 0.18;
    const bwi = bw * 0.64;
    s += `<rect x="${x}" y="${y(v)}" width="${bwi}" height="${pad.t + ih - y(v)}" rx="3" fill="${color}"/>`;
    s += `<text x="${x + bwi / 2}" y="${y(v) - 4}" text-anchor="middle" font-size="8.5" fill="#17191c">${(v / 1000).toFixed(1)}k</text>`;
    s += `<text x="${x + bwi / 2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#5f666d">${mLabel(m)}</text>`;
  });
  s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#9aa1a8" stroke-width="1"/></svg>`;
  return s;
}

// ── 차트: ICE/HOT 비중 (100% 누적 막대, 2계열) ─────────────
function shareChart(months, ice, hot, { w = 720, h = 150 } = {}) {
  const pad = { l: 44, r: 12, t: 18, b: 28 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const bw = iw / months.length;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="월별 아이스·핫 비중" style="font-family:'Noto Sans KR',sans-serif">`;
  for (const f of [0, 0.5, 1]) {
    const yy = pad.t + ih - f * ih;
    s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy}" y2="${yy}" stroke="#e4e6e8"/><text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#5f666d">${f * 100}%</text>`;
  }
  months.forEach((m, i) => {
    const tot = ice[i] + hot[i] || 1;
    const fi = ice[i] / tot;
    const x = pad.l + i * bw + bw * 0.18;
    const bwi = bw * 0.64;
    const hIce = fi * ih;
    s += `<rect x="${x}" y="${pad.t + ih - hIce}" width="${bwi}" height="${hIce}" rx="3" fill="#2a78d6"/>`;
    s += `<rect x="${x}" y="${pad.t}" width="${bwi}" height="${ih - hIce - 2}" rx="3" fill="#eb6834"/>`;
    s += `<text x="${x + bwi / 2}" y="${pad.t + ih - hIce + 12}" text-anchor="middle" font-size="8.5" fill="#fff">${Math.round(fi * 100)}%</text>`;
    s += `<text x="${x + bwi / 2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#5f666d">${mLabel(m)}</text>`;
  });
  s += `<g font-size="9" fill="#17191c"><rect x="${w - 150}" y="2" width="9" height="9" fill="#2a78d6"/><text x="${w - 137}" y="10">아이스</text><rect x="${w - 90}" y="2" width="9" height="9" fill="#eb6834"/><text x="${w - 77}" y="10">핫</text></g></svg>`;
  return s;
}

const months = a.months;
const cups = months.map((m) => a.cupsByMonth[m]);
const ice = months.map((m) => a.iceHot[m].ice);
const hot = months.map((m) => a.iceHot[m].hot);
const totalCups = cups.reduce((x, y) => x + y, 0);

// 노아주스 4종은 POS에 종류가 없어 균등 배분한 것이라 표에서는 한 줄로 합쳐 보여 준다
const noaRows = a.items.filter((r) => /^noa-/.test(r.itemId));
const noaMerged = noaRows.length
  ? {
      ...noaRows[0],
      itemId: 'noa-all',
      name: `노아주스 4종 합계`,
      totalUnits: noaRows.reduce((x, r) => x + r.totalUnits, 0),
      avgPerDay: noaRows.reduce((x, r) => x + r.avgPerDay, 0),
      peakPerDay: noaRows.reduce((x, r) => x + r.peakPerDay, 0),
      parEach: noaRows.every((r) => r.parEach != null) ? noaRows.reduce((x, r) => x + r.parEach, 0) : null,
      parLabel: noaRows.every((r) => r.parEach != null) ? `${noaRows[0].parEach}×4종` : null,
      suggested: noaRows[0].suggested && { mon_thu: `${noaRows[0].suggested.mon_thu}×4`, thu_mon: `${noaRows[0].suggested.thu_mon}×4` },
      note: '종류별 균등 배분(가정)',
    }
  : null;
const withPkg = a.items.filter((r) => r.perPackage && !/^noa-/.test(r.itemId)).concat(noaMerged ? [noaMerged] : []).sort((x, y) => (y.avgPerDay || 0) - (x.avgPerDay || 0));
const noPkg = a.items.filter((r) => !r.perPackage);
// 커버 일수: 시트 기준(낱개)이 최대월 소비로 며칠 가는지. 박스 기준인데 1박스 개수를 모르면(parEach null) 계산하지 않는다.
const coverage = (r) => (r.parEach != null && r.peakPerDay > 0 ? r.parEach / r.peakPerDay : null);
const parCell = (r) => (r.parLabel ?? (r.parEach != null ? String(r.parEach) : '–'));
const noRecipe = (a.unmapped || []).filter((u) => /레시피 없음/.test(u.reason || ''));
const noLink = (a.unmapped || []).filter((u) => !/레시피 없음/.test(u.reason || ''));
const ignoredList = a.ignored || [];
const item = (id) => a.items.find((r) => r.itemId === id);
const checklist = buildChecklist(a);
const checklistCount = checklist.reduce((n, sec) => n + sec.rows.length, 0);
const ignoredByGroup = {};
for (const u of ignoredList) if (u.byGroup) ignoredByGroup[u.group] = (ignoredByGroup[u.group] || 0) + u.total;
const dropWords = (s) => s.replace(/\(1box>6\)/, '');

const rowsHtml = withPkg
  .map((r) => {
    const cov = coverage(r);
    const covCls = cov == null ? '' : cov < 4 ? 'bad' : cov > 30 ? 'lots' : '';
    return `<tr>
      <td class="lead">${esc(dropWords(r.name))}${r.assumed ? ' <span class="pill warn">가정</span>' : ''}</td>
      <td class="num">${n0(r.totalUnits)}</td>
      <td class="num">${n2(r.avgPerDay)}</td>
      <td class="num">${n2(r.peakPerDay)}</td>
      <td class="num">${parCell(r)}</td>
      <td class="num ${covCls}">${cov == null ? '–' : n0(cov) + '일'}</td>
      <td class="num">${r.suggested ? `${r.suggested.mon_thu} / ${r.suggested.thu_mon}` : '–'}</td>
      <td class="small muted note">${esc(r.note)}</td>
    </tr>`;
  })
  .join('');

const noPkgHtml = noPkg
  .map((r) => `<tr><td class="lead">${esc(r.name)}</td><td class="num">${n0(r.totalRaw)} ${unitKo[r.unit] || r.unit}</td><td class="num">${n1(r.totalRaw / 365)} ${unitKo[r.unit] || r.unit}</td><td class="num">${parCell(r)}</td><td class="small muted">${esc(r.note)}</td></tr>`)
  .join('');

const seasonRows = withPkg
  .filter((r) => r.totalUnits >= 20)
  .map((r) => {
    const vals = months.map((m) => r.season[m] || 0);
    const hi = months[vals.indexOf(Math.max(...vals))];
    const lo = months[vals.indexOf(Math.min(...vals.filter((v) => v > 0)))];
    return { r, hi, lo, spread: Math.max(...vals) / (Math.min(...vals.filter((v) => v > 0)) || 1) };
  })
  .sort((x, y) => y.spread - x.spread)
  .slice(0, 12)
  .map(({ r, hi, lo, spread }) => `<tr><td class="lead">${esc(dropWords(r.name))}</td><td>${mLabel(hi)}</td><td>${mLabel(lo)}</td><td class="num">${n1(spread)}배</td></tr>`)
  .join('');

const listHtml = (arr) => arr.map((u) => `${esc(u.product)} ${n0(u.total)}`).join(', ') || '없음';
const brunchTotal = Object.values(a.brunch).reduce((x, y) => x + y, 0);
const ramenTotal = Object.values(a.ramen).reduce((x, y) => x + y, 0);

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>판매 데이터 기반 소비량 분석</title>
<style>
  @font-face { font-family: 'Noto Sans KR'; font-weight: 400; src: url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family: 'Noto Sans KR'; font-weight: 700; src: url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --red:#c93a3a; --red-soft:#fbe9e9; --warn:#a8690f; --warn-soft:#fbeed2; --ok:#2e7d4f; --ok-soft:#e3f1e8; }
  @page { size: A4; margin: 16mm 18mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Sans KR', sans-serif; font-size:10.5pt; line-height:1.6; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:24pt; margin:0 0 2mm; }
  h2 { font-size:15pt; margin:0 0 3mm; padding-bottom:1.5mm; border-bottom:2px solid var(--ink); }
  h2 .num { color:var(--red); margin-right:2.5mm; }
  h3 { font-size:11.5pt; margin:5mm 0 2mm; }
  p { margin:0 0 2.5mm; }
  .section { page-break-before: always; }
  .muted { color:var(--muted); } .small { font-size:9pt; }
  table { width:100%; border-collapse:collapse; font-size:9pt; margin:2mm 0 4mm; }
  tr { page-break-inside: avoid; }
  th, td { text-align:left; vertical-align:top; padding:1.1mm 1.8mm; border-bottom:1px solid var(--line); }
  th.note, td.note { width:44mm; }
  th { font-size:8.5pt; color:var(--muted); background:var(--tint); border-bottom:1.5px solid var(--ink); }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.lead { font-weight:700; white-space:nowrap; }
  td.bad { color:var(--red); font-weight:700; } td.lots { color:var(--warn); }
  .pill { display:inline-block; border-radius:99px; padding:0 2mm; font-size:8pt; font-weight:700; background:var(--tint); color:var(--muted); }
  .pill.warn { background:var(--warn-soft); color:var(--warn); }
  .callout { border-left:3px solid var(--red); background:var(--red-soft); padding:3mm 4mm; border-radius:0 2mm 2mm 0; margin:3mm 0 4mm; page-break-inside:avoid; }
  .callout.ok { border-color:var(--ok); background:var(--ok-soft); }
  .callout.warn { border-color:var(--warn); background:var(--warn-soft); }
  .callout .t { font-weight:700; margin-bottom:1mm; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:3mm; margin:3mm 0 5mm; }
  .kpi { border:1px solid var(--line); border-radius:2.5mm; padding:3mm; }
  .kpi .v { font-size:17pt; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
  .kpi .l { font-size:8.5pt; color:var(--muted); margin-top:1mm; }
  figure { margin:3mm 0 4mm; page-break-inside:avoid; }
  figcaption { font-size:8.5pt; color:var(--muted); margin-top:1mm; }
  .eyebrow { font-size:8.5pt; letter-spacing:.12em; color:var(--muted); font-weight:500; text-transform:uppercase; }
</style></head><body>

<div class="eyebrow">분석 보고서 · 2026년 9월</div>
<h1>판매 데이터 기반 소비량 분석</h1>
<p class="muted">POS "그룹별 매출분석" ${months[0].replace('-', '년 ')}월 ~ ${months.at(-1).replace('-', '년 ')}월(12개월) × 음료 제조 레시피(2026.08판)로 씨앤비 재고 품목의 실제 소비량을 계산했습니다. 매출 금액은 다루지 않습니다.</p>

<div class="kpis">
  <div class="kpi"><div class="v">${n0(totalCups)}잔</div><div class="l">12개월 음료 판매 (옵션 제외)</div></div>
  <div class="kpi"><div class="v">${withPkg.length}개</div><div class="l">소비량을 낱개 단위로 계산한 재고 품목</div></div>
  <div class="kpi"><div class="v">${noPkg.length}개</div><div class="l">포장 단위를 몰라 원재료 양만 계산한 품목</div></div>
  <div class="kpi"><div class="v">${checklistCount}개</div><div class="l">비워 둔 값 (가정하지 않음 → 3장 확인 목록)</div></div>
</div>

<div class="callout">
  <div class="t">결론</div>
  판매 자료와 레시피만으로 음료 재료 ${withPkg.length}개 품목의 소비 속도(낱개/일)를 <strong>세지 않고</strong> 얻을 수 있습니다. 포장 단위나 환산값을 모르는 ${noPkg.length}개는 가정하지 않고 원재료 양까지만 계산했으며, 3장 목록을 채워 주시면 마저 계산됩니다. 이 속도로 "지금쯤 몇 개"를 계산하면 앞서 제안한 예상 재고가
  기록을 쌓을 필요 없이 첫 주부터 작동하고, 기준 수량이 소비에 비해 너무 많거나 적은 품목(3장)도 바로 보입니다.
  매달 POS에서 이 보고서 한 장을 내보내 앱에 넣는 것이 유일한 새 습관입니다.
</div>

<h3>계산 방법</h3>
<p>상품별 월 판매 잔 수 × 레시피 사용량(레시피에 인쇄된 g·ml·봉 수) = 재료 소비량. 이것을 레시피 구매 정보에 적힌 포장 크기로 나눠 <strong>낱개 수</strong>로 바꿨습니다.
자료에 없는 값(시럽 병의 g, 1샷 원두 g, 청 1단지 무게, 가니쉬 1포장 개수 등)은 <strong>가정하지 않고 비워 두었습니다</strong>. 그런 품목은 원재료 양(g·샷·개)만 나오며, 3장 목록을 채워 주시면 낱개로 바뀝니다.
"샷 추가"는 1샷, 에스프레소 단품은 싱글 1샷·더블 2샷으로 세었습니다(확인 목록). 원두는 시트처럼 일반·디카페인을 합쳐 두고 디카페인 잔 수만큼을 따로 표시했습니다. 레시피가 없는 메뉴는 잔 수만 세고 재료는 계산하지 않았습니다. 빵·디저트·쇼케이스·진동벨 그룹은 제외했습니다.</p>

<figure>${barChart(months, cups, { label: '월별 음료 판매 잔 수' })}<figcaption>월별 음료 판매 잔 수 (커피·티·에이드·라떼·주스, 옵션 제외)</figcaption></figure>
<figure>${shareChart(months, ice, hot)}<figcaption>레시피가 있는 메뉴의 아이스·핫 비중. 여름엔 탄산수·청·얼음이, 겨울엔 대추·생강·스팀우유가 늘어납니다.</figcaption></figure>

<section class="section">
<h2><span class="num">1</span>품목별 소비량과 기준 수량 비교</h2>
<p class="small muted">연간 낱개 = 12개월 소비량 ÷ 1포장. 일평균은 판매가 있던 달의 평균, 최대월은 가장 많이 쓴 달의 일평균. "커버 일수" = 시트 기준 수량이 최대월 소비로 며칠을 버티는지. 제안 = 최대월 소비 × (3일 / 4일) × 1.5. 빨강 = 4일 미만(월·목 사이를 못 버팀), 주황 = 30일 초과(과다 재고 가능).</p>
<table>
<thead><tr><th>품목</th><th class="num">연간 낱개</th><th class="num">일평균</th><th class="num">최대월</th><th class="num">시트 기준</th><th class="num">커버 일수</th><th class="num">제안 월→목 / 목→월</th><th class="note">포장 근거</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
${noaMerged ? `<p class="small muted">노아주스는 POS에 종류가 없어 연 ${n0(noaMerged.totalUnits)}병을 4종에 같은 비중으로 나눴습니다.</p>` : ''}

<h3>포장 단위(또는 환산값)를 몰라 원재료 양으로만 계산한 품목</h3>
<p class="small muted">자료에 없는 값은 가정하지 않고 비워 두었습니다. 3장의 확인 목록을 채워 주시면 이 표의 품목도 위 표로 올라갑니다.</p>
<table>
<thead><tr><th>품목</th><th class="num">연간 사용량</th><th class="num">하루 평균</th><th class="num">시트 기준</th><th>필요한 정보</th></tr></thead>
<tbody>${noPkgHtml}</tbody>
</table>
</section>

<section class="section">
<h2><span class="num">2</span>계절 변동</h2>
<p>월별 일평균 소비가 연평균 대비 얼마나 오르내리는지 본 것입니다. 변동이 큰 품목은 계절별로 기준 수량을 달리 두는 것이 맞습니다.</p>
<table>
<thead><tr><th>품목</th><th>가장 많이 쓰는 달</th><th>가장 적게 쓰는 달</th><th class="num">최대/최소</th></tr></thead>
<tbody>${seasonRows}</tbody>
</table>
<p class="small muted">연간 20낱개 이상 쓰는 품목만. 최대/최소가 2배를 넘으면 여름·겨울 기준을 따로 두는 것을 권합니다.</p>

<h3>브런치·라면</h3>
<p>브런치 1인 ${n0(brunchTotal)}인분, 브런치 어린이 ${n0(Object.values(a.brunchKids || {}).reduce((x, y) => x + y, 0))}건(몇 인분인지 확인 전), 라면 ${n0(ramenTotal)}그릇이 팔렸습니다. 브런치 재료(스모크햄·샐러드류·치즈·드레싱·버터·잼·양배추·당근)는 1인분 레시피가 있어야 같은 방식으로 계산할 수 있습니다.</p>
</section>

<section class="section">
<h2><span class="num">3</span>확인 목록 — 비워 둔 값</h2>
<p>자료(레시피·구매표·재고 시트)에 없는 값은 가정하지 않고 비워 두었습니다. 아래 값을 알려 주시면 해당 품목의 낱개 소비량과 예상 재고가 바로 계산됩니다. (같은 목록을 채워 보내실 수 있게 별도 PDF로도 드립니다.)</p>
${checklist
  .map(
    (sec) => `<h3>${esc(sec.title)}</h3>
<table>
<thead><tr><th style="width:38mm">${esc(sec.head[0])}</th><th>${esc(sec.head[1])}</th><th style="width:34mm">${esc(sec.head[2])}</th></tr></thead>
<tbody>${sec.rows.map((r) => `<tr><td class="lead" style="white-space:normal">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="small muted">${esc(r[2])}</td></tr>`).join('')}</tbody>
</table>`,
  )
  .join('')}
<p class="small muted">재료 계산에서 뺀 것 — 옵션·호출 ${ignoredList.filter((u) => !u.byGroup).length}개(${listHtml(ignoredList.filter((u) => !u.byGroup && u.total >= 100))} 등), 그룹째 제외 ${Object.entries(ignoredByGroup).map(([g, t]) => `${esc(g)} ${n0(t)}건`).join(' · ') || '없음'}. 레시피가 없어 뺀 메뉴: ${listHtml(noRecipe)}.</p>
<p class="small muted">답이 오면 <code>src/data/pos-map.js</code>의 빈 값을 채우고 분석을 다시 돌립니다. 답이 없는 항목은 그대로 비워 둡니다.</p>

</section>
<section class="section">
<h2><span class="num">4</span>이 자료로 더 자동화되는 것</h2>
<table>
<thead><tr><th style="width:40mm">자동화</th><th>어떻게</th><th style="width:34mm">새로 필요한 습관</th></tr></thead>
<tbody>
<tr><td class="lead">예상 재고를 첫 주부터</td><td>이 보고서의 품목별 소비 속도를 앱에 넣어 두면 "지난 실측값 + 입고 − 소비 속도 × 경과일"로 지금쯤 몇 개인지 바로 계산됩니다. 기록이 쌓이길 기다릴 필요가 없습니다.</td><td>없음 (1회 등록)</td></tr>
<tr><td class="lead">확인 필요 품목 자동 선별</td><td>예상값이 발주 결정을 바꿀 수 있는 품목만 표시 → 매번 세는 품목이 68개에서 10~15개로.</td><td>없음</td></tr>
<tr><td class="lead">기준 수량 자동 점검</td><td>커버 일수가 4일 미만이거나 30일 초과인 품목을 앱이 표시하고 계절별 기준을 제안합니다.</td><td>월 1회 확인</td></tr>
<tr><td class="lead">품목 등급(A/B/C) 자동 배정</td><td>소비 속도와 단가로 매번 셀 품목(A)과 월 1회 품목(C)을 나눕니다.</td><td>없음</td></tr>
<tr><td class="lead">소비 속도 갱신</td><td>매달 POS에서 "그룹별 매출분석"을 내보내 앱에 올리면 소비 속도가 갱신됩니다. 주 단위면 오차가 더 줄어듭니다.</td><td>월 1회 내보내기</td></tr>
<tr><td class="lead">발주 초안</td><td>예상 재고와 기준으로 월·목 아침에 발주 초안이 준비됩니다. 재발주 카드는 여전히 안전망으로 유효합니다.</td><td>—</td></tr>
</tbody>
</table>
</section>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`docs/analysis/index.html (${(html.length / 1024).toFixed(0)} KB)`);
