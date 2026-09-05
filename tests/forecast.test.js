import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateFor, consumedBetween, lastKnown, forecastItem, forecastAll, validateModel } from '../src/logic/forecast.js';

const model = { version: 1, source: 't', months: ['2026-01', '2026-02'], items: { a: { perDay: { '2026-01': 1, '2026-02': 2 }, avgPerDay: 1.5 }, b: { perDay: { '2026-07': 0.5 }, avgPerDay: 0.5 }, c: { perDay: { '2025-02': 5, '2026-02': 7 }, avgPerDay: 6 } } };
const itemA = { id: 'a', name: 'A', par: 8, parUnit: 'ea', boxSize: null, orderUnit: 'ea', countUnit: 'ea' };
const itemBox = { id: 'b', name: 'B', par: 6, parUnit: 'ea', boxSize: 6, orderUnit: 'box', countUnit: 'box' };

test('rateFor: 같은 달 → 다른 해 같은 달 → 연평균', () => {
  assert.equal(rateFor(model, 'a', '2026-01-15'), 1);
  assert.equal(rateFor(model, 'a', '2027-02-01'), 2);
  assert.equal(rateFor(model, 'c', '2027-02-01'), 7); // 여러 해가 있으면 가장 최근 해
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
  // 예상값·기준값으로 채운 조사는 실측이 아니므로 그 전 실측으로 거슬러 간다 (그 뒤 입고는 모두 더함)
  const filled = sessions.map((s) => (s.id === '2' ? { ...s, filled: { a: true } } : s));
  assert.deepEqual(lastKnown(itemA, filled, orders), { count: 9, date: '2026-01-05', received: 104 });
  // 발주일보다 먼저 확정했으면(토요일에 세고 월요일 발주분) 확정한 날을 센 날로 본다
  const early = [{ id: 'e', date: '2026-01-26', submittedAt: '2026-01-24T12:00:00.000Z', status: 'submitted', counts: { a: 3 } }];
  assert.equal(lastKnown(itemA, early, []).date, '2026-01-24');
  // 같은 날 두 번 확정했으면 나중 것
  const twice = [
    { id: 't1', date: '2026-01-26', submittedAt: '2026-01-26T01:00:00.000Z', status: 'submitted', counts: { a: 1 } },
    { id: 't2', date: '2026-01-26', submittedAt: '2026-01-26T02:00:00.000Z', status: 'submitted', counts: { a: 2 } },
  ];
  assert.equal(lastKnown(itemA, twice, []).count, 2);
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

test('forecastItem: 오차 범위가 0 아래로 내려가면 확인 필요, 실측이 오래돼도 확인 필요', () => {
  // 1/26에 1개, 4일 × 1개 소비 → −3 → 0으로 잘림. 범위가 좁아 보여도 이미 떨어졌을 수 있으니 확인
  const f = forecastItem(itemA, model, [{ id: '1', date: '2026-01-26', status: 'submitted', counts: { a: 1 } }], [], '2026-01-30');
  assert.equal(f.expected, 0);
  assert.equal(f.crossesZero, true);
  assert.equal(f.needsCheck, true);
  // 19일 전 실측 50개 → 예상 31, 기준 8이라 발주 결정은 안 갈리지만 오래돼서 확인
  const g = forecastItem(itemA, model, [{ id: '1', date: '2026-01-01', status: 'submitted', counts: { a: 50 } }], [], '2026-01-20');
  assert.equal(g.expected, 31);
  assert.equal(g.stale, true);
  assert.equal(g.needsCheck, true);
  // 같은 상황이 5일 전이면 확인 불필요
  const h = forecastItem(itemA, model, [{ id: '1', date: '2026-01-15', status: 'submitted', counts: { a: 50 } }], [], '2026-01-20');
  assert.equal(h.needsCheck, false);
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
  // 음수 연평균은 무시하고 월별 평균으로
  assert.equal(validateModel({ items: { n: { perDay: { '2026-01': 2 }, avgPerDay: -1 } } }).items.n.avgPerDay, 2);
  assert.throws(() => validateModel({ items: {} }), /품목이 없습니다/);
});
