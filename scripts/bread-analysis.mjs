// 빵 그룹 심층 분석 — 구색·잔존 품목·소금빵 계열·단가·할인·부착률 (23개월, 2024-08 ~ 2026-07)
//   node scripts/bread-analysis.mjs [data/pos] [--json out.json]
//
// 계산 규칙(모두 이 파일 안에서 재현 가능):
//   · 보고서 → parseSalesReport → buildSeries(level:'family') (src/logic/sku.js). 각 달 합계는 원본과 같음(buildSeries 가 검사).
//   · 2026-03 빵 재등록(그룹코드 00005→00014): 두 블록의 같은 이름은 파서가 합산한다. 3월 총합계(보고서 '총합계' 줄)가 두 블록 합과 같으므로
//     이중 계상이 아니라 실제 판매가 두 코드에 나뉜 것이다(아래 checkMarch 가 확인).
//   · 정상가 = amount + discount. 단가(가중) = 정상가 / qty. 할인율 = discount / 정상가.
//   · 음료 잔 수 = 그룹 커피·티·에이드·라떼·주스/병음료 의 단가>0 줄 수량 합(무료 옵션 제외). 주문 건수 = 진동벨 그룹 'N번' 줄 수량 합.
//   · 실매출(큰 그림 검산용) = amount 합에서 음수 줄(포인트결제·계좌이체 조정)을 뺀 값 — 기존 큰 그림 숫자와 같은 정의.
//   · EXTRA_JOINS: 대응표(sku-map.js)에는 없지만 이 분석에서만 같은 상품으로 이어 본 빵 이름 교대. 기본은 적용하지 않고(strict),
//     '--joined' 로 적용한 결과를 따로 낸다 — 두 결과를 나란히 보면 구색 결론이 이름 교대에 얼마나 민감한지 드러난다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport } from '../src/logic/pos.js';
import { buildSeries, splitKey } from '../src/logic/sku.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const dir = path.resolve(positional[0] || path.join(root, 'data', 'pos'));
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const JOINED = args.includes('--joined');

// 분석용 추가 결합 (family id → 잇는 family id). 근거는 scripts/sku-audit.mjs (3) 의심 쌍: 구코드의 마지막 달 = 신코드의 첫 달, 이름이 서로 포함.
// 대응표에 넣을 만큼 확실하지 않아(단가 차이·두 달 공백 등) 여기서만 쓴다.
const EXTRA_JOINS = {
  '빵|쑥떡쑥떡': '빵|쑥떡쑥떡빵',                         // 25-04 한 달 겹침, 편집거리 1
  '빵|무화과깜빠뉴': '빵|무화과/밤깜빠뉴',                 // 25-08 한 달 겹침, 슬래시 병합
  '빵|햄치즈토스트': '빵|페퍼소세지/햄치즈토스트',         // 25-09 끝 → 25-11 병합 코드 (두 달 공백)
  '빵|페퍼소세지빵': '빵|페퍼소세지/햄치즈토스트',         // 25-11 한 달 겹침
  '빵|호두쉬폰': '빵|호두쉬폰/단호박쉬폰',                 // 25-11 한 달 겹침
  '빵|생과일몽블랑': '빵|생과일몽블랑팡도르',              // 26-03 재등록 교대(구블록 65개/신블록 65개), 3월 단가 둘 다 8,400
  '빵|블빵': '빵|블루베리빵',                             // 26-03 재등록 교대(구블록 61개/신블록 38개), 단가 둘 다 7,400, 4월부터 블루베리빵만
  '빵|마늘바게트': '빵|마늘바게트/머쉬룸바게트',           // 26-02 끝 → 26-03 병합
  '빵|잠봉/리코타샌드위치': '빵|크림치즈/잠봉샌드위치',    // 26-03 재등록 교대
  '빵|쑥맘모스빵': '빵|맘모스빵',                         // 26-07 한 달 겹침
  '빵|먹물베이컨크림치즈': '빵|베이컨크림치즈',            // 26-07 한 달 겹침
  '빵|카야쨈앙버터': '빵|카야쨈버터/앙버터소금빵',        // 25-11 병합 → 26-01 카야쨈버터 → 26-02 병합. 26-03~ '앙버터소금빵' 단독은 잇지 않음
  '빵|카야쨈앙버터/칠리닭가슴살빵': '빵|카야쨈버터/앙버터소금빵',
  '빵|카야쨈버터': '빵|카야쨈버터/앙버터소금빵',
};

