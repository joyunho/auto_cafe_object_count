// 추정값 층 — 자료(레시피·구매표·시트)에 없어 비워 둔 값에 대한 "일단 쓰는 추정값".
//
// 원칙: 확정 자료(pos-map.js)와 분리해 둔다. 여기 있는 값은 모두 assumed: true 로 표시되어
// 분석 보고서·앱에서 "추정"으로 보이고, 확인 목록(scripts/lib/checklist.mjs)에 "지금 쓰는 추정값"으로 함께 적힌다.
// 실제 값이 확인되면 pos-map.js 에 넣고 여기서는 지운다. 분석을 추정 없이 돌리려면 `--no-estimates`.
//
// basis: 무엇을 근거로 한 추정인지 (보고서 비고에 표시)

const DENSITY_SYRUP = 1.3; // 시럽·소스 g/ml 추정
// 가니쉬(건조 슬라이스): 1봉 100g 은 확인됨(2026-09). 1조각 무게만 모르므로 여기서 추정한다.
//   레몬 품목(lemon-syrup)에는 레몬청(생레몬)과 레몬 가니쉬(건조레몬)가 함께 모인다 — 둘 다 100g 단위라 합계는 "100g 몇 개"로 읽는다.
const SLICE_G = 3; // 건조 오렌지·레몬 1조각 ≈ 3g (100g 봉지 약 33조각)
const LEMON_G = 100; // 레몬청용 생레몬 1개 ≈ 청 100g
const est = (o, basis) => ({ ...o, assumed: true, basis, note: `추정: ${basis}` });

