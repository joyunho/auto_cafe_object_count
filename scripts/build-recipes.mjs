// 레시피 구조화 결과(JSON) → 앱/분석용 레시피 표 (data/recipes.json)
//   node scripts/build-recipes.mjs <structured.json>
// 후처리:
//   - 에스프레소샷 40ml → 1 shot 단위
//   - 티백 메뉴를 "티백 X" 이름으로 통일하고 ICE/HOT 모두 티백 1봉 소비
//   - 애플유자 ICE의 "애플유자티 물 150ml" → 애플유자티 1봉
//   - 옛날미숫가루의 "미숫가루 베이스 180g" → 베이스 배합(PREP) 비율로 원재료 환산
//   - 시나몬가루/가니쉬처럼 수량이 없는 항목에 추정 수량 부여
//   - 레시피에 없는 판매 메뉴(유자차) 추가
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

// 옛미 베이스 배합에서 180g당 원재료
const base = data.recipes.find((r) => r.menu.includes('옛미 베이스'));
let misuPer180 = null;
if (base) {
  const total = base.ingredients.reduce((a, i) => a + i.qty, 0); // ml≈g로 봄
  const get = (n) => base.ingredients.find((i) => i.name === n)?.qty || 0;
  misuPer180 = {
    미숫가루: (get('미숫가루') / total) * 180,
    연유: (get('연유') / total) * 180,
    설탕시럽: (get('시럽') / total) * 180,
  };
}

for (const r of data.recipes) {
  if (r.variant === 'PREP') continue;
  let menu = r.menu;
  let ingredients = r.ingredients.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit }));
  if (TEABAGS.includes(menu) || TEABAGS.some((t) => menu === `티백 ${t}`)) {
    const t = TEABAGS.find((t) => menu.includes(t));
    menu = `티백 ${t}`;
    ingredients = [{ name: `티백 ${t}`, qty: 1, unit: 'bag' }];
  }
  ingredients = ingredients.flatMap((i) => {
    if (i.name === '에스프레소샷') return [{ name: '에스프레소샷', qty: i.unit === 'ml' ? i.qty / 40 : i.qty, unit: 'shot' }];
    if (i.name.startsWith('애플유자티')) return [{ name: '애플유자티', qty: 1, unit: 'bag' }];
    if (i.name === '미숫가루 베이스' && misuPer180) {
      const k = i.qty / 180;
      return [
        { name: '미숫가루', qty: misuPer180.미숫가루 * k, unit: 'g' },
        { name: '연유', qty: misuPer180.연유 * k, unit: 'g' },
        { name: '설탕시럽', qty: misuPer180.설탕시럽 * k, unit: 'g' },
      ];
    }
    if (i.name === '시나몬가루') return [{ name: '시나몬가루', qty: 0.3, unit: 'g', assumed: true }];
    if (i.name === '가니쉬') return [{ name: '오렌지 가니쉬', qty: 1, unit: 'ea', assumed: true }];
    if (i.name === '키위' && i.unit === 'g') return [{ name: '키위', qty: i.qty / 100, unit: 'ea' }];
    if (i.name === '대추' || i.name === '잣') return [{ name: i.name, qty: i.qty, unit: 'ea' }];
    if (['얼음', '물', '뜨거운물', '우유거품', '초코드리즐', '아몬드슬라이스', '얼음 추가', '티백 우린 물'].includes(i.name)) return [];
    return [i];
  });
  out.push({ menu, variant: r.variant, category: r.category, ingredients, notes: r.notes || '' });
}
// 레시피에 없는 판매 메뉴: 유자차 (청귤차와 같은 방식으로 추정)
if (!out.some((r) => r.menu === '유자차')) {
  out.push({ menu: '유자차', variant: 'HOT', category: 'TEA', ingredients: [{ name: '유자청', qty: 45, unit: 'g', assumed: true }, { name: '오렌지 가니쉬', qty: 1, unit: 'ea', assumed: true }], notes: '레시피 없음 — 청귤차 방식으로 추정' });
  out.push({ menu: '유자차', variant: 'ICE', category: 'TEA', ingredients: [{ name: '유자청', qty: 45, unit: 'g', assumed: true }, { name: '오렌지 가니쉬', qty: 1, unit: 'ea', assumed: true }], notes: '레시피 없음 — 청귤차 방식으로 추정' });
}
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'recipes.json'), JSON.stringify({ measures: data.measures, recipes: out, supplies: data.supplies }, null, 1));
console.log(`data/recipes.json: ${out.length} recipes, ${data.supplies.length} supplies`);
for (const r of out) console.log(`  ${r.menu} ${r.variant}: ${r.ingredients.map((i) => `${i.name} ${Math.round(i.qty * 100) / 100}${i.unit}`).join(', ')}`);