// ── 자료 읽기 ────────────────────────────────────────────────────────────────
const files = fs.readdirSync(dir).filter((f) => /월.*\.txt$/.test(f));
const reports = files.map((f) => ({ file: f, ...parseSalesReport(fs.readFileSync(path.join(dir, f), 'utf8')) }))
  .sort((a, b) => a.period.month.localeCompare(b.period.month));
const months = reports.map((r) => r.period.month);
const M = (m) => m.slice(2).replace('-', '-'); // '2025-03' → '25-03'
const 만 = (won) => Math.round(won / 1e4);
const pct = (a, b) => (b ? `${(100 * (a / b - 1)).toFixed(1)}%` : '-');
const f = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : x.toFixed(d));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ── 2026-03 재등록 검사: 보고서의 '총합계' 줄 = 모든 그룹 합계(빵 두 블록 포함)인가 ──────────────
function checkMarch() {
  const text = fs.readFileSync(path.join(dir, reports.find((r) => r.period.month === '2026-03').file), 'utf8');
  const grand = /총합계\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/.exec(text);
  const blocks = [...text.matchAll(/^빵 합계\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/gm)].map((m) => Number(m[1].replace(/,/g, '')));
  const rep = reports.find((r) => r.period.month === '2026-03');
  const parsedBread = sum(rep.rows.filter((r) => r.group === '빵').map((r) => r.qty));
  const parsedAll = sum(rep.rows.map((r) => r.qty));
  return { grandQty: Number(grand[1].replace(/,/g, '')), breadBlocks: blocks, parsedBreadQty: parsedBread, parsedAllQty: parsedAll };
}

// ── 월별 기본 지표 ───────────────────────────────────────────────────────────
const DRINK = new Set(['커피', '티', '에이드', '라떼', '주스/병음료']);
const monthly = {};
for (const r of reports) {
  const m = r.period.month;
  const t = { sales: 0, salesNormal: 0, disc: 0, orders: 0, breadQty: 0, breadAmt: 0, breadDisc: 0, cups: 0, dessertQty: 0, dessertAmt: 0 };
  for (const x of r.rows) {
    if (x.amount >= 0) t.sales += x.amount; // 큰 그림 정의(음수 줄 제외)
    t.salesNormal += x.amount + x.discount; t.disc += x.discount;
    if (x.group === '진동벨' && /^\d+번$/.test(x.product)) t.orders += x.qty;
    if (x.group === '빵') { t.breadQty += x.qty; t.breadAmt += x.amount; t.breadDisc += x.discount; }
    if (x.group === '디저트') { t.dessertQty += x.qty; t.dessertAmt += x.amount; }
    if (DRINK.has(x.group) && x.price > 0) t.cups += x.qty;
  }
  t.breadNormal = t.breadAmt + t.breadDisc;
  t.breadAvgPrice = t.breadNormal / t.breadQty;
  t.breadDiscRate = t.breadDisc / t.breadNormal;
  t.breadPerCup = t.breadQty / t.cups;
  t.breadPerOrder = t.breadQty / t.orders;
  t.breadShare = t.breadAmt / t.sales;
  monthly[m] = t;
}

