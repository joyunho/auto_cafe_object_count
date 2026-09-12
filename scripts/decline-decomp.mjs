// 2026-03~07 전년 동월 대비 매출 감소 분해 — 주문 건수 vs 객단가 vs 그룹 vs 상품(family) vs 시점
//   node scripts/decline-decomp.mjs            → 표 출력 (JSON 은 --json)
//
// 정의 (모두 이 파일 안에서 계산, 외부 상태 없음)
//   행 제외:  진동벨 그룹의 'N번' 줄(= 주문 건수 프록시, 금액은 조정치) · 결제수단 조정 줄(포인트결제·계좌이체, 금액 음수)
//   실매출 R = Σ amount (제외 행 뺀 전 행. 오픈푸드·정식·대관료처럼 진동벨 그룹에 섞인 실제 판매는 '기타' 그룹으로 포함)
//   정상가 G = Σ (amount + discount),  할인 D = Σ discount,  할인율 d = D / G
//   주문 N   = 진동벨 그룹 'N번' 줄 수량 합 ('진동벨 9번' 처럼 그룹명이 붙은 채 등록된 벨도 포함)
//   품목 Q   = 단가 > 0 인 행의 수량 합 (단가 0 인 무료 옵션 제외)
//   객단가 A = R / N = (Q/N) × (G/Q) × (R/G) = 건당 품목 × 품목당 정상가 × (1 − 할인율)   ← 항등식
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport } from '../src/logic/pos.js';
import { buildSeries } from '../src/logic/sku.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data', 'pos');
const asJson = process.argv.includes('--json');

const isBell = (r) => r.group === '진동벨' && /(\d+)번$/.test(r.product);
const isPayment = (r) => r.group === '진동벨' && /^(포인트결제|계좌이체)$/.test(r.product);
const isExcluded = (r) => isBell(r) || isPayment(r);
const groupOf = (r) => (r.group === '진동벨' ? '기타(진동벨 그룹 내 오픈푸드·정식·대관 등)' : r.group || '(미배정)');
const DRINK_GROUPS = new Set(['커피', '라떼', '티', '에이드', '주스/병음료']);

// ── 읽기 · 원본 총합계 검증 ──────────────────────────────────────────────────
const files = fs.readdirSync(dir).filter((f) => /월.*\.txt$/.test(f));
const reports = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const rep = parseSalesReport(text);
  if (rep.unassigned) throw new Error(`${f}: 그룹 미배정 ${rep.unassigned}줄`);
  // 파일 맨 끝 '총합계 수량 금액 할인' 줄과 파싱 합이 같은지 (3월 빵 2중 블록 포함, 원본이 이미 둘 다 더한 값)
  const tot = [...text.matchAll(/^총합계\s+([\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)/gm)].pop();
  const num = (s) => Number(s.replace(/,/g, ''));
  const sum = rep.rows.reduce((a, r) => ({ qty: a.qty + r.qty, amount: a.amount + r.amount, discount: a.discount + r.discount }), { qty: 0, amount: 0, discount: 0 });
  if (!tot || num(tot[1]) !== sum.qty || num(tot[2]) !== sum.amount || num(tot[3]) !== sum.discount) throw new Error(`${f}: 파싱 합계 ≠ 원본 총합계 ${JSON.stringify(sum)} vs ${tot && tot.slice(1)}`);
  rep.file = f;
  reports.push(rep);
}
reports.sort((a, b) => a.period.month.localeCompare(b.period.month));
const months = reports.map((r) => r.period.month);
if (new Set(months).size !== months.length) throw new Error('같은 달이 두 번');

// ── 월별 지표 ────────────────────────────────────────────────────────────────
const M = {};
for (const rep of reports) {
  const m = rep.period.month;
  const x = { month: m, days: Number(rep.period.to.slice(8)), R: 0, G: 0, D: 0, N: 0, Nstrict: 0, Q: 0, Qall: 0, bread: 0, cups: 0, groups: {}, bellNames: [], adjust: 0 };
  for (const r of rep.rows) {
    if (isBell(r)) { x.N += r.qty; if (/^\d+번$/.test(r.product)) x.Nstrict += r.qty; else x.bellNames.push(`${r.product}:${r.qty}`); x.adjust += r.amount; continue; }
    if (isPayment(r)) { x.adjust += r.amount; continue; }
    x.R += r.amount; x.G += r.amount + r.discount; x.D += r.discount; x.Qall += r.qty;
    if (r.price > 0) x.Q += r.qty;
    if (r.group === '빵' && r.price > 0) x.bread += r.qty;
    if (DRINK_GROUPS.has(r.group) && r.price > 0) x.cups += r.qty;
    const g = (x.groups[groupOf(r)] ||= { R: 0, G: 0, D: 0, Q: 0 });
    g.R += r.amount; g.G += r.amount + r.discount; g.D += r.discount; if (r.price > 0) g.Q += r.qty;
  }
  x.A = x.R / x.N; x.ipo = x.Q / x.N; x.gpi = x.G / x.Q; x.npi = x.R / x.Q; x.d = x.D / x.G;
  M[m] = x;
}
const prevYear = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
const man = (won) => Math.round(won / 10000); // 만원
const pct = (x) => (x * 100).toFixed(1) + '%';
const f2 = (x) => x.toFixed(2);

