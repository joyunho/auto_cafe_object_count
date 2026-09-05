import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, migrate, exportJSON, importJSON, resetItems, SCHEMA_VERSION } from '../src/store.js';
import { SEED_ITEMS, SEED_GROUPS } from '../src/data/items.js';
import { SEED_SUPPLY_ITEMS, SEED_SUPPLY_GROUPS } from '../src/data/supplies.js';

const ALL_ITEMS = SEED_ITEMS.length + SEED_SUPPLY_ITEMS.length;

test('defaultState는 시드 품목/그룹(제품 + 자재)을 복사한다', () => {
  const s = defaultState();
  assert.equal(s.items.length, ALL_ITEMS);
  assert.equal(s.groups.length, SEED_GROUPS.length + SEED_SUPPLY_GROUPS.length);
  assert.ok(s.items.every((it) => it.book === 'product' || it.book === 'supply'));
  assert.equal(s.ui.book, 'product');
  assert.deepEqual(s.settings.orderDaysByBook, { supply: [3] });
  assert.notEqual(s.items[0], SEED_ITEMS[0]); // 복사본
  assert.equal(s.version, SCHEMA_VERSION);
});

test('시드 품목 id는 유일하고 모든 품목이 존재하는 그룹을 가리킨다', () => {
  const ids = new Set(SEED_ITEMS.map((i) => i.id));
  assert.equal(ids.size, SEED_ITEMS.length);
  const gids = new Set(SEED_GROUPS.map((g) => g.id));
  for (const it of SEED_ITEMS) assert.ok(gids.has(it.group), `${it.name} 그룹 없음`);
  const names = SEED_ITEMS.map((i) => i.name);
  assert.equal(new Set(names).size, names.length, '품목명 중복');
});

test('자재 시드: id·이름 유일(제품과도 겹치지 않음), 그룹 존재, 장부 표기', () => {
  const ids = new Set([...SEED_ITEMS, ...SEED_SUPPLY_ITEMS].map((i) => i.id));
  assert.equal(ids.size, ALL_ITEMS, 'id 중복');
  const names = new Set([...SEED_ITEMS, ...SEED_SUPPLY_ITEMS].map((i) => i.name));
  assert.equal(names.size, ALL_ITEMS, '이름 중복');
  const gids = new Set(SEED_SUPPLY_GROUPS.map((g) => g.id));
  for (const it of SEED_SUPPLY_ITEMS) {
    assert.ok(gids.has(it.group), `${it.name} 그룹 없음`);
    assert.equal(it.book, 'supply');
  }
  for (const g of SEED_SUPPLY_GROUPS) assert.equal(g.book, 'supply');
  for (const g of SEED_GROUPS) assert.equal(g.book, 'product');
  assert.equal(SEED_SUPPLY_ITEMS.find((i) => i.id === 'trash-100l').unitName, '묶음');
  assert.equal(SEED_SUPPLY_ITEMS.find((i) => i.id === 'knock-box-bag').par, 1.5);
});

test('시드 규칙: 박스 발주 품목은 boxSize가 있거나 par 단위가 box', () => {
  for (const it of SEED_ITEMS) {
    if (it.orderUnit === 'box') assert.ok(it.boxSize || it.parUnit === 'box', it.name);
    if (it.rule) assert.ok(it.rule.threshold > 0 && it.rule.orderQty > 0, it.name);
  }
});

test('migrate: 잘못된 입력이면 기본 상태', () => {
  assert.equal(migrate(null).items.length, ALL_ITEMS);
  assert.equal(migrate('x').items.length, ALL_ITEMS);
  assert.equal(migrate({ items: [] }).items.length, ALL_ITEMS);
});