// ── family 시계열 (빵만) ─────────────────────────────────────────────────────
const fam = buildSeries(reports, { level: 'family' });
const joinOf = (id) => (JOINED ? EXTRA_JOINS[id] || id : id);
// family 항목을 (추가 결합 적용 시) 합친다
const bread = {};
for (const it of Object.values(fam.items)) {
  if (it.group !== '빵') continue;
  const id = joinOf(it.id);
  const b = (bread[id] ||= { id, names: new Set(), byMonth: {}, prices: new Set() });
  for (const v of it.variants) b.names.add(v);
  for (const [m, x] of Object.entries(it.byMonth)) {
    const bm = (b.byMonth[m] ||= { qty: 0, amount: 0, discount: 0 });
    bm.qty += x.qty; bm.amount += x.amount; bm.discount += x.discount;
  }
}
for (const b of Object.values(bread)) {
  b.active = months.filter((m) => (b.byMonth[m]?.qty || 0) > 0);
  b.first = b.active[0]; b.last = b.active[b.active.length - 1];
  b.total = sum(months.map((m) => b.byMonth[m]?.qty || 0));
}
const q = (b, m) => b.byMonth[m]?.qty || 0;
const a = (b, m) => b.byMonth[m]?.amount || 0;
const n = (b, m) => (b.byMonth[m] ? b.byMonth[m].amount + b.byMonth[m].discount : 0);
const price = (b, m) => (q(b, m) ? n(b, m) / q(b, m) : null);
const name = (b) => splitKey(b.id).name;

// ── 1. 구색 ─────────────────────────────────────────────────────────────────
const assortment = months.map((m) => {
  const act = Object.values(bread).filter((b) => q(b, m) >= 1);
  return { m, n1: act.length, n30: act.filter((b) => q(b, m) >= 30).length, n100: act.filter((b) => q(b, m) >= 100).length,
    top10share: (() => { const qs = act.map((b) => q(b, m)).sort((x, y) => y - x); return sum(qs.slice(0, 10)) / sum(qs); })() };
});

// 전년 동월 비교 창: 25-03~07 vs 26-03~07
const W25 = ['2025-03', '2025-04', '2025-05', '2025-06', '2025-07'];
const W26 = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const W26clean = W26.slice(1); // 재등록 달(26-03) 제외
const inW = (b, W) => W.some((m) => q(b, m) > 0);
const disappeared = Object.values(bread).filter((b) => inW(b, W25) && !inW(b, W26clean) && !inW(b, ['2026-03']) )
  .map((b) => ({ id: b.id, name: name(b), last: b.last, qty25: sum(W25.map((m) => q(b, m))), amt25: sum(W25.map((m) => a(b, m))), byM: W25.map((m) => q(b, m)) }))
  .sort((x, y) => y.amt25 - x.amt25);
const disappearedAfterMarch = Object.values(bread).filter((b) => inW(b, W25) && inW(b, ['2026-03']) && !inW(b, W26clean))
  .map((b) => ({ id: b.id, name: name(b), last: b.last, qty25: sum(W25.map((m) => q(b, m))), amt25: sum(W25.map((m) => a(b, m))), qtyMar: q(b, '2026-03') }))
  .sort((x, y) => y.amt25 - x.amt25);
const appeared = Object.values(bread).filter((b) => inW(b, W26) && !inW(b, W25))
  .map((b) => ({ id: b.id, name: name(b), first: b.first, qty26: sum(W26.map((m) => q(b, m))), amt26: sum(W26.map((m) => a(b, m))), byM: W26.map((m) => q(b, m)) }))
  .sort((x, y) => y.amt26 - x.amt26);

