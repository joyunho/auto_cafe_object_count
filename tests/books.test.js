import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOKS, bookOf, orderDaysFor, DEFAULT_BOOK } from '../src/data/books.js';
import { nextOrderDate, formatDate } from '../src/logic/order.js';

test('bookOf: 모르는 id는 기본 장부', () => {
  assert.equal(bookOf('supply').short, '자재');
  assert.equal(bookOf('nope').id, DEFAULT_BOOK);
  assert.equal(BOOKS.length, 2);
});

test('orderDaysFor: 제품은 settings.orderDays, 자재는 orderDaysByBook, 없으면 기본(수)', () => {
  const settings = { orderDays: [1, 4], orderDaysByBook: { supply: [2] } };
  assert.deepEqual(orderDaysFor(settings, 'product'), [1, 4]);
  assert.deepEqual(orderDaysFor(settings, 'supply'), [2]);
  assert.deepEqual(orderDaysFor({ orderDays: [1, 4] }, 'supply'), [3]);
  assert.deepEqual(orderDaysFor({ orderDays: [1, 4], orderDaysByBook: { supply: [] } }, 'supply'), [3]);
});

test('nextOrderDate([3]): 수요일 기준 다음 발주일', () => {
  assert.equal(formatDate(nextOrderDate(new Date(2026, 8, 5), [3])), '2026-09-09'); // 토 → 다음 수
  assert.equal(formatDate(nextOrderDate(new Date(2026, 8, 9), [3])), '2026-09-09'); // 수요일이면 오늘
  assert.equal(formatDate(nextOrderDate(new Date(2026, 8, 10), [3])), '2026-09-16');
});
