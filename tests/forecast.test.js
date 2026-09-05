import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateFor, consumedBetween, lastKnown, forecastItem, forecastAll, validateModel } from '../src/logic/forecast.js';

const model = { version: 1, source: 't', months: ['2026-01', '2026-02'], items: { a: { perDay: { '2026-01': 1, '2026-02': 2 }, avgPerDay: 1.5 }, b: { perDay: { '2026-07': 0.5 }, avgPerDay: 0.5 } } };
const itemA = { id: 'a', name: 'A', par: 8, parUnit: 'ea', boxSize: null, orderUnit: 'ea', countUnit: 'ea' };
const itemBox = { id: 'b', name: 'B', par: 6, parUnit: 'ea', boxSize: 6, orderUnit: 'box', countUnit: 'box' };

test('rateFor: 같은 달 → 다른 해 같은 달 → 연평균', () => {
  assert.equal(rateFor(model, 'a', '2026-01-15'), 1);
  assert.equal(rateFor(model, 'a', '2027-02-01'), 2);
  assert.equal(rateFor(model, 'a', '2026-05-01'), 1.5);
  assert.equal(rateFor(model, 'zzz', '2026-01-01'), null);
});

test('consumedBetween: 일별 합, 월 경계', () => {
  const r = consumedBetween(model, 'a', '2026-01-30', '2026-02-02'); // 1/31(1) + 2/1(2) + 2/2(2)
  assert.equal(r.days, 3);
  assert.equal(r.consumed, 5);
  assert.equal(consumedBetween(model, 'a', '2026-02-02', '2026-02-02').consumed, 0);
});

test('lastKnown: 마지막 확정 조사 + 그 뒤 입고', () => {
  const sessions = [
    { id: '1', date: '2026-01-05', status: 'submitted', counts: { a: 9 } },
    { id: '2', date: '2026-01-26', status: 'submitted', counts: { a: 3 } },
    { id: '3', date: '2026-01-29', status: 'draft', counts: { a: 1 } },
  ];
  const orders = [
    { id: 'o1', date: '2026-01-26', lines: [{ itemId: 'a', qty: 5, unit: 'ea' }] },
    { id: 'o0', date: '2026-01-05', lines: [{ itemId: 'a', qty: 99, unit: 'ea' }] },
  ];
  assert.deepEqual(lastKnown(itemA, sessions, orders), { count: 3, date: '2026-01-26', received: 5 });
  assert.equal(lastKnown(itemA, [], orders), null);
  // 박스 단위로 세는 품목: 1박스 발주 = 1박스 입고
  const lk = lastKnown(itemBox, [{ id: 's', date: '2026-07-01', status: 'submitted', counts: { b: 1 } }], [{ id: 'o', date: '2026-07-01', lines: [{ itemId: 'b', qty: 1, unit: 'box' }] }]);
  assert.equal(lk.received, 1);
});

test('forecastItem: 예상값과 확인 필요 판정', () => {
  const sessions = [{ id: '1', date: '2026-01-26', status: 'submitted', counts: { a: 3 } }];
  const orders = [{ id: 'o1', date: '2026-01-26', lines: [{ itemId: 'a', qty: 5, unit: 'ea' }] }];
  // 1/27~1/30 = 4일 × 1 = 4 소비 → 3 + 5 − 4 = 4
  const f = forecastItem(itemA, model, sessions, orders, '2026-01-30');
  assert.equal(f.expected, 4);
  assert.equal(f.days, 4);
  assert.ok(f.low <= 4 && f.high >= 4);
  // 기준 8: low/high에 따라 발주량이 달라지므로 확인 필요
  assert.equal(f.needsCheck, true);
  // 모델·기록 없으면 null
  assert.equal(forecastItem(itemA, model, [], orders, '2026-01-30'), null);
  assert.equal(forecastItem({ ...itemA, id: 'nope' }, model, sessions, orders, '2026-01-30'), null);
});

test('forecastItem: 재발주점 규칙 — 결정이 갈리지 않으면 확인 불필요', () => {
  const rule = { ...itemA, rule: { type: 'reorderPoint', threshold: 3, orderQty: 1 }, boxSize: 6, orderUnit: 'box' };
  const sessions = [{ id: '1', date: '2026-01-29', status: 'submitted', counts: { a: 8 } }];
  const f = forecastItem(rule, model, sessions, [], '2026-01-30'); // 8 − 1 = 7, 범위 6~8 → 모두 3 이상 → 발주 0
  assert.equal(f.expected, 7);
  assert.equal(f.needsCheck, false);
});

test('forecastItem: 박스 단위 품목은 낱개 소비를 박스로 환산', () => {
  const sessions = [{ id: '1', date: '2026-07-01', status: 'submitted', counts: { b: 2 } }];
  const f = forecastItem(itemBox, model, sessions, [], '2026-07-13'); // 12일 × 0.5개 = 6개 = 1박스 → 1박스
  assert.equal(f.expected, 1);
  assert.equal(forecastItem({ ...itemBox, boxSize: null }, model, sessions, [], '2026-07-13'), null);
});

test('forecastAll & validateModel', () => {
  const sessions = [{ id: '1', date: '2026-01-29', status: 'submitted', counts: { a: 8, b: 1 } }];
  const all = forecastAll([itemA, itemBox, { ...itemA, id: 'x', active: false }], model, sessions, [], '2026-01-30');
  assert.ok(all.a);
  assert.ok(all.b); // 2026-01은 모델에 없어 연평균 사용
  const v = validateModel({ items: { a: { perDay: { '2026-01': 1, bad: 3, '2026-02': -1 } }, junk: 5 } });
  assert.deepEqual(Object.keys(v.items), ['a']);
  assert.equal(v.items.a.avgPerDay, 1);
  assert.throws(() => validateModel({}), /소비 모델/);
  assert.throws(() => validateModel({ items: {} }), /품목이 없습니다/);
});
