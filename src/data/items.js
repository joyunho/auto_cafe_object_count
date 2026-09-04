// 씨앤비 재고조사 시트 3장(월요일·목요일 발주)을 옮긴 기본 품목 데이터.
//
// 필드 설명은 src/logic/order.js 상단 참고.
//   par       : 시트의 빨간 인쇄 숫자(기준 수량). 흰 스티커로 덮어 쓴 값이 있으면 스티커 값.
//   boxSize   : "(1box>6)" 표기 → 6
//   rule      : 시트 각주 "* 유자, 청귤 최소발주 6○○ / 3개 미만일 때 1 BOX씩" → 재발주점 규칙
//   note      : 원본 시트와 다르게 옮긴 부분 등 메모
//
// ※ 시트 1의 "레몬"(주스 칸)과 시트 2의 "레몬"(시럽 칸)은 이름이 같아 구분을 위해
//    "레몬(주스)" / "레몬(시럽)"으로 등록했습니다. 실제 품목이 다르면 품목 탭에서 이름을 고치세요.
//    (두 품목에 같은 별칭 "레몬"을 주면 사진 인식 결과를 어느 쪽에도 배정할 수 없어 별칭은 두지 않았습니다.)
// ※ 그룹은 시트에 없는 앱의 분류입니다. 시트 칸 순서와 조금 다를 수 있습니다.

export const SEED_GROUPS = [
  { id: 'cheong', title: '과일청 · 아이스크림', sheet: 1 },
  { id: 'juice', title: '주스 · 생수', sheet: 1 },
  { id: 'coffee', title: '원두 · 우유', sheet: 2 },
  { id: 'syrup', title: '탄산 · 시럽 · 소스', sheet: 2 },
  { id: 'tea', title: '티(차)', sheet: 2 },
  { id: 'topping', title: '토핑 · 기타', sheet: 2 },
  { id: 'brunch', title: '브런치', sheet: 3 },
  { id: 'ramen', title: '라면', sheet: 3 },
];

const base = {
  parUnit: 'ea',
  boxSize: null,
  orderUnit: 'ea',
  countUnit: 'ea',
  rule: null,
  minOrder: null,
  aliases: [],
  active: true,
  note: '',
};

const item = (id, name, group, par, extra = {}) => ({ ...base, id, name, group, par, ...extra });

// 유자청/청귤청: 시트 각주 "* 유자, 청귤 최소발주 6○○ / 3개 미만일 때 1 BOX씩 시켜주십니다."
//   → 1박스 = 6개(단지)로 보고, 3개 미만이면 1박스씩 발주하는 규칙으로 옮겼습니다.
//   각주 사진이 흐려 "6" 뒤 단위는 확실하지 않습니다. 다르면 품목 탭에서 고치세요.
const cheongRule = {
  boxSize: 6,
  orderUnit: 'box',
  minOrder: 1,
  rule: { type: 'reorderPoint', threshold: 3, orderQty: 1 },
  note: '각주: 최소발주 6(단위는 시트 확인) / 3개 미만일 때 1박스씩',
};