// ── 2. 잔존 품목 같은 달 비교 + 분해 ───────────────────────────────────────
const likeForLike = W25.map((m25, i) => {
  const m26 = W26[i];
  const all = Object.values(bread);
  const both = all.filter((b) => q(b, m25) > 0 && q(b, m26) > 0);
  const only25 = all.filter((b) => q(b, m25) > 0 && q(b, m26) === 0);
  const only26 = all.filter((b) => q(b, m26) > 0 && q(b, m25) === 0);
  const S = (arr, fn) => sum(arr.map(fn));
  const row = {
    m25, m26, nBoth: both.length, nOnly25: only25.length, nOnly26: only26.length,
    total25: S(all, (b) => q(b, m25)), total26: S(all, (b) => q(b, m26)),
    both25: S(both, (b) => q(b, m25)), both26: S(both, (b) => q(b, m26)),
    lost25: S(only25, (b) => q(b, m25)), new26: S(only26, (b) => q(b, m26)),
    bothAmt25: S(both, (b) => a(b, m25)), bothAmt26: S(both, (b) => a(b, m26)),
    lostAmt25: S(only25, (b) => a(b, m25)), newAmt26: S(only26, (b) => a(b, m26)),
    // 같은 품목 가격지수(라스파이레스): Σ p26·q25 / Σ p25·q25
    priceIdx: S(both, (b) => price(b, m26) * q(b, m25)) / S(both, (b) => price(b, m25) * q(b, m25)),
    // 잔존 품목 중 늘어난/줄어든 수
    up: both.filter((b) => q(b, m26) > q(b, m25)).length, down: both.filter((b) => q(b, m26) < q(b, m25)).length,
    // 잔존 품목 개별 변화 (수량 상위)
    items: both.map((b) => ({ name: name(b), q25: q(b, m25), q26: q(b, m26), p25: price(b, m25), p26: price(b, m26), a25: a(b, m25), a26: a(b, m26) })).sort((x, y) => (y.q25 + y.q26) - (x.q25 + x.q26)),
    only25: only25.map((b) => ({ name: name(b), q25: q(b, m25), a25: a(b, m25) })).sort((x, y) => y.q25 - x.q25),
    only26: only26.map((b) => ({ name: name(b), q26: q(b, m26), a26: a(b, m26) })).sort((x, y) => y.q26 - x.q26),
  };
  return row;
});

// ── 3. 소금빵 계열 ─────────────────────────────────────────────────────────
const SALT_CORE = '빵|소금빵/먹물소금빵/초코짠짠'; // FAMILIES: 소금빵행사 + 먹물소금빵 + 병합 코드
const saltCore = bread[SALT_CORE];
const saltMembers = fam.items[SALT_CORE]; // variantByMonth 로 구성 코드별
const saltRelated = Object.values(bread).filter((b) => /소금빵|짠짠/.test(name(b)) && b.id !== SALT_CORE);
const saltSeries = months.map((m) => ({
  m, core: q(saltCore, m), coreNormal: n(saltCore, m), coreAmt: a(saltCore, m), corePrice: price(saltCore, m),
  byCode: Object.fromEntries(Object.entries(saltMembers.variantByMonth).map(([v, bm]) => [v, bm[m] || 0]).filter(([, x]) => x)),
  related: sum(saltRelated.map((b) => q(b, m))), breadQty: monthly[m].breadQty, share: q(saltCore, m) / monthly[m].breadQty,
  nonSalt: monthly[m].breadQty - q(saltCore, m),
}));

// ── 4. 빵 단가 변화 ─────────────────────────────────────────────────────────
// 같은 family 의 가중 단가가 전달 대비 ±3% 넘게 바뀐 곳 (양쪽 달 수량 ≥ 20). 전후 3개월 평균 수량도 함께.
const priceChanges = [];
for (const b of Object.values(bread)) {
  for (let i = 1; i < months.length; i++) {
    const m0 = months[i - 1], m1 = months[i];
    if (q(b, m0) < 20 || q(b, m1) < 20) continue;
    const p0 = price(b, m0), p1 = price(b, m1);
    if (Math.abs(p1 / p0 - 1) < 0.03) continue;
    const before = months.slice(Math.max(0, i - 3), i).map((m) => q(b, m)).filter(Boolean);
    const after = months.slice(i + 1, i + 4).map((m) => q(b, m)).filter(Boolean);
    priceChanges.push({ name: name(b), m0, m1, p0: Math.round(p0), p1: Math.round(p1), chg: p1 / p0 - 1, q0: q(b, m0), q1: q(b, m1), qBefore3: before.length ? sum(before) / before.length : null, qAfter3: after.length ? sum(after) / after.length : null });
  }
}
priceChanges.sort((x, y) => x.m1.localeCompare(y.m1) || (y.q0 - x.q0));
// 빵 전체 가중 단가(정상가/개) 와 소금빵 제외 가중 단가
const avgPrice = months.map((m) => ({ m, all: monthly[m].breadAvgPrice, nonSalt: (monthly[m].breadNormal - n(saltCore, m)) / (monthly[m].breadQty - q(saltCore, m)) }));