export const ESTIMATES = {
  INGREDIENT_MAP: {
    '바닐라시럽': est({ item: 'vanilla-syrup', perPackage: 1000 * DENSITY_SYRUP, unit: 'g' }, '1L 병 × 밀도 1.3'),
    '카라멜소스': est({ item: 'caramel-sauce', perPackage: 1890 * DENSITY_SYRUP, unit: 'g' }, '1.89L 병 × 밀도 1.3'),
    '카라멜시럽': est({ item: 'caramel-syrup', perPackage: 750 * DENSITY_SYRUP, unit: 'g' }, '750ml 병 × 밀도 1.3'),
    '설탕시럽': est({ item: 'cafe-syrup', perPackage: 1500 * DENSITY_SYRUP, unit: 'g' }, '1.5L 병 × 밀도 1.3'),
    '그린티': est({ item: 'boseong-green-tea', perPackage: 1000 * DENSITY_SYRUP, unit: 'g' }, '1L 병 × 밀도 1.3'),
    '헤이즐넛시럽': est({ item: 'hazelnut-syrup', perPackage: 1000 * DENSITY_SYRUP, unit: 'g' }, '1L 병 × 밀도 1.3 (적어 주신 병 용량 "1750ml"이 750ml인지 1L인지 불확실)'),
    '크림우유': est({ item: 'milk', perPackage: 1000, unit: 'ml', density: 1.03, milkShare: 0.6 }, '우유 3 : 휘핑 2 비율의 우유 60%, 밀도 1.03'),
    '미숫가루': est({ item: 'misugaru', perPackage: 1000, unit: 'g' }, '1봉 1kg'),
    '시나몬가루': est({ item: 'cinnamon-powder', perPackage: 500, unit: 'g', perServing: 0.3 }, '1잔 0.3g (한 꼬집)'),
    '오렌지 가니쉬': est({ item: 'orange-garnish', perPackage: 100, unit: 'g', perServing: SLICE_G }, `1잔 1조각·1봉 100g(확인) + 건조 1조각 ≈ ${SLICE_G}g`),
    '가니쉬': est({ item: 'lemon-syrup', perPackage: 100, unit: 'g', perServing: SLICE_G }, `종류 미표기 가니쉬 = 레몬(확인) + 건조 1조각 ≈ ${SLICE_G}g`),
    '레몬청': est({ item: 'lemon-syrup', perPackage: LEMON_G, unit: 'g' }, '레몬청용 생레몬 1개 ≈ 청 100g 으로 봄'),
    '레몬 가니쉬': est({ item: 'lemon-syrup', perPackage: 100, unit: 'g', perServing: SLICE_G }, `건조레몬 1봉 100g(확인) + 1조각 ≈ ${SLICE_G}g`),
    '잣(미표기)': est({ item: 'pine-nut', perPackage: null, unit: 'ea', perServing: 3 }, '1잔 잣 3개'),
    '아이스크림': est({ item: 'ice-cream', perPackage: null, unit: 'scoop', perServing: 2 }, '1잔 2스쿱(확인) · 1통에서 몇 스쿱인지는 모름'),
    // 토마토·키위·대추·잣·아이스크림의 1포장 양은 추정하지 않는다 (근거 없음 — 원자료 양만 집계)
  },
  MODIFIERS: {
    hazelnut: { ingredient: '헤이즐넛시럽', qty: 5, unit: 'g', assumed: true, basis: '1펌프 5g(확인) × 옵션 1건에 1펌프로 봄' },
  },
  PRODUCT_MAP: {
    '노아주스': est({ items: { 'noa-orange': 0.25, 'noa-carrot': 0.25, 'noa-mango': 0.25, 'noa-kiwi': 0.25 } }, '종류 정보 없음 → 4종 균등'),
    '포도주스': est({ item: 'grape-juice', qty: 1 }, '착즙포도주스 1병 = 1건'),
    '브런치어린이': est({ brunch: 0.5 }, '어린이 = 0.5인분'),
  },
  // 레시피가 없거나 원재료로 나눌 수 없어 추정한 레시피 (메뉴|변형이 같으면 덮어씀)
  recipes: [
    { menu: '유자차', variant: 'HOT', ingredients: [{ name: '유자청', qty: 45, unit: 'g' }, { name: '오렌지 가니쉬', qty: 1, unit: 'serving' }], assumed: true, basis: '청귤차와 같은 방식 (청 3스쿱 45g)' },
    { menu: '유자차', variant: 'ICE', ingredients: [{ name: '유자청', qty: 45, unit: 'g' }, { name: '오렌지 가니쉬', qty: 1, unit: 'serving' }], assumed: true, basis: '청귤차와 같은 방식 (청 3스쿱 45g)' },
    // 사용자 확인(2026-09): 대추차의 대추는 6조각 (인쇄 레시피의 "대추 5개"를 고쳐 적어 주심)
    { menu: '대추차', variant: 'HOT', ingredients: [{ name: '대추원액', qty: 2, unit: 'bag' }, { name: '대추', qty: 6, unit: 'ea' }, { name: '잣', qty: 6, unit: 'ea' }], assumed: true, basis: '사용자 확인: 대추 6조각 (대추 1개를 여러 조각으로 잘라 씀)' },
    { menu: '대추차', variant: 'ICE', ingredients: [{ name: '대추원액', qty: 2, unit: 'bag' }, { name: '대추', qty: 6, unit: 'ea' }, { name: '잣', qty: 6, unit: 'ea' }], assumed: true, basis: 'HOT 레시피와 같다고 봄 (대추 6조각)' },
    {
      menu: '옛날미숫가루',
      variant: 'ICE',
      ingredients: [
        { name: '미숫가루', qty: (220 / 1530) * 180, unit: 'g' },
        { name: '연유', qty: (40 / 1530) * 180, unit: 'g' },
        { name: '설탕시럽', qty: (40 / 1530) * 180, unit: 'g' },
      ],
      assumed: true,
      basis: '옛미 베이스 배합(물 1150+연유 40+시럽 40+설탕 80+미숫가루 220 = 1530g, ml≈g)의 비율로 180g 환산, 시럽 = 설탕시럽',
    },
  ],
};

/** 확정 연결표·레시피에 추정값을 덧씌운다. 덧씌운 항목은 assumed: true 로 남는다. */
export function applyEstimates(maps, recipes, estimates = ESTIMATES) {
  const merged = {
    ...maps,
    INGREDIENT_MAP: { ...maps.INGREDIENT_MAP, ...estimates.INGREDIENT_MAP },
    PRODUCT_MAP: { ...maps.PRODUCT_MAP, ...estimates.PRODUCT_MAP },
    MODIFIERS: { ...maps.MODIFIERS, ...estimates.MODIFIERS },
  };
  const key = (r) => `${r.menu}|${r.variant}`;
  const out = recipes.map((r) => ({ ...r }));
  for (const e of estimates.recipes || []) {
    let rec = e;
    if (e.copyOf) {
      const src = recipes.find((r) => r.menu === e.menu && r.variant === e.copyOf);
      if (!src) continue;
      rec = { ...src, variant: e.variant, assumed: true, basis: e.basis };
    }
    const i = out.findIndex((r) => key(r) === key(rec));
    if (i >= 0) out[i] = rec;
    else out.push(rec);
  }
  return { maps: merged, recipes: out };
}
