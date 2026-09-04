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

test('export → import 왕복', () => {
  const s = defaultState();
  s.settings.storeName = '테스트점';
  s.sessions.push({ id: 's1', date: '2026-09-07', status: 'submitted', counts: { 'yuja-cheong': 2 } });
  const text = exportJSON(s);
  assert.ok(!JSON.parse(text).ui, 'ui 상태는 내보내지 않음');
  const back = importJSON(text);
  assert.equal(back.settings.storeName, '테스트점');
  assert.equal(back.sessions.length, 1);
  assert.equal(back.items.length, SEED_ITEMS.length);
});

test('resetItems는 기록을 유지하고 품목만 되돌린다', () => {
  const s = defaultState();
  s.items = [{ id: 'x', name: 'X' }];
  s.sessions.push({ id: 's1', date: '2026-09-07', status: 'submitted', counts: {} });
  const r = resetItems(s);
  assert.equal(r.items.length, SEED_ITEMS.length);
  assert.equal(r.sessions.length, 1);
});