const out = { definitions: {}, monthly: [], decomp1: {}, decomp2: {}, groups: {}, families: {}, timing: {}, checks: [] };
out.checks.push('각 파일의 파싱 합(qty·amount·discount)이 파일 끝 총합계 줄과 원 단위로 같음 — 23개월 모두 확인 (2026-03 빵 2중 블록은 원본 총합계에도 둘 다 들어 있음 = 기간을 나눈 분할, 이중 계상 아님)');

console.log('== 월별 지표 (R 실매출 만원 · N 주문(벨) · A 객단가 원 · Q 품목(단가>0) · 건당품목 · 품목당 정상가 · 할인율 · 빵 개수 · 음료 잔)');
console.log('월 | R(만원) | R 전년비 | N | N(엄격, ^N번만) | N 전년비 | A | A 전년비 | Q | Q/N | G/Q | d | 빵 | 빵 전년비 | 음료잔 | 잔 전년비 | 조정줄 금액');
for (const m of months) {
  const x = M[m], p = M[prevYear(m)];
  const yoy = (k) => (p ? pct(x[k] / p[k] - 1) : '-');
  out.monthly.push({ month: m, R: x.R, G: x.G, D: x.D, N: x.N, Nstrict: x.Nstrict, Q: x.Q, A: Math.round(x.A), ipo: +f2(x.ipo), gpi: Math.round(x.gpi), d: +(x.d * 100).toFixed(2), bread: x.bread, cups: x.cups, adjust: x.adjust, yoy: p ? { R: +((x.R / p.R - 1) * 100).toFixed(1), N: +((x.N / p.N - 1) * 100).toFixed(1), A: +((x.A / p.A - 1) * 100).toFixed(1), bread: +((x.bread / p.bread - 1) * 100).toFixed(1), cups: +((x.cups / p.cups - 1) * 100).toFixed(1) } : null });
  console.log(`${m} | ${man(x.R).toLocaleString()} | ${yoy('R')} | ${x.N.toLocaleString()} | ${x.Nstrict.toLocaleString()}${x.bellNames.length ? '(+' + x.bellNames.join(',') + ')' : ''} | ${yoy('N')} | ${Math.round(x.A).toLocaleString()} | ${yoy('A')} | ${x.Q.toLocaleString()} | ${f2(x.ipo)} | ${Math.round(x.gpi).toLocaleString()} | ${pct(x.d)} | ${x.bread.toLocaleString()} | ${yoy('bread')} | ${x.cups.toLocaleString()} | ${yoy('cups')} | ${x.adjust.toLocaleString()}`);
}

