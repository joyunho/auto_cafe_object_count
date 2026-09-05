// 추정값 층 — 자료(레시피·구매표·시트)에 없어 비워 둔 값에 대한 "일단 쓰는 추정값".
//
// 원칙: 확정 자료(pos-map.js)와 분리해 둔다. 여기 있는 값은 모두 assumed: true 로 표시되어
// 분석 보고서·앱에서 "추정"으로 보이고, 확인 목록(scripts/lib/checklist.mjs)에 "지금 쓰는 추정값"으로 함께 적힌다.
// 실제 값이 확인되면 pos-map.js 에 넣고 여기서는 지운다. 분석을 추정 없이 돌리려면 `--no-estimates`.
//
// basis: 무엇을 근거로 한 추정인지 (보고서 비고에 표시)

const DENSITY_SYRUP = 1.3; // 시럽·소스 g/ml 추정
const est = (o, basis) => ({ ...o, assumed: true, basis, note: `추정: ${basis}` });

export const ESTIMATES = {
  INGREDIENT_MAP: {
    '에스프레소샷': est({ item: 'beans', perShotG: 18, perPackage: 1000, unit: 'g' }, '1샷 원두 18g·1봉 1kg (업계 일반값)'),
    '바닐라시럽': est({ item: 'vanilla-syrup', perPackage: 1000 * DENSITY_SYRUP, unit: 'g' }, '1L 병 × 밀도 1.3'),
    '카라멜소스': est({ item: 'caramel-sauce', perPackage: 1890 * DENSITY_SYRUP, unit: 'g' }, '1.89L 병 × 밀도 1.3'),
    '카라멜시럽': est({ item: 'caramel-syrup', perPackage: 750 * DENSITY_SYRUP, unit: 'g' }, '750ml 병 × 밀도 1.3'),
    '설탕시럽': est({ item: 'cafe-syrup', perPackage: 1500 * DENSITY_SYRUP, unit: 'g' }, '1.5L 병 × 밀도 1.3'),
    '그린티': est({ item: 'boseong-green-tea', perPackage: 1000 * DENSITY_SYRUP, unit: 'g' }, '1L 병 × 밀도 1.3'),
    '헤이즐넛시럽': est({ item: 'hazelnut-syrup', perPackage: 1000 * DENSITY_SYRUP, unit: 'g' }, '1L 병 × 밀도 1.3, 옵션 1건 = 1펌프 15g'),
    '크림우유': est({ item: 'milk', perPackage: 1000, unit: 'ml', density: 1.03, milkShare: 0.6 }, '우유 3 : 휘핑 2 비율의 우유 60%, 밀도 1.03'),
    '우유거품': est({ item: 'milk', perPackage: 1000, unit: 'ml', perServing: 30 }, '거품용 우유 1잔 30ml'),
    '딸기청': est({ item: 'strawberry-cheong', perPackage: 2000, unit: 'g' }, '같은 회사 청 2kg 규격'),
    '블루베리청': est({ item: 'blueberry-cheong', perPackage: 2000, unit: 'g' }, '같은 회사 청 2kg 규격'),
    '배도라지청': est({ item: 'pear-bellflower-tea', perPackage: 470, unit: 'g' }, '구매표 470g 병 (1박스 병 수는 모름 → 병 단위)'),
    '디카페인 콜드브루': est({ item: 'decaf-coldbrew', perPackage: 1000, unit: 'g' }, '1봉 1kg'),
    '콜드브루': est({ item: 'decaf-coldbrew', perPackage: 1000, unit: 'g' }, '바닐라 크림 콜드브루도 디카페인 콜드브루 사용, 1봉 1kg'),
    '미숫가루': est({ item: 'misugaru', perPackage: 1000, unit: 'g' }, '1봉 1kg'),
    '시나몬가루': est({ item: 'cinnamon-powder', perPackage: 500, unit: 'g', perServing: 0.3 }, '1잔 0.3g (한 꼬집)'),
    '오렌지 가니쉬': est({ item: 'orange-garnish', perPackage: null, unit: 'ea', perServing: 1 }, '1잔 1조각 (1포장 조각 수는 모름)'),
    '가니쉬': est({ item: 'orange-garnish', perPackage: null, unit: 'ea', perServing: 1 }, '종류 미표기 가니쉬 = 오렌지 1조각'),
    '레몬 가니쉬': est({ item: 'lemon-juice', perPackage: null, unit: 'ea', perServing: 1 }, '시트 1 "레몬" = 건조레몬, 1잔 1조각'),
    '대추 가니쉬': est({ item: 'jujube', perPackage: null, unit: 'ea', perServing: 2 }, '1잔 대추 2개'),
    '잣(미표기)': est({ item: 'pine-nut', perPackage: null, unit: 'ea', perServing: 3 }, '1잔 잣 3개'),
    '아이스크림': est({ item: 'ice-cream', perPackage: null, unit: 'scoop', perServing: 1 }, '1잔 1스쿱 (1통 스쿱 수는 모름)'),
    '초코드리즐': est({ item: 'choco-sauce', perPackage: 2600, unit: 'g', perServing: 10 }, '아포가토 드리즐 = 초코소스 10g'),
    '애플유자티': est({ item: 'apple-tea', perPackage: 25, unit: 'bag', perServing: 1 }, '1잔 티백 1봉'),
    '티백 캐모마일': est({ item: 'chamomile', perPackage: 20, unit: 'bag', perServing: 1 }, '1잔 티백 1봉'),
    '티백 루이보스': est({ item: 'rooibos', perPackage: 30, unit: 'bag', perServing: 1 }, '1잔 티백 1봉'),
    '티백 파인우롱': est({ item: 'pine-oolong', perPackage: 20, unit: 'bag', perServing: 1 }, '1잔 티백 1봉'),
    '티백 작설녹차': est({ item: 'jakseol-green-tea', perPackage: 30, unit: 'bag', perServing: 1 }, '1잔 티백 1봉'),
    // 탄산수·토마토·키위·대추·잣·오렌지가니쉬·아이스크림의 1포장 양은 추정하지 않음 (시트 기준과 맞지 않거나 근거 없음)
  },
  MODIFIERS: {
    hazelnut: { ingredient: '헤이즐넛시럽', qty: 15, unit: 'g', assumed: true, basis: '옵션 1건 = 1펌프 15g' },
  },
  PRODUCT_MAP: {
    '노아주스': est({ items: { 'noa-orange': 0.25, 'noa-carrot': 0.25, 'noa-mango': 0.25, 'noa-kiwi': 0.25 } }, '종류 정보 없음 → 4종 균등'),
    '어린이 사과주스': est({ item: 'sweet-apple', qty: 1 }, '이름으로 달콤사과로 봄'),
    '포도주스': est({ item: 'grape-juice', qty: 1 }, '착즙포도주스 1병 = 1건'),
    '브런치어린이': est({ brunch: 0.5 }, '어린이 = 0.5인분'),
  },
  // 레시피가 없거나 원재료로 나눌 수 없어 추정한 레시피 (메뉴|변형이 같으면 덮어씀)
  recipes: [
    { menu: '유자차', variant: 'HOT', ingredients: [{ name: '유자청', qty: 45, unit: 'g' }, { name: '오렌지 가니쉬', qty: 1, unit: 'serving' }], assumed: true, basis: '청귤차와 같은 방식 (청 3스쿱 45g)' },
    { menu: '유자차', variant: 'ICE', ingredients: [{ name: '유자청', qty: 45, unit: 'g' }, { name: '오렌지 가니쉬', qty: 1, unit: 'serving' }], assumed: true, basis: '청귤차와 같은 방식 (청 3스쿱 45g)' },
    { menu: '대추차', variant: 'ICE', copyOf: 'HOT', assumed: true, basis: 'HOT 레시피와 같다고 봄' },
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
