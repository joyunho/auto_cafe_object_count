import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumptionStats, suggestPar, stockoutCount, dayNumber } from '../src/logic/stats.js';

const item = { id: 'a', name: '탄산수', par: 8, parUnit: 'ea', boxSize: null, orderUnit: 'ea' };
const boxItem = { id: 'b', name: '아이스티', par: 6, parUnit: 'ea', boxSize: 6, orderUnit: 'box' };

const sessions = [
  { id: 's1', date: '2026-09-07', status: 'submitted', counts: { a: 2, b: 1 } },
  { id: 's2', date: '2026-09-10', status: 'submitted', counts: { a: 5, b: 4 } }, // 월요일 발주 6개 입고 후 3일간 3개 사용
  { id: 's3', date: '2026-09-14', status: 'submitted', counts: { a: 3, b: 2 } }, // 목요일 발주 3개 입고 후 4일간 5개 사용
  { id: 'd1', date: '2026-09-17', status: 'draft', counts: { a: 0 } },
];
const orders = [
  { id: 'o1', sessionId: 's1', date: '2026-09-07', lines: [{ itemId: 'a', qty: 6, unit: 'ea' }, { itemId: 'b', qty: 1, unit: 'box' }] },
  { id: 'o2', sessionId: 's2', date: '2026-09-10', lines: [{ itemId: 'a', qty: 3, unit: 'ea' }] },
];

test('dayNumber는 날짜 차이를 일수로 준다', () => {
  assert.equal(dayNumber('2026-09-10') - dayNumber('2026-09-07'), 3);
});

test('consumptionStats: 입고량을 반영한 소비량 추정', () => {
  const st = consumptionStats([item, boxItem], sessions, orders);
  // a: (2+6-5)=3 over 3d, (5+3-3)=5 over 4d → 8/7 per day
  assert.equal(st.a.samples, 2);
  assert.ok(Math.abs(st.a.avgPerDay - 8 / 7) < 1e-9);
  assert.equal(st.a.lastCount, 3);
  assert.equal(st.a.lastDate, '2026-09-14');
  // b: (1+6-4)=3 over 3d, (4+0-2)=2 over 4d → 5/7
  assert.equal(st.b.samples, 2);
  assert.ok(Math.abs(st.b.avgPerDay - 5 / 7) < 1e-9);
});

test('consumptionStats: 초안(draft) 세션은 무시', () => {
  const st = consumptionStats([item], sessions, orders);
  assert.equal(st.a.lastDate, '2026-09-14');
});

test('consumptionStats: 소비량이 음수(추가 입고 등)면 표본 제외', () => {
  const s = [
    { id: '1', date: '2026-09-01', status: 'submitted', counts: { a: 1 } },
    { id: '2', date: '2026-09-04', status: 'submitted', counts: { a: 9 } },
  ];
  const st = consumptionStats([item], s, []);
  assert.equal(st.a.samples, 0);
  assert.equal(st.a.avgPerDay, null);
});

test('suggestPar: 표본 부족이면 null', () => {
  const st = consumptionStats([item], sessions, orders);
  assert.equal(suggestPar(item, st.a), null);
});

test('suggestPar: 충분한 표본이면 제안, 기준과 비슷하면 null', () => {
  const stat = { samples: 4, avgPerDay: 3 }; // 4일 → 12개 * 1.5 = 18
  const s = suggestPar(item, stat);
  assert.equal(s.suggested, 18);
  assert.equal(s.currentPar, 8);
  assert.equal(suggestPar({ ...item, par: 17 }, stat), null);
});

test('stockoutCount: 최근 조사 중 0인 횟수', () => {
  const s = [
    { id: '1', date: '2026-09-01', status: 'submitted', counts: { a: 0 } },
    { id: '2', date: '2026-09-04', status: 'submitted', counts: { a: 2 } },
    { id: '3', date: '2026-09-08', status: 'submitted', counts: { a: 0 } },
  ];
  assert.equal(stockoutCount('a', s), 2);
  assert.equal(stockoutCount('a', s, 1), 1);
});
