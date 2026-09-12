// 할인·가격 분해 — 할인율 계단 · 할인 성격(50%/무료/10%) · 커피 +500원 순효과 · 객단가 평평의 정체 · 옵션 추세
//   node scripts/discount-price.mjs            → 표 출력 (JSON 은 --json)
//
// 정의 (모두 이 파일 안에서 계산, 외부 상태 없음)
//   행 제외:  진동벨 그룹의 'N번' 줄(= 주문 건수 프록시) · 결제수단 조정 줄(포인트결제·계좌이체: amount 음수 + discount 양수, 합 0)
//   정상가 G = Σ (amount + discount),  실매출 R = Σ amount,  할인 D = Σ discount,  할인율 d = D / G
//   음료 그룹 = 커피·라떼·티·에이드·주스/병음료,  식품 그룹 = 빵·디저트·쇼케이스·브런치/밀키트
//   잔 수     = 음료 그룹에서 단가 ≥ 2,000 인 줄의 수량 (0원 옵션·500원 옵션 제외)
//   주문 N    = 진동벨 그룹 'N번' 줄 수량 합
//   보고서의 '단가' = (amount + discount) / qty 를 반올림한 값 (검산됨). 한 달 안에 가격이 바뀐 줄은 50의 배수가 아니다 → 'mixed'
//   줄 분류   = ratio = discount / 단가 의 소수부 f:  int(f=0) · half(f=0.5) · tenth(f∈{0.1..0.9}, 0.5 제외) · other · mixed(단가가 50 배수 아님)
//               ※ 한 줄은 한 달치 합계라 여러 할인 이벤트가 섞인다. 소수부는 "마지막 한 건의 흔적"일 뿐이라 큰 줄에서는 정보가 없다.
//   반값환산 잔수 H = Σ_줄 2 × discount / 단가  (그 달 음료 할인이 전부 50% 쿠폰이었을 때의 쿠폰 잔 수 = 상한)
//   무료환산 잔수 F = Σ_줄 discount / 단가       (전부 통째 무료였을 때의 잔 수 = 하한)
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
const DRINK = new Set(['커피', '라떼', '티', '에이드', '주스/병음료']);
const FOOD = new Set(['빵', '디저트', '쇼케이스', '브런치/밀키트']);
const isCup = (r) => DRINK.has(r.group) && r.price >= 2000;
const man = (won) => Math.round(won / 10000); // 만원
const pct = (a, b, d = 1) => (b ? (100 * a / b).toFixed(d) : '-');
const yoy = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;

// ── 읽기 · 원본 총합계 검증 ──────────────────────────────────────────────────
const files = fs.readdirSync(dir).filter((f) => /월.*\.txt$/.test(f));
const reports = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const rep = parseSalesReport(text);
  if (rep.unassigned) throw new Error(`${f}: 그룹 미배정 ${rep.unassigned}줄`);
  const tot = [...text.matchAll(/^총합계\s+([\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)/gm)].pop();
  const num = (s) => Number(s.replace(/,/g, ''));
  const sum = rep.rows.reduce((a, r) => ({ qty: a.qty + r.qty, amount: a.amount + r.amount, discount: a.discount + r.discount }), { qty: 0, amount: 0, discount: 0 });
  if (!tot || num(tot[1]) !== sum.qty || num(tot[2]) !== sum.amount || num(tot[3]) !== sum.discount) throw new Error(`${f}: 파싱 합계 ≠ 원본 총합계`);
  // 단가 = round((amount+discount)/qty) 인지 (qty>0 인 줄 전부)
  for (const r of rep.rows) if (r.qty > 0 && Math.abs(r.price - (r.amount + r.discount) / r.qty) > 0.5) throw new Error(`${f}: 단가≠정상가/수량 ${r.group}|${r.product}`);
  rep.file = f;
  reports.push(rep);
}
reports.sort((a, b) => a.period.month.localeCompare(b.period.month));
const months = reports.map((r) => r.period.month);
if (new Set(months).size !== months.length) throw new Error('같은 달이 두 번');
const byMonth = Object.fromEntries(reports.map((r) => [r.period.month, r]));

