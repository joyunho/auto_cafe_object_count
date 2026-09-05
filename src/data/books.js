// 장부(book): 재고를 따로 세는 묶음. 제품(음료 재료, 월·목 발주)과 자재(포장·컵·봉투 등 소모품, 수요일)를 나눈다.
export const BOOKS = [
  { id: 'product', title: '제품 · 재료', short: '제품', dayLabel: '월·목', orderDays: [1, 4], desc: '음료 재료 시트 3장 — 씨앤비 월·목 발주' },
  { id: 'supply', title: '자재 · 소모품', short: '자재', dayLabel: '수', orderDays: [3], desc: '포장·컵·봉투·위생용품 — 수요일, 지하창고 기준 수량' },
];
export const DEFAULT_BOOK = 'product';

export function bookOf(id) {
  return BOOKS.find((b) => b.id === id) || BOOKS[0];
}

/** 장부별 발주 요일. 제품은 settings.orderDays, 그 외는 settings.orderDaysByBook[book] (없으면 기본값) */
export function orderDaysFor(settings, bookId) {
  if (!bookId || bookId === 'product') return settings.orderDays;
  const d = settings.orderDaysByBook?.[bookId];
  return Array.isArray(d) && d.length ? d : bookOf(bookId).orderDays;
}