// ── 1. ΔR = ΔN·A_p + ΔA·N_c ──────────────────────────────────────────────────
const TARGET = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
console.log('\n== 1. 실매출 감소 = 주문 효과(ΔN × 작년 객단가) + 객단가 효과(ΔA × 올해 주문)   [항등식: R_c − R_p = (N_c−N_p)·A_p + (A_c−A_p)·N_c]');
console.log('월 | ΔR(만원) | ΔN | 주문효과(만원) | ΔA(원) | 객단가효과(만원) | 주문효과 비중 | 대칭식 주문효과(ΔN×평균A) | 대칭식 비중');
let S = { dR: 0, ordEff: 0, tickEff: 0, ordSym: 0, tickSym: 0 };
out.decomp1.months = [];
for (const m of TARGET) {
  const c = M[m], p = M[prevYear(m)];
  const dR = c.R - p.R, dN = c.N - p.N, dA = c.A - p.A;
  const ordEff = dN * p.A, tickEff = dA * c.N;
  const ordSym = dN * (p.A + c.A) / 2, tickSym = dA * (p.N + c.N) / 2;
  if (Math.abs(ordEff + tickEff - dR) > 1 || Math.abs(ordSym + tickSym - dR) > 1) throw new Error('분해 항등식 불일치 ' + m);
  S.dR += dR; S.ordEff += ordEff; S.tickEff += tickEff; S.ordSym += ordSym; S.tickSym += tickSym;
  out.decomp1.months.push({ month: m, R_prev: p.R, R_curr: c.R, dR, N_prev: p.N, N_curr: c.N, dN, A_prev: Math.round(p.A), A_curr: Math.round(c.A), dA: Math.round(dA), orderEffect: Math.round(ordEff), ticketEffect: Math.round(tickEff), orderShare: +(ordEff / dR * 100).toFixed(1), orderEffectSym: Math.round(ordSym), ticketEffectSym: Math.round(tickSym) });
  console.log(`${m} | ${man(dR)} | ${dN} | ${man(ordEff)} | ${Math.round(dA)} | ${man(tickEff)} | ${pct(ordEff / dR)} | ${man(ordSym)} | ${pct(ordSym / dR)}`);
}
out.decomp1.total = { dR: S.dR, orderEffect: Math.round(S.ordEff), ticketEffect: Math.round(S.tickEff), orderShare: +(S.ordEff / S.dR * 100).toFixed(1), ticketShare: +(S.tickEff / S.dR * 100).toFixed(1), orderEffectSym: Math.round(S.ordSym), ticketEffectSym: Math.round(S.tickSym), orderShareSym: +(S.ordSym / S.dR * 100).toFixed(1) };
console.log(`5개월 합 | ${man(S.dR)} | | ${man(S.ordEff)} | | ${man(S.tickEff)} | ${pct(S.ordEff / S.dR)} | ${man(S.ordSym)} | ${pct(S.ordSym / S.dR)}`);
// 5개월 풀링(합계 기준) 값
const pool = (ms) => { const t = { R: 0, G: 0, D: 0, N: 0, Q: 0, bread: 0, cups: 0, groups: {} }; for (const m of ms) { const x = M[m]; for (const k of ['R', 'G', 'D', 'N', 'Q', 'bread', 'cups']) t[k] += x[k]; for (const [g, v] of Object.entries(x.groups)) { const t2 = (t.groups[g] ||= { R: 0, G: 0, D: 0, Q: 0 }); for (const k of ['R', 'G', 'D', 'Q']) t2[k] += v[k]; } } t.A = t.R / t.N; t.ipo = t.Q / t.N; t.gpi = t.G / t.Q; t.npi = t.R / t.Q; t.d = t.D / t.G; return t; };
const Pc = pool(TARGET), Pp = pool(TARGET.map(prevYear));
console.log(`5개월 합 수준: 2025 R ${man(Pp.R).toLocaleString()}만원 N ${Pp.N.toLocaleString()} A ${Math.round(Pp.A).toLocaleString()} · 2026 R ${man(Pc.R).toLocaleString()}만원 N ${Pc.N.toLocaleString()} A ${Math.round(Pc.A).toLocaleString()} · ΔR ${pct(Pc.R / Pp.R - 1)} ΔN ${pct(Pc.N / Pp.N - 1)} ΔA ${pct(Pc.A / Pp.A - 1)}`);
{ // 민감도: (a) 주문 수를 '^N번' 줄만으로 셀 때(2024-08·2025-03 의 '진동벨 9번' 제외) (b) 실매출에 포인트결제·계좌이체 조정 줄을 포함할 때
  let o = 0, t = 0, dRs = 0;
  for (const m of TARGET) { const c = M[m], p = M[prevYear(m)]; const Ap = p.R / p.Nstrict, Ac = c.R / c.Nstrict; o += (c.Nstrict - p.Nstrict) * Ap; t += (Ac - Ap) * c.Nstrict; dRs += c.R - p.R; }
  out.decomp1.sensitivityStrictN = { orderEffect: Math.round(o), ticketEffect: Math.round(t), orderShare: +(o / dRs * 100).toFixed(1), N_prev_strict: TARGET.reduce((a, m) => a + M[prevYear(m)].Nstrict, 0), N_curr_strict: TARGET.reduce((a, m) => a + M[m].Nstrict, 0) };
  console.log(`민감도(a) 주문을 ^N번 줄만으로: 주문효과 ${man(o)} · 객단가효과 ${man(t)} · 주문효과 비중 ${pct(o / dRs)} (2025-03 N 5,598 → ΔN 26-03 ${M['2026-03'].Nstrict - M['2025-03'].Nstrict})`);
  const Radj = (ms) => ms.reduce((a, m) => a + M[m].R + M[m].adjust, 0);
  out.decomp1.sensitivityWithAdjust = { R_prev: Radj(TARGET.map(prevYear)), R_curr: Radj(TARGET), dR: Radj(TARGET) - Radj(TARGET.map(prevYear)) };
  console.log(`민감도(b) 조정 줄(포인트결제·계좌이체·벨 조정) 포함 실매출: 2025 ${man(Radj(TARGET.map(prevYear))).toLocaleString()} → 2026 ${man(Radj(TARGET)).toLocaleString()} (Δ ${man(Radj(TARGET) - Radj(TARGET.map(prevYear)))}만원)`);
}
out.decomp1.pooled = { prev: { R: Pp.R, N: Pp.N, A: Math.round(Pp.A) }, curr: { R: Pc.R, N: Pc.N, A: Math.round(Pc.A) }, pctR: +((Pc.R / Pp.R - 1) * 100).toFixed(1), pctN: +((Pc.N / Pp.N - 1) * 100).toFixed(1), pctA: +((Pc.A / Pp.A - 1) * 100).toFixed(1) };

