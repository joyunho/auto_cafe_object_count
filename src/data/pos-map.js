// POS 상품명 ↔ 레시피 메뉴 ↔ 재고 품목 연결표
//
// PRODUCT_MAP : POS "그룹별 매출분석"의 상품명 → 레시피 메뉴·변형(ICE/HOT) 또는 옵션(모디파이어)
//   { menu, variant }          레시피에 있는 메뉴 한 잔 (레시피가 없으면 분석에서 "레시피 없음"으로 표시됨)
//   { espresso: n }            에스프레소 단품 (싱글 1샷, 더블 2샷) — 잔이면서 샷
//   { modifier: '...' }        옵션 (샷 추가, 헤이즐넛시럽, 디카페인 등) — 재료만 더하거나 원두를 바꿈
//   { item: itemId, qty: 1 }   병음료처럼 재고 품목을 그대로 1개 파는 것
//   { items: {id: 비중} }      한 POS 상품이 여러 재고 품목 중 하나일 때 (노아주스 4종) 비중대로 배분
//   null                       재료 소비와 무관한 옵션·호출 (Take out, 연하게, 얼음컵 …) — 잔 수만 보고서에 표시
//
// INGREDIENT_MAP : 레시피 재료명 → 재고 품목 id + 1포장당 그램/개수 (없는 것은 null)
//   perPackage : 재고 1단위(병·단지·박스)에 든 양. 레시피 단위(g/ml/ea/bag)와 같은 단위.
//   assumed    : 자료(레시피 SUPPLY 표)에 없어 추정한 값 → 확인 필요
//   density    : 레시피가 g, 포장이 ml일 때 환산용 (g/ml). 시럽·소스 1.3, 우유 1.03