// ── 5. 빵 할인 ─────────────────────────────────────────────────────────────
const discount = months.map((m) => {
  const items = Object.values(bread).filter((b) => (b.byMonth[m]?.discount || 0) > 0)
    .map((b) => ({ name: name(b), disc: b.byMonth[m].discount, rate: b.byMonth[m].discount / n(b, m), qty: q(b, m) })).sort((x, y) => y.disc - x.disc);
  return { m, rate: monthly[m].breadDiscRate, disc: monthly[m].breadDisc, storeRate: monthly[m].disc / monthly[m].salesNormal, top: items.slice(0, 5), nDiscounted: items.length, nActive: Object.values(bread).filter((b) => q(b, m) > 0).length };
});

// ── 6. 부착률 ───────────────────────────────────────────────────────────────
const attach = months.map((m) => ({ m, cups: monthly[m].cups, orders: monthly[m].orders, breadQty: monthly[m].breadQty, perCup: monthly[m].breadPerCup, perOrder: monthly[m].breadPerOrder, nonSaltPerCup: (monthly[m].breadQty - q(saltCore, m)) / monthly[m].cups, saltPerCup: q(saltCore, m) / monthly[m].cups }));

// ── 전년 동월 요약 (빵 매출 기여) ────────────────────────────────────────────
const yoy = W25.map((m25, i) => {
  const m26 = W26[i], A = monthly[m25], B = monthly[m26];
  return { m25, m26, salesΔ: B.sales - A.sales, breadAmtΔ: B.breadAmt - A.breadAmt, breadQtyΔ: B.breadQty - A.breadQty, breadQtyPct: B.breadQty / A.breadQty - 1, breadAmtPct: B.breadAmt / A.breadAmt - 1,
    saltQtyΔ: q(saltCore, m26) - q(saltCore, m25), saltAmtΔ: a(saltCore, m26) - a(saltCore, m25), nonSaltQtyΔ: (B.breadQty - q(saltCore, m26)) - (A.breadQty - q(saltCore, m25)), nonSaltAmtΔ: (B.breadAmt - a(saltCore, m26)) - (A.breadAmt - a(saltCore, m25)),
    cupsPct: B.cups / A.cups - 1, ordersPct: B.orders / A.orders - 1, dessertAmtΔ: B.dessertAmt - A.dessertAmt,
    // 부착률 효과: 잔 수가 그대로였다면 빵이 얼마였을까 = perCup26 × cups25 ; 잔 수 효과 = (cups26−cups25) × perCup25
    cupEffect: (B.cups - A.cups) * A.breadPerCup, attachEffect: (B.breadPerCup - A.breadPerCup) * B.cups };
});

// ── 출력 ────────────────────────────────────────────────────────────────────
const line = (s = '') => console.log(s);
line(`== 자료 ${months[0]} ~ ${months.at(-1)} (${months.length}개월) · 추가 결합 ${JOINED ? '적용(--joined)' : '미적용(strict)'} · 빵 family ${Object.keys(bread).length}개`);
const cm = checkMarch();
line(`== 2026-03 재등록 검사: 보고서 총합계 qty ${cm.grandQty} = 파서 전체 qty ${cm.parsedAllQty} (${cm.grandQty === cm.parsedAllQty ? '같음' : '다름!'}) · 빵 블록 ${cm.breadBlocks.join('+')} = ${sum(cm.breadBlocks)} = 파서 빵 qty ${cm.parsedBreadQty} → 이중 계상 없음`);

line('\n== 월별 기본 (실매출=음수 줄 제외 amount 합, 만원)');
line('달 | 실매출 | 할인율 | 주문 | 음료잔 | 빵개수 | 빵매출 | 빵비중 | 빵할인율 | 빵단가(정상가/개) | 빵/잔 | 빵/주문 | 디저트매출');
for (const m of months) { const t = monthly[m]; line(`${M(m)} | ${만(t.sales)} | ${f(100 * t.disc / t.salesNormal, 1)}% | ${t.orders} | ${t.cups} | ${t.breadQty} | ${만(t.breadAmt)} | ${f(100 * t.breadShare, 1)}% | ${f(100 * t.breadDiscRate, 1)}% | ${Math.round(t.breadAvgPrice)} | ${f(t.breadPerCup, 3)} | ${f(t.breadPerOrder, 2)} | ${만(t.dessertAmt)}`); }