// ── 2. 객단가 = 건당 품목 × 품목당 정상가 × (1−할인율) ───────────────────────
console.log('\n== 2. 객단가 분해  A = (Q/N) × (G/Q) × (1−d)   [순차 항등식: ΔA = Δipo·gpi_p·(1−d_p) + ipo_c·Δgpi·(1−d_p) + ipo_c·gpi_c·Δ(1−d)]');
console.log('월 | A_p→A_c | Q/N p→c | G/Q p→c | d p→c | ΔA | 품목수 효과 | 정상가 효과 | 할인 효과 | (원/건)');
out.decomp2.months = [];
const tick = (c, p) => {
  const e1 = (c.ipo - p.ipo) * p.gpi * (1 - p.d), e2 = c.ipo * (c.gpi - p.gpi) * (1 - p.d), e3 = c.ipo * c.gpi * ((1 - c.d) - (1 - p.d));
  if (Math.abs(e1 + e2 + e3 - (c.A - p.A)) > 0.01) throw new Error('객단가 분해 불일치');
  return { e1, e2, e3 };
};
for (const m of TARGET) {
  const c = M[m], p = M[prevYear(m)]; const { e1, e2, e3 } = tick(c, p);
  out.decomp2.months.push({ month: m, A_prev: Math.round(p.A), A_curr: Math.round(c.A), ipo_prev: +f2(p.ipo), ipo_curr: +f2(c.ipo), gpi_prev: Math.round(p.gpi), gpi_curr: Math.round(c.gpi), d_prev: +(p.d * 100).toFixed(2), d_curr: +(c.d * 100).toFixed(2), dA: Math.round(c.A - p.A), itemsEffect: Math.round(e1), priceEffect: Math.round(e2), discountEffect: Math.round(e3) });
  console.log(`${m} | ${Math.round(p.A)}→${Math.round(c.A)} | ${f2(p.ipo)}→${f2(c.ipo)} | ${Math.round(p.gpi)}→${Math.round(c.gpi)} | ${pct(p.d)}→${pct(c.d)} | ${Math.round(c.A - p.A)} | ${Math.round(e1)} | ${Math.round(e2)} | ${Math.round(e3)}`);
}
{
  const { e1, e2, e3 } = tick(Pc, Pp);
  out.decomp2.pooled = { A_prev: Math.round(Pp.A), A_curr: Math.round(Pc.A), ipo_prev: +f2(Pp.ipo), ipo_curr: +f2(Pc.ipo), gpi_prev: Math.round(Pp.gpi), gpi_curr: Math.round(Pc.gpi), npi_prev: Math.round(Pp.npi), npi_curr: Math.round(Pc.npi), d_prev: +(Pp.d * 100).toFixed(2), d_curr: +(Pc.d * 100).toFixed(2), dA: Math.round(Pc.A - Pp.A), itemsEffect: Math.round(e1), priceEffect: Math.round(e2), discountEffect: Math.round(e3), itemsEffectWon: Math.round(e1 * Pc.N), priceEffectWon: Math.round(e2 * Pc.N), discountEffectWon: Math.round(e3 * Pc.N) };
  console.log(`5개월 풀 | ${Math.round(Pp.A)}→${Math.round(Pc.A)} | ${f2(Pp.ipo)}→${f2(Pc.ipo)} | ${Math.round(Pp.gpi)}→${Math.round(Pc.gpi)} | ${pct(Pp.d)}→${pct(Pc.d)} | ${Math.round(Pc.A - Pp.A)} | ${Math.round(e1)} | ${Math.round(e2)} | ${Math.round(e3)}   ← ×올해 주문 ${Pc.N} = 품목수 ${man(e1 * Pc.N)} / 정상가 ${man(e2 * Pc.N)} / 할인 ${man(e3 * Pc.N)} 만원`);
  // 정상가/품목(G/Q) 변화 = 그룹 간 믹스 + 그룹 내 단가·믹스   Δgpi = Σ(s_c−s_p)·p_p + Σ s_c·(p_c−p_p)
  const gs = new Set([...Object.keys(Pc.groups), ...Object.keys(Pp.groups)]);
  let mix = 0, within = 0; const rows = [];
  for (const g of gs) {
    const c = Pc.groups[g] || { Q: 0, G: 0 }, p = Pp.groups[g] || { Q: 0, G: 0 };
    const sc = c.Q / Pc.Q, sp = p.Q / Pp.Q, pc = c.Q ? c.G / c.Q : 0, pp = p.Q ? p.G / p.Q : 0;
    const mx = (sc - sp) * pp, wi = sc * (pc - pp); mix += mx; within += wi;
    rows.push({ group: g, share_prev: +(sp * 100).toFixed(1), share_curr: +(sc * 100).toFixed(1), gpi_prev: Math.round(pp), gpi_curr: Math.round(pc), npi_prev: p.Q ? Math.round(p.R / p.Q) : 0, npi_curr: c.Q ? Math.round(c.R / c.Q) : 0, d_prev: p.G ? +(p.D / p.G * 100).toFixed(1) : 0, d_curr: c.G ? +(c.D / c.G * 100).toFixed(1) : 0, mixEffect: Math.round(mx), withinEffect: Math.round(wi) });
  }
  if (Math.abs(mix + within - (Pc.gpi - Pp.gpi)) > 0.01) throw new Error('믹스 분해 불일치');
  out.decomp2.gpiByGroup = { dGpi: Math.round(Pc.gpi - Pp.gpi), mixEffect: Math.round(mix), withinEffect: Math.round(within), rows: rows.sort((a, b) => b.share_prev - a.share_prev) };
  console.log(`\n  품목당 정상가 Δ ${Math.round(Pc.gpi - Pp.gpi)}원 = 그룹 간 믹스 ${Math.round(mix)} + 그룹 내 단가·믹스 ${Math.round(within)}   (5개월 풀, 수량 비중 s=Q_g/Q)`);
  console.log('  그룹 | 수량비중 p→c | 정상가/품목 p→c | 실수령/품목 p→c | 할인율 p→c | 믹스효과 | 그룹내효과');
  for (const r of out.decomp2.gpiByGroup.rows) console.log(`  ${r.group} | ${r.share_prev}%→${r.share_curr}% | ${r.gpi_prev}→${r.gpi_curr} | ${r.npi_prev}→${r.npi_curr} | ${r.d_prev}%→${r.d_curr}% | ${r.mixEffect} | ${r.withinEffect}`);
}

