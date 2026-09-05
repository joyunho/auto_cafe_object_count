// 레시피 구조화 결과(JSON) → 앱/분석용 레시피 표 (data/recipes.json)
//   node scripts/build-recipes.mjs <structured.json>
// 후처리:
//   - 에스프레소샷 40ml → 1 shot 단위 (레시피에 "1샷 40ml"로 인쇄됨)
//   - 티백 메뉴를 "티백 X" 이름으로 통일. 봉 수는 인쇄돼 있지 않으므로 1잔(serving)으로만 집계
//   - 애플유자의 "애플유자티" 도 봉 수 미인쇄 → 1잔(serving)
//   - 옛날미숫가루의 "미숫가루 베이스 180g" 는 원재료로 나누지 않고 베이스 g 그대로 둠 (배합 산출량 미인쇄)
//   - 수량이 인쇄되지 않은 재료(가니쉬·거품·드리즐·시나몬가루·아이스크림 등)는 수량을 지어내지 않고
//     1잔(serving)으로만 남김. 같은 이름이 다른 곳에 수량과 함께 나오면 "(미표기)"를 붙여 구분
//   - 레시피에 없는 판매 메뉴(유자차 등)는 추가하지 않음 → 분석에서 "레시피 없음"으로 표시
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) {
  console.error('사용법: node scripts/build-recipes.mjs <structured.json>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const data = raw.result?.recipes ? raw.result : raw;
const TEABAGS = ['캐모마일', '루이보스', '파인우롱', '작설녹차'];
const out = [];

// 수량이 인쇄된 재료 이름 (같은 이름이 수량 없이도 나오면 "(미표기)"로 구분하기 위해)
const printedNames = new Set(data.recipes.flatMap((r) => r.ingredients.filter((i) => /\d/.test(i.raw || '')).map((i) => i.name)));
const noQty = (i) => !/\d/.test(i.raw || '');

for (const r of data.recipes) {
  if (r.variant === 'PREP') continue;
  let menu = r.menu;
  let ingredients = r.ingredients.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit }));
  if (TEABAGS.includes(menu) || TEABAGS.some((t) => menu === `티백 ${t}`)) {
    const t = TEABAGS.find((t) => menu.includes(t));
    menu = `티백 ${t}`;
    ingredients = [{ name: `티백 ${t}`, qty: 1, unit: 'serving' }]; // 봉 수 미인쇄
  }
  const rawIngredients = r.ingredients;
  ingredients = ingredients.flatMap((i, idx) => {
    const src = rawIngredients[idx] || i;
    if (i.name === '에스프레소샷') return [{ name: '에스프레소샷', qty: i.unit === 'ml' ? i.qty / 40 : i.qty, unit: 'shot' }];
    if (i.name.startsWith('애플유자티')) return [{ name: '애플유자티', qty: 1, unit: 'serving' }]; // 봉 수 미인쇄
    if (i.name === '콜드브루' && /디카페인/.test(menu)) return [{ name: '디카페인 콜드브루', qty: i.qty, unit: i.unit }]; // 메뉴명이 디카페인
    if (['얼음', '물', '뜨거운물', '얼음 추가', '티백 우린 물', '설탕', '시럽'].includes(i.name)) return []; // 재고 시트와 무관
    if (noQty(src)) {
      // 수량이 인쇄돼 있지 않음 → 1잔으로만 집계 (값을 지어내지 않음)
      const name = printedNames.has(i.name) ? `${i.name}(미표기)` : i.name;
      return [{ name, qty: 1, unit: 'serving' }];
    }
    if (i.name === '대추' || i.name === '잣') return [{ name: i.name, qty: i.qty, unit: 'ea' }];
    return [i];
  });
  out.push({ menu, variant: r.variant, category: r.category, ingredients, notes: r.notes || '' });
}
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'recipes.json'), JSON.stringify({ measures: data.measures, recipes: out, supplies: data.supplies }, null, 1));
console.log(`data/recipes.json: ${out.length} recipes, ${data.supplies.length} supplies`);
for (const r of out) console.log(`  ${r.menu} ${r.variant}: ${r.ingredients.map((i) => `${i.name} ${Math.round(i.qty * 100) / 100}${i.unit}`).join(', ')}`);
