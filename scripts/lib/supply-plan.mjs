// 자재(소모품) 43품목 자동화 갈래표 — "이 물건이 나가는 속도를 무엇이 알려 주는가"
//
// tier 'pos'  : POS 판매 자료가 나간 양을 알려 준다 → 처음 한 번만 세면 그 뒤로는 안 세도 된다.
// tier 'ask'  : POS가 모른다 → 사장님이 "주당 몇 개"를 한 번 적어 주시면 그날부터 자동.
//               적어 주시지 않으면 재고조사 3~4주치로 앱이 스스로 배운다(그동안만 세면 된다).
//
// driver : 비례하는 POS 수치. perDriver 는 "드라이버 1건당 몇 개" — 아직 모르면 null 로 두고 ask 에 질문을 남긴다.
// 원칙은 제품 쪽(src/data/pos-map.js)과 같다: 모르는 값은 가정하지 않고 비워 두고 확인 목록에 올린다.

/** POS 12개월(2025-08~2026-07) 집계에서 나온 드라이버 값 — data/analysis.json 기준 */
export const DRIVERS = {
  ice: { label: 'ICE 잔 수', year: 78757 },
  hot: { label: 'HOT 잔 수', year: 77154 },
  iceCup: { label: 'ICE 중 일회용컵', year: 39379, note: '머그·유리컵 반반(사장님 확인)' },
  hotCup: { label: 'HOT 중 일회용컵', year: 38577, note: '머그·유리컵 반반(사장님 확인)' },
  ade: { label: '에이드 잔 수', year: 6835 },
  orders: { label: '주문 건수(진동벨 번호)', year: 57418 },
  bread: { label: '빵 건수', year: 102543 },
  loaf: { label: '식빵·콩식빵류', year: 3431 },
  tart: { label: '타르트류', year: 3469 },
  cakeSlice: { label: '조각케이크류', year: 1284 },
  cakeWhole: { label: '생크림·보틀케이크류', year: 2333 },
  dessert: { label: '디저트 건수', year: 24590 },
  showcase: { label: '쇼케이스 건수', year: 5513 },
  ramen: { label: '라면 그릇', year: 530 },
  brunch: { label: '브런치 인분', year: 2982 },
  jujube: { label: '대추차 잔 수', year: 4774 },
};

const pos = (id, driver, perDriver, ask = '') => ({ id, tier: 'pos', driver, perDriver, ask });
const ask = (id, hint, why = '') => ({ id, tier: 'ask', hint, why });