// ── 0. 월별 기본 지표 (큰 그림 검산) ──────────────────────────────────────────
const M = {};
for (const rep of reports) {
  const m = rep.period.month;
  const x = { month: m, R: 0, G: 0, D: 0, N: 0, Q: 0, cups: 0, coffeeCups: 0, groups: {} };
  for (const r of rep.rows) {
    if (isBell(r)) { x.N += r.qty; continue; }
    if (isPayment(r)) continue;
    x.R += r.amount; x.G += r.amount + r.discount; x.D += r.discount;
    if (r.price > 0) x.Q += r.qty;
    if (isCup(r)) x.cups += r.qty;
    if (isCup(r) && r.group === '커피') x.coffeeCups += r.qty;
    const g = (x.groups[r.group || '(미배정)'] ||= { R: 0, G: 0, D: 0, cups: 0, units: 0 });
    g.R += r.amount; g.G += r.amount + r.discount; g.D += r.discount; if (isCup(r)) g.cups += r.qty; if (r.price > 0) g.units += r.qty;
  }
  x.dDrink = { G: 0, D: 0 }; x.dFood = { G: 0, D: 0 };
  for (const [g, v] of Object.entries(x.groups)) {
    if (DRINK.has(g)) { x.dDrink.G += v.G; x.dDrink.D += v.D; }
    if (FOOD.has(g)) { x.dFood.G += v.G; x.dFood.D += v.D; }
  }
  M[m] = x;
}

// ── 1. 할인율 계단 (그룹별) ────────────────────────────────────────────────────
const GROUPS = ['커피', '라떼', '티', '에이드', '주스/병음료', '빵', '디저트', '쇼케이스', '브런치/밀키트'];
const step = months.map((m) => {
  const x = M[m];
  const row = { month: m, all: 100 * x.D / x.G, drink: 100 * x.dDrink.D / x.dDrink.G, food: 100 * x.dFood.D / x.dFood.G };
  for (const g of GROUPS) row[g] = x.groups[g] ? 100 * x.groups[g].D / x.groups[g].G : null;
  return row;
});

// ── 2. 할인 성격 분해 ───────────────────────────────────────────────────────────
function classify(r) {
  if (r.price % 50 !== 0) return 'mixed';
  const ratio = r.discount / r.price;
  const f = ratio - Math.floor(ratio);
  const near = (x, t) => Math.abs(x - t) < 1e-6;
  if (near(f, 0) || near(f, 1)) return 'int';
  if (near(f, 0.5)) return 'half';
  const t = f * 10; if (near(t, Math.round(t))) return 'tenth';
  return 'other';
}
const CLS = ['int', 'half', 'tenth', 'other', 'mixed'];
const nature = months.map((m) => {
  const out = { month: m };
  for (const [name, S] of [['drink', DRINK], ['food', FOOD]]) {
    const rows = byMonth[m].rows.filter((r) => S.has(r.group) && r.price > 0 && r.discount > 0);
    const lines = Object.fromEntries(CLS.map((k) => [k, 0])), won = Object.fromEntries(CLS.map((k) => [k, 0]));
    let D = 0, H = 0, F = 0, Dcup = 0;
    for (const r of rows) {
      const k = classify(r); lines[k]++; won[k] += r.discount; D += r.discount;
      if (isCup(r) || (name === 'food')) { H += 2 * r.discount / r.price; F += r.discount / r.price; Dcup += r.discount; }
    }
    // 원자: 할인이 단가의 1.5배 이하인 소량 줄에서 ratio 값 (0.05 단위)
    const atoms = {};
    for (const r of rows) {
      if (r.price % 50 || r.discount > 1.5 * r.price) continue;
      const v = r.discount / r.price * 20; const k = Math.abs(v - Math.round(v)) < 1e-6 ? (Math.round(v) / 20).toFixed(2) : 'odd';
      atoms[k] = (atoms[k] || 0) + 1;
    }
    out[name] = { n: rows.length, lines, wonShare: Object.fromEntries(CLS.map((k) => [k, D ? 100 * won[k] / D : 0])), D, H: Math.round(H), F: Math.round(F), atoms };
  }
  const x = M[m];
  out.drinkRate = 100 * x.dDrink.D / x.dDrink.G; out.cups = x.cups;
  return out;
});
// 음료 할인 기준선: 2024-08~2025-03 의 음료 할인율(가중 평균). 그 뒤 달의 '기준선 초과 할인' = (d_t − d_base) × G_drink,t
const base = months.filter((m) => m <= '2025-03');
const dBase = base.reduce((a, m) => a + M[m].dDrink.D, 0) / base.reduce((a, m) => a + M[m].dDrink.G, 0);
for (const n of nature) { const x = M[n.month]; n.excessWon = Math.round(x.dDrink.D - dBase * x.dDrink.G); }

