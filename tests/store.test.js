import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, migrate, exportJSON, importJSON, resetItems, SCHEMA_VERSION } from '../src/store.js';
import { SEED_ITEMS, SEED_GROUPS } from '../src/data/items.js';

test('defaultState는 시드 품목/그룹을 복사한다', () => {
  const s = defaultState();
  assert.equal(s.items.length, SEED_ITEMS.length);
  assert.equal(s.groups.length, SEED_GROUPS.length);
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

test('시드 규칙: 박스 발주 품목은 boxSize가 있거나 par 단위가 box', () => {
  for (const it of SEED_ITEMS) {
    if (it.orderUnit === 'box') assert.ok(it.boxSize || it.parUnit === 'box', it.name);
    if (it.rule) assert.ok(it.rule.threshold > 0 && it.rule.orderQty > 0, it.name);
  }
});

test('migrate: 잘못된 입력이면 기본 상태', () => {
  assert.equal(migrate(null).items.length, SEED_ITEMS.length);
  assert.equal(migrate('x').items.length, SEED_ITEMS.length);
  assert.equal(migrate({ items: [] }).items.length, SEED_ITEMS.length);
});

test('migrate: 일부 필드만 있어도 나머지는 기본값으로 채운다', () => {
  const s = migrate({ items: [{ id: 'a', name: 'A' }], settings: { storeName: 'X' } });
  assert.equal(s.items.length, 1);
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
  assert.equal(back.items.length, SEED_ITEMS.length);
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
  assert.deepEqual(s.items.map((i) => i.id), ['a']);
  assert.deepEqual(s.groups.map((g) => g.id), ['g']);
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
  assert.equal(r.items.length, SEED_ITEMS.length);
  assert.equal(r.sessions.length, 1);
});