// ── 3. 그룹별 기여 (5개월 합) ────────────────────────────────────────────────
console.log('\n== 3. 그룹별 기여 — 5개월 합 실매출 차이 (2026-03~07 − 2025-03~07)');
console.log('그룹 | R 2025(만원) | R 2026(만원) | ΔR(만원) | ΔR/R2025 | 감소 기여 % | Q 2025 | Q 2026 | ΔQ | 실수령/품목 2025→2026 | 할인율 2025→2026');
{
  const gs = new Set([...Object.keys(Pc.groups), ...Object.keys(Pp.groups)]);
  const rows = [];
  for (const g of gs) {
    const c = Pc.groups[g] || { R: 0, G: 0, D: 0, Q: 0 }, p = Pp.groups[g] || { R: 0, G: 0, D: 0, Q: 0 };
    rows.push({ group: g, R_prev: p.R, R_curr: c.R, dR: c.R - p.R, pct: p.R ? +((c.R / p.R - 1) * 100).toFixed(1) : null, share: +((c.R - p.R) / S.dR * 100).toFixed(1), Q_prev: p.Q, Q_curr: c.Q, dQ: c.Q - p.Q, npi_prev: p.Q ? Math.round(p.R / p.Q) : 0, npi_curr: c.Q ? Math.round(c.R / c.Q) : 0, d_prev: p.G ? +(p.D / p.G * 100).toFixed(1) : 0, d_curr: c.G ? +(c.D / c.G * 100).toFixed(1) : 0, byMonth: TARGET.map((m) => ({ month: m, dR: (M[m].groups[g]?.R || 0) - (M[prevYear(m)].groups[g]?.R || 0), pct: M[prevYear(m)].groups[g]?.R ? +(((M[m].groups[g]?.R || 0) / M[prevYear(m)].groups[g].R - 1) * 100).toFixed(1) : null })) });
  }
  rows.sort((a, b) => a.dR - b.dR);
  const sumD = rows.reduce((a, r) => a + r.dR, 0);
  if (Math.abs(sumD - S.dR) > 1) throw new Error('그룹 합 ≠ 전체 ΔR');
  out.groups = { total_dR: S.dR, rows };
  for (const r of rows) console.log(`${r.group} | ${man(r.R_prev).toLocaleString()} | ${man(r.R_curr).toLocaleString()} | ${man(r.dR)} | ${r.pct ?? '-'}% | ${r.share}% | ${r.Q_prev} | ${r.Q_curr} | ${r.dQ} | ${r.npi_prev}→${r.npi_curr} | ${r.d_prev}%→${r.d_curr}%`);
  console.log(`합계 | ${man(Pp.R).toLocaleString()} | ${man(Pc.R).toLocaleString()} | ${man(sumD)} | ${pct(Pc.R / Pp.R - 1)} | 100%`);
  out.groups.perOrder = rows.map((r) => ({ group: r.group, perOrder_prev: +(r.Q_prev / Pp.N).toFixed(3), perOrder_curr: +(r.Q_curr / Pc.N).toFixed(3), pct: +(((r.Q_curr / Pc.N) / (r.Q_prev / Pp.N) - 1) * 100).toFixed(1), Qpct: r.Q_prev ? +((r.Q_curr / r.Q_prev - 1) * 100).toFixed(1) : null }));
  console.log(`\n  주문 1건당 그룹 수량 (Q_g / N, 5개월 풀; N ${Pp.N}→${Pc.N} ${pct(Pc.N / Pp.N - 1)}):`);
  for (const r of out.groups.perOrder) console.log(`  ${r.group} | 수량 ${r.Qpct ?? '-'}% | 건당 ${r.perOrder_prev}→${r.perOrder_curr} (${r.pct}%)`);
  console.log('\n  그룹 × 월 ΔR(만원, 전년비%):');
  for (const r of rows) console.log(`  ${r.group}: ` + r.byMonth.map((b) => `${b.month.slice(2)} ${man(b.dR)}(${b.pct ?? '-'}%)`).join(' · '));
}