// ── 3. 커피 +500원 ─────────────────────────────────────────────────────────────
// 3a. SKU 단위 단가 이력 (hot/ice 따로) — 깨끗한 달(단가 50 배수, qty≥20)끼리 앞 달과 비교
const sku = buildSeries(reports, { level: 'sku' });
const cleanPrice = (bm) => { if (!bm || bm.qty < 20) return null; const p = Math.round((bm.amount + bm.discount) / bm.qty); return p % 50 === 0 ? p : 'mixed'; };
const priceChanges = {};
for (const it of Object.values(sku.items)) {
  if (!DRINK.has(it.group) && !FOOD.has(it.group)) continue;
  if (it.prices.every((p) => p < 2000)) continue; // 옵션 줄
  let prev = null, prevM = null;
  for (const m of months) {
    const p = cleanPrice(it.byMonth[m]);
    if (p == null) continue;
    if (prev != null && p !== prev && p !== 'mixed' && prev !== 'mixed') (priceChanges[m] ||= []).push({ group: it.group, name: it.name, from: prev, to: p, since: prevM, qty: it.byMonth[m].qty });
    if (p === 'mixed') (priceChanges[m] ||= []).push({ group: it.group, name: it.name, from: prev, to: 'mixed', since: prevM, qty: it.byMonth[m].qty, avg: Math.round((it.byMonth[m].amount + it.byMonth[m].discount) / it.byMonth[m].qty) });
    if (p !== 'mixed') { prev = p; prevM = m; }
  }
}
// 3b. 2025-12 → 2026-02 음료 SKU 단가 차이 (+500 이 어디까지 적용됐나) 와 2026 각 달의 인상액 × 수량
const dP = {}; // sku id → ΔP (2026-02 대비 2025-12)
for (const it of Object.values(sku.items)) {
  if (!DRINK.has(it.group)) continue;
  const a = cleanPrice(it.byMonth['2025-12']), b = cleanPrice(it.byMonth['2026-02']);
  if (typeof a === 'number' && typeof b === 'number') dP[it.id] = { group: it.group, name: it.name, from: a, to: b, d: b - a };
}
const raised = Object.values(dP).filter((v) => v.d !== 0);
// 3c. 커피 잔 수 전년 동월 비교 + 정상가 · 실수령 · 할인
const coffee = months.map((m) => {
  const x = M[m]; const g = x.groups['커피'] || { R: 0, G: 0, D: 0, cups: 0 };
  const rep = byMonth[m];
  let raisedWon = 0, raisedCups = 0;
  for (const it of Object.values(sku.items)) { const v = dP[it.id]; const bm = it.byMonth[m]; if (v && v.d && bm && m >= '2026-02') { raisedWon += v.d * bm.qty; raisedCups += bm.qty; } }
  const tea = x.groups['티'] || { cups: 0 }, latte = x.groups['라떼'] || { cups: 0 };
  return { month: m, cups: g.cups, G: g.G, R: g.R, D: g.D, pNormal: g.cups ? g.G / g.cups : 0, pReal: g.cups ? g.R / g.cups : 0, N: x.N, teaCups: tea.cups, latteCups: latte.cups, allCups: x.cups, raisedWon, raisedCups };
});
const coffeeYoy = coffee.filter((c) => c.month >= '2026-02').map((c) => {
  const p = coffee.find((z) => z.month === yoy(c.month));
  const cupsExpectedByOrders = p.cups * c.N / p.N;        // 주문 건수만큼 줄었다면 기대되는 잔 수
  const cupsExpectedByTea = p.cups * c.teaCups / p.teaCups; // 티(가격 불변) 잔 수만큼 변했다면
  return {
    month: c.month, cups25: p.cups, cups26: c.cups, cupsYoy: 100 * (c.cups / p.cups - 1),
    ordersYoy: 100 * (c.N / p.N - 1), teaYoy: 100 * (c.teaCups / p.teaCups - 1), latteYoy: 100 * (c.latteCups / p.latteCups - 1),
    pNormal25: p.pNormal, pNormal26: c.pNormal, pReal25: p.pReal, pReal26: c.pReal, d25: 100 * p.D / p.G, d26: 100 * c.D / c.G,
    G25: p.G, G26: c.G, R25: p.R, R26: c.R,
    priceGainNormal: c.raisedWon,                                    // 인상액 × 2026 수량 (정상가 기준)
    priceGainReal: c.raisedWon * (1 - c.D / c.G),                    // 할인율만큼 깎인 실수령 기준
    lostCupsRaw: p.cups - c.cups, lostWonRaw: (p.cups - c.cups) * c.pReal,
    lostCupsVsOrders: cupsExpectedByOrders - c.cups, lostWonVsOrders: (cupsExpectedByOrders - c.cups) * c.pReal,
    lostCupsVsTea: cupsExpectedByTea - c.cups, lostWonVsTea: (cupsExpectedByTea - c.cups) * c.pReal,
  };
});
// 1월 안의 인상 시점: 평균 단가 − 이전 단가 / 500 = 인상 뒤 팔린 비율
const janMix = Object.values(sku.items).filter((it) => it.group === '커피' && dP[it.id]?.d && it.byMonth['2026-01']?.qty >= 100).map((it) => {
  const bm = it.byMonth['2026-01']; const avg = (bm.amount + bm.discount) / bm.qty; const v = dP[it.id];
  return { name: it.name, qty: bm.qty, avg: Math.round(avg), from: v.from, to: v.to, shareAfter: 100 * (avg - v.from) / v.d };
});

