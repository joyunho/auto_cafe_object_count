// POS 월별 매출 보고서(텍스트) × 레시피 → 재고 품목별 소비량 분석
//   node scripts/pos-analysis.mjs [data/pos]   → data/consumption.json, data/analysis.json + 요약 출력
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport, aggregateSales } from '../src/logic/pos.js';
import { consumptionByIngredient, consumptionByItem, suggestParFromRate, seasonality } from '../src/logic/consumption.js';
const RECIPES = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data', 'recipes.json'), 'utf8')).recipes;
import * as baseMaps from '../src/data/pos-map.js';
import { applyEstimates } from '../src/data/pos-estimates.js';
import { SEED_ITEMS } from '../src/data/items.js';

// 기본: 추정값 층을 덧씌워 계산 (assumed 로 표시). `--no-estimates` 면 자료에 있는 값만.
const useEstimates = !process.argv.includes('--no-estimates');
const { maps, recipes: RECIPES_USED } = useEstimates ? applyEstimates(baseMaps, RECIPES) : { maps: baseMaps, recipes: RECIPES };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'data', 'pos'));
const files = fs.readdirSync(dir).filter((f) => /월.*\.txt$/.test(f));
const reports = files.map((f) => parseSalesReport(fs.readFileSync(path.join(dir, f), 'utf8')));
for (const [i, r] of reports.entries()) if (r.unassigned) console.warn(`경고: ${files[i]} 그룹 미배정 ${r.unassigned}줄`);
const sales = aggregateSales(reports);
const { byIngredient, unmapped, ignored, decafCups } = consumptionByIngredient(sales, RECIPES_USED, maps);
const { byItem, notes } = consumptionByItem(sales.months, byIngredient, decafCups, maps, SEED_ITEMS);

// 음료 판매 잔 수 (재료 소비 대상 그룹만)
const drinkGroups = ['커피', '티', '에이드', '라떼', '주스/병음료'];
const cupsByMonth = Object.fromEntries(sales.months.map((m) => [m, 0]));
const cupsByGroup = {};
for (const [name, p] of Object.entries(sales.products)) {
  if (!drinkGroups.includes(p.group)) continue;
  const map = maps.PRODUCT_MAP[name];
  if (!map || map.modifier) continue; // 옵션 제외
  cupsByGroup[p.group] = (cupsByGroup[p.group] || 0) + p.total;
  for (const [m, q] of Object.entries(p.byMonth)) cupsByMonth[m] += q;
}
// 아이스/핫: POS 상품명(ice…/hot…)으로 판정, 이름에 없으면 레시피 변형으로 (대추차 ice처럼 레시피는 HOT만 있어도 판매는 ICE)
const served = (name, map) => (/^ice|\sice$/i.test(name) ? 'ice' : /^hot|\shot$/i.test(name) ? 'hot' : map.variant === 'ICE' ? 'ice' : 'hot');
const iceHot = Object.fromEntries(sales.months.map((m) => [m, { ice: 0, hot: 0 }]));
for (const [name, p] of Object.entries(sales.products)) {
  const map = maps.PRODUCT_MAP[name];
  if (!map || !(map.menu || map.espresso)) continue;
  for (const [m, q] of Object.entries(p.byMonth)) iceHot[m][served(name, map)] += q;
}