export const PRODUCT_MAP = {
  // ── 커피 ──
  'ice아메리카노': { menu: '아메리카노', variant: 'ICE' },
  'hot아메리카노': { menu: '아메리카노', variant: 'HOT' },
  'ice디카페인아메리카노': { menu: '아메리카노', variant: 'ICE', decaf: true },
  'hot디카페인아메리카노': { menu: '아메리카노', variant: 'HOT', decaf: true },
  'hot카페라떼': { menu: '카페라떼', variant: 'HOT' },
  'ic카페라떼': { menu: '카페라떼', variant: 'ICE' },
  'ice바닐라라떼': { menu: '바닐라라떼', variant: 'ICE' },
  'hot바닐라라떼': { menu: '바닐라라떼', variant: 'HOT' },
  'hot카푸치노': { menu: '카푸치노', variant: 'HOT' },
  'ice카푸치노': { menu: '카푸치노', variant: 'ICE' },
  'ice카라멜마끼야또': { menu: '카라멜마끼아또', variant: 'ICE' },
  'hot카라멜마끼아또': { menu: '카라멜마끼아또', variant: 'HOT' },
  'ice연유라떼': { menu: '연유라떼', variant: 'ICE' },
  'hot연유라떼': { menu: '연유라떼', variant: 'HOT' },
  'hot카페모카': { menu: '카페모카', variant: 'HOT' },
  'ice카페모카': { menu: '카페모카', variant: 'ICE' },
  'ice크림 카페라떼': { menu: '크림 카페라떼', variant: 'ICE' },
  '에소프레소 싱글': { espresso: 1 }, // 단품 (POS 단가 4,500~5,000원) — 1샷
  '에소프레소 더블': { espresso: 2 }, // 단품 — 2샷
  '샷 추가': { modifier: 'shot', shots: 1 },
  '디카페인': { modifier: 'decaf' },
  '헤이즐넛시럽': { modifier: 'hazelnut' },
  '아포카토': { menu: '아포가토', variant: 'ICE' },
  // ── 옵션·호출 (재료 소비 없음) ──
  '연하게': null, 'Take out': null, '얼음컵': null, '빈컵': null, '정식메뉴': null,
  '덜 달게': null, '얼음없이': null, '얼음적게': null, '얼음많이': null, '휘핑없이': null,
  '뜨거운물': null, '물 적게': null, '물 많이': null,
  // ── 티 ──
  '대추차 only hot': { menu: '대추차', variant: 'HOT' },
  '대추차 hot': { menu: '대추차', variant: 'HOT' },
  '대추차 ice': { menu: '대추차', variant: 'HOT' },
  'hot로얄캐모마일': { menu: '티백 캐모마일', variant: 'HOT' },
  'ice로얄캐모마일': { menu: '티백 캐모마일', variant: 'ICE' },
  'hot레몬생강': { menu: '레몬생강차', variant: 'HOT' },
  'ice레몬생강': { menu: '레몬생강차', variant: 'ICE' },
  '아이스티': { menu: '아이스티', variant: 'ICE' },
  'hot생강차': { menu: '생강차', variant: 'HOT' },
  'ice생강차': { menu: '생강차', variant: 'ICE' },
  '배도라지차': { menu: '배도라지차', variant: 'HOT' },
  '레몬차': { menu: '레몬차', variant: 'HOT' },
  '자몽차': { menu: '자몽차', variant: 'HOT' },
  'hot청귤차': { menu: '청귤차', variant: 'HOT' },
  'ice청귤차': { menu: '청귤차', variant: 'ICE' },
  'hot애플유자': { menu: '애플유자', variant: 'HOT' },
  'ice애플유자': { menu: '애플유자', variant: 'ICE' },
  'hot유자차': { menu: '유자차', variant: 'HOT' },
  'ice유자차': { menu: '유자차', variant: 'ICE' },
  'hot루이보스빌베리': { menu: '티백 루이보스', variant: 'HOT' },
  'ice루이보스빌베리': { menu: '티백 루이보스', variant: 'ICE' },
  'hot파인애플우롱': { menu: '티백 파인우롱', variant: 'HOT' },
  'ice파인애플우롱': { menu: '티백 파인우롱', variant: 'ICE' },
  'hot작설녹차': { menu: '티백 작설녹차', variant: 'HOT' },
  'ice작설녹차': { menu: '티백 작설녹차', variant: 'ICE' },
  // 레시피에 없는 메뉴 — 잔 수는 세고 재료는 "레시피 없음"으로 보고서에 표시
  '설국차': { menu: '설국차', variant: 'HOT' }, 'hot설국차': { menu: '설국차', variant: 'HOT' }, 'ice설국차': { menu: '설국차', variant: 'ICE' },
  'hot애플피치': { menu: '애플피치', variant: 'HOT' }, 'ice애플피치': { menu: '애플피치', variant: 'ICE' }, 'hot레몬블랙티': { menu: '레몬블랙티', variant: 'HOT' },
  // ── 에이드 ──
  'ice자몽에이드': { menu: '자몽에이드', variant: 'ICE' },
  'ice레몬에이드': { menu: '레몬에이드', variant: 'ICE' },
  'ice청포도에이드': { menu: '청포도에이드', variant: 'ICE' },
  'ice청귤에이드': { menu: '청귤에이드', variant: 'ICE' },
  // ── 라떼(논커피) ──
  '딸기라떼': { menu: '딸기라떼', variant: 'ICE' },
  '디카페인콜드브루': { menu: '디카페인 콜드브루', variant: 'ICE' },
  '블루베리라떼': { menu: '블루베리라떼', variant: 'ICE' },
  '옛날미숫가루': { menu: '옛날미숫가루', variant: 'ICE' },
  'ice초코라떼': { menu: '초코라떼', variant: 'ICE' },
  'hot초코라떼': { menu: '초코라떼', variant: 'HOT' },
  '미숫가루라떼': { menu: '미숫가루라떼', variant: 'ICE' },
  'ice그린티라떼': { menu: '그린티라떼', variant: 'ICE' },
  'hot그린티라떼': { menu: '그린티라떼', variant: 'HOT' },
  'hot우유': { menu: '우유', variant: 'HOT' },
  'ice우유': { menu: '우유', variant: 'ICE' },
  'ice얼그레이밀크티': { menu: '얼그레이밀크티', variant: 'ICE' },
  'hot얼그레이밀크티': { menu: '얼그레이밀크티', variant: 'HOT' },
  'hot생강라떼': { menu: '생강라떼', variant: 'HOT' },
  'ice생강라떼': { menu: '생강라떼', variant: 'ICE' },
  '바닐라크림 콜드브루': { menu: '바닐라 크림 콜드브루', variant: 'ICE' },
  'ice바닐라크림 콜드브루': { menu: '바닐라 크림 콜드브루', variant: 'ICE' },
  'ice그린티 크림라떼': { menu: '그린티 크림라떼', variant: 'ICE' },
  'ice얼그레이 크림라떼': { menu: '얼그레이 크림라떼', variant: 'ICE' },
  // ── 주스/병음료 ──
  '키위주스': { menu: '키위주스', variant: 'ICE' },
  '토마토주스': { menu: '토마토주스', variant: 'ICE' },
  '포도주스': { item: 'grape-juice', qty: 1 },
  '노아주스': { items: { 'noa-orange': 0.25, 'noa-carrot': 0.25, 'noa-mango': 0.25, 'noa-kiwi': 0.25 }, assumed: true }, // POS에 종류가 없어 4종 균등 배분
  '어린이 사과주스': { item: 'sweet-apple', qty: 1, assumed: true },
  '골드메달사과주스': { item: 'golden-apple-juice', qty: 1 },
  '에비앙': { item: 'evian', qty: 1 },
  // ── 브런치/밀키트 (레시피 없음 — 1인분 판매 수만 집계) ──
  '브런치 1인': { brunch: 1 },
  '브런치어린이': { brunch: 0.5, assumed: true },
  '라면': { ramen: 1 },
};