test('migrate: 장부가 없는 예전 데이터 — 품목·세션·주문은 제품 장부로, 자재 시드는 덧붙인다', () => {
  const s = migrate({
    version: 1,
    items: [{ id: 'a', name: 'A' }],
    groups: [{ id: 'g', title: 'G' }],
    sessions: [{ id: 's1', status: 'submitted', date: '2026-09-07', counts: { a: 1 } }],
    orders: [{ id: 'o1', date: '2026-09-07', lines: [] }],
    settings: { orderDays: [1, 4], orderDaysByBook: { supply: [2, 'x', 9] } },
    ui: { book: 'nope' },
  });
  assert.equal(s.items.find((i) => i.id === 'a').book, 'product');
  assert.equal(s.groups.find((g) => g.id === 'g').book, 'product');
  assert.equal(s.sessions[0].book, 'product');
  assert.equal(s.orders[0].book, 'product');
  assert.equal(s.items.filter((i) => i.book === 'supply').length, SEED_SUPPLY_ITEMS.length);
  assert.equal(s.groups.filter((g) => g.book === 'supply').length, SEED_SUPPLY_GROUPS.length);
  assert.deepEqual(s.settings.orderDaysByBook, { supply: [2] });
  assert.equal(s.ui.book, 'product');
  // 자재 품목이 이미 있으면 다시 붙이지 않는다
  const again = migrate(s);
  assert.equal(again.items.length, s.items.length);
  assert.equal(again.seeded.supply, true);
  // 사용자가 자재 장부를 통째로 지운 뒤에도 다시 붙이지 않는다 (표시가 남아 있으므로)
  const wiped = migrate({ ...again, items: again.items.filter((i) => i.book !== 'supply') });
  assert.equal(wiped.items.filter((i) => i.book === 'supply').length, 0);
  assert.deepEqual(migrate({ settings: { orderDaysByBook: { supply: [] } } }).settings.orderDaysByBook, { supply: [3] });
});

test('migrate: 일부 필드만 있어도 나머지는 기본값으로 채운다', () => {
  const s = migrate({ items: [{ id: 'a', name: 'A' }], settings: { storeName: 'X' } });
  assert.equal(s.items.filter((i) => i.book === 'product').length, 1);
  assert.equal(s.settings.storeName, 'X');
  assert.equal(s.settings.supplierName, '씨앤비');
  assert.deepEqual(s.sessions, []);
  assert.equal(s.ui.tab, 'count');
});

test('export → import 왕복, API 키는 내보내지 않음', () => {
  const s = defaultState();
  s.settings.storeName = '테스트점';
  s.settings.apiKey = 'sk-ant-SECRET';
  s.sessions.push({ id: 's1', date: '2026-09-07', status: 'submitted', counts: { 'yuja-cheong': 2 } });
  const text = exportJSON(s);
  const parsed = JSON.parse(text);
  assert.ok(!parsed.ui, 'ui 상태는 내보내지 않음');
  assert.ok(!('apiKey' in parsed.settings), 'API 키는 내보내지 않음');
  assert.ok(!text.includes('sk-ant-SECRET'));
  const back = importJSON(text);
  assert.equal(back.settings.storeName, '테스트점');
  assert.equal(back.settings.apiKey, '');
  assert.equal(back.sessions.length, 1);
  assert.equal(back.items.length, ALL_ITEMS);
});

test('importJSON: 백업이 아닌 JSON은 거부', () => {
  for (const bad of ['{}', '[]', 'null', '42', '{"foo":"bar"}', '{"items":[]}', '{"items":[],"version":"1"}']) {
    assert.throws(() => importJSON(bad), undefined, bad);
  }
  assert.throws(() => importJSON('not json'));
});

test('migrate: 깨진 요소를 정리해 렌더 가능한 상태로 만든다', () => {
  const s = migrate({
    version: 1,
    items: [null, { id: 'a', name: 'A' }, { name: '이름만' }],
    groups: [null, { id: 'g', title: 'G' }],
    sessions: [{ id: 's1', status: 'draft' }, null, { id: 's2', status: 'weird', counts: 'x', date: 5 }],
    orders: [{ id: 'o1' }, 'junk'],
    settings: { orderDays: null, storeName: 7 },
  });
  assert.deepEqual(s.items.filter((i) => i.book === 'product').map((i) => i.id), ['a']);
  assert.deepEqual(s.groups.filter((g) => g.book === 'product').map((g) => g.id), ['g']);
  assert.equal(s.sessions.length, 2);
  assert.deepEqual(s.sessions[0].counts, {});
  assert.deepEqual(s.sessions[0].overrides, {});
  assert.equal(s.sessions[1].status, 'draft');
  assert.equal(s.sessions[1].date, '');
  assert.deepEqual(s.orders[0].lines, []);
  assert.deepEqual(s.settings.orderDays, [1, 4]);
  assert.equal(s.settings.storeName, '');
  assert.deepEqual(migrate({ settings: { orderDays: [4, 1, 1, 9, 'x'] } }).settings.orderDays, [1, 4]);
});

test('resetItems는 기록을 유지하고 품목만 되돌린다', () => {
  const s = defaultState();
  s.items = [{ id: 'x', name: 'X' }];
  s.sessions.push({ id: 's1', date: '2026-09-07', status: 'submitted', counts: {} });
  const r = resetItems(s);
  assert.equal(r.items.length, ALL_ITEMS);
  assert.equal(r.sessions.length, 1);
});