line('\n== 1. 구색 — 그 달에 1개 이상 팔린 빵 family 수 (n≥1 / n≥30 / n≥100 / 상위10 비중)');
line(assortment.map((x) => `${M(x.m)}:${x.n1}/${x.n30}/${x.n100}/${f(100 * x.top10share, 0)}%`).join('  '));
line(`\n-- 25-03~07 에 팔렸고 26-03~07 에 전혀 안 팔린 빵 (${disappeared.length}개) · 25-03~07 매출 합 ${만(sum(disappeared.map((x) => x.amt25)))}만원 · 개수 ${sum(disappeared.map((x) => x.qty25))}`);
line('이름 | 마지막 달 | 25-03~07 개수(월별) | 25-03~07 매출(만)');
for (const x of disappeared) line(`${x.name} | ${M(x.last)} | ${x.qty25} (${x.byM.join('/')}) | ${만(x.amt25)}`);
line(`\n-- 25-03~07 에 팔렸고 26-03 까지만 팔린 빵 (재등록 때 끝남, ${disappearedAfterMarch.length}개) · 25-03~07 매출 합 ${만(sum(disappearedAfterMarch.map((x) => x.amt25)))}만원`);
for (const x of disappearedAfterMarch) line(`${x.name} | 26-03 ${x.qtyMar}개 | 25-03~07 ${x.qty25}개 ${만(x.amt25)}만`);
line(`\n-- 26-03~07 에 팔렸고 25-03~07 에 없던 빵 (${appeared.length}개) · 26-03~07 매출 합 ${만(sum(appeared.map((x) => x.amt26)))}만원 · 개수 ${sum(appeared.map((x) => x.qty26))}`);
line('이름 | 첫 달 | 26-03~07 개수(월별) | 26-03~07 매출(만)');
for (const x of appeared) line(`${x.name} | ${M(x.first)} | ${x.qty26} (${x.byM.join('/')}) | ${만(x.amt26)}`);

line('\n== 2. 같은 달 비교 — 양쪽 달 모두 팔린 family(잔존) vs 25 에만 / 26 에만');
line('25→26 | 잔존n | 잔존 개수 25→26 (변화) | 25에만 n·개수 | 26에만 n·개수 | 전체 25→26 | 잔존 매출 25→26(만) | 잔존 가격지수 | 잔존 중 증/감');
for (const r of likeForLike) line(`${M(r.m25)}→${M(r.m26)} | ${r.nBoth} | ${r.both25}→${r.both26} (${pct(r.both26, r.both25)}) | ${r.nOnly25}·${r.lost25} | ${r.nOnly26}·${r.new26} | ${r.total25}→${r.total26} (${pct(r.total26, r.total25)}) | ${만(r.bothAmt25)}→${만(r.bothAmt26)} (${pct(r.bothAmt26, r.bothAmt25)}) | ${f(r.priceIdx, 3)} | ${r.up}/${r.down}`);
line('\n-- 분해: 전체 Δ = 잔존 Δ + (−25에만) + (+26에만)');
for (const r of likeForLike) line(`${M(r.m25)}→${M(r.m26)}: Δ${r.total26 - r.total25} = 잔존 ${r.both26 - r.both25} + 소멸 −${r.lost25} + 신규 +${r.new26}`);
for (const r of likeForLike) {
  line(`\n-- ${M(r.m25)}→${M(r.m26)} 잔존 품목 상위 25 (이름 | q25→q26 | 단가25→26 | 매출25→26 만)`);
  for (const x of r.items.slice(0, 25)) line(`  ${x.name} | ${x.q25}→${x.q26} (${pct(x.q26, x.q25)}) | ${Math.round(x.p25)}→${Math.round(x.p26)} | ${만(x.a25)}→${만(x.a26)}`);
  line(`  25에만: ${r.only25.slice(0, 15).map((x) => `${x.name}(${x.q25})`).join(', ')}`);
  line(`  26에만: ${r.only26.slice(0, 15).map((x) => `${x.name}(${x.q26})`).join(', ')}`);
}