// ── 4. 객단가 평평의 정체 ──────────────────────────────────────────────────────
const perOrder = months.map((m) => {
  const x = M[m];
  return { month: m, N: x.N, Q: x.Q, G: x.G, R: x.R, D: x.D, GperN: x.G / x.N, RperN: x.R / x.N, DperN: x.D / x.N, QperN: x.Q / x.N, GperQ: x.G / x.Q, d: 100 * x.D / x.G };
});
const perOrderYoy = perOrder.filter((p) => p.month >= '2026-02').map((c) => {
  const p = perOrder.find((z) => z.month === yoy(c.month));
  return { month: c.month, dGperN: c.GperN - p.GperN, dDperN: c.DperN - p.DperN, dRperN: c.RperN - p.RperN, GperN25: p.GperN, GperN26: c.GperN, RperN25: p.RperN, RperN26: c.RperN, DperN25: p.DperN, DperN26: c.DperN, QperN25: p.QperN, QperN26: c.QperN, GperQ25: p.GperQ, GperQ26: c.GperQ,
    // G/N 변화 분해: (Q/N 변화) × G/Q_25 + Q/N_26 × (G/Q 변화)
    fromItems: (c.QperN - p.QperN) * p.GperQ, fromPrice: c.QperN * (c.GperQ - p.GperQ) };
});

// ── 5. 옵션 추세 ───────────────────────────────────────────────────────────────
const FREE = ['연하게', 'Take out', '얼음적게', '얼음없이', '덜 달게', '뜨거운물', '물 적게', '물 많이', '얼음컵', '빈컵', '얼음많이'];
const PAID = ['디카페인', '샷 추가', '헤이즐넛시럽'];
const options = months.map((m) => {
  const x = M[m]; const o = { month: m, coffeeCups: x.coffeeCups, cups: x.cups, N: x.N, free: {}, paid: {}, decafCups: 0 };
  for (const r of byMonth[m].rows) {
    if (!DRINK.has(r.group)) continue;
    if (r.price === 0 && FREE.includes(r.product)) o.free[r.product] = (o.free[r.product] || 0) + r.qty;
    if (r.price > 0 && r.price < 2000 && PAID.includes(r.product)) o.paid[r.product] = (o.paid[r.product] || 0) + r.qty;
    if (isCup(r) && /디카페인/.test(r.product)) o.decafCups += r.qty;
  }
  return o;
});

