// POS 상품명 ↔ 레시피 메뉴 ↔ 재고 품목 연결표
//
// PRODUCT_MAP : POS "그룹별 매출분석"의 상품명 → 레시피 메뉴·변형(ICE/HOT) 또는 옵션(모디파이어)
//   { menu, variant }          레시피에 있는 메뉴 한 잔 (정확히 같은 메뉴·변형의 레시피가 없으면 "레시피 없음"으로 표시, 대체하지 않음)
//   { espresso: n }            에스프레소 단품 (싱글 1샷, 더블 2샷) — 잔이면서 샷
//   { modifier: '...' }        옵션 (샷 추가, 헤이즐넛시럽, 디카페인 등) — 재료만 더하거나 원두를 바꿈
//   { item: itemId, qty: 1 }   병음료처럼 재고 품목을 그대로 1개 파는 것
//   { items: {id: 비중} }      한 POS 상품이 여러 재고 품목 중 하나일 때 비중대로 배분 (비중을 알 때만)
//   { unknown: '이유' }        어느 품목인지 알 수 없어 비워 둔 것 — 잔 수와 이유만 보고서에 표시
//   null                       재료 소비와 무관한 옵션·호출 (Take out, 연하게, 얼음컵 …) — 잔 수만 보고서에 표시
//
// 원칙: 자료(레시피·구매표·시트)에 없는 값은 가정하지 않는다. 모르는 포장 크기는 perPackage: null 로 비워 두고
//       원재료 양만 집계하며, 확인되면 값을 채우고 분석을 다시 돌린다.
//
// INGREDIENT_MAP : 레시피 재료명 → 재고 품목 id + 1포장당 그램/개수 (모르면 perPackage: null)
//   perPackage : 재고 1단위(병·단지·박스)에 든 양. 레시피 단위(g/ml/ea/bag/shot/pump/serving)와 같은 단위.
//   density    : 레시피가 g, 포장이 ml일 때 환산용 (g/ml). 확인된 값이 있을 때만 넣는다.

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
  '에소프레소 싱글': { espresso: 1 }, // 단품 — 1샷으로 봄 (확인 목록)
  '에소프레소 더블': { espresso: 2 }, // 단품 — 2샷으로 봄 (확인 목록)
  '샷 추가': { modifier: 'shot', shots: 1 },
  '디카페인': { modifier: 'decaf' },
  '헤이즐넛시럽': { modifier: 'hazelnut' },
  '아포카토': { menu: '아포가토', variant: 'ICE' },
  // ── 옵션·호출 (재료 소비 없음) ──
  '연하게': null, 'Take out': null, '얼음컵': null, '빈컵': null,
  '정식메뉴': { unknown: '유료 상품인데 무엇인지 확인 전' },
  '덜 달게': null, '얼음없이': null, '얼음적게': null, '얼음많이': null, '휘핑없이': null,
  '뜨거운물': null, '물 적게': null, '물 많이': null,
  // ── 티 ──
  '대추차 only hot': { menu: '대추차', variant: 'HOT' },
  '대추차 hot': { menu: '대추차', variant: 'HOT' },
  '대추차 ice': { menu: '대추차', variant: 'ICE' }, // ICE 레시피가 없어 "레시피 없음"으로 남음
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
  '포도주스': { unknown: '착즙포도주스를 병째 파는지, 1병으로 몇 잔인지 확인 전' },
  '노아주스': { unknown: '노아 4종(오렌지·당근·망고·키위) 중 무엇인지 POS에 없음' },
  '어린이 사과주스': { unknown: '시트의 어느 품목인지 확인 전' },
  '골드메달사과주스': { item: 'golden-apple-juice', qty: 1 },
  '에비앙': { item: 'evian', qty: 1 },
  // ── 브런치/밀키트 (레시피 없음 — 1인분 판매 수만 집계) ──
  '브런치 1인': { brunch: 1 },
  '브런치어린이': { brunchKids: 1 }, // 몇 인분인지 몰라 따로 집계
  '라면': { ramen: 1 },
};

/** 재료 소비와 무관한 상품(옵션·호출벨·빵·디저트 등)은 그룹으로 걸러낸다 */
export const IGNORED_GROUPS = ['빵', '디저트', '쇼케이스', '진동벨'];