/** 재료 소비와 무관한 상품(옵션·호출벨·빵·디저트 등)은 그룹으로 걸러낸다 */
export const IGNORED_GROUPS = ['빵', '디저트', '쇼케이스', '진동벨'];

/** 옵션 처리 규칙 */
export const MODIFIERS = {
  shot: { ingredient: '에스프레소샷', qtyPerShot: 1, unit: 'shot' },
  hazelnut: { ingredient: '헤이즐넛시럽', qty: 15, unit: 'g', assumed: true }, // 1펌프 15g로 가정
};

/** 에스프레소 1샷(40ml)에 드는 원두 양 — 확인 필요 */
export const BEANS_G_PER_SHOT = { value: 18, assumed: true };

export const INGREDIENT_MAP = {
  // 커피·우유
  '에스프레소샷': { item: 'beans', perShotG: 18, perPackage: 1000, unit: 'g', assumed: true, note: '1샷 18g·1봉 1kg 가정, 디카페인 합산' },
  '우유': { item: 'milk', perPackage: 1000, unit: 'ml', density: 1.03, note: '매일우유 1L' },
  '스팀우유': { item: 'milk', perPackage: 1000, unit: 'ml', density: 1.03, note: '매일우유 1L' },
  '크림우유': { item: 'milk', perPackage: 1000, unit: 'ml', density: 1.03, milkShare: 0.6, note: '우유 3 : 휘핑 2 → 우유 60%' },
  '연유': { item: 'condensed-milk', perPackage: 500, unit: 'g', note: '매일 연유 500g' },
  // 시럽·소스 (레시피 g, 포장 ml → 밀도 1.3 가정)
  '바닐라시럽': { item: 'vanilla-syrup', perPackage: 1000, unit: 'ml', density: 1.3, assumed: true, note: '모닌 1L' },
  '초코소스': { item: 'choco-sauce', perPackage: 2600, unit: 'g', note: '다빈치 2L(2.6kg)' },
  '카라멜소스': { item: 'caramel-sauce', perPackage: 1890, unit: 'ml', density: 1.3, assumed: true, note: '토라니 1.89L' },
  '카라멜시럽': { item: 'caramel-syrup', perPackage: 750, unit: 'ml', density: 1.3, assumed: true, note: '토라니 750ml' },
  '설탕시럽': { item: 'cafe-syrup', perPackage: 1500, unit: 'ml', density: 1.3, assumed: true, note: '그린스위트 카페시럽 1.5L' },
  '헤이즐넛시럽': { item: 'hazelnut-syrup', perPackage: 1000, unit: 'ml', density: 1.3, assumed: true, note: '1L 병 가정' },
  // 청·베이스
  '유자청': { item: 'yuja-cheong', perPackage: 2200, unit: 'g', note: '제주유자차 2.2kg' },
  '청귤청': { item: 'cheonggyul-cheong', perPackage: 2200, unit: 'g', note: '제주청귤청 2.2kg' },
  '딸기청': { item: 'strawberry-cheong', perPackage: 2000, unit: 'g', assumed: true, note: '2kg 가정' },
  '블루베리청': { item: 'blueberry-cheong', perPackage: 2000, unit: 'g', assumed: true, note: '2kg 가정' },
  '레몬청': { item: 'lemon-syrup', perPackage: 2000, unit: 'g', note: '쏘스윗업 레몬 시럽 2kg' },
  '자몽청': { item: 'grapefruit', perPackage: 2000, unit: 'g', note: '쏘스윗업 자몽 시럽 2kg' },
  '청포도청': { item: 'green-grape', perPackage: 2000, unit: 'g', note: '쏘스윗업 청포도 시럽 2kg' },
  '아이스티': { item: 'ice-tea', perPackage: 2000, unit: 'g', note: '복숭아 아이스티 시럽 2kg (1box=6)' },
  '키위시럽': { item: 'kiwi-sauce', perPackage: 2000, unit: 'g', note: '포모나 키위 스무디 2kg' },
  '배도라지청': { item: 'pear-bellflower-tea', perPackage: 470, unit: 'g', assumed: true, note: '470g 병 — 1박스 병 수 확인' },
  '그린티': { item: 'boseong-green-tea', perPackage: 1000, unit: 'ml', density: 1.3, assumed: true, note: '보성녹차 베이스 1L' },
  '얼그레이': { item: 'earl-grey', perPackage: 1200, unit: 'g', note: '얼그레이 밀크티 베이스 1.2kg' },
  '콜드브루': { item: 'decaf-coldbrew', perPackage: 1000, unit: 'g', assumed: true, note: '디카페인 콜드브루 1kg 가정' },
  '미숫가루': { item: 'misugaru', perPackage: 1000, unit: 'g', assumed: true, note: '1kg 가정' },
  '시나몬가루': { item: 'cinnamon-powder', perPackage: 500, unit: 'g', note: '계피가루 500g' },
  // 티백 (1잔 = 1봉)
  '애플유자티': { item: 'apple-tea', perPackage: 25, unit: 'bag', note: '아일레스 애플티 25T' },
  '티백 캐모마일': { item: 'chamomile', perPackage: 20, unit: 'bag', note: '20T' },
  '티백 루이보스': { item: 'rooibos', perPackage: 30, unit: 'bag', note: '30T' },
  '티백 파인우롱': { item: 'pine-oolong', perPackage: 20, unit: 'bag', note: '20T' },
  '티백 작설녹차': { item: 'jakseol-green-tea', perPackage: 30, unit: 'bag', note: '30T' },
  // 가니쉬·원물
  '오렌지 가니쉬': { item: 'orange-garnish', perPackage: null, unit: 'ea', note: '1포장 개수 확인 필요' },
  '레몬 가니쉬': { item: 'lemon-juice', perPackage: null, unit: 'ea', assumed: true, note: '건조레몬 100g봉(레시피 구매표)으로 추정 — 품목·1봉 조각 수 확인' },
  '대추 가니쉬': { item: 'jujube', perPackage: null, unit: 'ea', note: '1포장 개수 확인 필요' },
  '대추': { item: 'jujube', perPackage: null, unit: 'ea', note: '1포장 개수 확인 필요' },
  '잣': { item: 'pine-nut', perPackage: null, unit: 'ea', note: '1포장 개수 확인 필요' },
  '아이스크림': { item: 'ice-cream', perPackage: null, unit: 'ea', note: '1통 스쿱 수 확인 필요' },
  '탄산수': { item: 'sparkling-water', perPackage: null, unit: 'ml', assumed: true, note: '병 용량·발주 단위 확인 필요 (500ml 병이면 하루 7병)' },
  '토마토': { item: 'tomato', perPackage: null, unit: 'g', note: '1박스 무게 확인 필요' },
  '키위': { item: 'kiwi', perPackage: null, unit: 'ea', note: '1박스 개수 확인 필요' },
  // 씨앤비 시트에 없는 재료 (다른 거래처)
  '생강청': { item: null, note: '시트에 없음' },
  '레몬생강청': { item: null, note: '시트에 없음' },
  '대추원액': { item: null, note: '시트에 없음' },
  '휘핑': { item: null, note: '시트에 없음' },
  '휘핑크림': { item: null, note: '시트에 없음' },
  '물': null, '뜨거운물': null, '얼음': null, '우유거품': null, '초코드리즐': null, '아몬드슬라이스': null, '설탕': null, '시럽': null,
};