// ── 6. 기간 합계 분해 (2025-03~07 vs 2026-03~07) · 식품 가격 인상(2025-03→05) · 2026-03 빵 이중 블록 확인 ──
const sumPeriod = (from, to) => { const t = { N: 0, R: 0, G: 0, D: 0, Dd: 0, Gd: 0, Rd: 0, Rf: 0, Q: 0 }; for (const m of months) { if (m < from || m > to) continue; const x = M[m]; t.N += x.N; t.R += x.R; t.G += x.G; t.D += x.D; t.Q += x.Q; t.Dd += x.dDrink.D; t.Gd += x.dDrink.G; for (const [g, v] of Object.entries(x.groups)) { if (DRINK.has(g)) t.Rd += v.R; else t.Rf += v.R; } } return t; };
const P25 = sumPeriod('2025-03', '2025-07'), P26 = sumPeriod('2026-03', '2026-07');
const period = {
  dR: P26.R - P25.R, orders: (P26.N - P25.N) * (P25.R / P25.N), perOrder: P26.N * (P26.R / P26.N - P25.R / P25.N),
  perOrderG: P26.N * (P26.G / P26.N - P25.G / P25.N), perOrderD: -P26.N * (P26.D / P26.N - P25.D / P25.N),
  dDdrink: P26.Dd - P25.Dd, rateCost: P26.Dd - P26.Gd * (P25.Dd / P25.Gd), GperN25: P25.G / P25.N, GperN26: P26.G / P26.N, DperN25: P25.D / P25.N, DperN26: P26.D / P26.N, RperN25: P25.R / P25.N, RperN26: P26.R / P26.N,
  dDrink25: 100 * P25.Dd / P25.Gd, dDrink26: 100 * P26.Dd / P26.Gd, N25: P25.N, N26: P26.N, R25: P25.R, R26: P26.R, Rd25: P25.Rd, Rd26: P26.Rd, Rf25: P25.Rf, Rf26: P26.Rf,
};
const foodPrice = {};
for (const g of ['빵', '디저트', '쇼케이스']) {
  let q = 0, before = 0, after = 0, qAll = 0, n = 0, nUp = 0;
  for (const it of Object.values(sku.items)) {
    if (it.group !== g) continue;
    const bm5 = it.byMonth['2025-05']; if (bm5) qAll += bm5.qty;
    const a = cleanPrice(it.byMonth['2025-03']), b = cleanPrice(it.byMonth['2025-05']);
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    n++; if (b > a) nUp++; q += bm5.qty; before += a * bm5.qty; after += b * bm5.qty;
  }
  foodPrice[g] = { skus: n, up: nUp, qtyCovered: q, qtyAll: qAll, before: before / q, after: after / q, pct: 100 * (after / before - 1) };
}
const breadMar = ['2026-02', '2026-03', '2026-04'].map((m) => { const b = byMonth[m].rows.filter((r) => r.group === '빵'); return { month: m, lines: b.length, names: new Set(b.map((r) => r.product)).size, qty: b.reduce((a, r) => a + r.qty, 0), amount: b.reduce((a, r) => a + r.amount, 0) }; });