/** 옵션 처리 규칙 */
export const MODIFIERS = {
  shot: { ingredient: '에스프레소샷', qtyPerShot: 1, unit: 'shot' },
  hazelnut: { ingredient: '헤이즐넛시럽', qty: 1, unit: 'ea' }, // 옵션 건수만 집계 (건당 펌프 수·1펌프 ml·병 용량 확인 전)
};

export const INGREDIENT_MAP = {
  // 커피·우유
  '에스프레소샷': { item: 'beans', perShotG: null, perPackage: null, unit: 'shot', note: '1샷 원두 g·1봉 무게 확인 전 — 샷 수만 집계' },
  '우유': { item: 'milk', perPackage: 1000, unit: 'ml', note: '매일우유 1L' },
  '스팀우유': { item: 'milk', perPackage: 1000, unit: 'ml', note: '매일우유 1L' },
  '크림우유': { item: null, note: '크림우유(우유+휘핑) 1잔의 우유 ml 확인 전 — 우유 소비에 미포함' },
  '우유거품': { item: null, note: '거품용 우유 ml 확인 전 — 우유 소비에 미포함' },
  '연유': { item: 'condensed-milk', perPackage: 500, unit: 'g', note: '매일 연유 500g' },
  // 시럽·소스 — 레시피는 g, 병은 ml 표기라 병당 g(또는 1펌프 ml)을 알아야 낱개로 바꿀 수 있음
  '바닐라시럽': { item: 'vanilla-syrup', perPackage: null, unit: 'g', note: '모닌 1L 병 = 몇 g인지 확인 전' },
  '초코소스': { item: 'choco-sauce', perPackage: 2600, unit: 'g', note: '다빈치 2L(2.6kg)' },
  '카라멜소스': { item: 'caramel-sauce', perPackage: null, unit: 'g', note: '토라니 1.89L 병 = 몇 g인지 확인 전' },
  '카라멜시럽': { item: 'caramel-syrup', perPackage: null, unit: 'g', note: '토라니 750ml 병 = 몇 g인지 확인 전' },
  '설탕시럽': { item: 'cafe-syrup', perPackage: null, unit: 'g', note: '카페시럽 1.5L 병 = 몇 g인지 확인 전' },
  '헤이즐넛시럽': { item: 'hazelnut-syrup', perPackage: null, unit: 'ea', note: '옵션 건당 펌프 수·1펌프 ml·병 용량 확인 전 — 옵션 건수만' },
  '초코드리즐': { item: null, note: '아포가토 드리즐이 초코소스인지 카라멜소스인지·양 확인 전' },
  // 청·베이스
  '유자청': { item: 'yuja-cheong', perPackage: 2200, unit: 'g', note: '제주유자차 2.2kg' },
  '청귤청': { item: 'cheonggyul-cheong', perPackage: 2200, unit: 'g', note: '제주청귤청 2.2kg' },
  '딸기청': { item: 'strawberry-cheong', perPackage: null, unit: 'g', note: '1단지 무게 확인 전' },
  '블루베리청': { item: 'blueberry-cheong', perPackage: null, unit: 'g', note: '1단지 무게 확인 전' },
  '레몬청': { item: 'lemon-syrup', perPackage: 2000, unit: 'g', note: '쏘스윗업 레몬 시럽 2kg (구매표에 ◇확인 표시)' },
  '자몽청': { item: 'grapefruit', perPackage: 2000, unit: 'g', note: '쏘스윗업 자몽 시럽 2kg (구매표에 ◇확인 표시)' },
  '청포도청': { item: 'green-grape', perPackage: 2000, unit: 'g', note: '쏘스윗업 청포도 시럽 2kg (구매표에 ◇확인 표시)' },
  '아이스티': { item: 'ice-tea', perPackage: 2000, unit: 'g', note: '복숭아 아이스티 시럽 2kg (1box=6)' },
  '키위시럽': { item: 'kiwi-sauce', perPackage: 2000, unit: 'g', note: '포모나 키위 스무디 2kg' },
  '배도라지청': { item: 'pear-bellflower-tea', perPackage: null, unit: 'g', note: '470g 병(구매표에 ◇확인 표시)·1박스 병 수 확인 전' },
  '그린티': { item: 'boseong-green-tea', perPackage: null, unit: 'g', note: '보성녹차 베이스 1L 병 = 몇 g인지 확인 전' },
  '얼그레이': { item: 'earl-grey', perPackage: 1200, unit: 'g', note: '얼그레이 밀크티 베이스 1.2kg' },
  '디카페인 콜드브루': { item: 'decaf-coldbrew', perPackage: null, unit: 'g', note: '1봉 무게 확인 전' },
  '콜드브루': { item: null, note: '바닐라 크림 콜드브루의 콜드브루가 디카페인 제품인지 확인 전' },
  '미숫가루': { item: 'misugaru', perPackage: null, unit: 'g', note: '1봉 무게 확인 전' },
  '미숫가루 베이스': { item: null, note: '옛미 베이스 1배합에서 몇 잔 나오는지·시럽 종류 확인 전 — 원재료로 나누지 않음' },
  '시나몬가루': { item: 'cinnamon-powder', perPackage: null, unit: 'serving', note: '1잔 사용량(g) 확인 전 — 잔 수만 집계 (1봉 500g)' },
  // 티백 — 1잔에 몇 봉인지 레시피에 없어 잔 수만 집계 (포장: 애플티 25T, 캐모마일 20T, 루이보스 30T, 파인우롱 20T, 작설녹차 30T)
  '애플유자티': { item: 'apple-tea', perPackage: null, unit: 'serving', note: '1잔 티백 봉 수 확인 전 (아일레스 애플티 25T)' },
  '티백 캐모마일': { item: 'chamomile', perPackage: null, unit: 'serving', note: '1잔 티백 봉 수 확인 전 (20T)' },
  '티백 루이보스': { item: 'rooibos', perPackage: null, unit: 'serving', note: '1잔 티백 봉 수 확인 전 (30T)' },
  '티백 파인우롱': { item: 'pine-oolong', perPackage: null, unit: 'serving', note: '1잔 티백 봉 수 확인 전 (20T)' },
  '티백 작설녹차': { item: 'jakseol-green-tea', perPackage: null, unit: 'serving', note: '1잔 티백 봉 수 확인 전 (30T)' },
  // 가니쉬·원물 — 1포장 개수·무게 확인 전
  '오렌지 가니쉬': { item: 'orange-garnish', perPackage: null, unit: 'serving', note: '1잔 조각 수·1포장 조각 수 확인 전 — 잔 수만' },
  '가니쉬': { item: null, note: '레시피에 종류 없이 "가니쉬"로만 적힘 — 어떤 가니쉬인지 확인 전' },
  '레몬 가니쉬': { item: null, note: '시트의 어느 품목(레몬 2종)인지·1봉 조각 수 확인 전' },
  '대추 가니쉬': { item: null, note: '1잔에 대추 몇 개인지 확인 전 (대추차의 "대추 5개"만 집계)' },
  '대추': { item: 'jujube', perPackage: null, unit: 'ea', note: '1포장 개수 확인 전' },
  '잣': { item: 'pine-nut', perPackage: null, unit: 'ea', note: '1포장 개수(무게) 확인 전' },
  '잣(미표기)': { item: null, note: '배도라지차 1잔 잣 개수 확인 전 (대추차의 "잣 6개"만 집계)' },
  '아이스크림': { item: 'ice-cream', perPackage: null, unit: 'serving', note: '1잔 스쿱 수·1통 스쿱 수 확인 전 — 잔 수만' },
  '탄산수': { item: 'sparkling-water', perPackage: null, unit: 'ml', note: '병 용량·발주 단위 확인 전' },
  '토마토': { item: 'tomato', perPackage: null, unit: 'g', note: '1박스 무게 확인 전' },
  '키위': { item: 'kiwi', perPackage: null, unit: 'g', note: '1박스 무게(또는 개수와 1개 g) 확인 전' },
  // 씨앤비 시트에 없는 재료 (다른 거래처)
  '생강청': { item: null, note: '시트에 없음' },
  '레몬생강청': { item: null, note: '시트에 없음' },
  '대추원액': { item: null, note: '시트에 없음' },
  '휘핑': { item: null, note: '시트에 없음' },
  '휘핑크림': { item: null, note: '시트에 없음' },
  '아몬드슬라이스': { item: null, note: '시트에 없음' },
  '물': null, '뜨거운물': null, '얼음': null, '설탕': null, '시럽': null,
};