// ── 4. 상품(family) 워터폴 ──────────────────────────────────────────────────
console.log('\n== 4. 상품(family) 워터폴 — buildSeries(level:family), 제외 행(벨 N번·결제조정) 뺀 보고서로');
{
  const filtered = reports.map((r) => ({ period: r.period, rows: r.rows.filter((x) => !isExcluded(x)) }));
  const ser = buildSeries(filtered, { level: 'family' });
  const PREV = TARGET.map(prevYear);
  const sumOver = (it, ms, k) => ms.reduce((a, m) => a + (it.byMonth[m]?.[k] || 0), 0);
  const fam = Object.values(ser.items).map((it) => {
    const Rp = sumOver(it, PREV, 'amount'), Rc = sumOver(it, TARGET, 'amount');
    const Qp = sumOver(it, PREV, 'qty'), Qc = sumOver(it, TARGET, 'qty');
    const active = it.activeMonths || it.monthsPresent || [];
    return { id: it.id, name: it.name, group: it.group, R_prev: Rp, R_curr: Rc, dR: Rc - Rp, Q_prev: Qp, Q_curr: Qc, dQ: Qc - Qp, npi_prev: Qp ? Math.round(Rp / Qp) : null, npi_curr: Qc ? Math.round(Rc / Qc) : null, first: it.first, last: it.last, variants: it.variants, mergedInto: it.mergedInto, skus: it.skus };
  });
  const tot = fam.reduce((a, f) => a + f.dR, 0);
  if (Math.abs(tot - S.dR) > 1) throw new Error(`family 합 ${tot} ≠ 전체 ΔR ${S.dR}`);
  const neg = fam.filter((f) => f.dR < 0).sort((a, b) => a.dR - b.dR), pos = fam.filter((f) => f.dR > 0).sort((a, b) => b.dR - a.dR);
  const sumNeg = neg.reduce((a, f) => a + f.dR, 0), sumPos = pos.reduce((a, f) => a + f.dR, 0);
  const top15 = neg.slice(0, 15), top10 = pos.slice(0, 10);
  const top15sum = top15.reduce((a, f) => a + f.dR, 0);
  out.families = { total_dR: S.dR, sumNeg, sumPos, nFamilies: fam.length, nNeg: neg.length, nPos: pos.length, top15sum, top15shareOfNet: +(top15sum / S.dR * 100).toFixed(1), top15shareOfGross: +(top15sum / sumNeg * 100).toFixed(1), top15, top10, note: '' };
  console.log(`family 수 ${fam.length} (감소 ${neg.length} 합 ${man(sumNeg)}만원 · 증가 ${pos.length} 합 ${man(sumPos)}만원 · 순 ${man(tot)}만원)`);
  console.log(`감소 상위 15 합 ${man(top15sum)}만원 = 순감소의 ${pct(top15sum / S.dR)} · 총감소(증가 상쇄 전)의 ${pct(top15sum / sumNeg)}`);
  const line = (f) => `${f.id} [${f.first}~${f.last}] | R ${man(f.R_prev)}→${man(f.R_curr)} | Δ ${man(f.dR)} (${f.R_prev ? pct(f.R_curr / f.R_prev - 1) : '신규'}) | Q ${f.Q_prev}→${f.Q_curr} | 실수령/개 ${f.npi_prev ?? '-'}→${f.npi_curr ?? '-'}${f.mergedInto ? ' → ' + f.mergedInto : ''}`;
  console.log('\n  감소 상위 15:'); top15.forEach((f, i) => console.log(`  ${i + 1}. ${line(f)}`));
  console.log('\n  증가 상위 10:'); top10.forEach((f, i) => console.log(`  ${i + 1}. ${line(f)}`));
  // 재등록·개명 의심: 2026-03 에 끝난 family 와 2026-03 에 시작한 family (같은 그룹) — 워터폴에서 한쪽 −, 한쪽 + 로 갈릴 수 있다
  const ended = fam.filter((f) => f.last >= '2026-02' && f.last <= '2026-03' && f.R_prev > 0), started = fam.filter((f) => f.first === '2026-03');
  out.families.endedAt2603 = ended.map((f) => ({ id: f.id, dR: f.dR, R_prev: f.R_prev, R_curr: f.R_curr })).sort((a, b) => a.dR - b.dR);
  out.families.startedAt2603 = started.map((f) => ({ id: f.id, dR: f.dR, R_curr: f.R_curr })).sort((a, b) => b.dR - a.dR);
  console.log('\n  2026-02/03 에 마지막으로 팔린 family (R_2025>0):'); for (const f of out.families.endedAt2603) console.log(`   ${f.id} Δ ${man(f.dR)}만원 (2025 ${man(f.R_prev)} → 2026 ${man(f.R_curr)})`);
  console.log('  2026-03 에 처음 나타난 family:'); for (const f of out.families.startedAt2603) console.log(`   ${f.id} Δ +${man(f.dR)}만원`);
  // 감사에서 잇지 않은 의심 쌍(2026-03 교대) 를 묶어 보면
  const PAIRS = [['쇼케이스|생크림케이크', '쇼케이스|생크림/기리쉬'], ['빵|생과일몽블랑', '빵|생과일몽블랑팡도르'], ['빵|잠봉/리코타샌드위치', '빵|크림치즈/잠봉샌드위치'], ['디저트|계피만쥬', '디저트|만주/계피만쥬'], ['빵|마늘바게트', '빵|마늘바게트/머쉬룸바게트'], ['빵|카야쨈버터/앙버터소금빵', '빵|앙버터소금빵'], ['빵|앙버터빵/크렌베리쌀빵', '빵|크렌베리쌀빵'], ['빵|먹물베이컨크림치즈', '빵|베이컨크림치즈'], ['빵|쑥맘모스빵', '빵|맘모스빵'], ['빵|쑥모찌빵', '빵|쑥모찌빵/크림범벅']];
  const byId = Object.fromEntries(fam.map((f) => [f.id, f]));
  out.families.pairs = PAIRS.map(([a, b]) => ({ a, b, dR_a: byId[a]?.dR ?? null, dR_b: byId[b]?.dR ?? null, net: (byId[a]?.dR || 0) + (byId[b]?.dR || 0) }));
  console.log('\n  감사표 의심 쌍(잇지 않음)을 합치면 (Δa + Δb = 순 Δ, 만원):'); for (const p of out.families.pairs) console.log(`   ${p.a} (${p.dR_a == null ? '없음' : man(p.dR_a)}) + ${p.b} (${p.dR_b == null ? '없음' : man(p.dR_b)}) = ${man(p.net)}`);
  const SHOW = ['커피|아메리카노', '빵|단팥/완두/소보로', '빵|육쪽마늘빵', '티|레몬생강', '티|대추차', '쇼케이스|생딸기조각', '쇼케이스|생딸기보틀케이크', '쇼케이스|생크림케이크', '쇼케이스|생크림/기리쉬', '빵|소금빵/먹물소금빵/초코짠짠', '빵|치아바타', '디저트|버터떡', '빵|버터떡'];
  const MS = [...PREV, ...TARGET];
  out.families.monthly = {};
  console.log('\n  주요 family 월별 수량 (25-03..07 | 26-03..07):');
  for (const id of SHOW) { const it = ser.items[id]; if (!it) { console.log('   (없음)', id); continue; } out.families.monthly[id] = Object.fromEntries(MS.map((m) => [m, it.byMonth[m]?.qty || 0])); console.log(`   ${id}: ${PREV.map((m) => it.byMonth[m]?.qty || 0).join(' ')} | ${TARGET.map((m) => it.byMonth[m]?.qty || 0).join(' ')}   (sku: ${it.skus.join(', ')})`); }
  // 그룹별 family 수·감소 family 수
  out.families.all = fam.sort((a, b) => a.dR - b.dR).map((f) => ({ id: f.id, group: f.group, dR: f.dR, R_prev: f.R_prev, R_curr: f.R_curr, dQ: f.dQ, Q_prev: f.Q_prev, Q_curr: f.Q_curr, first: f.first, last: f.last }));
}