// ── 출력 ───────────────────────────────────────────────────────────────────────
const result = { period, foodPrice, breadMar, months, dBase: 100 * dBase, big: months.map((m) => ({ month: m, R_man: man(M[m].R), N: M[m].N, cups: M[m].cups })), step, nature, priceChanges, raised, coffee, coffeeYoy, janMix, perOrder, perOrderYoy, options };
if (asJson) { process.stdout.write(JSON.stringify(result, null, 1) + '\n'); } else {

const f1 = (v) => (v == null ? '-' : v.toFixed(1));
const pad = (s, n) => String(s).padStart(n);
console.log('## 0. 큰 그림 검산: 월 / 실매출(만원) / 주문 N / 잔 수 / 전년 동월 실매출 % / 주문 %');
for (const m of months) { const p = M[yoy(m)]; console.log(m, pad(man(M[m].R), 6), pad(M[m].N, 6), pad(M[m].cups, 6), p ? `${pad(pct(M[m].R - p.R, p.R), 6)}% ${pad(pct(M[m].N - p.N, p.N), 6)}%` : ''); }

console.log('\n## 1. 할인율(정상가 대비 %) — 그룹별 · 음료 · 식품 · 전체');
console.log('월       ' + GROUPS.map((g) => pad(g, 7)).join('') + '   음료   식품   전체');
for (const s of step) console.log(s.month, ' ' + GROUPS.map((g) => pad(f1(s[g]), 7)).join('') + `  ${pad(f1(s.drink), 5)}  ${pad(f1(s.food), 5)}  ${pad(f1(s.all), 5)}`);
console.log(`음료 기준선(2024-08~2025-03 가중 평균) = ${f1(100 * dBase)}%`);

console.log('\n## 2. 할인 성격 — 음료: 할인>0 줄 수 [int/half/tenth/other/mixed] · 할인액 비중% · 반값환산 H · 무료환산 F · 기준선 초과 할인(만원)');
for (const n of nature) console.log(n.month, `n=${pad(n.drink.n, 3)}`, CLS.map((k) => `${k}:${pad(n.drink.lines[k], 2)}|${pad(f1(n.drink.wonShare[k]), 5)}%`).join(' '), ` d=${f1(n.drinkRate)}%  D=${pad(man(n.drink.D), 4)}만  H=${pad(n.drink.H, 5)}  F=${pad(n.drink.F, 5)}  잔=${pad(n.cups, 6)}  H/잔=${f1(100 * n.drink.H / n.cups)}%  초과=${pad(man(n.excessWon), 4)}만`);
console.log('\n   식품:');
for (const n of nature) console.log(n.month, `n=${pad(n.food.n, 3)}`, CLS.map((k) => `${k}:${pad(n.food.lines[k], 2)}|${pad(f1(n.food.wonShare[k]), 5)}%`).join(' '), ` D=${pad(man(n.food.D), 4)}만`);
console.log('\n   원자(할인 ≤ 1.5×단가인 줄의 discount/단가 값 분포) 음료:');
for (const n of nature) console.log('  ', n.month, Object.entries(n.drink.atoms).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('   식품:');
for (const n of nature) console.log('  ', n.month, Object.entries(n.food.atoms).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));

console.log('\n## 3a. 단가 변경 이력 (SKU, 깨끗한 달끼리, qty≥20)');
for (const m of Object.keys(priceChanges).sort()) { const L = priceChanges[m]; console.log(m, `${L.length}건:`, L.map((c) => `${c.group}|${c.name} ${c.from}→${c.to}${c.avg ? `(평균 ${c.avg})` : ''}${c.since && c.since !== months[months.indexOf(m) - 1] ? ` [${c.since} 이후 첫 등장]` : ''}`).join('; ')); }
console.log('\n## 3b. 2025-12 → 2026-02 음료 SKU 단가 차이 (0 아닌 것)');
for (const v of raised.sort((a, b) => a.group.localeCompare(b.group))) console.log(`  ${v.group}|${v.name} ${v.from}→${v.to} (${v.d > 0 ? '+' : ''}${v.d})`);
console.log(`  변경 없음: ${Object.values(dP).filter((v) => !v.d).length} SKU / 전체 비교 가능 ${Object.keys(dP).length} SKU`);
console.log('\n## 3c. 1월 안의 인상 시점: 커피 주요 SKU 평균단가 → 인상가로 팔린 비율');
for (const j of janMix) console.log(`  ${j.name}: qty ${j.qty}, 평균 ${j.avg} (${j.from}→${j.to}) → 인상 뒤 비율 ${f1(j.shareAfter)}%`);
console.log('\n## 3d. 커피 잔 수 · 단가 · 할인율 (월별)');
for (const c of coffee) console.log(c.month, `잔 ${pad(c.cups, 6)}  정상단가 ${pad(Math.round(c.pNormal), 5)}  실단가 ${pad(Math.round(c.pReal), 5)}  할인 ${f1(100 * c.D / c.G)}%  G ${pad(man(c.G), 5)}만 R ${pad(man(c.R), 5)}만  주문 ${pad(c.N, 5)}  티잔 ${pad(c.teaCups, 5)}  라떼잔 ${pad(c.latteCups, 4)}`);
console.log('\n## 3e. 커피 전년 동월 비교 (2026-02~07) — 만원');
for (const c of coffeeYoy) console.log(c.month, `잔 ${c.cups25}→${c.cups26} (${f1(c.cupsYoy)}%)  주문 ${f1(c.ordersYoy)}%  티잔 ${f1(c.teaYoy)}%  라떼잔 ${f1(c.latteYoy)}%  정상단가 ${Math.round(c.pNormal25)}→${Math.round(c.pNormal26)}  실단가 ${Math.round(c.pReal25)}→${Math.round(c.pReal26)}  할인 ${f1(c.d25)}→${f1(c.d26)}%  R ${man(c.R25)}→${man(c.R26)}`);
console.log('   인상 효과(정상가) = Σ ΔP×qty | 실수령 기준(×(1−d)) | 잔 감소 매출: 그대로 | 주문 감소 초과분 | 티 감소 초과분');
let tot = { pg: 0, pr: 0, lr: 0, lo: 0, lt: 0 };
const sg = (v) => (v >= 0 ? '+' : '−') + Math.abs(man(v));
for (const c of coffeeYoy) { tot.pg += c.priceGainNormal; tot.pr += c.priceGainReal; tot.lr += c.lostWonRaw; tot.lo += c.lostWonVsOrders; tot.lt += c.lostWonVsTea; console.log(`  ${c.month}  ${sg(c.priceGainNormal)} | ${sg(c.priceGainReal)} | ${sg(-c.lostWonRaw)} (${Math.round(-c.lostCupsRaw)}잔) | ${sg(-c.lostWonVsOrders)} (${Math.round(-c.lostCupsVsOrders)}잔) | ${sg(-c.lostWonVsTea)} (${Math.round(-c.lostCupsVsTea)}잔)`); }
console.log(`  합계(6개월)  ${sg(tot.pg)} | ${sg(tot.pr)} | ${sg(-tot.lr)} | ${sg(-tot.lo)} | ${sg(-tot.lt)}   → 순효과(실수령 기준): 잔 감소 그대로 ${sg(tot.pr - tot.lr)} · 주문 감소 초과분만 ${sg(tot.pr - tot.lo)} · 티 대비 초과분 ${sg(tot.pr - tot.lt)}`);

console.log('\n## 4. 주문당 정상가 G/N · 할인 D/N · 실수령 R/N · 건당 품목 Q/N · 품목당 정상가 G/Q (원)');
for (const p of perOrder) console.log(p.month, `N ${pad(p.N, 5)}  G/N ${pad(Math.round(p.GperN), 6)}  D/N ${pad(Math.round(p.DperN), 5)}  R/N ${pad(Math.round(p.RperN), 6)}  Q/N ${p.QperN.toFixed(2)}  G/Q ${pad(Math.round(p.GperQ), 5)}  d ${f1(p.d)}%`);
console.log('   전년 동월 대비 (원/건):  ΔG/N = ΔD/N + ΔR/N (항등식) · ΔG/N 분해 = 건당 품목 변화분 + 품목당 정상가 변화분');
for (const p of perOrderYoy) console.log(`  ${p.month}  G/N ${Math.round(p.GperN25)}→${Math.round(p.GperN26)} (${p.dGperN >= 0 ? '+' : ''}${Math.round(p.dGperN)})  D/N ${Math.round(p.DperN25)}→${Math.round(p.DperN26)} (+${Math.round(p.dDperN)})  R/N ${Math.round(p.RperN25)}→${Math.round(p.RperN26)} (${p.dRperN >= 0 ? '+' : ''}${Math.round(p.dRperN)})  | Q/N ${p.QperN25.toFixed(2)}→${p.QperN26.toFixed(2)} (${Math.round(p.fromItems)}원)  G/Q ${Math.round(p.GperQ25)}→${Math.round(p.GperQ26)} (${Math.round(p.fromPrice)}원)`);

console.log('\n## 5. 옵션 — 무료(연하게·Take out·얼음·물·덜 달게) · 유료(디카페인 옵션·샷 추가·헤이즐넛) · 디카페인 잔 : 건수, /100잔(음료)');
console.log('월       잔수   연하게  /100  Takeout /100  얼음·물·달게 /100 | 디카옵션 /100  샷추가 /100  헤이즐넛 /100 | 디카잔 /100커피');
for (const o of options) {
  const f = o.free, p = o.paid; const misc = (f['얼음적게'] || 0) + (f['얼음없이'] || 0) + (f['덜 달게'] || 0) + (f['뜨거운물'] || 0) + (f['물 적게'] || 0) + (f['물 많이'] || 0) + (f['얼음컵'] || 0) + (f['빈컵'] || 0) + (f['얼음많이'] || 0);
  const r = (v, base = o.cups) => `${pad(v, 5)} ${pad(f1(100 * v / base), 5)}`;
  console.log(o.month, pad(o.cups, 6), r(f['연하게'] || 0), r(f['Take out'] || 0), r(misc), '|', r(p['디카페인'] || 0), r(p['샷 추가'] || 0), r(p['헤이즐넛시럽'] || 0), '|', r(o.decafCups, o.coffeeCups));
}

console.log('\n## 6. 기간 합계 (2025-03~07 → 2026-03~07, 만원): 실매출 변화 = 주문 수 효과 + 객단가 효과 (객단가 효과 = 정상가 객단가 효과 − 할인 객단가 효과)');
console.log(`  주문 ${period.N25}→${period.N26}  실매출 ${man(period.R25)}→${man(period.R26)} (Δ ${man(period.dR)})  음료 R Δ ${man(period.Rd26 - period.Rd25)}  비음료 R Δ ${man(period.Rf26 - period.Rf25)}`);
console.log(`  주문 수 효과 ${man(period.orders)} (ΔN × 2025 R/N)  객단가 효과 ${man(period.perOrder)} (N26 × ΔR/N)  = 정상가 객단가 ${man(period.perOrderG)} (N26 × ΔG/N) − 할인 객단가 ${man(-period.perOrderD)} (N26 × ΔD/N)`);
console.log(`  G/N ${Math.round(period.GperN25)}→${Math.round(period.GperN26)} (+${Math.round(period.GperN26 - period.GperN25)})  D/N ${Math.round(period.DperN25)}→${Math.round(period.DperN26)} (+${Math.round(period.DperN26 - period.DperN25)})  R/N ${Math.round(period.RperN25)}→${Math.round(period.RperN26)} (+${Math.round(period.RperN26 - period.RperN25)})  → 정상가 객단가 상승분 중 할인으로 나간 비율 ${pct(period.DperN26 - period.DperN25, period.GperN26 - period.GperN25)}%`);
console.log(`  음료 할인 D ${man(P25.Dd)}→${man(P26.Dd)} (Δ ${man(period.dDdrink)}, 실매출 감소 ${man(period.dR)} 의 ${pct(period.dDdrink, -period.dR)}%)  음료 할인율 ${f1(period.dDrink25)}→${f1(period.dDrink26)}%  할인율 상승분 비용(2026 정상가 × Δ할인율) ${man(period.rateCost)}`);
console.log('\n   식품 가격 인상 2025-03→2025-05 (깨끗한 달끼리 비교 가능한 SKU, 2025-05 수량 가중):');
for (const [g, v] of Object.entries(foodPrice)) console.log(`   ${g}: SKU ${v.skus}개 중 인상 ${v.up}개, 수량 커버 ${v.qtyCovered}/${v.qtyAll}, 단가 ${Math.round(v.before)}→${Math.round(v.after)} (+${f1(v.pct)}%)`);
console.log('\n   2026-03 빵 그룹 이중 블록 확인 (줄 수 / 고유 이름 / 수량 / 금액):');
for (const b of breadMar) console.log(`   ${b.month}: 줄 ${b.lines}, 이름 ${b.names}, qty ${b.qty}, amount ${b.amount}`);
}
