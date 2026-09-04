import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcOrderLine,
  calcOrder,
  formatOrderText,
  linesToOrder,
  nextOrderDate,
  formatDate,
  parInEach,
  parInCountUnit,
  countToEach,
  unitsUnresolved,
} from '../src/logic/order.js';

const ea = (over = {}) => ({ id: 'a', name: '탄산수', par: 8, parUnit: 'ea', boxSize: null, orderUnit: 'ea', rule: null, minOrder: null, ...over });
const boxed = (over = {}) => ({ id: 'b', name: '아이스티(1box>6)', par: 6, parUnit: 'ea', boxSize: 6, orderUnit: 'box', rule: null, minOrder: null, ...over });
const yuja = (over = {}) => ({
  id: 'y',
  name: '유자청',
  par: 8,
  parUnit: 'ea',
  boxSize: 6,
  orderUnit: 'box',
  minOrder: 1,
  rule: { type: 'reorderPoint', threshold: 3, orderQty: 1 },
  ...over,
});

test('낱개 품목: 기준 − 현재 = 발주 수량', () => {
  const l = calcOrderLine(ea(), 3);
  assert.equal(l.need, 5);
  assert.equal(l.qty, 5);
  assert.equal(l.unit, 'ea');
  assert.equal(l.auto, true);
});

test('현재 수량이 기준 이상이면 발주 0', () => {
  assert.equal(calcOrderLine(ea(), 8).qty, 0);
  assert.equal(calcOrderLine(ea(), 12).qty, 0);
  assert.equal(calcOrderLine(ea(), 12).need, 0);
});

test('미입력이면 auto=false, qty 0', () => {
  const l = calcOrderLine(ea(), null);
  assert.equal(l.auto, false);
  assert.equal(l.qty, 0);
  assert.equal(l.reason, '미입력');
});

test('음수 입력은 0으로 취급', () => {
  assert.equal(calcOrderLine(ea(), -2).qty, 8);
});

test('박스 품목: 부족 낱개 수를 박스로 올림', () => {
  assert.equal(calcOrderLine(boxed(), 0).qty, 1); // 6 부족 → 1박스
  assert.equal(calcOrderLine(boxed(), 5).qty, 1); // 1 부족 → 1박스
  assert.equal(calcOrderLine(boxed({ par: 8 }), 0).qty, 2); // 8 부족 → 2박스
  assert.equal(calcOrderLine(boxed(), 6).qty, 0);
});

test('par가 박스 단위, 세는 단위는 낱개 (boxSize 있음)', () => {
  const it = { id: 'p', name: '배도라지차', par: 2, parUnit: 'box', boxSize: 10, orderUnit: 'box', countUnit: 'ea' };
  assert.equal(parInEach(it), 20);
  assert.equal(calcOrderLine(it, 10).qty, 1);
  assert.equal(calcOrderLine(it, 0).qty, 2);
  assert.equal(calcOrderLine(it, 20).qty, 0);
});

test('전부 박스 단위인 품목 (배도라지차 2BOX, boxSize 모름)', () => {
  const it = { id: 'p', name: '배도라지차', par: 2, parUnit: 'box', boxSize: null, orderUnit: 'box', countUnit: 'box' };
  assert.equal(unitsUnresolved(it), false);
  assert.equal(calcOrderLine(it, 1).qty, 1); // 1박스 남음 → 1박스
  assert.equal(calcOrderLine(it, 2).qty, 0);
  assert.equal(calcOrderLine(it, 0).qty, 2);
  assert.match(calcOrderLine(it, 1).reason, /현재 1박스/);
  assert.equal(parInCountUnit(it), 2);
});

test('세는 단위가 박스이고 boxSize가 있으면 박스 수 × 개수로 환산', () => {
  const it = { id: 't', name: '아이스티', par: 6, parUnit: 'ea', boxSize: 6, orderUnit: 'box', countUnit: 'box' };
  assert.equal(countToEach(it, 1), 6);
  assert.equal(parInCountUnit(it), 1);
  const l = calcOrderLine(it, 1); // 1박스 = 6개 = 기준 → 충분
  assert.equal(l.qty, 0);
  assert.equal(l.current, 1);
  assert.equal(l.currentEach, 6);
  assert.equal(calcOrderLine(it, 0).qty, 1);
  // 기준 8개, 1박스 보유 → 2개 부족 → 1박스
  assert.equal(calcOrderLine({ ...it, par: 8 }, 1).qty, 1);
});