line('\n== 3. 소금빵 계열 (family: 소금빵행사 + 먹물소금빵 → 26-03 "소금빵/ 먹물소금빵/초코짠짠")');
line('달 | 계열 개수 | 코드별 | 가중단가 | 계열 매출(만) | 빵 중 비중 | 소금빵 제외 빵 개수 | 관련(묶음·앙버터·라우겐 등)');
for (const s of saltSeries) line(`${M(s.m)} | ${s.core} | ${Object.entries(s.byCode).map(([k, v]) => `${k}:${v}`).join(' ')} | ${Math.round(s.corePrice)} | ${만(s.coreAmt)} | ${f(100 * s.share, 1)}% | ${s.nonSalt} | ${s.related}`);
line('-- 전년 동월: ' + W25.map((m25, i) => { const m26 = W26[i]; return `${M(m26)} ${q(saltCore, m25)}→${q(saltCore, m26)} (${pct(q(saltCore, m26), q(saltCore, m25))}, 매출 ${만(a(saltCore, m25))}→${만(a(saltCore, m26))}만 ${pct(a(saltCore, m26), a(saltCore, m25))}) · 소금빵 제외 ${monthly[m25].breadQty - q(saltCore, m25)}→${monthly[m26].breadQty - q(saltCore, m26)} (${pct(monthly[m26].breadQty - q(saltCore, m26), monthly[m25].breadQty - q(saltCore, m25))})`; }).join('\n   '));

line('\n== 4. 빵 단가 변화 — family 가중 단가가 전달 대비 ±3% 넘게 바뀐 곳 (양쪽 달 수량 ≥20)');
line('이름 | 달 | 단가 전→후 | 변화 | 수량 전달→그달 | 전3개월 평균 → 후3개월 평균');
for (const p of priceChanges) line(`${p.name} | ${M(p.m0)}→${M(p.m1)} | ${p.p0}→${p.p1} | ${f(100 * p.chg, 0)}% | ${p.q0}→${p.q1} | ${f(p.qBefore3, 0)}→${f(p.qAfter3, 0)}`);
line('\n-- 빵 전체 가중 단가(정상가/개) · 소금빵 제외: ' + avgPrice.map((x) => `${M(x.m)}:${Math.round(x.all)}/${Math.round(x.nonSalt)}`).join(' '));

line('\n== 5. 빵 할인 — 빵 할인율 / 매장 전체 할인율 / 할인 있는 family 수 / 할인 상위 5');
for (const d of discount) line(`${M(d.m)} | 빵 ${f(100 * d.rate, 1)}% (${만(d.disc)}만) | 매장 ${f(100 * d.storeRate, 1)}% | ${d.nDiscounted}/${d.nActive} | ${d.top.map((t) => `${t.name} ${만(t.disc)}만(${f(100 * t.rate, 1)}%)`).join(', ')}`);
line('-- 소금빵행사 코드: ' + months.map((m) => `${M(m)}:${saltMembers.variantByMonth['소금빵행사']?.[m] ?? '-'}`).join(' '));

line('\n== 6. 부착률 — 빵 개수 / 음료 잔 수(단가>0), 빵 개수 / 주문 건수');
line('달 | 음료잔 | 주문 | 빵 | 빵/잔 | 소금빵/잔 | 소금빵제외/잔 | 빵/주문');
for (const x of attach) line(`${M(x.m)} | ${x.cups} | ${x.orders} | ${x.breadQty} | ${f(x.perCup, 3)} | ${f(x.saltPerCup, 3)} | ${f(x.nonSaltPerCup, 3)} | ${f(x.perOrder, 2)}`);

