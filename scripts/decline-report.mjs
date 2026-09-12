// "요즘 매출이 떨어지는 이유" — 조언 없는 지표 보고서 → docs/analysis/decline.html → PDF
//   node scripts/decline-report.mjs && node scripts/make-pdf.mjs docs/analysis/decline.html "docs/analysis/매출-지표-2026-03~07.pdf"
//
// 두 가지 모양: docs/analysis/decline-narrative.json 이 있으면 기승전결 서사형(표지·요약·1~4장·부록), 없으면 지표 나열형.
//   서사형 본문은 워크플로가 findings 에서만 숫자를 가져와 쓰고 독자·감사 검토를 거친 것이다. 그림·표 값은 여기서 다시 계산한다.
//   --indicators 를 주면 서사형 파일이 있어도 나열형으로 만든다.
//
// 숫자는 전부 실행 시점에 data/pos/*.txt 에서 다시 계산한다(그림·타일). 문장(지표·함께 일어난 것·한계)은
// 워크플로가 반증까지 거쳐 남긴 docs/analysis/decline-findings.json 에서 읽는다. 둘 다 저장소에 올리지 않는다(매출 자료).
//
// 정의 — 실매출 R: 진동벨 'N번' 줄과 포인트결제/계좌이체 조정줄을 뺀 나머지 줄의 금액 합(할인을 뺀 값). scripts/decline-decomp.mjs 와 같은 정의.
//        주문 수 대용: 진동벨 'N번' 줄 수량 합(페이지 넘김으로 '진동벨 9번' 처럼 그룹명이 붙은 줄도 센다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport, daysInMonth } from '../src/logic/pos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'analysis');
const findings = JSON.parse(fs.readFileSync(path.join(outDir, 'decline-findings.json'), 'utf8')).결론;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const man = (x) => Math.round(x / 1e4).toLocaleString('ko-KR');
const pct = (a, b) => (b ? ((a / b - 1) * 100) : 0);
const f1 = (x) => (x > 0 ? '+' : '') + x.toFixed(1) + '%';