const itemIndex = Object.fromEntries(SEED_ITEMS.map((it) => [it.id, it]));
const rows = Object.values(byItem)
  .map((r) => {
    const it = itemIndex[r.itemId];
    if (!it) notes.push(`품목 목록에 없는 id: ${r.itemId}`);
    // 시트 기준을 낱개로: 박스 기준인데 1박스 개수를 모르면(배도라지차 2BOX) 비교 불가 → null
    const parEach = it && it.par != null ? (it.parUnit === 'box' ? (it.boxSize ? it.par * it.boxSize : null) : it.par) : null;
    const parLabel = it && it.par != null ? (it.parUnit === 'box' ? `${it.par}박스` : String(it.par)) : null;
    const sug = r.perPackage ? { mon_thu: suggestParFromRate(r.peakPerDay, { coverDays: 3 }), thu_mon: suggestParFromRate(r.peakPerDay, { coverDays: 4 }), avg4: suggestParFromRate(r.avgPerDay, { coverDays: 4 }) } : null;
    let note = r.note;
    if (r.totalDecafRaw) note += r.unit === 'shot' ? ` (디카페인 ${Math.round(r.totalDecafRaw).toLocaleString()}샷/년 포함)` : ` (디카페인 ${(r.totalDecafRaw / 1000).toFixed(0)}kg/년 포함)`;
    return { ...r, note, parEach, parLabel, boxSize: it?.boxSize || null, suggested: sug, season: seasonality(r.perDay, sales.months) };
  })
  .sort((a, b) => (b.avgPerDay || 0) - (a.avgPerDay || 0));

const out = {
  generatedAt: new Date().toISOString(),
  estimates: useEstimates,
  months: sales.months,
  cupsByMonth,
  cupsByGroup,
  iceHot,
  items: rows,
  brunch: byIngredient['@brunch']?.months || {},
  brunchKids: byIngredient['@brunch-kids']?.months || {},
  ramen: byIngredient['@ramen']?.months || {},
  unmapped,
  ignored,
  notes,
};
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'analysis.json'), JSON.stringify(out, null, 1));

// 앱용 소비 모델: 품목별 월 일평균(포장 단위) + 계절 지수
const model = {
  version: 1,
  source: `POS 그룹별 매출분석 ${sales.months[0]} ~ ${sales.months.at(-1)} × 레시피 2026.08${useEstimates ? ' (포장 크기 일부 추정)' : ''}`,
  months: sales.months,
  items: Object.fromEntries(
    rows
      .filter((r) => r.perPackage && itemIndex[r.itemId])
      .map((r) => [r.itemId, { perDay: Object.fromEntries(sales.months.map((m) => [m, Math.round((r.perDay[m] || 0) * 1000) / 1000])), avgPerDay: Math.round(r.avgPerDay * 1000) / 1000, unit: r.unit, assumed: r.assumed, estimated: r.assumed }]),
  ),
};
fs.writeFileSync(path.join(root, 'data', 'consumption.json'), JSON.stringify(model, null, 1));

// 요약 출력
const f1 = (x) => (x == null ? '-' : x.toFixed(2));
console.log(`월: ${sales.months.join(' ')}`);
console.log(`음료 잔 수(옵션 제외): ${Object.values(cupsByMonth).reduce((a, b) => a + b, 0).toLocaleString()} / 그룹별 ${JSON.stringify(cupsByGroup)}`);
console.log('\n품목 | 단위 | 1포장 | 연간 낱개 | 일평균 | 최대월 | 시트 기준 | 제안(월→목/목→월) | 가정');
for (const r of rows) {
  console.log(`${r.name} | ${r.unit} | ${r.perPackage ?? '?'} | ${r.totalUnits == null ? '-' : r.totalUnits.toFixed(1)} | ${f1(r.avgPerDay)} | ${f1(r.peakPerDay)} | ${r.parEach ?? '-'} | ${r.suggested ? `${r.suggested.mon_thu}/${r.suggested.thu_mon}` : '-'} | ${r.assumed ? '추정' : ''} ${r.perPackage ? '' : '(포장 단위 모름: 원자료 ' + r.totalRaw.toFixed(0) + r.unit + '/년)'}`);
}
console.log('\n브런치 1인:', JSON.stringify(out.brunch), '\n브런치 어린이:', JSON.stringify(out.brunchKids), '\n라면:', JSON.stringify(out.ramen));
console.log('\n미연결 상품:', unmapped.map((u) => `${u.product}(${u.total}${u.reason ? ', ' + u.reason : ''})`).join(', ') || '없음');
console.log('의도적으로 뺀 옵션:', ignored.map((u) => `${u.product}(${u.total})`).join(', '));
console.log('메모:', notes.join('; ') || '없음');