line('\n== 전년 동월 — 빵이 총매출 감소에 기여한 크기 (만원)');
line('달 | 실매출Δ | 빵매출Δ (빵/총) | 빵개수Δ | 소금빵 개수Δ·매출Δ | 소금빵제외 개수Δ·매출Δ | 음료잔% | 주문% | 디저트매출Δ | 잔수효과 | 부착률효과');
for (const y of yoy) line(`${M(y.m26)} | ${만(y.salesΔ)} | ${만(y.breadAmtΔ)} (${f(100 * y.breadAmtΔ / y.salesΔ, 0)}%) | ${y.breadQtyΔ} (${f(100 * y.breadQtyPct, 1)}%) | ${y.saltQtyΔ}·${만(y.saltAmtΔ)} | ${y.nonSaltQtyΔ}·${만(y.nonSaltAmtΔ)} | ${f(100 * y.cupsPct, 1)}% | ${f(100 * y.ordersPct, 1)}% | ${만(y.dessertAmtΔ)} | ${Math.round(y.cupEffect)}개 | ${Math.round(y.attachEffect)}개`);

// ── 7. 2025-04 인상 검증 — sku 수준 단가 25-03 → 25-05 (양쪽 달 수량 ≥20) 차액 분포 ────────────────────
const skuS = buildSeries(reports, { level: 'sku' });
const pd = [];
for (const it of Object.values(skuS.items)) {
  if (it.group !== '빵') continue;
  const x = it.byMonth['2025-03'], y = it.byMonth['2025-05'];
  if (!x || !y || x.qty < 20 || y.qty < 20) continue;
  const px = (x.amount + x.discount) / x.qty, py = (y.amount + y.discount) / y.qty;
  pd.push({ name: splitKey(it.id).name, px: Math.round(px), py: Math.round(py), d: Math.round(py - px), qx: x.qty, qy: y.qty });
}
pd.sort((u, v) => v.d - u.d);
const hist = {};
for (const d of pd) hist[d.d] = (hist[d.d] || 0) + 1;
line(`\n== 7. 빵 sku 단가 25-03 → 25-05 (양쪽 수량≥20, ${pd.length}개) · 차액 분포(원:개수) ${Object.entries(hist).sort((u, v) => u[0] - v[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
for (const d of pd.filter((d) => d.d !== 400)) line(`  ${d.name} ${d.px}→${d.py} (${d.d >= 0 ? '+' : ''}${d.d}, ${f(100 * (d.py / d.px - 1), 0)}%) qty ${d.qx}→${d.qy}`);
line('  (+400원: ' + pd.filter((d) => d.d === 400).map((d) => d.name).join(', ') + ')');

// ── 8. 25-03~07 상위 12 family 의 23개월 개수 ───────────────────────────────
const top12 = Object.values(bread).map((b) => ({ b, s: sum(W25.map((m) => q(b, m))) })).sort((u, v) => v.s - u.s).slice(0, 12);
line('\n== 8. 25-03~07 상위 12 family 의 23개월 개수\n이름 | ' + months.map(M).join(' '));
for (const { b } of top12) line(`${name(b)} | ` + months.map((m) => q(b, m) || '-').join(' '));

// ── 9. 전년 동월 — 자료가 있는 모든 짝 (빵 감소가 언제 시작됐는지) ─────────────
line('\n== 9. 전년 동월 전 구간 (빵 개수 / 빵 매출 / 음료 잔 / 주문 / 빵/잔 / 디저트 개수 / 실매출)');
for (const m of months) {
  const y = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  if (!monthly[y]) continue;
  const A = monthly[y], B = monthly[m];
  line(`${M(m)} vs ${M(y)} | 빵 ${A.breadQty}→${B.breadQty} (${pct(B.breadQty, A.breadQty)}) | 빵매출 ${pct(B.breadAmt, A.breadAmt)} | 잔 ${pct(B.cups, A.cups)} | 주문 ${pct(B.orders, A.orders)} | 빵/잔 ${f(A.breadPerCup, 3)}→${f(B.breadPerCup, 3)} | 디저트 ${A.dessertQty}→${B.dessertQty} (${pct(B.dessertQty, A.dessertQty)}) | 실매출 ${pct(B.sales, A.sales)}`);
}
line('-- 디저트/잔: ' + months.map((m) => `${M(m)}:${f(monthly[m].dessertQty / monthly[m].cups, 3)}`).join(' '));

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ joined: JOINED, months, monthly, assortment, disappeared, disappearedAfterMarch, appeared, likeForLike, saltSeries, priceChanges, avgPrice, discount, attach, yoy, priceDiff2503to2505: pd, checkMarch: cm }, null, 1));
