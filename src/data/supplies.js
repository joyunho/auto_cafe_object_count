// 씨앤비 재고조사 (수요일) — 자재(소모품) 시트에서 옮긴 시드 데이터
// 빨간 인쇄 숫자 → par, 손글씨로 추가된 품목은 기준 없이 등록. "묶음" 단위는 unitName 으로 표시.
// 시트 각주: "지하창고 기준 수량입니다. 지하창고 비품 > 1층 카페창고로 1개씩 이동시켜야 함"
// 사진 판독은 독립 2회 + 대조로 했고, 인쇄 칸 33개는 모두 일치. 손글씨 여백 항목은 판독 확신도가 낮은 것에 메모를 남겼다.
export const SEED_SUPPLY_GROUPS = [
  { id: 'sp-pack', title: '포장', book: 'supply' },
  { id: 'sp-cup', title: '컵 · 뚜껑', book: 'supply' },
  { id: 'sp-bag', title: '봉투 · 쓰레기봉투', book: 'supply' },
  { id: 'sp-hyg', title: '빨대 · 위생', book: 'supply' },
  { id: 'sp-etc', title: '기타', book: 'supply' },
];

const base = { book: 'supply', parUnit: 'ea', boxSize: null, orderUnit: 'ea', countUnit: 'ea', rule: null, minOrder: null, aliases: [], active: true, note: '' };
const item = (id, name, group, par, extra = {}) => ({ ...base, id, name, group, par, ...extra });
const hand = { note: '손글씨로 추가된 품목 — 기준 수량 없음' };

export const SEED_SUPPLY_ITEMS = [
  // ── 포장 ──
  item('sq-mini-pack', '사각미니포장(타르트)', 'sp-pack', 2),
  item('brown-wrap', '갈색종이포장지', 'sp-pack', 2),
  item('cake-slice-pack', '조각케이크포장', 'sp-pack', 2),
  item('cream-cake-pack', '생크림케이크포장', 'sp-pack', 2),
  item('bread-bag', '식빵·콩식빵봉투', 'sp-pack', 2, { aliases: ['식빵*콩식빵봉투'] }),
  item('bag-tie', '봉투끈(식빵포장)', 'sp-pack', 2),
  item('bag-12x15', '봉투 12*15', 'sp-pack', 2, { aliases: ['12*15'] }),
  item('bag-15x21', '봉투 15*21', 'sp-pack', 2, { aliases: ['15*21'] }),
  item('bag-18x25', '봉투 18*25', 'sp-pack', 2, { aliases: ['18*25'] }),
  item('bag-25x28', '봉투 25*28', 'sp-pack', 2, { aliases: ['25*28'] }),
  item('roll-bag', '롤백', 'sp-pack', 2),
  item('wax-paper', '유산지', 'sp-pack', null, { note: '시트 기준: "베이커리확인"' }),
  item('paper-bag', '종이봉투', 'sp-pack', null, hand),
  item('bread-sticker', '빵 스티커', 'sp-pack', null, { note: '손글씨로 추가된 품목 (★ 표시)' }),
  item('shopping-bag', '쇼핑백', 'sp-pack', null, hand),
  item('bread-shopping-bag', '빵 쇼핑백', 'sp-pack', null, { note: '손글씨로 추가된 품목 (상단 여백 "빵쇼핑백 1")' }),
  item('plain-vinyl', '무지비닐', 'sp-pack', null, { note: '손글씨로 추가된 품목 (상단 여백 "무지비닐 1") — 판독 불확실' }),
  item('vinyl-handle-bag', '비닐포장 손잡이', 'sp-pack', null, { note: '손글씨로 추가된 품목 (상단 여백 "비닐포장손잡이 2") — 판독 확인 필요' }),
  // ── 컵 · 뚜껑 ──
  item('ice-cup', '아이스컵 · 아이스뚜껑', 'sp-cup', 2, { aliases: ['아이스컵', '아이스 뚜껑'], note: '시트 한 칸에 두 줄로 적힘' }),
  item('hot-cup', '핫컵', 'sp-cup', 2),
  item('hot-lid', '핫뚜껑', 'sp-cup', 2),
  item('cup-holder', '컵홀더', 'sp-cup', 2),
  item('cup-carrier', '컵캐리어', 'sp-cup', null, { note: '시트에 기준 수량 없음' }),
  item('paper-cup', '종이컵', 'sp-cup', 2),
  item('ramen-container', '라면용기', 'sp-cup', null, hand),
  item('jujube-tea-togo', '대추차 T.O(테이크아웃 용기)', 'sp-cup', null, { note: '손글씨로 추가된 품목 — "대추차 T.O"' }),
  // ── 봉투 · 쓰레기봉투 ──
  item('trash-100l', '100L 쓰레기봉투(일쓰)', 'sp-bag', 2, { unitName: '묶음' }),
  item('trash-40l', '40L 쓰레기봉투(음식물)', 'sp-bag', 2, { unitName: '묶음' }),
  item('pay-bag', '종량제봉투', 'sp-bag', 2, { unitName: '묶음' }),
  item('knock-box-bag', '넉박스 봉투', 'sp-bag', 1.5, { unitName: '묶음' }),
  // ── 빨대 · 위생 ──
  item('ade-straw', '에이드빨대', 'sp-hyg', 2),
  item('straw', '일반빨대', 'sp-hyg', 2),
  item('black-straw', '검정빨대', 'sp-hyg', 1.5),
  item('chopsticks', '나무젓가락', 'sp-hyg', null, hand),
  item('latex-gloves', '라텍스장갑', 'sp-hyg', 2, { note: '시트 기준 "각 2" (사이즈별). 하단 손글씨 "라텍스 M 4 (2통)"' }),
  item('vinyl-gloves', '위생장갑', 'sp-hyg', 2),
  item('hand-towel', '핸드타올', 'sp-hyg', 2),
  item('wet-wipes', '물티슈', 'sp-hyg', 2),
  item('napkin', '냅킨', 'sp-hyg', 2),
  item('dinner-napkin', '디너냅킨', 'sp-hyg', null, { note: '손글씨로 추가된 품목 (상단 여백 "디너냅킨 1")' }),
  item('jumbo-roll', '점보롤', 'sp-hyg', 2),
  // ── 기타 ──
  item('sugar', '설탕', 'sp-etc', 1.5),
  item('receipt-paper', '영수증지', 'sp-etc', null, hand),
];
