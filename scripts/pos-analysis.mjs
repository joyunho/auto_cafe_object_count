// POS 월별 매출 보고서(텍스트) × 레시피 → 재고 품목별 소비량 분석
//   node scripts/pos-analysis.mjs [data/pos]   → data/consumption.json, data/analysis.json + 요약 출력
//
// 계산 본체는 src/logic/pos-model.js 에 있다 — 앱(설정 탭 "포스 자료 넣기")이 브라우저에서 부르는 것과
// 같은 함수다. 여기서는 파일을 읽고 보고서용 표(analysis.json)를 덧붙여 쓰기만 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport } from '../src/logic/pos.js';
import { suggestParFromRate, seasonality } from '../src/logic/consumption.js';
import { analyze, modelFrom, cupsOf } from '../src/logic/pos-model.js';
import { SEED_ITEMS } from '../src/data/items.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 기본: 추정값 층을 덧씌워 계산 (assumed 로 표시). `--no-estimates` 면 자료에 있는 값만.
const useEstimates = !process.argv.includes('--no-estimates');

// 레시피는 이 스크립트의 입력인 data/recipes.json 을 그대로 쓴다.
// 앱(브라우저)은 같은 자료를 src/data/recipes.js 로 받으므로, 둘이 어긋나면 알려 준다.
const recipesJson = path.join(root, 'data', 'recipes.json');
if (!fs.existsSync(recipesJson)) {
  console.error(`${path.relative(root, recipesJson)} 가 없습니다 — 먼저 scripts/build-recipes.mjs 로 만드세요`);
  process.exit(1);
}
const RECIPES = JSON.parse(fs.readFileSync(recipesJson, 'utf8')).recipes;
const modulePath = path.join(root, 'src', 'data', 'recipes.js');
if (!fs.existsSync(modulePath)) {
  console.warn('경고: src/data/recipes.js 가 없어 앱(브라우저)에서는 소비량을 계산할 수 없습니다 → node scripts/build-recipes-module.mjs');
} else {
  const { RECIPES: inApp } = await import('../src/data/recipes.js');
  if (JSON.stringify(inApp) !== JSON.stringify(RECIPES)) {
    console.warn('경고: data/recipes.json 과 src/data/recipes.js 가 다릅니다 → node scripts/build-recipes-module.mjs 로 맞추세요 (이 스크립트는 data/recipes.json 으로 계산합니다)');
  }
}

const dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'data', 'pos'));
const files = fs.readdirSync(dir).filter((f) => /월.*\.txt$/.test(f));
const reports = files.map((f) => parseSalesReport(fs.readFileSync(path.join(dir, f), 'utf8')));
for (const [i, r] of reports.entries()) if (r.unassigned) console.warn(`경고: ${files[i]} 그룹 미배정 ${r.unassigned}줄`);

const a = analyze(reports, { estimates: useEstimates, recipes: RECIPES, items: SEED_ITEMS });
const { sales, byIngredient, byItem, unmapped, ignored, maps, notes } = a;

// 음료 판매 잔 수 (재료 소비 대상 그룹만) — 앱 미리보기와 같은 함수
const { byMonth: cupsByMonth, byGroup: cupsByGroup } = cupsOf(a);
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

// 앱용 소비 모델: 품목별 월 일평균(포장 단위) — 앱이 브라우저에서 만드는 것과 같은 함수(modelFrom)로
const model = modelFrom(a);
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