// ── 자료 ──
const DRINK = ['커피', '티', '에이드', '라떼', '주스/병음료'];
const FOOD = ['빵', '디저트', '쇼케이스', '브런치/밀키트'];
const isBell = (x) => x.group === '진동벨' && /(^|\s)\d+번$/.test(x.product);
const isPayment = (x) => x.group === '진동벨' && /^(포인트결제|계좌이체)$/.test(x.product);
const M = {};
for (const f of fs.readdirSync(path.join(root, 'data', 'pos')).filter((f) => /월.*\.txt$/.test(f))) {
  const r = parseSalesReport(fs.readFileSync(path.join(root, 'data', 'pos', f), 'utf8'));
  const e = (M[r.period.month] = { R: 0, D: 0, bell: 0, bread: 0, cups: 0, g: {} });
  for (const x of r.rows) {
    if (isBell(x)) { e.bell += x.qty; continue; }
    if (isPayment(x)) continue;
    e.R += x.amount || 0; e.D += x.discount || 0;
    const g = (e.g[x.group] ||= { R: 0, D: 0 }); g.R += x.amount || 0; g.D += x.discount || 0;
    if (x.price > 0 && x.group === '빵') e.bread += x.qty;
    if (x.price > 0 && DRINK.includes(x.group)) e.cups += x.qty;
  }
}
const have = Object.keys(M).sort();
const first = have[0], last = have.at(-1);
const months = []; // 달력상 모든 달 (결측 포함)
for (let [y, m] = first.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= last; m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const missing = months.filter((m) => !M[m]);
const prevYear = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
const ma3 = (m) => { const i = months.indexOf(m); const w = months.slice(Math.max(0, i - 2), i + 1).filter((k) => M[k]); return w.length >= 2 ? w.reduce((s, k) => s + M[k].R, 0) / w.length : null; };
const label = (m) => (m.endsWith('-01') || m === months[0] ? `${m.slice(2, 4)}년 ${Number(m.slice(5))}월` : `${Number(m.slice(5))}월`);

// 5개월 비교 구간과 두 가지 읽기
const CUR = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const BASE = CUR.map(prevYear);
const PREV6 = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
const sum = (ms, f) => ms.reduce((s, m) => s + (M[m] ? f(M[m], m) : 0), 0);
const days = (ms) => ms.filter((m) => M[m]).reduce((s, m) => s + daysInMonth(m), 0);
const Rcur = sum(CUR, (e) => e.R), Rbase = sum(BASE, (e) => e.R);
const dailyCur = Rcur / days(CUR), dailyPrev6 = sum(PREV6, (e) => e.R) / days(PREV6);
const bellCur = sum(CUR, (e) => e.bell), bellBase = sum(BASE, (e) => e.bell);

// ── 그림 공통 ──
const W = 700;
const svgOpen = (h, aria) => `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`;
const axisText = (x, y, t, anchor = 'middle', cls = 'ax') => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(t)}</text>`;
const legend = (items, x, y) => items.map(([c, t], i) => `<rect x="${x + i * 150}" y="${y - 8}" width="14" height="3" rx="1.5" fill="${c}"/>${axisText(x + i * 150 + 20, y - 3, t, 'start', 'lg')}`).join('');

// 그림 1: 월별 실매출 막대 + 3개월 이동평균
function chart1() {
  const H = 260, L = 52, Rm = 16, T = 28, B = 44;
  const pw = W - L - Rm, ph = H - T - B, n = months.length, bw = pw / n;
  const max = Math.max(...have.map((m) => M[m].R)) * 1.08;
  const y = (v) => T + ph * (1 - v / max);
  let s = svgOpen(H, '월별 1층 실매출 막대와 3개월 이동평균 선. 2025년 3~8월이 가장 높고 2025년 9월 이후 평평하다');
  // 음영: 비교 기준 구간과 이번 구간
  for (const [a, b, t] of [['2025-03', '2025-08', '비교 기준 (최고 구간)'], ['2026-03', '2026-07', '이번 구간']]) {
    const i = months.indexOf(a), j = months.indexOf(b);
    s += `<rect x="${L + i * bw}" y="${T}" width="${(j - i + 1) * bw}" height="${ph}" fill="var(--tint)"/>${axisText(L + i * bw + 4, T + 12, t, 'start', 'note')}`;
  }
  for (const t of [5000, 10000, 15000]) s += `<line x1="${L}" x2="${W - Rm}" y1="${y(t * 1e4)}" y2="${y(t * 1e4)}" class="grid"/>${axisText(L - 6, y(t * 1e4) + 4, `${t.toLocaleString('ko-KR')}`, 'end')}`;
  axisText(L - 6, T - 8, '만원', 'end');
  s += axisText(L - 6, T - 10, '만원', 'end');
  months.forEach((m, i) => {
    const x = L + i * bw + 2;
    if (!M[m]) { s += `<text x="${x + bw / 2 - 2}" y="${y(0) - 6}" text-anchor="middle" class="note">결측</text>`; }
    else s += `<rect x="${x}" y="${y(M[m].R)}" width="${bw - 4}" height="${y(0) - y(M[m].R)}" rx="2" fill="var(--bar)"/>`;
    if (m.endsWith('-01') || m === months[0] || m.endsWith('-07')) s += axisText(x + bw / 2 - 2, H - B + 16, label(m));
  });
  const pts = months.map((m, i) => [L + i * bw + bw / 2, ma3(m)]).filter((p) => p[1] != null);
  s += `<polyline points="${pts.map(([x, v]) => `${x.toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>`;
  const peak = have.reduce((a, m) => (M[m].R > M[a].R ? m : a), have[0]);
  s += axisText(L + months.indexOf(peak) * bw + bw / 2, y(M[peak].R) - 6, man(M[peak].R), 'middle', 'val');
  s += axisText(L + (n - 1) * bw + bw / 2, y(M[last].R) - 6, man(M[last].R), 'middle', 'val');
  s += legend([['var(--bar)', '월 실매출'], ['var(--s1)', '3개월 이동평균']], L, H - 4);
  return s + '</svg>';
}