/** 43품목 전부. id 는 src/data/supplies.js 의 품목 id */
export const SUPPLY_PLAN = [
  // ── POS 가 나간 양을 알려 주는 것 ──────────────────────────────────────
  pos('ice-cup', 'iceCup', 1, '아이스컵과 아이스뚜껑을 1:1로 봐도 되나요? (시트에 한 칸으로 묶여 있어 우선 같이 셉니다)'),
  pos('hot-cup', 'hotCup', 1),
  pos('hot-lid', 'hotCup', null, '핫뚜껑은 테이크아웃에만 씌우시나요, 홀 일회용에도 씌우시나요? (일회용 핫 1잔당 __개)'),
  pos('cup-holder', 'hotCup', null, '컵홀더는 일회용 핫 1잔당 __개인가요? 아이스에도 쓰시나요?'),
  pos('cup-carrier', 'orders', null, '캐리어는 몇 잔 이상 나갈 때 쓰시나요? 하루에 대략 몇 개 쓰시는지만 알려 주셔도 됩니다'),
  pos('ade-straw', 'ade', null, '에이드빨대는 에이드에만 쓰시나요? 에이드 1잔당 1개 맞나요?'),
  pos('straw', 'ice', null, '일반빨대는 머그·유리컵으로 나가는 아이스 음료에도 주시나요? (주시면 ICE 잔 수 전부, 아니면 일회용컵만)'),
  pos('black-straw', 'ice', null, '검정빨대는 어느 메뉴에 쓰시나요? (일반빨대와 어떻게 갈리는지)'),
  pos('ramen-container', 'ramen', 1),
  pos('chopsticks', 'ramen', null, '나무젓가락은 라면에만 나가나요, 브런치·디저트에도 나가나요?'),
  pos('jujube-tea-togo', 'jujube', null, '대추차 테이크아웃 용기는 대추차 중 몇 %쯤 나가나요?'),
  pos('napkin', 'orders', null, '냅킨은 주문 1건에 몇 장쯤 나가나요? (묶음/통 단위로 세신다면 1통에 몇 장인지도)'),
  pos('receipt-paper', 'orders', null, '영수증지 1롤로 대략 몇 건 뽑히나요?'),
  pos('bread-sticker', 'bread', null, '빵 스티커는 빵 1개마다 붙이시나요, 봉투에만 붙이시나요?'),
  pos('bread-bag', 'loaf', 1, '식빵·콩식빵봉투는 식빵류 1개당 1장 맞나요?'),
  pos('bag-tie', 'loaf', null, '봉투끈은 식빵 1개당 1개 맞나요? (1묶음에 몇 개인지도)'),
  pos('sq-mini-pack', 'tart', null, '사각미니포장은 타르트 1개당 1개인가요? 다른 디저트에도 쓰시나요?'),
  pos('cake-slice-pack', 'cakeSlice', 1, '조각케이크 1조각당 1개 맞나요?'),
  pos('cream-cake-pack', 'cakeWhole', null, '생크림케이크포장은 어떤 상품에 쓰시나요? (보틀케이크·생크림/기리쉬 포함인가요)'),
  pos('bag-12x15', 'bread', null, '봉투 4종(12*15 · 15*21 · 18*25 · 25*28)이 어떤 빵에 각각 쓰이나요? 또는 대략 몇 대 몇으로 나가나요'),
  pos('bag-15x21', 'bread', null, ''),
  pos('bag-18x25', 'bread', null, ''),
  pos('bag-25x28', 'bread', null, ''),

  // ── POS 가 모르는 것 — 주당 개수를 적어 주시면 그날부터 자동 ────────────
  ask('trash-100l', '하루에 몇 장 버리시는지로 적으셔도 됩니다', '가게가 바쁜 정도와 어느 정도 비례하지만 POS로는 알 수 없습니다'),
  ask('trash-40l', '음식물 봉투'),
  ask('pay-bag', '종량제봉투'),
  ask('knock-box-bag', '넉박스(커피 찌꺼기통) 봉투 — 한 봉투에 며칠 치가 들어가는지로 적으셔도 됩니다', '샷 수와 비례하지만 한 봉투 용량을 몰라 아직 계산이 안 됩니다'),
  ask('latex-gloves', '라텍스장갑 (1통에 몇 장인지도 같이)'),
  ask('vinyl-gloves', '위생장갑'),
  ask('hand-towel', '핸드타올'),
  ask('wet-wipes', '물티슈'),
  ask('jumbo-roll', '점보롤'),
  ask('dinner-napkin', '디너냅킨 — 브런치에 나가나요? 그러면 브런치 인분으로 계산할 수 있습니다', '브런치용이면 POS로 계산 가능합니다'),
  ask('sugar', '설탕 — 테이블용인지 음료용인지도 알려 주세요', '음료용이면 레시피로 계산할 수 있습니다'),
  ask('paper-cup', '종이컵 — 물컵인가요, 직원용인가요?', '손님 물컵이면 주문 건수로 계산할 수 있습니다'),
  ask('shopping-bag', '쇼핑백'),
  ask('bread-shopping-bag', '빵 쇼핑백 — 빵 몇 개 이상 살 때 쓰시는지 알려 주시면 POS로 계산됩니다', '빵 건수 대비 비율만 알면 자동화됩니다'),
  ask('paper-bag', '종이봉투'),
  ask('plain-vinyl', '무지비닐'),
  ask('vinyl-handle-bag', '비닐포장 손잡이'),
  ask('roll-bag', '롤백'),
  ask('wax-paper', '유산지 — 시트에 "베이커리확인"으로 적혀 있습니다'),
  ask('brown-wrap', '갈색종이포장지 — 어떤 빵·디저트에 쓰시나요?', '용도를 알면 POS 건수로 계산할 수 있습니다'),
];

/** 세는 방법에 대해 여쭐 것 (품목별이 아니라 전체에 걸리는 질문) */
export const HOW_TO_COUNT = [
  [
    '창고를 어디까지 세나요?',
    '시트 각주에 "지하창고 기준 수량입니다. 지하창고 비품 → 1층 카페창고로 1개씩 이동시켜야 함"이라고 적혀 있습니다. 지하만 세면 "쓴 양"이 아니라 "지하에서 1층으로 옮긴 양"을 재게 됩니다.',
    ['지하 + 1층을 합쳐서 (권장)', '지금처럼 지하만', '지하 칸 · 1층 칸을 따로'],
  ],
  [
    '세는 단위가 무엇인가요?',
    '시트에 1.5 같은 소수가 있는 걸 보면 "뜯은 것은 반개"로 치시는 것 같습니다. 예를 들어 아이스컵을 "2.5"로 적으면 2박스 + 뜯은 것 반 박스로 읽으면 될까요? 컵·빨대·장갑처럼 박스로 세는 품목은 1박스에 몇 개인지도 알려 주세요.',
    ['박스·묶음 단위 (뜯은 건 0.5)', '낱개', '품목마다 다름'],
  ],
  [
    '머그·유리컵 비율이 아이스와 핫이 같은가요?',
    '"반반"이라고 하셨는데, 보통 핫은 머그가 많고 아이스는 일회용이 많습니다. 이 집도 그런지, 아니면 둘 다 반반인지에 따라 컵 필요량이 크게 달라집니다.',
    ['둘 다 반반', '핫이 머그가 더 많음 (핫 __% / 아이스 __%)'],
  ],
  [
    '발주한 것이 언제 들어오나요?',
    '지금 앱은 "발주 확정 = 입고"로 계산합니다. 수요일에 시키면 보통 언제 도착하나요? 안 오거나 덜 오는 일이 잦다면 "도착" 확인 단추를 넣겠습니다.',
    ['같은 주에 도착 (지금 계산 그대로)', '다음 주에 도착', '들쭉날쭉 — 도착 단추 필요'],
  ],
];