export const SEED_ITEMS = [
  // ── 시트 1: 청 · 아이스크림 ─────────────────────────────
  item('yuja-cheong', '유자청', 'cheong', 8, cheongRule),
  item('cheonggyul-cheong', '청귤청', 'cheong', 8, cheongRule),
  item('strawberry-cheong', '딸기청', 'cheong', 8),
  item('blueberry-cheong', '블루베리청', 'cheong', 6),
  item('ice-cream', '아이스크림', 'cheong', 3),

  // ── 시트 1: 주스 · 생수 ─────────────────────────────────
  item('grape-juice', '착즙포도주스', 'juice', 10),
  item('kiwi', '키위', 'juice', 1),
  item('tomato', '토마토', 'juice', 1),
  item('lemon-juice', '레몬(주스)', 'juice', 1, { note: '원본 시트 표기: 레몬 (시트 1 주스 칸)' }),
  item('noa-orange', '노아(오렌지)', 'juice', 1),
  item('noa-carrot', '노아(당근)', 'juice', 1),
  item('noa-mango', '노아(망고)', 'juice', 1),
  item('noa-kiwi', '노아(키위)', 'juice', 1),
  item('golden-apple-juice', '골든메달사과주스', 'juice', 1),
  item('evian', '에비앙', 'juice', 1),
  item('sweet-apple', '달콤사과', 'juice', 2),

  // ── 시트 2: 원두 · 우유 ─────────────────────────────────
  item('beans', '원두 / 디카페인 원두', 'coffee', null, { aliases: ['원두', '디카페인 원두'] }),
  item('milk', '우유 / 요거트바이오', 'coffee', null, { aliases: ['우유', '요거트바이오'] }),
  item('condensed-milk', '연유', 'coffee', null),
  item('decaf-coldbrew', '디카페인콜드브루', 'coffee', 8),

  // ── 시트 2: 탄산 · 시럽 · 소스 ──────────────────────────
  item('sparkling-water', '탄산수', 'syrup', 8),
  item('vanilla-syrup', '바닐라시럽(1box>6)', 'syrup', 8, { boxSize: 6, orderUnit: 'box', aliases: ['바닐라시럽'] }),
  item('grapefruit', '자몽', 'syrup', 6),
  item('lemon-syrup', '레몬(시럽)', 'syrup', 6, { note: '원본 시트 표기: 레몬 (시트 2 시럽 칸)' }),
  item('green-grape', '청포도', 'syrup', 6),
  item('cafe-syrup', '카페시럽(1box>6)', 'syrup', 8, { boxSize: 6, orderUnit: 'box', aliases: ['카페시럽'] }),
  item('hazelnut-syrup', '헤이즐넛 시럽', 'syrup', 3),
  item('caramel-sauce', '카라멜소스', 'syrup', 4),
  item('caramel-syrup', '카라멜시럽', 'syrup', 4),
  item('choco-sauce', '초코소스', 'syrup', 5),
  item('kiwi-sauce', '키위소스', 'syrup', 4),

  // ── 시트 2: 티 ──────────────────────────────────────────
  item('boseong-green-tea', '보성그린티', 'tea', 5),
  item('earl-grey', '얼그레이', 'tea', 6),
  item('pear-bellflower-tea', '배도라지차', 'tea', 2, { parUnit: 'box', orderUnit: 'box', countUnit: 'box', note: '기준 2BOX — 박스 단위로 세기' }),
  item('rooibos', '루이보스', 'tea', 4),
  item('jakseol-green-tea', '작설녹차', 'tea', 4),
  item('chamomile', '캐모마일', 'tea', 6),
  item('pine-oolong', '파인우롱', 'tea', 4),
  item('ice-tea', '아이스티(1box>6)', 'tea', 6, { boxSize: 6, orderUnit: 'box', aliases: ['아이스티'] }),
  item('apple-tea', '애플티', 'tea', 3),

  // ── 시트 2: 토핑 · 기타 ─────────────────────────────────
  item('sugar-cube', '각설탕', 'topping', 2),
  item('cinnamon-powder', '시나몬가루', 'topping', 2),
  item('orange-garnish', '오렌지가니쉬', 'topping', 4),
  item('jujube', '대추', 'topping', 1),
  item('pine-nut', '잣', 'topping', 1),
  item('misugaru', '미숫가루(지하)', 'topping', null, { aliases: ['미숫가루'] }),

  // ── 시트 3: 브런치 ──────────────────────────────────────
  item('mango-pudding', '망고푸딩', 'brunch', 4),
  item('apple-pudding', '사과푸딩', 'brunch', 4),
  item('smoked-ham', '스모크햄', 'brunch', 2),
  item('corn-salad', '콘샐러드', 'brunch', 5),
  item('egg-salad', '에그샐러드', 'brunch', 5),
  item('potato-salad', '감자샐러드', 'brunch', 5),
  item('salsa-salad', '살사후실리샐러드', 'brunch', 5),
  item('cheddar-slice', '체다치즈슬라이스', 'brunch', 2),
  item('cereal', '시리얼', 'brunch', 2),
  item('kiwi-dressing', '키위드레싱', 'brunch', 2, { aliases: ['유자드레싱'], note: '시트에 "유자드레싱"으로 고쳐 쓴 흔적 있음' }),
  item('butane-gas', '부탄가스', 'brunch', 4),
  item('cooking-oil', '식용유', 'brunch', 2),
  item('cabbage', '양배추', 'brunch', 2),
  item('strawberry-jam', '딸기잼', 'brunch', 2),
  item('butter-portion', '일회용 버터', 'brunch', 2),
  item('carrot', '당근', 'brunch', 2),
  item('danmuji', '단무지', 'brunch', null, { note: '손글씨로 추가된 품목' }),

  // ── 시트 3: 라면 ────────────────────────────────────────
  item('cup-ramen', '컵라면', 'ramen', 4, { active: false, note: '시트에서 줄을 그어 지운 품목' }),
  item('shin-ramyun', '신라면', 'ramen', null, { note: '손글씨로 추가된 품목' }),
  item('jin-ramyun', '진라면', 'ramen', null, { note: '손글씨로 추가된 품목' }),
  item('neoguri', '너구리', 'ramen', null, { note: '손글씨로 추가된 품목' }),
  item('samyang-ramyun', '삼양라면', 'ramen', null, { note: '손글씨로 추가된 품목' }),
  item('chapagetti', '짜파게티', 'ramen', null, { note: '손글씨로 추가된 품목' }),
];

export const SEED_SETTINGS = {
  storeName: '',
  senderName: '',
  supplierName: '씨앤비',
  orderTitle: '씨앤비 발주',
  orderDays: [1, 4], // 월, 목
  apiKey: '',
  photoMode: 'sheet',
};