// 그림 2: 그룹별 5개월 합 차이 (가로 막대, 감소/증가)
function chart2() {
  const groups = {}; for (const m of [...BASE, ...CUR]) for (const g of Object.keys(M[m]?.g || {})) groups[g] = 1;
  const rows = Object.keys(groups).map((g) => { const a = sum(BASE, (e) => e.g[g]?.R || 0), b = sum(CUR, (e) => e.g[g]?.R || 0); return { g: g === '진동벨' ? '기타(정식·오픈)' : g, a, b, d: b - a, share: a / Rbase }; }).sort((x, y) => x.d - y.d);
  const H = 24 + rows.length * 26 + 30, L = 118, Rm = 70, T = 20;
  const maxNeg = Math.max(0, ...rows.filter((r) => r.d < 0).map((r) => -r.d)), maxPos = Math.max(1, ...rows.filter((r) => r.d > 0).map((r) => r.d));
  // 0 선 위치: 감소 쪽에 폭을 더 주되, 가장 긴 감소 막대 왼쪽에 값 라벨 자리(64px)를 남긴다
  const x0 = L + (W - L - Rm) * 0.78;
  const scale = Math.min((x0 - L - 64) / maxNeg, (W - Rm - x0 - 56) / maxPos);
  let s = svgOpen(H, '그룹별 5개월 실매출 차이. 빵과 커피의 감소가 크고 디저트만 늘었다');
  s += `<line x1="${x0}" x2="${x0}" y1="${T - 6}" y2="${H - 26}" class="zero"/>`;
  rows.forEach((r, i) => {
    const y0 = T + i * 26, w = Math.abs(r.d) * scale;
    s += axisText(L - 8, y0 + 13, r.g, 'end', 'lg');
    s += `<rect x="${r.d < 0 ? x0 - w : x0}" y="${y0 + 3}" width="${Math.max(w, 1)}" height="16" rx="2" fill="${r.d < 0 ? 'var(--neg)' : 'var(--pos)'}"/>`;
    s += axisText(r.d < 0 ? x0 - w - 6 : x0 + w + 6, y0 + 15, `${r.d < 0 ? '−' : '+'}${man(Math.abs(r.d))}`, r.d < 0 ? 'end' : 'start', 'val');
    if (r.share >= 0.02) s += axisText(W - Rm + 60, y0 + 15, `비중 ${(r.share * 100).toFixed(0)}%`, 'end', 'note');
  });
  s += axisText(L, H - 8, `2025년 3~7월 ${man(Rbase)} → 2026년 3~7월 ${man(Rcur)} (만원). 오른쪽 작은 글씨는 2025년 매출 비중 — 비중보다 크게 줄었는지 볼 수 있다`, 'start', 'note');
  return s + '</svg>';
}

// 그림 3: 정상가 대비 할인율 — 음료 vs 식품, 그룹별 얇은 선
function chart3() {
  const H = 250, L = 44, Rm = 70, T = 24, B = 44;
  const pw = W - L - Rm, ph = H - T - B, n = months.length, bw = pw / n;
  const rate = (m, gs) => { if (!M[m]) return null; let r = 0, d = 0; for (const g of gs) { r += M[m].g[g]?.R || 0; d += M[m].g[g]?.D || 0; } return r + d ? (d / (r + d)) * 100 : null; };
  const allRates = months.flatMap((m) => [...DRINK, ...FOOD].map((g) => rate(m, [g]))).filter((v) => v != null);
  const yMax = Math.ceil(Math.max(16, ...allRates) / 4) * 4;
  const y = (v) => T + ph * (1 - v / yMax), x = (i) => L + i * bw + bw / 2;
  const line = (gs, cls) => { let out = '', seg = []; months.forEach((m, i) => { const v = rate(m, gs); if (v == null) { if (seg.length > 1) out += `<polyline class="${cls}" points="${seg.join(' ')}"/>`; seg = []; } else seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); }); if (seg.length > 1) out += `<polyline class="${cls}" points="${seg.join(' ')}"/>`; return out; };
  let s = svgOpen(H, '정상가 대비 할인율. 음료는 2025년 4~7월에 계단처럼 올라 14% 안팎, 식품은 3% 아래로 평평하다');
  for (let t = 0; t <= yMax; t += 4) s += `<line x1="${L}" x2="${W - Rm}" y1="${y(t)}" y2="${y(t)}" class="grid"/>${axisText(L - 6, y(t) + 4, `${t}%`, 'end')}`;
  for (const g of [...DRINK, ...FOOD]) s += line([g], 'thin');
  for (const [m, t] of [['2025-04', '빵 +400원'], ['2026-02', '커피 +500원']]) { const i = months.indexOf(m); s += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" class="mark"/>${axisText(x(i) + 4, T + 10, t, 'start', 'note')}`; }
  s += line(DRINK, 'bold s1') + line(FOOD, 'bold s2');
  const endD = rate(last, DRINK), endF = rate(last, FOOD);
  s += axisText(W - Rm + 6, y(endD) + 4, `음료 ${endD.toFixed(1)}%`, 'start', 'val') + axisText(W - Rm + 6, y(endF) + 4, `식품 ${endF.toFixed(1)}%`, 'start', 'val');
  months.forEach((m, i) => { if (m.endsWith('-01') || m === months[0] || m.endsWith('-07')) s += axisText(x(i), H - B + 16, label(m)); });
  s += legend([['var(--s1)', '음료 5그룹 합'], ['var(--s2)', '식품 4그룹 합'], ['#c9ccd1', '그룹별']], L, H - 4);
  return s + '</svg>';
}