test('단위가 섞였는데 boxSize가 없으면 계산하지 않는다', () => {
  const it = ea({ orderUnit: 'box', boxSize: null });
  assert.equal(unitsUnresolved(it), true);
  const l = calcOrderLine(it, 3);
  assert.equal(l.auto, false);
  assert.equal(l.qty, 0);
  assert.equal(l.reason, '1박스 개수 미설정');
  // 재발주점 규칙도 세는 단위가 박스면 낱개로 환산해서 비교
  const y = yuja({ countUnit: 'box' });
  assert.equal(calcOrderLine(y, 1).qty, 0); // 1박스 = 6개 ≥ 3
  assert.equal(calcOrderLine(y, 0).qty, 1);
});

test('재발주점 규칙: 3개 미만이면 1박스, 아니면 0', () => {
  assert.equal(calcOrderLine(yuja(), 2).qty, 1);
  assert.equal(calcOrderLine(yuja(), 0).qty, 1);
  assert.equal(calcOrderLine(yuja(), 3).qty, 0);
  assert.equal(calcOrderLine(yuja(), 7).qty, 0);
  assert.equal(calcOrderLine(yuja(), 2).unit, 'box');
});

test('최소 발주 수량 적용', () => {
  const it = ea({ minOrder: 5 });
  assert.equal(calcOrderLine(it, 7).qty, 5); // 1 부족이지만 최소 5
  assert.equal(calcOrderLine(it, 8).qty, 0); // 부족 없으면 0
});

test('기준 수량 없는 품목은 수량을 세었든 아니든 "기준 수량 없음"', () => {
  const l = calcOrderLine(ea({ par: null }), 3);
  assert.equal(l.auto, false);
  assert.equal(l.qty, 0);
  assert.equal(l.reason, '기준 수량 없음');
  assert.equal(l.current, 3);
  const u = calcOrderLine(ea({ par: null }), null);
  assert.equal(u.reason, '기준 수량 없음');
  // 규칙이 있으면 기준이 없어도 계산된다
  const r = calcOrderLine(yuja({ par: null }), 2);
  assert.equal(r.qty, 1);
  assert.equal(calcOrderLine(yuja({ par: null }), null).reason, '미입력');
});

test('calcOrder: 비활성 품목 제외, override 적용', () => {
  const items = [ea(), boxed({ active: false }), yuja()];
  const lines = calcOrder(items, { a: 2, y: 1 }, { a: 10 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].qty, 10);
  assert.equal(lines[0].overridden, true);
  assert.equal(lines[1].qty, 1);
});

test('formatOrderText: 그룹별 출력과 요약', () => {
  const items = [ea(), boxed(), yuja()];
  const lines = calcOrder(items, { a: 3, b: 0, y: 5 });
  const text = formatOrderText(lines, {
    title: '씨앤비 발주',
    date: '2026-09-07 (월)',
    groups: [
      { title: '음료', itemIds: ['a'] },
      { title: '티', itemIds: ['b', 'y'] },
    ],
  });
  assert.match(text, /씨앤비 발주/);
  assert.match(text, /\[음료\]\n- 탄산수 5개/);
  assert.match(text, /\[티\]\n- 아이스티\(1box>6\) 1박스/);
  assert.doesNotMatch(text, /유자청/);
  assert.match(text, /총 2개 품목/);
});

test('formatOrderText: 발주할 것이 없을 때', () => {
  const text = formatOrderText(calcOrder([ea()], { a: 9 }));
  assert.match(text, /발주할 품목이 없습니다/);
});

test('linesToOrder는 qty>0만', () => {
  const lines = calcOrder([ea(), boxed()], { a: 8, b: 0 });
  assert.deepEqual(linesToOrder(lines).map((l) => l.itemId), ['b']);
});

test('nextOrderDate: 월/목 중 가장 가까운 날 (오늘 포함)', () => {
  // 2026-09-04 는 금요일
  assert.equal(formatDate(nextOrderDate(new Date(2026, 8, 4))), '2026-09-07');
  // 2026-09-07 월요일 → 당일
  assert.equal(formatDate(nextOrderDate(new Date(2026, 8, 7))), '2026-09-07');
  // 2026-09-08 화요일 → 목요일
  assert.equal(formatDate(nextOrderDate(new Date(2026, 8, 8))), '2026-09-10');
});