// ── 5. 시점 ─────────────────────────────────────────────────────────────────
console.log('\n== 5. 시점 — 전년 동월비 (전년 자료 있는 달만) 와 3개월 이동평균(뒤 3달, 전년 창 3달 다 있을 때만)');
{
  const yoyRows = months.filter((m) => M[prevYear(m)]).map((m) => ({ month: m, R: +((M[m].R / M[prevYear(m)].R - 1) * 100).toFixed(1), N: +((M[m].N / M[prevYear(m)].N - 1) * 100).toFixed(1), A: +((M[m].A / M[prevYear(m)].A - 1) * 100).toFixed(1), bread: +((M[m].bread / M[prevYear(m)].bread - 1) * 100).toFixed(1), cups: +((M[m].cups / M[prevYear(m)].cups - 1) * 100).toFixed(1), Q: +((M[m].Q / M[prevYear(m)].Q - 1) * 100).toFixed(1) }));
  console.log('월 | R 전년비 | N 전년비 | A 전년비 | Q 전년비 | 빵 전년비 | 잔 전년비');
  for (const r of yoyRows) console.log(`${r.month} | ${r.R}% | ${r.N}% | ${r.A}% | ${r.Q}% | ${r.bread}% | ${r.cups}%`);
  const firstNeg = (k) => yoyRows.find((r) => r[k] < 0)?.month || null;
  const firstNegSustained = (k) => { for (let i = 0; i < yoyRows.length; i++) if (yoyRows.slice(i).every((r) => r[k] < 0)) return yoyRows[i].month; return null; };
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const ma3 = (k, m) => { const i = idx[m]; if (i == null || i < 2) return null; const w = months.slice(i - 2, i + 1); if (!w.every((x, j) => j === 0 || Number(x.slice(5)) === (Number(w[j - 1].slice(5)) % 12) + 1)) return null; return w.reduce((a, x) => a + M[x][k], 0) / 3; };
  const maRows = months.map((m) => ({ month: m, R: ma3('R', m), N: ma3('N', m), Rp: ma3('R', prevYear(m)), Np: ma3('N', prevYear(m)) })).filter((r) => r.R != null);
  for (const r of maRows) { r.R_yoy = r.Rp ? +((r.R / r.Rp - 1) * 100).toFixed(1) : null; r.N_yoy = r.Np ? +((r.N / r.Np - 1) * 100).toFixed(1) : null; }
  console.log('\n창 끝 달 | MA3 R(만원) | MA3 R 전년비 | MA3 N | MA3 N 전년비');
  for (const r of maRows) console.log(`${r.month} | ${man(r.R).toLocaleString()} | ${r.R_yoy ?? '-'}% | ${Math.round(r.N)} | ${r.N_yoy ?? '-'}%`);
  const peak = (k) => maRows.reduce((a, r) => (r[k] > (a?.[k] ?? -1) ? r : a), null);
  const pk = peak('R'), pkN = peak('N');
  out.timing = { yoy: yoyRows, firstNeg: { R: firstNeg('R'), N: firstNeg('N'), A: firstNeg('A'), Q: firstNeg('Q'), bread: firstNeg('bread'), cups: firstNeg('cups') }, firstNegSustained: { R: firstNegSustained('R'), N: firstNegSustained('N'), bread: firstNegSustained('bread'), cups: firstNegSustained('cups') }, ma3: maRows.map((r) => ({ month: r.month, R: Math.round(r.R), R_yoy: r.R_yoy, N: Math.round(r.N), N_yoy: r.N_yoy })), ma3FirstNegYoy: { R: maRows.find((r) => r.R_yoy != null && r.R_yoy < 0)?.month || null, N: maRows.find((r) => r.N_yoy != null && r.N_yoy < 0)?.month || null }, ma3Peak: { R: { month: pk.month, value: Math.round(pk.R) }, N: { month: pkN.month, value: Math.round(pkN.N) } } };
  console.log(`\n전년비 첫 마이너스 달: R ${out.timing.firstNeg.R} · N ${out.timing.firstNeg.N} · A ${out.timing.firstNeg.A} · 빵 ${out.timing.firstNeg.bread} · 잔 ${out.timing.firstNeg.cups}`);
  console.log(`그 뒤 계속 마이너스가 시작된 달: R ${out.timing.firstNegSustained.R} · N ${out.timing.firstNegSustained.N} · 빵 ${out.timing.firstNegSustained.bread} · 잔 ${out.timing.firstNegSustained.cups}`);
  console.log(`MA3 전년비 첫 마이너스: R ${out.timing.ma3FirstNegYoy.R} · N ${out.timing.ma3FirstNegYoy.N} · MA3 최고: R ${pk.month} ${man(pk.R)}만원 · N ${pkN.month} ${Math.round(pkN.N)}`);
}

if (asJson) fs.writeFileSync(path.join(root, 'data', 'decline-decomp.json'), JSON.stringify(out, null, 1));