// 그림 4: 전년 동월 대비 변화율 — 실매출·빵 개수·음료 잔·진동벨(2026-01~)
function chart4() {
  const span = months.filter((m) => m >= '2025-10');
  const H = 250, L = 44, Rm = 96, T = 24, B = 44;
  const pw = W - L - Rm, ph = H - T - B, n = span.length, bw = pw / n;
  const series = [
    ['실매출', 'var(--s1)', (m) => M[m] && M[prevYear(m)] ? pct(M[m].R, M[prevYear(m)].R) : null],
    ['빵 개수', 'var(--s2)', (m) => M[m] && M[prevYear(m)] ? pct(M[m].bread, M[prevYear(m)].bread) : null],
    ['음료 잔', 'var(--s3)', (m) => M[m] && M[prevYear(m)] ? pct(M[m].cups, M[prevYear(m)].cups) : null],
    ['진동벨 건수', 'var(--s4)', (m) => m >= '2026-01' && M[m] && M[prevYear(m)] ? pct(M[m].bell, M[prevYear(m)].bell) : null],
  ];
  const vals = series.flatMap(([, , f]) => span.map(f)).filter((v) => v != null);
  const lo = Math.floor(Math.min(...vals) / 10) * 10, hi = Math.ceil(Math.max(...vals) / 10) * 10;
  const y = (v) => T + ph * (1 - (v - lo) / (hi - lo)), x = (i) => L + i * bw + bw / 2;
  let s = svgOpen(H, '전년 동월 대비 변화율. 빵 개수가 2025년 12월에 먼저 마이너스가 되고 실매출·음료·진동벨은 2026년 3월부터 마이너스다');
  for (let t = lo; t <= hi; t += 20) s += `<line x1="${L}" x2="${W - Rm}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'zero' : 'grid'}"/>${axisText(L - 6, y(t) + 4, `${t > 0 ? '+' : ''}${t}%`, 'end')}`;
  for (const [name, color, f] of series) {
    let seg = [], out = '';
    span.forEach((m, i) => { const v = f(m); if (v == null) { if (seg.length > 1) out += `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`; seg = []; } else { seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); out += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`; } });
    if (seg.length > 1) out += `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    s += out;
  }
  // 끝값 라벨: 값이 비슷하면 겹치므로 위에서부터 12px 간격으로 밀어낸다
  const ends = series.map(([name, , f]) => ({ name, v: f(last) })).filter((e) => e.v != null).sort((a, b) => a.v - b.v);
  let prevY = Infinity;
  for (const e of [...ends].reverse()) { let yy = y(e.v) + 4; if (prevY - yy < 12) yy = prevY - 12; prevY = yy; e.y = yy; }
  for (const e of ends) s += axisText(W - Rm + 8, e.y, `${e.name} ${f1(e.v)}`, 'start', 'val');
  span.forEach((m, i) => { if (!M[m] || !M[prevYear(m)]) s += axisText(x(i), y(0) - 6, '전년 결측', 'middle', 'note'); if (m.endsWith('-01') || m === span[0] || m.endsWith('-07') || m.endsWith('-03')) s += axisText(x(i), H - B + 16, label(m)); });
  s += legend([['var(--s1)', '실매출'], ['var(--s2)', '빵 개수'], ['var(--s3)', '음료 잔'], ['var(--s4)', '진동벨 (26년 1월~)']], L, H - 4);
  return s + '</svg>';
}

// ── 표 1: 두 구간 비교 (값은 자료에서 계산) ──
function table1() {
  const rate = (ms) => { const R = sum(ms, (e) => e.R), D = sum(ms, (e) => e.D); return R + D ? (D / (R + D)) * 100 : 0; };
  const rows = [
    ['실매출 (5개월 합)', man(Rbase) + '만원', man(Rcur) + '만원', f1(pct(Rcur, Rbase))],
    ['하루 평균 실매출', man(Rbase / days(BASE)) + '만원', man(Rcur / days(CUR)) + '만원', f1(pct(Rcur / days(CUR), Rbase / days(BASE)))],
    ['진동벨 건수', bellBase.toLocaleString('ko-KR') + '건', bellCur.toLocaleString('ko-KR') + '건', f1(pct(bellCur, bellBase))],
    ['벨 1건당 실매출', Math.round(Rbase / bellBase).toLocaleString('ko-KR') + '원', Math.round(Rcur / bellCur).toLocaleString('ko-KR') + '원', f1(pct(Rcur / bellCur, Rbase / bellBase))],
    ['빵 개수', sum(BASE, (e) => e.bread).toLocaleString('ko-KR') + '개', sum(CUR, (e) => e.bread).toLocaleString('ko-KR') + '개', f1(pct(sum(CUR, (e) => e.bread), sum(BASE, (e) => e.bread)))],
    ['음료 잔 수', sum(BASE, (e) => e.cups).toLocaleString('ko-KR') + '잔', sum(CUR, (e) => e.cups).toLocaleString('ko-KR') + '잔', f1(pct(sum(CUR, (e) => e.cups), sum(BASE, (e) => e.cups)))],
    ['할인율 (정상가 대비)', rate(BASE).toFixed(1) + '%', rate(CUR).toFixed(1) + '%', (rate(CUR) - rate(BASE) > 0 ? '+' : '') + (rate(CUR) - rate(BASE)).toFixed(1) + '%p'],
  ];
  const perDay = (ms, f) => sum(ms, f) / days(ms);
  const prev6 = [
    ['하루 평균 실매출', man(dailyPrev6) + '만원', man(dailyCur) + '만원', f1(pct(dailyCur, dailyPrev6))],
    ['하루 진동벨 건수', Math.round(perDay(PREV6, (e) => e.bell)) + '건', Math.round(perDay(CUR, (e) => e.bell)) + '건', f1(pct(perDay(CUR, (e) => e.bell), perDay(PREV6, (e) => e.bell)))],
    ['하루 빵 개수', Math.round(perDay(PREV6, (e) => e.bread)) + '개', Math.round(perDay(CUR, (e) => e.bread)) + '개', f1(pct(perDay(CUR, (e) => e.bread), perDay(PREV6, (e) => e.bread)))],
  ];
  const cls = (d) => (d.startsWith('-') || d.startsWith('−') ? 'neg' : 'pos');
  const tr = (r) => `<tr><td>${esc(r[0])}</td><td class="r">${esc(r[1])}</td><td class="r">${esc(r[2])}</td><td class="r ${cls(r[3])}">${esc(r[3])}</td></tr>`;
  return `<table class="tbl"><thead><tr><th>전년 동월과 견줌</th><th class="r">2025년 3~7월</th><th class="r">2026년 3~7월</th><th class="r">차이</th></tr></thead>
<tbody>${rows.map(tr).join('')}</tbody>
<thead><tr class="sep"><th>직전 여섯 달과 견줌 (하루 평균)</th><th class="r">2025-09~2026-02</th><th class="r">2026-03~07</th><th class="r">차이</th></tr></thead>
<tbody>${prev6.map(tr).join('')}</tbody></table>`;
}

// ── 서사형 (기승전결) ──
const FIG = { 1: [chart1, '월별 실매출(막대)과 3개월 이동평균(선). 음영은 비교 기준 구간(2025-03~08)과 이번 구간(2026-03~07). 2024-09 는 결측.'], 2: [chart2, '그룹별 다섯 달 실매출 차이(2025-03~07 → 2026-03~07). 오른쪽 작은 글씨는 2025년 매출 비중.'], 3: [chart3, '정상가 대비 할인율. 굵은 선은 음료 5그룹 합·식품 4그룹 합, 얇은 선은 그룹별, 점선은 가격 인상 시점.'], 4: [chart4, '전년 동월 대비 변화율. 진동벨은 2024년 집계 방식이 달라 2026-01부터만 전년 비교가 성립한다.'] };
function renderNarrative(nar) {
  let figN = 0;
  const block = (b) => {
    if (b.kind === 'h3') return `<h3>${esc(b.text)}</h3>`;
    if (b.kind === 'p') return `<p class="body">${esc(b.text)}</p>`;
    if (b.kind === 'list') return `<ul class="body">${(b.items || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    const strip = (c) => (c || '').replace(/^\s*(그림|표)\s*\d+\s*[.．:]\s*/, '');
    const chartOf = (b) => { const c = b.caption || ''; if (/이동평균|월별 실매출/.test(c)) return 1; if (/전년 동월|변화율/.test(c)) return 4; if (/그룹별|분해/.test(c)) return 2; if (/할인율/.test(c)) return 3; return Number(b.text); };
    if (b.kind === 'figure') { const id = chartOf(b), [fn, cap] = FIG[id] || [null, '']; if (!fn) return ''; const n = ++figN; return `<figure>${fn()}<figcaption><b>그림 ${n}.</b> ${esc(strip(b.caption) || cap)}</figcaption></figure>`; }
    if (b.kind === 'table') return `<figure class="tblfig"><figcaption class="top"><b>표 1.</b> ${esc(strip(b.caption) || '두 구간 비교 — 2025년 3~7월과 2026년 3~7월, 그리고 직전 6개월')}</figcaption>${table1()}</figure>`;
    return '';
  };
  const secs = nar.sections.map((sec, i) => `<section class="${i > 0 && i < 4 ? 'keep' : ''}"><h2><span class="num">${esc(sec.num)}</span>${esc(sec.title)}</h2>${sec.blocks.map(block).join('')}</section>`).join('');
  return `<div class="cover">
  <div class="eyebrow">매출 지표 보고서 · 2026년 3~7월</div>
  <h1>${esc(nar.cover.title)}</h1>
  <p class="sub">${esc(nar.cover.subtitle)}</p>
  <table class="meta"><tr><th>대상</th><td>씨앤비 베이커리 카페 1층 베이커리·카페 (인천 서구 아라로 117-1)</td></tr><tr><th>자료 범위</th><td>${esc(nar.cover.scope)}</td></tr><tr><th>작성 기준일</th><td>${esc(nar.cover.date)}</td></tr><tr><th>작성 원칙</th><td>있었던 일을 숫자로만 적었다. 원인 판단과 제안은 넣지 않았다.</td></tr></table>
</div>
<div class="summary"><div class="lbl">요약</div><ol>${nar.summary.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>
${secs}`;
}

// ── 문장 ──
const bySection = (name) => findings.indicators.filter((i) => i.section === name);
const indicatorList = (items) => `<ol class="ind">${items.map((i) => `<li><p>${esc(i.line)}</p><p class="num">${esc(i.numbers)}</p></li>`).join('')}</ol>`;
const bullets = (arr, cls = '') => `<ul class="${cls}">${arr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
const coincided = findings.coincided.map((t) => t.replace(/\s*\(https?:[^)]*\)/g, '').replace(/\s*\(scripts\/[^)]*\)/g, ''));
const inside = coincided.filter((t) => t.startsWith('[내부')), outside = coincided.filter((t) => t.startsWith('[외부'));

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>1층 매출 지표 · 2026년 3~7월</title>
<style>
  @font-face { font-family:'Noto Sans KR'; font-weight:400; src:url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family:'Noto Sans KR'; font-weight:500; src:url('../proposal/fonts/NotoSansKR-500.ttf') format('truetype'); }
  @font-face { font-family:'Noto Sans KR'; font-weight:700; src:url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --surface:#ffffff; --bar:#b9bfc4;
          --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --neg:#e34948; --pos:#2a78d6; }
  @page { size:A4; margin:14mm 16mm 16mm 16mm; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Noto Sans KR',sans-serif; font-size:9.6pt; line-height:1.55; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:19pt; margin:0 0 1.5mm; letter-spacing:-.02em; }
  h2 { font-size:12pt; margin:6mm 0 2mm; padding-bottom:1.2mm; border-bottom:1.5px solid var(--ink); page-break-after:avoid; }
  p { margin:0 0 2mm; }
  .eyebrow { font-size:8pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
  .scope { font-size:8.5pt; color:var(--muted); }
  .muted { color:var(--muted); } .small { font-size:8.2pt; }
  .head { font-size:10.5pt; margin:2.5mm 0 3mm; }
  .two { display:flex; gap:4mm; margin:2mm 0 4mm; }
  .tile { flex:1; border:1px solid var(--line); border-top:3px solid var(--ink); padding:3mm 4mm; }
  .tile .t { font-size:8.5pt; color:var(--muted); }
  .tile .n { font-size:20pt; font-weight:700; line-height:1.15; font-variant-numeric:tabular-nums; }
  .tile .d { font-size:8.5pt; color:var(--muted); }
  figure { margin:2mm 0 3mm; page-break-inside:avoid; }
  figcaption { font-size:8.2pt; color:var(--muted); margin-top:1mm; }
  svg.chart { width:100%; height:auto; display:block; font-family:'Noto Sans KR',sans-serif; }
  .ax { font-size:9px; fill:var(--muted); } .lg { font-size:10px; fill:var(--ink); } .val { font-size:10px; fill:var(--ink); font-weight:500; } .note { font-size:8.5px; fill:var(--muted); }
  .grid { stroke:var(--line); stroke-width:1; } .zero { stroke:var(--ink); stroke-width:1.2; } .mark { stroke:var(--muted); stroke-width:1; stroke-dasharray:3 3; }
  polyline.thin { fill:none; stroke:#c9ccd1; stroke-width:1; } polyline.bold { fill:none; stroke-width:2.2; stroke-linejoin:round; } .s1 { stroke:var(--s1); } .s2 { stroke:var(--s2); }
  ol.ind { margin:0; padding-left:5mm; } ol.ind li { margin-bottom:2.2mm; page-break-inside:avoid; } ol.ind p { margin:0; } ol.ind .num { font-size:7.8pt; color:var(--muted); margin-top:.5mm; }
  ul { margin:0; padding-left:5mm; } ul li { margin-bottom:1.2mm; } ul.small li { font-size:8.2pt; color:var(--muted); }
  .pb { page-break-before:always; }
  footer { margin-top:5mm; padding-top:2mm; border-top:1px solid var(--line); font-size:8pt; color:var(--muted); }
  /* 서사형 */
  .cover { border-bottom:2px solid var(--ink); padding-bottom:4mm; margin-bottom:4mm; }
  .cover .sub { font-size:11pt; color:var(--muted); margin:0 0 3mm; }
  table.meta { border-collapse:collapse; font-size:8.5pt; } table.meta th { text-align:left; color:var(--muted); font-weight:500; padding:.6mm 4mm .6mm 0; white-space:nowrap; vertical-align:top; } table.meta td { padding:.6mm 0; }
  .summary { background:var(--tint); border-left:3px solid var(--ink); padding:3mm 4.5mm; margin:0 0 5mm; page-break-inside:avoid; }
  .summary .lbl { font-size:8pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; margin-bottom:1mm; }
  .summary ol { margin:0; padding-left:5mm; font-size:10.2pt; } .summary li { margin-bottom:1mm; }
  section h2 .num { display:inline-block; min-width:7mm; margin-right:2mm; color:var(--muted); font-weight:500; }
  h3 { font-size:10.2pt; margin:4mm 0 1.5mm; page-break-after:avoid; }
  p.body { font-size:9.8pt; line-height:1.7; margin:0 0 2.6mm; text-align:justify; }
  ul.body { font-size:9.6pt; line-height:1.65; margin:0 0 2.6mm; page-break-inside:avoid; }
  figure.tblfig figcaption.top { margin:0 0 1.5mm; }
  table.tbl { width:100%; border-collapse:collapse; font-size:9pt; } table.tbl th, table.tbl td { padding:1.6mm 2mm; border-bottom:1px solid var(--line); } table.tbl th { font-size:8pt; color:var(--muted); font-weight:500; border-bottom:1.5px solid var(--ink); text-align:left; }
  table.tbl .r { text-align:right; font-variant-numeric:tabular-nums; } table.tbl .neg { color:var(--neg); } table.tbl .pos { color:var(--pos); } table.tbl tr.sep th { padding-top:3.5mm; }
</style></head><body>

<div class="eyebrow">씨앤비 베이커리 카페 · 1층 POS 지표 · ${esc(first)} ~ ${esc(last)}</div>
<h1>1층 매출 — 무엇이 언제 얼마나</h1>
<p class="scope">범위: 1층 베이커리·카페 POS(유니온포스 그룹별 매출분석) ${have.length}개월. 2층 식당은 별도 POS라 들어 있지 않음. ${missing.length ? `결측: ${missing.join(', ')}.` : ''} 실매출 = 할인을 뺀 금액. 원인 판단은 넣지 않았고, 같은 시기에 일어난 일만 나란히 적었다.</p>
<p class="head">${esc(findings.headline)}</p>

<div class="two">
  <div class="tile"><div class="t">전년 같은 다섯 달(2025-03~07)과 견주면</div><div class="n">${f1(pct(Rcur, Rbase))}</div><div class="d">${man(Rbase)} → ${man(Rcur)}만원 · 진동벨 건수 ${f1(pct(bellCur, bellBase))}</div></div>
  <div class="tile"><div class="t">직전 여섯 달(2025-09~2026-02) 하루 평균과 견주면</div><div class="n">${f1(pct(dailyCur, dailyPrev6))}</div><div class="d">하루 ${man(dailyPrev6)} → ${man(dailyCur)}만원 · 2025-09 이후 수준은 평평</div></div>
</div>
<p class="small muted">두 숫자는 같은 자료의 두 읽기다. 비교 기준인 2025년 3~8월은 ${have.length}개월 중 가장 높은 구간이고, 2024년 봄 자료가 없어 그 구간이 해마다 오는 계절 고점인지 한 해의 일인지는 가릴 수 없다.</p>

<figure>${chart1()}<figcaption>월별 실매출(막대)과 3개월 이동평균(선). 음영은 비교 기준 구간(2025-03~08)과 이번 구간(2026-03~07).</figcaption></figure>

<h2>얼마나</h2>
${indicatorList(bySection('얼마나'))}

<h2 class="pb">무엇이</h2>
<figure>${chart2()}<figcaption>그룹별 다섯 달 실매출 차이(2025-03~07 → 2026-03~07). 빵·쇼케이스는 매출 비중보다 크게 줄었고 커피는 가게 전체와 같은 비율로 줄었다. 버터떡이 2026년 빵·디저트 두 버튼에 있어 빵 몫은 42~49% 사이.</figcaption></figure>
${indicatorList(bySection('무엇이'))}
<figure>${chart3()}<figcaption>정상가 대비 할인율. 굵은 선은 음료 5그룹 합과 식품 4그룹 합, 얇은 선은 그룹별. 점선은 가격 인상 시점. 할인 종류(쿠폰·영수증·직원 등)는 보고서에 없다.</figcaption></figure>

<h2 class="pb">언제부터</h2>
<figure>${chart4()}<figcaption>전년 동월 대비 변화율. 2025-08~11의 큰 플러스는 2024년 하반기 낮은 기저 대비라 여기서는 2025-10부터 그렸고, 진동벨은 2024년 집계 방식이 달라(벨당 품목 6.4→5) 2026-01부터만 전년 비교가 성립한다.</figcaption></figure>
${indicatorList(bySection('언제부터'))}

<h2>함께 일어난 것 — 원인이라는 뜻이 아니다</h2>
<p class="small muted">같은 시기에 있었던 일을 날짜와 함께 적었다. 어느 것이 얼마나 영향을 줬는지는 일별 자료가 없어 계산할 수 없다.</p>
<p><b>가게 안</b></p>${bullets(inside.map((t) => t.replace(/^\[[^\]]+\]\s*/, '')), 'small')}
<p style="margin-top:2mm"><b>가게 밖</b></p>${bullets(outside.map((t) => t.replace(/^\[[^\]]+\]\s*/, '')), 'small')}

<h2>늘어난 것</h2>
${indicatorList(bySection('늘어난 것'))}

<h2>이 자료로는 알 수 없는 것</h2>
${bullets(findings.cannotTell, 'small')}

<h2>자료 범위와 정의</h2>
${bullets(findings.caveats.filter((t) => !/미커밋|이 세션/.test(t)), 'small')}

<footer>자료: POS 「그룹별 매출분석」 월 보고서 ${have.length}개 (${esc(first)} ~ ${esc(last)}${missing.length ? `, ${missing.join('·')} 결측` : ''}). 실매출 = 진동벨 'N번' 줄과 포인트결제·계좌이체 조정줄을 뺀 상품 줄의 금액 합(할인 차감 후). 주문 수 대용 = 진동벨 번호 발급 수. 외부 사건 출처: K-water 경인아라뱃길 공지, 기상청 월 기후특성·Open-Meteo 재분석, 통계청, 다이닝코드, 지역 언론. 그림 값은 실행 시점에 자료에서 다시 계산한 것.</footer>
</body></html>`;

const narrativePath = path.join(outDir, 'decline-narrative.json');
const useNarrative = fs.existsSync(narrativePath) && !process.argv.includes('--indicators');
let out = html;
if (useNarrative) {
  const nar = JSON.parse(fs.readFileSync(narrativePath, 'utf8'));
  const body = renderNarrative(nar);
  // 스타일·푸터는 그대로 두고 본문만 바꾼다
  out = html.replace(/<body>[\s\S]*<footer>/, `<body>\n${body}\n<footer>`);
}
fs.writeFileSync(path.join(outDir, 'decline.html'), out);
console.log(`docs/analysis/decline.html (${useNarrative ? '서사형' : '나열형'}) — ${have.length}개월, 결측 ${missing.join(',') || '없음'}, 5개월 R ${man(Rbase)}→${man(Rcur)} (${f1(pct(Rcur, Rbase))}), 하루평균 직전6개월 대비 ${f1(pct(dailyCur, dailyPrev6))}, 벨 ${bellBase}→${bellCur}`);
