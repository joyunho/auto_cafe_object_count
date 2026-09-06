// 공유 저장소 동기화 엔진(src/sync/engine.js) 단위 테스트 — DOM 없이 가짜 백엔드·가짜 앱으로 돌린다.
//   node --test tests/sync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync, stable, diff, applyPatch, patchForBackend, stripNulls, sharedSettings, DEL } from '../src/sync/engine.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const OPTS = { debounceMs: 5, readyTimeoutMs: 1000 };
/** 디바운스(5ms)와 flush 의 await 들이 끝날 만큼 기다린다 */
const settle = () => sleep(25);

/** 백엔드가 update 를 처리하는 방식과 같은 중첩 병합 (null 잎 = 삭제) */
function mergeInto(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (isObj(v)) {
      if (!isObj(target[k])) target[k] = {};
      mergeInto(target[k], v);
    } else target[k] = v;
  }
}

const newStore = () => ({ items: new Map(), groups: new Map(), sessions: new Map(), orders: new Map(), meta: new Map() });

/**
 * 메모리 맵으로 된 가짜 백엔드. 실제 백엔드와 달리 쓰기가 스냅샷으로 되돌아오지 않는다 —
 * 테스트가 emit() 으로 원하는 때에 스냅샷을 보낸다. 모든 쓰기 호출은 calls 에 남는다.
 * store 를 넘기면 그 저장소를 같이 쓴다 (기기 두 대). defer 를 켜면 쓰기가 release() 까지 끝나지 않는다 (전송 중 상태).
 */
function fakeBackend(initial = {}, store = newStore()) {
  for (const [coll, docs] of Object.entries(initial)) for (const [id, d] of Object.entries(docs)) store[coll].set(id, clone(d));
  const watchers = []; // { coll, id?, cb, err }
  const calls = []; // { op, coll, id, doc | patch }
  const unsub = (w) => () => {
    const i = watchers.indexOf(w);
    if (i >= 0) watchers.splice(i, 1);
  };
  /** 쓰기가 서버에 닿는 순간 — defer 가 켜져 있으면 release() 까지 기다린다 */
  const hold = () => (b.defer ? new Promise((r) => b.pending.push(r)) : Promise.resolve());
  const b = {
    name: 'fake',
    store,
    calls,
    watchers,
    fail: null, // 설정하면 모든 쓰기가 이 오류로 거부된다
    rejectUpdateOnce: null, // 설정하면 다음 update 한 번만 이 오류로 거부된다
    defer: false, // 켜면 쓰기가 서버에 닿기 전에 pending 에 걸려 release() 때까지 끝나지 않는다
    pending: [],
    release() {
      for (const r of b.pending.splice(0)) r();
    },
    closed: false,
    watch(coll, onDocs, onError) {
      const w = { coll, cb: onDocs, err: onError };
      watchers.push(w);
      return unsub(w);
    },
    watchDoc(coll, id, onDoc, onError) {
      const w = { coll, id, cb: onDoc, err: onError };
      watchers.push(w);
      return unsub(w);
    },
    async set(coll, id, doc) {
      calls.push({ op: 'set', coll, id, doc: clone(doc) });
      if (b.fail) throw b.fail;
      await hold();
      store[coll].set(id, clone(doc));
    },
    async update(coll, id, patch) {
      calls.push({ op: 'update', coll, id, patch: clone(patch) });
      if (b.fail) throw b.fail;
      if (b.rejectUpdateOnce) {
        const e = b.rejectUpdateOnce;
        b.rejectUpdateOnce = null;
        throw e;
      }
      await hold();
      if (!store[coll].has(id)) throw Object.assign(new Error('document does not exist'), { code: 'invalid_argument' });
      mergeInto(store[coll].get(id), patch);
    },
    async remove(coll, id) {
      calls.push({ op: 'remove', coll, id });
      if (b.fail) throw b.fail;
      await hold();
      store[coll].delete(id);
    },
    close() {
      b.closed = true;
    },
    /** 컬렉션(또는 'meta' 문서)의 현재 내용을 스냅샷으로 보낸다 */
    emit(coll, meta = { fromCache: false }) {
      for (const w of [...watchers]) {
        if (w.coll !== coll) continue;
        if (w.id) w.cb(store[coll].has(w.id) ? clone(store[coll].get(w.id)) : null, meta);
        else w.cb(new Map([...store[coll]].map(([k, v]) => [k, clone(v)])), meta);
      }
    },
    emitAll(meta) {
      for (const c of ['items', 'groups', 'sessions', 'orders', 'meta']) b.emit(c, meta);
    },
    error(coll, err) {
      for (const w of [...watchers]) if (w.coll === coll) w.err?.(err);
    },
  };
  return b;
}

function fakeApp(state) {
  const app = {
    state,
    persistCalls: 0,
    remotePersists: 0,
    remoteChanges: 0,
    statuses: [],
    last: null,
    persist(fromRemote) {
      app.persistCalls++;
      if (fromRemote) app.remotePersists++;
    },
    onRemoteChange() {
      app.remoteChanges++;
    },
    setSyncStatus(st) {
      app.statuses.push(st);
      app.last = st;
    },
  };
  return app;
}

const draft = (id, extra = {}) => ({ id, status: 'draft', book: 'product', counts: {}, overrides: {}, filled: {}, createdAt: '2026-09-01T00:00:00.000Z', ...extra });
const baseState = (over = {}) => ({ items: [], groups: [], sessions: [], orders: [], settings: {}, ui: { tab: 'count', activeSessionId: null }, ...over });
const ids = (list) => list.map((d) => d.id);

/** 시작 → 확정 스냅샷 전부 → 부트스트랩 flush 까지 끝낸 엔진 */
async function boot(state, remote = {}, opts = {}, store = newStore()) {
  const app = fakeApp(state);
  const backend = fakeBackend(remote, store);
  // 원격에 무엇이든 있는 fixture 는 "처음 올리기가 끝난 저장소"로 본다 (meta/store 표시). partial 옵션이면 표시 없이 = 올리다 만 저장소
  const hasData = ['items', 'groups', 'sessions', 'orders', 'meta'].some((c) => store[c].size > 0);
  if (hasData && !opts.partial && !store.meta.has('store')) store.meta.set('store', { seededAt: '2026-09-01T00:00:00.000Z', version: 1 });
  const sync = createSync(app, backend, { ...OPTS, ...opts });
  sync.start();
  backend.emitAll();
  await settle();
  return { app, backend, sync, store, pull: (coll = 'sessions') => backend.emit(coll) };
}

/** 저장소 하나를 같이 쓰는 기기 두 대 (A·B). 서로의 쓰기는 각자 pull() 로 받는다 */
async function twoDevices() {
  const store = newStore();
  store.meta.set('settings', {});
  store.meta.set('store', { seededAt: '2026-09-01T00:00:00.000Z', version: 1 });
  const A = await boot(baseState(), {}, {}, store);
  const B = await boot(baseState(), {}, {}, store);
  return { store, A, B };
}

// ── 순수 함수 ─────────────────────────────────────────────
test('stable·diff·applyPatch·patchForBackend·stripNulls·sharedSettings', () => {
  assert.equal(stable({ b: 1, a: [1, { d: 2, c: 3 }] }), stable({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.notEqual(stable({ a: 1 }), stable({ a: '1' }));
  const a = { counts: { x: 1, y: 2 }, note: 'n', arr: [1, 2] };
  const b = { counts: { x: 1, z: 3 }, arr: [1, 2, 3], added: true };
  const p = diff(a, b);
  assert.deepEqual(p, { counts: { y: DEL, z: 3 }, note: DEL, arr: [1, 2, 3], added: true });
  assert.deepEqual(applyPatch(a, p), b);
  assert.deepEqual(diff(a, a), {});
  assert.deepEqual(patchForBackend(p), { counts: { y: null, z: 3 }, note: null, arr: [1, 2, 3], added: true });
  assert.deepEqual(stripNulls({ counts: { x: null, y: 5 }, gone: null, list: [null, 1] }), { counts: { y: 5 }, list: [null, 1] });
  assert.deepEqual(sharedSettings({ storeName: 's', apiKey: 'k', shareConfig: 'c', orderDays: [1] }), { storeName: 's', orderDays: [1] });
});

// ── 1. 첫 기기 ────────────────────────────────────────────
test('1. 원격이 비어 있으면: 확정 스냅샷이 다 오면 flush 가 로컬 전체를 올리고 다 올라가야 on (order 필드 · 설정에서 apiKey/shareConfig 제외)', async () => {
  const state = baseState({
    items: [
      { id: 'a', name: 'A', par: 3 },
      { id: 'b', name: 'B', par: null },
    ],
    groups: [
      { id: 'g1', title: 'G1' },
      { id: 'g2', title: 'G2' },
    ],
    sessions: [draft('s1', { counts: { a: 1 } })],
    orders: [{ id: 'o1', sessionId: 's1', book: 'product', date: '2026-09-04', lines: [{ itemId: 'a', qty: 2 }], text: 'x' }],
    settings: { storeName: '매장', orderDays: [1, 4], apiKey: 'sk-secret', shareConfig: '{"firebase":{}}' },
    ui: { tab: 'count', activeSessionId: 's1' },
  });
  const app = fakeApp(state);
  const backend = fakeBackend();
  const sync = createSync(app, backend, OPTS);
  sync.start();
  assert.equal(app.last.state, 'connecting');
  assert.equal(app.last.backend, 'fake');
  assert.equal(backend.watchers.length, 6, '컬렉션 4 + 설정 문서 1 + 표시 문서 1');
  backend.emit('items');
  backend.emit('groups');
  backend.emit('sessions');
  backend.emit('orders');
  assert.equal(app.last.state, 'connecting', '설정 문서 스냅샷 전에는 아직');
  assert.equal(sync.ready, false);
  backend.emit('meta');
  assert.equal(sync.ready, true);
  assert.equal(app.last.state, 'connecting', '로컬을 다 올리기 전에는 아직 연결 중 (on 은 첫 push 가 끝난 뒤)');
  assert.equal(app.remotePersists, 0, '원격이 비었으면 로컬을 건드리지 않는다');
  assert.equal(app.remoteChanges, 0);
  await settle();
  assert.ok(backend.calls.every((c) => c.op === 'set'), 'set 만');
  const by = (coll) => backend.calls.filter((c) => c.coll === coll);
  assert.deepEqual(
    by('items').map((c) => [c.id, c.doc.order]),
    [
      ['a', 0],
      ['b', 1],
    ],
  );
  assert.deepEqual(by('items')[0].doc, { id: 'a', name: 'A', par: 3, order: 0 });
  assert.deepEqual(
    by('groups').map((c) => [c.id, c.doc.order]),
    [
      ['g1', 0],
      ['g2', 1],
    ],
  );
  assert.deepEqual(by('sessions').map((c) => c.id), ['s1']);
  assert.deepEqual(by('sessions')[0].doc, state.sessions[0]);
  assert.deepEqual(by('orders')[0].doc, state.orders[0]);
  assert.equal(by('meta').length, 2, '설정 + "다 올렸다" 표시');
  assert.equal(by('meta')[0].id, 'settings');
  assert.deepEqual(by('meta')[0].doc, { storeName: '매장', orderDays: [1, 4] });
  assert.equal(by('meta')[1].id, 'store', '표시 문서는 맨 마지막에');
  assert.equal(backend.calls.at(-1).id, 'store');
  assert.equal(backend.calls.length, 2 + 2 + 1 + 1 + 1 + 1);
  // 맞춘 상태 기록
  assert.deepEqual([...sync._synced.items.keys()], ['a', 'b']);
  assert.equal(sync._synced.items.get('a'), stable({ id: 'a', name: 'A', par: 3, order: 0 }));
  assert.deepEqual([...sync._synced.groups.keys()], ['g1', 'g2']);
  assert.deepEqual([...sync._synced.sessions.keys()], ['s1']);
  assert.deepEqual([...sync._synced.orders.keys()], ['o1']);
  assert.equal(sync._synced.meta, stable({ storeName: '매장', orderDays: [1, 4] }));
  assert.equal(backend.store.items.get('b').order, 1);
  assert.ok(!('order' in state.items[0]), '로컬 상태에는 order 를 붙이지 않는다');
  assert.equal(app.last.state, 'on');
  assert.ok(app.last.lastSyncAt > 0);
  // 다시 flush 해도 보낼 것이 없다
  backend.calls.length = 0;
  await sync.flush();
  assert.equal(backend.calls.length, 0);
});

// ── 2. 두 번째 기기 ───────────────────────────────────────
test('2. 원격에 데이터가 있으면: 품목은 원격 순서로 교체, 빈 초안은 버림, 값 있는 초안은 원격의 같은 장부 초안에 합쳐 update 로 올림, 설정은 원격 우선(apiKey 유지)', async () => {
  const state = baseState({
    items: [
      { id: 'seed1', name: '시드1' },
      { id: 'seed2', name: '시드2' },
    ],
    groups: [{ id: 'gs', title: '시드그룹' }],
    sessions: [draft('d_local', { createdAt: '2026-09-05T00:00:00.000Z' }), draft('d_supply', { book: 'supply', counts: { seed1: 2 }, createdAt: '2026-09-05T00:00:01.000Z' })],
    orders: [{ id: 'o_local', sessionId: 'x', book: 'product', date: '2026-09-04', lines: [], text: '' }],
    settings: { storeName: '로컬', senderName: '나', apiKey: 'sk-local', shareConfig: 'cfg' },
    ui: { tab: 'count', activeSessionId: 'd_local' },
  });
  const remote = {
    items: { b: { id: 'b', name: 'B', order: 1 }, a: { id: 'a', name: 'A', order: 0 }, c: { id: 'c', name: 'C', order: 2 } },
    groups: { g2: { id: 'g2', title: 'G2', order: 1 }, g1: { id: 'g1', title: 'G1', order: 0 } },
    sessions: {
      d_remote: draft('d_remote', { createdAt: '2026-09-04T00:00:00.000Z' }),
      d_remote_supply: draft('d_remote_supply', { book: 'supply', createdAt: '2026-09-04T00:00:01.000Z' }),
      sub1: draft('sub1', { status: 'submitted', counts: { a: 1 }, createdAt: '2026-09-01T00:00:00.000Z' }),
    },
    orders: { o1: { id: 'o1', sessionId: 'sub1', book: 'product', date: '2026-09-01', lines: [], text: '' } },
    meta: { settings: { storeName: '원격', supplierName: '씨앤비' } },
  };
  const { app, backend, sync } = await boot(state, remote);
  const s = app.state;
  assert.equal(app.last.state, 'on');
  assert.deepEqual(ids(s.items), ['a', 'b', 'c'], '로컬 시드는 원격 품목으로 교체, 원격 order 순');
  assert.ok(s.items.every((it) => !('order' in it)), '로컬 상태에는 order 없음');
  assert.deepEqual(ids(s.groups), ['g1', 'g2']);
  assert.ok(!s.sessions.some((x) => x.id === 'd_local'), '빈 로컬 초안은 원격에 같은 장부 초안이 있으니 버림');
  assert.ok(s.sessions.some((x) => x.id === 'd_remote'));
  assert.ok(s.sessions.some((x) => x.id === 'sub1'));
  assert.ok(!s.sessions.some((x) => x.id === 'd_supply'), '값이 있는 로컬 초안은 더 먼저 만든 원격 초안에 합쳐진다 (따로 남지 않음)');
  assert.deepEqual(s.sessions.find((x) => x.id === 'd_remote_supply').counts, { seed1: 2 }, '입력은 남는 초안으로 옮겨진다');
  assert.equal(s.ui.activeSessionId, null, '버린 초안을 가리키던 활성 세션은 풀린다');
  assert.deepEqual(ids(s.orders), ['o_local', 'o1']);
  assert.deepEqual(s.settings, { storeName: '원격', senderName: '나', supplierName: '씨앤비', apiKey: 'sk-local', shareConfig: 'cfg' });
  assert.equal(app.remotePersists, 1);
  assert.equal(app.remoteChanges, 1);
  // flush: 원격에 없던 로컬 문서만 올라간다 (합친 초안은 옮긴 입력만 update)
  assert.deepEqual(
    backend.calls.map((c) => `${c.op} ${c.coll}/${c.id}`).sort(),
    ['set meta/settings', 'set orders/o_local', 'update sessions/d_remote_supply'],
  );
  assert.deepEqual(backend.calls.find((c) => c.op === 'update').patch, { counts: { seed1: 2 } });
  assert.deepEqual(backend.store.sessions.get('d_remote_supply').counts, { seed1: 2 });
  assert.deepEqual(backend.calls.find((c) => c.coll === 'meta').doc, { storeName: '원격', senderName: '나', supplierName: '씨앤비' });
  assert.deepEqual([...sync._synced.items.keys()].sort(), ['a', 'b', 'c']);
  assert.ok(!sync._synced.sessions.has('d_supply'));
  assert.equal(sync._synced.sessions.get('d_remote_supply'), stable(s.sessions.find((x) => x.id === 'd_remote_supply')));
  assert.equal(sync._synced.meta, stable({ storeName: '원격', senderName: '나', supplierName: '씨앤비' }));
  assert.ok(!backend.store.sessions.has('d_local'));
  assert.ok(!backend.store.sessions.has('d_supply'));
});

// ── 3. 진행 중 원격 변경 + 삼방 병합 ───────────────────────
test('3. 세션의 원격 변경은 항목별로 반영되고, 아직 안 보낸 로컬 변경은 살아남아 중첩 patch 로 update 된다', async () => {
  const remote = { sessions: { s1: draft('s1', { counts: { a: 1 } }) }, meta: { settings: { storeName: 'x' } } };
  const { app, backend, sync } = await boot(baseState({ settings: { storeName: 'x' } }), remote);
  assert.equal(backend.calls.length, 0, '원격과 같으면 아무것도 올리지 않는다');
  assert.equal(app.last.state, 'on', '올릴 것이 없으면 바로 on');
  assert.equal(app.remoteChanges, 1);
  // 마지막 flush 뒤의 로컬 변경 (아직 안 보냄)
  app.state.sessions[0].counts.b = 7;
  // 원격에서 다른 항목이 바뀜
  backend.store.sessions.get('s1').counts.a = 3;
  backend.emit('sessions');
  assert.deepEqual(app.state.sessions[0].counts, { a: 3, b: 7 }, '원격 a=3 위에 로컬 b=7 을 다시 얹음');
  assert.equal(app.remoteChanges, 2);
  assert.equal(app.remotePersists, 2);
  assert.ok(app.last.lastSyncAt > 0);
  sync.schedule();
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'update', coll: 'sessions', id: 's1', patch: { counts: { b: 7 } } }]);
  assert.deepEqual(backend.store.sessions.get('s1').counts, { a: 3, b: 7 });
  assert.equal(sync._synced.sessions.get('s1'), stable(app.state.sessions[0]));
  // 원격이 그 결과를 되돌려 보내도 변화 없음 · 바뀐 게 없으면 아무것도 보내지 않음
  backend.calls.length = 0;
  backend.emit('sessions');
  assert.equal(app.remoteChanges, 2);
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0);
});

// ── 4. 삭제 표시(null) ────────────────────────────────────
test('4. 수량 지움(키 삭제) → update { counts: { x: null } } · 원격 문서의 null 잎은 반영할 때 걷어낸다', async () => {
  const remote = { sessions: { s1: draft('s1', { counts: { x: 2, y: 5 } }) } };
  const { app, backend, sync } = await boot(baseState(), remote);
  assert.deepEqual(backend.calls, [{ op: 'set', coll: 'meta', id: 'settings', doc: {} }], '원격에 설정 문서가 없으면 빈 설정을 만든다');
  backend.calls.length = 0;
  delete app.state.sessions[0].counts.x;
  sync.schedule();
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'update', coll: 'sessions', id: 's1', patch: { counts: { x: null } } }]);
  assert.deepEqual(backend.store.sessions.get('s1').counts, { y: 5 });
  // 삭제 표시가 남아 있는 원격 문서
  backend.store.sessions.set('s1', { ...backend.store.sessions.get('s1'), counts: { x: null, y: 5, z: 1 }, note: null });
  backend.emit('sessions');
  const sess = app.state.sessions[0];
  assert.deepEqual(sess.counts, { y: 5, z: 1 });
  assert.ok(!('x' in sess.counts));
  assert.ok(!('note' in sess));
  backend.calls.length = 0;
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0, '걷어낸 문서를 다시 올리지 않는다');
});

// ── 5. 문서 통째 컬렉션 ───────────────────────────────────
test('5. 품목·분류: 편집은 set(전체 문서 + order), 로컬 삭제는 remove, 원격 삭제는 로컬에서도 지운다', async () => {
  const state = baseState({
    items: [
      { id: 'a', name: 'A', par: 1 },
      { id: 'b', name: 'B', par: 2 },
    ],
    groups: [
      { id: 'g1', title: 'G1' },
      { id: 'g2', title: 'G2' },
    ],
  });
  const { app, backend, sync } = await boot(state, {});
  backend.calls.length = 0;
  app.state.items[0].name = 'A2';
  sync.schedule();
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'set', coll: 'items', id: 'a', doc: { id: 'a', name: 'A2', par: 1, order: 0 } }]);
  // 로컬 삭제
  backend.calls.length = 0;
  app.state.items = app.state.items.filter((it) => it.id !== 'b');
  sync.schedule();
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'remove', coll: 'items', id: 'b' }]);
  assert.ok(!backend.store.items.has('b'));
  assert.ok(!sync._synced.items.has('b'));
  // 분류 순서 바꿈 → order 만 바뀐 문서는 통째가 아니라 order 만 update
  backend.calls.length = 0;
  app.state.groups.reverse();
  sync.schedule();
  await settle();
  assert.deepEqual(
    backend.calls.map((c) => [c.op, c.id, c.patch]),
    [
      ['update', 'g2', { order: 0 }],
      ['update', 'g1', { order: 1 }],
    ],
  );
  assert.equal(backend.store.groups.get('g2').order, 0);
  // 원격 삭제 + 원격 추가
  backend.calls.length = 0;
  backend.store.items.delete('a');
  backend.store.items.set('c', { id: 'c', name: 'C', order: 0 });
  backend.emit('items');
  assert.deepEqual(app.state.items, [{ id: 'c', name: 'C' }]);
  assert.equal(app.remoteChanges, 1);
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0, '원격에서 지운 문서를 다시 올리지 않는다');
  // 원격 분류 순서가 바뀌면 로컬 순서도 따라간다
  backend.store.groups.set('g1', { id: 'g1', title: 'G1', order: 0 });
  backend.store.groups.set('g2', { id: 'g2', title: 'G2', order: 1 });
  backend.emit('groups');
  assert.deepEqual(ids(app.state.groups), ['g1', 'g2']);
});

// ── 6. update 거부 → set ──────────────────────────────────
test('6. update 가 invalid_argument 로 거부되면 문서 전체를 set 한다', async () => {
  const remote = { sessions: { s1: draft('s1', { counts: { a: 1 } }) }, meta: { settings: {} } };
  const { app, backend, sync } = await boot(baseState(), remote);
  backend.calls.length = 0;
  backend.rejectUpdateOnce = Object.assign(new Error('document does not exist'), { code: 'invalid_argument' });
  app.state.sessions[0].counts.q = 1;
  sync.schedule();
  await settle();
  assert.deepEqual(
    backend.calls.map((c) => c.op),
    ['update', 'set'],
  );
  assert.deepEqual(backend.calls[1], { op: 'set', coll: 'sessions', id: 's1', doc: app.state.sessions[0] });
  assert.deepEqual(backend.store.sessions.get('s1').counts, { a: 1, q: 1 });
  assert.equal(app.last.state, 'on');
  assert.equal(sync._synced.sessions.get('s1'), stable(app.state.sessions[0]));
});

// ── 7. 쓰기 실패 → 재시도 ─────────────────────────────────
test('7. 쓰기 실패: 상태 error, 재시도 예약, 백엔드가 살아나면 다시 on', async () => {
  const { app, backend, sync } = await boot(baseState({ items: [{ id: 'a', name: 'A' }], settings: { storeName: 's' } }), {});
  backend.calls.length = 0;
  backend.fail = Object.assign(new Error('unavailable'), { code: 'unavailable' });
  app.state.items[0].name = 'A2';
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 1, '한 번 시도');
  assert.equal(app.last.state, 'error');
  assert.equal(app.last.error, 'unavailable');
  assert.notEqual(sync._synced.items.get('a'), stable({ id: 'a', name: 'A2', order: 0 }), '실패한 쓰기는 맞춘 상태로 기록하지 않는다');
  await sleep(100);
  assert.equal(backend.calls.length, 1, '재시도는 backoff(1초) 뒤에');
  assert.equal(app.last.state, 'error');
  backend.fail = null;
  await sleep(1100);
  assert.equal(backend.calls.length, 2, '예약된 재시도');
  assert.deepEqual(backend.calls[1], { op: 'set', coll: 'items', id: 'a', doc: { id: 'a', name: 'A2', order: 0 } });
  assert.equal(app.last.state, 'on');
  assert.equal(app.last.error, null);
  assert.equal(backend.store.items.get('a').name, 'A2');
  assert.equal(sync._synced.items.get('a'), stable({ id: 'a', name: 'A2', order: 0 }));
  // 감시 오류도 상태에 드러난다
  backend.error('items', new Error('permission-denied'));
  assert.equal(app.last.state, 'error');
  assert.equal(app.last.error, 'permission-denied');
});

test('7b. 실패한 뒤 로컬이 또 바뀌면 backoff 를 기다리지 않고 바로 다시 보낸다', async () => {
  const { app, backend, sync } = await boot(baseState({ items: [{ id: 'a', name: 'A' }] }), {});
  backend.calls.length = 0;
  backend.fail = new Error('unavailable');
  app.state.items[0].name = 'A2';
  sync.schedule();
  await settle();
  assert.equal(app.last.state, 'error');
  backend.fail = null;
  app.state.items[0].name = 'A3';
  sync.schedule();
  await settle();
  assert.equal(app.last.state, 'on');
  assert.equal(backend.store.items.get('a').name, 'A3');
  assert.equal(backend.calls.length, 2);
});

// ── 8. 초안 중복 제거 ─────────────────────────────────────
test('8. 같은 장부의 초안이 여럿이면 가장 먼저 만든 것만 남기고 나머지는 원격에서도 지운다 (값 있는 초안의 입력은 남는 초안에 합침)', async () => {
  const remote = {
    sessions: {
      d2: draft('d2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      d1: draft('d1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      d3: draft('d3', { counts: { a: 1, b: 2 }, filled: { b: true }, overrides: { c: 4 }, createdAt: '2026-01-03T00:00:00.000Z' }),
      sup: draft('sup', { book: 'supply', createdAt: '2026-01-05T00:00:00.000Z' }),
    },
    meta: { settings: {} },
  };
  const { app, backend, sync } = await boot(baseState({ ui: { tab: 'count', activeSessionId: 'd2' } }), remote);
  assert.deepEqual(ids(app.state.sessions).sort(), ['d1', 'sup']);
  const d1 = app.state.sessions.find((x) => x.id === 'd1');
  assert.deepEqual([d1.counts, d1.filled, d1.overrides], [{ a: 1, b: 2 }, { b: true }, { c: 4 }], 'd3 의 입력(채움 표시·발주 수정 포함)은 d1 로 옮겨진다');
  assert.equal(app.state.ui.activeSessionId, null);
  assert.deepEqual(backend.calls, [
    { op: 'update', coll: 'sessions', id: 'd1', patch: { counts: { a: 1, b: 2 }, filled: { b: true }, overrides: { c: 4 } } },
    { op: 'remove', coll: 'sessions', id: 'd2' },
    { op: 'remove', coll: 'sessions', id: 'd3' },
  ]);
  assert.deepEqual([...backend.store.sessions.keys()].sort(), ['d1', 'sup']);
  assert.deepEqual(backend.store.sessions.get('d1').counts, { a: 1, b: 2 });
  // 진행 중: 다른 기기가 더 먼저 만든 빈 초안을 올리면 그것을 남기고 지금 것을 지운다 — 입력은 옮기고, flush 는 엔진이 예약한다
  backend.calls.length = 0;
  app.state.ui.activeSessionId = 'd1';
  backend.store.sessions.set('d0', draft('d0', { counts: { a: 9 }, createdAt: '2025-12-31T00:00:00.000Z' }));
  backend.emit('sessions');
  assert.deepEqual(ids(app.state.sessions).sort(), ['d0', 'sup']);
  assert.deepEqual(app.state.sessions.find((x) => x.id === 'd0').counts, { a: 9, b: 2 }, '남는 초안에 이미 센 품목(a)은 그대로, 없는 품목(b)만 옮겨진다');
  assert.equal(app.state.ui.activeSessionId, null);
  assert.ok(sync._synced.sessions.has('d1'), '아직 원격에는 남아 있다');
  await settle();
  assert.deepEqual(backend.calls, [
    { op: 'update', coll: 'sessions', id: 'd0', patch: { counts: { b: 2 }, filled: { b: true }, overrides: { c: 4 } } },
    { op: 'remove', coll: 'sessions', id: 'd1' },
  ]);
  assert.deepEqual([...backend.store.sessions.keys()].sort(), ['d0', 'sup']);
  assert.ok(!sync._synced.sessions.has('d1'));
  // 합친 결과가 되돌아와도 더 보낼 것은 없다
  backend.calls.length = 0;
  backend.emit('sessions');
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0);
});

// ── 9. readyTimeout ───────────────────────────────────────
test('9. 빈 캐시 스냅샷(fromCache)만 왔으면 시간이 지나도 "원격이 비었다"고 보지 않고 기다린다 — 서버 확답이 와야 올린다', async () => {
  const app = fakeApp(baseState({ items: [{ id: 'a', name: 'A' }] }));
  const backend = fakeBackend();
  const sync = createSync(app, backend, { debounceMs: 5, readyTimeoutMs: 40 });
  sync.start();
  backend.emitAll({ fromCache: true });
  assert.equal(sync.ready, false);
  assert.equal(app.last.state, 'connecting');
  await sleep(70);
  assert.equal(sync.ready, false, '캐시가 비어 있을 뿐 서버 확답이 없으면 시드를 올리지 않는다');
  assert.equal(app.last.state, 'connecting');
  assert.equal(backend.calls.length, 0);
  // 서버에는 다른 기기의 데이터가 있었다 → 확답이 오면 그것을 기준으로 맞춘다 (시드로 덮어쓰지 않음)
  backend.store.items.set('a', { id: 'a', name: 'REMOTE', order: 0 });
  backend.store.meta.set('settings', {});
  backend.store.meta.set('store', { seededAt: 'x', version: 1 });
  backend.emitAll({ fromCache: false });
  assert.equal(sync.ready, true);
  await settle();
  assert.equal(app.state.items[0].name, 'REMOTE');
  assert.equal(backend.calls.length, 0, '원격이 기준이므로 올릴 것이 없다');
  assert.equal(app.last.state, 'on');
});

test('9c. 캐시에 데이터가 있으면(오프라인 재시작) 시간이 지난 뒤 캐시를 기준으로 맞추고 시작한다', async () => {
  const app = fakeApp(baseState({ items: [{ id: 'a', name: 'A' }] }));
  const backend = fakeBackend({ items: { a: { id: 'a', name: 'CACHED', order: 0 } }, meta: { settings: {}, store: { seededAt: 'x', version: 1 } } });
  const sync = createSync(app, backend, { debounceMs: 5, readyTimeoutMs: 40 });
  sync.start();
  backend.emitAll({ fromCache: true });
  await sleep(70);
  assert.equal(sync.ready, true);
  assert.equal(app.state.items[0].name, 'CACHED');
  assert.equal(backend.calls.length, 0);
});

test('9b. 첫 스냅샷이 다 오지 않았으면 시간이 지나도 기다리고, 확정 스냅샷이 다 오면 바로 시작한다', async () => {
  const app = fakeApp(baseState({ items: [{ id: 'a', name: 'A' }] }));
  const backend = fakeBackend();
  const sync = createSync(app, backend, { debounceMs: 5, readyTimeoutMs: 20 });
  sync.start();
  backend.emit('items', { fromCache: true });
  await sleep(50);
  assert.equal(sync.ready, false, '컬렉션이 하나라도 안 왔으면 시작하지 않는다');
  assert.equal(app.last.state, 'connecting');
  backend.emitAll({ fromCache: false });
  assert.equal(sync.ready, true);
  await settle(); // 부트스트랩 flush(품목 a·설정)가 끝나야 on
  assert.equal(app.last.state, 'on');
});

// ── 10. close ─────────────────────────────────────────────
test('10. close(): 구독 해제 · 백엔드 닫기 · 상태 off · 이후 schedule/flush/스냅샷은 무시', async () => {
  const { app, backend, sync } = await boot(baseState({ items: [{ id: 'a', name: 'A' }] }), {});
  assert.equal(backend.watchers.length, 6);
  backend.calls.length = 0;
  sync.close();
  assert.equal(backend.watchers.length, 0, '모두 구독 해제');
  assert.equal(backend.closed, true);
  assert.equal(app.last.state, 'off');
  app.state.items.push({ id: 'z', name: 'Z' });
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0);
  assert.equal(await sync.flush(), undefined);
  assert.equal(backend.calls.length, 0);
  // 닫힌 뒤에 스냅샷이 와도 (구독 해제 전에 큐에 있던 것처럼) 로컬을 건드리지 않는다
  const before = app.remoteChanges;
  backend.watchers.push({ coll: 'items', cb: () => {} }); // emit 대상이 있어도
  backend.store.items.set('q', { id: 'q', name: 'Q', order: 0 });
  backend.emit('items');
  assert.equal(app.remoteChanges, before);
  assert.ok(!app.state.items.some((it) => it.id === 'q'));
});

// ── 11. 전송 중 원격 스냅샷 ────────────────────────────────
test('11. update 를 보내는 동안 다른 기기의 스냅샷이 오면: 맞춘 상태는 "그 스냅샷 + 보낸 patch" — 남의 변경을 되돌리거나 다시 쓰지 않는다', async () => {
  const remote = { sessions: { s1: draft('s1', { counts: { a: 1 } }) }, meta: { settings: {} } };
  const { app, backend, sync } = await boot(baseState(), remote);
  backend.calls.length = 0;
  backend.defer = true;
  app.state.sessions[0].counts.b = 7;
  const flushing = sync.flush();
  assert.deepEqual(backend.calls, [{ op: 'update', coll: 'sessions', id: 's1', patch: { counts: { b: 7 } } }]);
  assert.equal(backend.pending.length, 1, 'update 가 아직 서버에 닿지 않음');
  // 그 사이 다른 기기가 a=3 → 스냅샷이 먼저 도착
  backend.store.sessions.get('s1').counts.a = 3;
  backend.emit('sessions');
  assert.deepEqual(app.state.sessions[0].counts, { a: 3, b: 7 });
  assert.deepEqual(JSON.parse(sync._synced.sessions.get('s1')).counts, { a: 3 });
  backend.release();
  await flushing;
  assert.deepEqual(backend.store.sessions.get('s1').counts, { a: 3, b: 7 });
  assert.deepEqual(JSON.parse(sync._synced.sessions.get('s1')).counts, { a: 3, b: 7 }, '보내기 전 문서({a:1,b:7})로 덮어쓰지 않는다');
  assert.equal(sync._synced.sessions.get('s1'), stable(app.state.sessions[0]), '맞춘 상태 = 원격 = 로컬');
  assert.equal(app.last.state, 'on');
  // 원격이 다시 a=5 → 그대로 반영된다 (a=3 이 미전송 로컬 변경으로 둔갑해 있으면 되돌아갔을 것)
  backend.defer = false;
  backend.store.sessions.get('s1').counts.a = 5;
  backend.emit('sessions');
  assert.deepEqual(app.state.sessions[0].counts, { a: 5, b: 7 });
  backend.calls.length = 0;
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0, '보낼 것이 없다');
  // 다음 로컬 변경은 그 변경만 보낸다 (a 를 다시 쓰지 않음)
  app.state.sessions[0].counts.c = 1;
  sync.schedule();
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'update', coll: 'sessions', id: 's1', patch: { counts: { c: 1 } } }]);
  assert.deepEqual(backend.store.sessions.get('s1').counts, { a: 5, b: 7, c: 1 });
});

test('11b. 전송 중 스냅샷이 와도 update 가 거부되어 set 으로 대체했으면 맞춘 상태는 보낸 문서 그대로', async () => {
  const remote = { sessions: { s1: draft('s1', { counts: { a: 1 } }) }, meta: { settings: {} } };
  const { app, backend, sync } = await boot(baseState(), remote);
  backend.calls.length = 0;
  backend.defer = true;
  app.state.sessions[0].counts.b = 7;
  const flushing = sync.flush();
  backend.store.sessions.delete('s1'); // 서버에 닿기 전에 문서가 사라짐 → update 는 invalid_argument
  backend.emit('sessions'); // 사라진 스냅샷: 세고 있던 초안이라 로컬은 버리지 않고 새 문서로 다시 올릴 준비
  assert.deepEqual(ids(app.state.sessions), ['s1']);
  backend.release();
  await sleep(0);
  backend.release(); // 대체 set
  await flushing;
  assert.deepEqual(
    backend.calls.map((c) => c.op),
    ['update', 'set'],
  );
  assert.deepEqual(backend.store.sessions.get('s1').counts, { a: 1, b: 7 });
  assert.equal(sync._synced.sessions.get('s1'), stable(app.state.sessions[0]));
});

// ── 12. 두 기기의 초안 정리 경합 ──────────────────────────
const sessionCalls = (dev) => dev.backend.calls.filter((c) => c.coll === 'sessions').map((c) => `${c.op} ${c.id}`);

test('12. 두 기기가 동시에 초안을 만들고 한쪽이 지는 초안에 입력 → 상대의 정리 remove 와 엇갈려도 입력은 남는 초안으로 옮겨져 살아남는다', async () => {
  const { store, A, B } = await twoDevices();
  // 둘 다 재고조사 탭으로 → 각자 빈 초안. A 의 것이 조금 늦게 만들어져 정리 대상(지는 쪽)
  A.app.state.sessions.push(draft('d1', { createdAt: '2026-09-06T00:00:01.000Z' }));
  A.app.state.ui.activeSessionId = 'd1';
  A.sync.schedule();
  B.app.state.sessions.push(draft('d0', { createdAt: '2026-09-06T00:00:00.000Z' }));
  B.app.state.ui.activeSessionId = 'd0';
  B.sync.schedule();
  await settle();
  assert.deepEqual([...store.sessions.keys()].sort(), ['d0', 'd1']);
  // B 가 d1(아직 빈 초안)을 받고 로컬에서 버린다 → 엔진이 정리 flush(remove d1)를 예약한다. 그 remove 를 전송 중 상태로 붙잡아 둔다
  B.backend.defer = true;
  B.pull();
  assert.deepEqual(ids(B.app.state.sessions), ['d0']);
  assert.equal(B.app.state.ui.activeSessionId, 'd0');
  await settle();
  assert.deepEqual(sessionCalls(B), ['set d0', 'remove d1']);
  assert.equal(B.backend.pending.length, 1, 'remove d1 이 전송 중');
  // A 는 아직 d0 을 받지 못한 채 d1 에 x=5 를 세고, 그것이 원격에 먼저 닿는다
  A.app.state.sessions[0].counts.x = 5;
  A.sync.schedule();
  await settle();
  assert.deepEqual(store.sessions.get('d1').counts, { x: 5 });
  // B 의 remove 가 그 뒤에 닿는다 → 원격에서 d1 이 x=5 와 함께 사라진다
  B.backend.release();
  B.backend.defer = false;
  await settle();
  assert.deepEqual([...store.sessions.keys()], ['d0']);
  assert.equal(B.app.last.state, 'on');
  // A 가 "d1 없음" 스냅샷을 받는다: 세고 있던 입력을 버리지 않고 남은 초안 d0 에 합쳐 올린다
  A.pull();
  assert.deepEqual(ids(A.app.state.sessions), ['d0'], 'A 도 같은 초안 하나로');
  assert.deepEqual(A.app.state.sessions[0].counts, { x: 5 }, 'A 의 x=5 는 남는 초안으로 옮겨짐');
  assert.equal(A.app.state.ui.activeSessionId, null, '앱은 남은 초안을 활성 세션으로 잡는다');
  assert.equal(A.app.remoteChanges, 2);
  await settle();
  assert.deepEqual(sessionCalls(A), ['set d1', 'update d1', 'update d0']);
  assert.deepEqual(A.backend.calls.at(-1).patch, { counts: { x: 5 } });
  assert.deepEqual(store.sessions.get('d0').counts, { x: 5 });
  // B 가 그 사이 센 y=1 도, A 의 x=5 도 양쪽 모두에 남는다
  B.app.state.sessions[0].counts.y = 1;
  B.sync.schedule();
  await settle();
  A.pull();
  B.pull();
  assert.deepEqual(A.app.state.sessions[0].counts, { x: 5, y: 1 });
  assert.deepEqual(B.app.state.sessions[0].counts, { x: 5, y: 1 });
  assert.deepEqual(store.sessions.get('d0').counts, { x: 5, y: 1 });
  assert.deepEqual([...store.sessions.keys()], ['d0'], '원격에는 초안 하나만');
  // 더 보낼 것은 없다
  A.backend.calls.length = 0;
  B.backend.calls.length = 0;
  A.sync.schedule();
  B.sync.schedule();
  await settle();
  assert.equal(A.backend.calls.length + B.backend.calls.length, 0);
  assert.equal(A.sync._synced.sessions.get('d0'), stable(A.app.state.sessions[0]));
  assert.equal(B.sync._synced.sessions.get('d0'), stable(B.app.state.sessions[0]));
});

test('12b. 반대 순서(A 의 update 가 B 의 remove 뒤에 닿아 set 으로 되살아남)여도 양쪽이 다시 합쳐 초안 하나로 모인다', async () => {
  const { store, A, B } = await twoDevices();
  A.app.state.sessions.push(draft('d1', { createdAt: '2026-09-06T00:00:01.000Z' }));
  A.app.state.ui.activeSessionId = 'd1';
  A.sync.schedule();
  B.app.state.sessions.push(draft('d0', { createdAt: '2026-09-06T00:00:00.000Z' }));
  B.app.state.ui.activeSessionId = 'd0';
  B.sync.schedule();
  await settle();
  // B 가 빈 d1 을 받아 버리고, 정리 remove 가 바로 닿는다
  B.pull();
  await settle();
  assert.deepEqual([...store.sessions.keys()], ['d0']);
  // A 는 d0 을 모른 채 d1 에 x=5 → update 는 거부(문서 없음) → set 으로 d1 이 x=5 와 함께 되살아난다
  A.app.state.sessions[0].counts.x = 5;
  A.sync.schedule();
  await settle();
  assert.deepEqual(sessionCalls(A), ['set d1', 'update d1', 'set d1']);
  assert.deepEqual([...store.sessions.keys()].sort(), ['d0', 'd1']);
  assert.equal(A.app.last.state, 'on');
  // B 가 d1{x:5} 를 받으면 d0 에 합치고 d1 을 다시 지운다
  B.pull();
  assert.deepEqual(ids(B.app.state.sessions), ['d0']);
  assert.deepEqual(B.app.state.sessions[0].counts, { x: 5 });
  await settle();
  assert.deepEqual(sessionCalls(B).slice(-2), ['update d0', 'remove d1']);
  assert.deepEqual([...store.sessions.keys()], ['d0']);
  assert.deepEqual(store.sessions.get('d0').counts, { x: 5 });
  // A 가 그 결과를 받으면 d0 하나만 남고 (x=5 는 이미 있으니) 더 보낼 것은 없다
  A.backend.calls.length = 0;
  A.pull();
  assert.deepEqual(ids(A.app.state.sessions), ['d0']);
  assert.deepEqual(A.app.state.sessions[0].counts, { x: 5 });
  assert.equal(A.app.state.ui.activeSessionId, null);
  await settle();
  assert.equal(A.backend.calls.length, 0);
  assert.equal(A.sync._synced.sessions.get('d0'), stable(A.app.state.sessions[0]));
});

test('12c. 세고 있던 초안이 원격에서 사라졌는데 같은 장부의 초안이 없으면 새 문서로 다시 올린다', async () => {
  const remote = { sessions: { d1: draft('d1', { counts: { x: 5 } }) }, meta: { settings: {} } };
  const { app, backend, sync } = await boot(baseState(), remote);
  app.state.ui.activeSessionId = 'd1'; // 앱이 세는 중
  backend.calls.length = 0;
  backend.store.sessions.delete('d1');
  backend.emit('sessions');
  assert.deepEqual(ids(app.state.sessions), ['d1'], '입력이 있는 초안은 버리지 않는다');
  assert.equal(app.state.ui.activeSessionId, 'd1');
  assert.ok(!sync._synced.sessions.has('d1'));
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'set', coll: 'sessions', id: 'd1', doc: app.state.sessions[0] }]);
  assert.ok(backend.store.sessions.has('d1'));
  // 빈 초안이 사라진 것은 그냥 따라간다
  backend.calls.length = 0;
  backend.store.sessions.set('e1', draft('e1', { createdAt: '2026-09-07T00:00:00.000Z' }));
  backend.emit('sessions');
  assert.deepEqual(ids(app.state.sessions).sort(), ['d1'], '나중에 만든 빈 초안은 정리된다');
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'remove', coll: 'sessions', id: 'e1' }]);
  backend.store.sessions.delete('d1');
  app.state.sessions[0].counts = {};
  backend.emit('sessions');
  assert.deepEqual(app.state.sessions, [], '빈 초안은 원격에서 사라지면 로컬에서도 사라진다');
});

// ── 13. 자기 쓰기의 메아리 (확인 전 스냅샷) ────────────────
test('13. 첫 push 중 입력: 보낸 문서의 메아리가 확인보다 먼저 와도 그 사이의 입력을 덮어쓰지 않고 다시 그리지 않으며, 다음 flush 가 그 입력만 보낸다 · 다 올라가기 전에는 connecting', async () => {
  const app = fakeApp(baseState({ items: [{ id: 'a', name: 'A' }], sessions: [draft('s1')], settings: { storeName: '매장' }, ui: { tab: 'count', activeSessionId: 's1' } }));
  const backend = fakeBackend();
  backend.defer = true; // 쓰기가 서버에 닿기까지 시간이 걸린다 (실제 Firestore: 문서마다 왕복 한 번, 100여 개면 수십 초)
  const sync = createSync(app, backend, OPTS);
  sync.start();
  backend.emitAll();
  assert.equal(sync.ready, true);
  assert.equal(app.last.state, 'connecting', '올릴 것이 있으면 다 올라갈 때까지 아직 연결 중');
  await sleep(10);
  assert.deepEqual(
    backend.calls.map((c) => `${c.op} ${c.coll}/${c.id}`),
    ['set items/a'],
    '첫 push 시작: 품목이 전송 중',
  );
  // 그 사이 사용자가 초안에 입력한다 (앱: persist → schedule)
  app.state.sessions[0].counts.milk = 3;
  sync.schedule();
  // 품목 set 이 닿고 그 메아리(품목 스냅샷)가 온다. 이어서 초안 set 이 나가는데, 보내는 문서는 flush 를 시작할 때의 것(빈 counts)
  backend.release();
  await sleep(0);
  backend.emit('items');
  assert.deepEqual(backend.calls.at(-1), { op: 'set', coll: 'sessions', id: 's1', doc: draft('s1') }, '초안은 flush 시작 때의 내용으로 나간다');
  // 초안 set 의 메아리가 확인(ack)보다 먼저 온다 — Firestore 의 hasPendingWrites 스냅샷
  backend.store.sessions.set('s1', draft('s1'));
  backend.emit('sessions', { fromCache: false, hasPendingWrites: true });
  assert.equal(app.state.sessions[0].counts.milk, 3, '메아리가 그 사이의 입력을 덮어쓰지 않는다');
  assert.equal(app.remoteChanges, 0, '자기 쓰기의 메아리로는 다시 그리지 않는다');
  assert.equal(app.remotePersists, 0);
  assert.equal(app.last.state, 'connecting');
  // 확인이 오고 나머지(설정)도 올라간다 → 이제 on. 그리고 그 사이의 입력(milk)만 update 로 뒤따른다
  backend.defer = false;
  backend.release();
  await settle();
  assert.equal(app.last.state, 'on');
  assert.deepEqual(
    backend.calls.map((c) => `${c.op} ${c.coll}/${c.id}`),
    ['set items/a', 'set sessions/s1', 'set meta/settings', 'set meta/store', 'update sessions/s1'],
  );
  assert.deepEqual(backend.calls.at(-1).patch, { counts: { milk: 3 } });
  assert.deepEqual(backend.store.sessions.get('s1').counts, { milk: 3 });
  assert.equal(sync._synced.sessions.get('s1'), stable(app.state.sessions[0]));
  assert.equal(app.state.sessions[0].counts.milk, 3);
  assert.equal(app.remoteChanges, 0);
  // 확인된 결과가 되돌아와도(hasPendingWrites=false) 변화 없음 · 더 보낼 것 없음
  backend.emitAll();
  assert.equal(app.remoteChanges, 0);
  backend.calls.length = 0;
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0);
});

test('13b. 병합 결과가 로컬과 같은 스냅샷(같은 입력을 양쪽에서 함)은 다시 그리지 않는다 · 설정 문서의 메아리도 건너뛰고 그 사이의 설정 변경은 살아남는다', async () => {
  const remote = { sessions: { s1: draft('s1', { counts: { a: 1 } }) }, meta: { settings: { storeName: 'x' } } };
  const { app, backend, sync } = await boot(baseState({ settings: { storeName: 'x' } }), remote);
  assert.equal(app.remoteChanges, 1);
  // 로컬에서 b=7 (아직 안 보냄) — 다른 기기도 b=7 을 올렸다
  app.state.sessions[0].counts.b = 7;
  backend.store.sessions.get('s1').counts.b = 7;
  backend.emit('sessions');
  assert.equal(app.remoteChanges, 1, '병합 결과가 로컬과 같으니 다시 그리지 않는다');
  assert.equal(app.remotePersists, 1);
  assert.equal(sync._synced.sessions.get('s1'), stable(app.state.sessions[0]), '맞춘 상태는 갱신된다');
  sync.schedule();
  await settle();
  assert.equal(backend.calls.length, 0, '보낼 것도 없다');
  // 설정 변경 → 전송 중에 메아리 → 다시 그리지 않고, 그 사이의 설정 변경도 살아남아 뒤따라 올라간다
  backend.defer = true;
  app.state.settings.storeName = 'y';
  const flushing = sync.flush();
  assert.deepEqual(backend.calls, [{ op: 'set', coll: 'meta', id: 'settings', doc: { storeName: 'y' } }]);
  app.state.settings.senderName = '나'; // 보내는 동안 또 바꿈
  sync.schedule();
  backend.store.meta.set('settings', { storeName: 'y' });
  backend.emit('meta', { fromCache: false, hasPendingWrites: true });
  assert.equal(app.remoteChanges, 1);
  assert.deepEqual(app.state.settings, { storeName: 'y', senderName: '나' });
  backend.defer = false;
  backend.release();
  await flushing;
  await settle();
  assert.deepEqual(backend.calls.at(-1), { op: 'set', coll: 'meta', id: 'settings', doc: { storeName: 'y', senderName: '나' } });
  assert.equal(sync._synced.meta, stable({ storeName: 'y', senderName: '나' }));
  assert.equal(app.remoteChanges, 1);
  assert.equal(app.last.state, 'on');
});

// ── 14. 로컬 삭제 vs 아직 그 문서가 든 스냅샷 ─────────────
test('14. 로컬에서 지운 문서는 원격 스냅샷에 아직 남아 있어도 되살리지 않는다 (remove 전송 전·전송 중 모두) — remove 만 나가고 다시 올리지 않는다', async () => {
  const remote = { items: { a: { id: 'a', name: 'A', order: 0 }, b: { id: 'b', name: 'B', order: 1 } }, meta: { settings: {} } };
  const { app, backend, sync } = await boot(baseState(), remote);
  backend.calls.length = 0;
  // 디바운스 안: b 를 지웠는데 flush 전에 다른 기기의 a 변경이 도착
  app.state.items = app.state.items.filter((it) => it.id !== 'b');
  sync.schedule();
  backend.store.items.get('a').name = 'A2';
  backend.emit('items');
  assert.deepEqual(app.state.items, [{ id: 'a', name: 'A2' }], 'b 는 지운 채로, a 는 원격 변경대로');
  assert.equal(app.remoteChanges, 2);
  await settle();
  assert.deepEqual(backend.calls, [{ op: 'remove', coll: 'items', id: 'b' }]);
  assert.ok(!backend.store.items.has('b'));
  // 전송 중: c 를 지우는 remove 가 서버에 닿기 전에 c 가 아직 든 스냅샷이 온다 (다른 기기의 a 변경)
  backend.store.items.set('c', { id: 'c', name: 'C', order: 2 });
  backend.emit('items');
  assert.deepEqual(ids(app.state.items), ['a', 'c']);
  backend.calls.length = 0;
  backend.defer = true;
  app.state.items = app.state.items.filter((it) => it.id !== 'c');
  const flushing = sync.flush();
  assert.deepEqual(backend.calls, [{ op: 'remove', coll: 'items', id: 'c' }]);
  backend.store.items.get('a').name = 'A3';
  backend.emit('items');
  assert.deepEqual(app.state.items, [{ id: 'a', name: 'A3' }], 'c 는 되살아나지 않는다');
  backend.defer = false;
  backend.release();
  await flushing;
  await settle();
  assert.ok(!backend.store.items.has('c'));
  assert.ok(!sync._synced.items.has('c'));
  assert.deepEqual(backend.calls, [{ op: 'remove', coll: 'items', id: 'c' }], '더 보낼 것은 없다 (c 를 다시 올리지 않는다)');
  // remove 의 메아리(c 없는 스냅샷)로는 다시 그리지 않는다
  const before = app.remoteChanges;
  backend.emit('items');
  assert.equal(app.remoteChanges, before);
  assert.deepEqual(app.state.items, [{ id: 'a', name: 'A3' }]);
});

// ── 15. 첫 push 실패 ──────────────────────────────────────
test('15. 첫 push 가 실패하면 on(공유 중)이 되지 않고 error, 재시도가 성공해야 on', async () => {
  const app = fakeApp(baseState({ items: [{ id: 'a', name: 'A' }] }));
  const backend = fakeBackend();
  backend.fail = Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  const sync = createSync(app, backend, OPTS);
  sync.start();
  backend.emitAll();
  await settle();
  assert.equal(app.last.state, 'error');
  assert.equal(app.last.error, 'permission-denied');
  assert.ok(!app.statuses.some((st) => st.state === 'on'), '한 번도 on 이 아니었다');
  backend.fail = null;
  await sleep(1100);
  assert.equal(app.last.state, 'on');
  assert.ok(backend.store.items.has('a'));
});

// ── 16. 올리다 만 저장소 ──────────────────────────────────
test('16. 표시(meta/store)가 없는 저장소는 올리다 만 것으로 보고 원격에 없는 로컬 품목·분류를 버리지 않고 같이 올린 뒤 표시를 쓴다', async () => {
  // 첫 기기가 품목 a 까지만 올리고 끊겼다 (b·c 는 아직). 이 기기(또는 새로고침한 같은 기기)는 a·b·c 를 갖고 있다
  const remote = { items: { a: { id: 'a', name: 'A(원격)', order: 0 } }, groups: { g1: { id: 'g1', title: 'G1', order: 0 } } };
  const state = baseState({ items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], groups: [{ id: 'g1', title: 'G1' }] });
  const { app, backend, sync } = await boot(state, remote, { partial: true });
  assert.deepEqual(ids(app.state.items), ['a', 'b', 'c'], '원격에 있는 것은 원격 순서, 없는 것은 남긴다');
  assert.equal(app.state.items[0].name, 'A(원격)', '원격에 있는 문서는 원격이 이긴다');
  const calls = backend.calls.map((c) => `${c.op} ${c.coll}/${c.id}`);
  assert.deepEqual(calls, ['set items/b', 'set items/c', 'set meta/settings', 'set meta/store'], '없던 것만 올리고 맨 끝에 표시');
  assert.equal(app.last.state, 'on');
  assert.ok(backend.store.meta.has('store'));
  // 완성된 저장소에 들어오는 세 번째 기기는 시드를 올리지 않는다
  const C = await boot(baseState({ items: [{ id: 'z', name: '시드' }] }), {}, {}, backend.store);
  assert.deepEqual(ids(C.app.state.items), ['a', 'b', 'c']);
  assert.equal(C.backend.calls.filter((c) => c.coll === 'items').length, 0);
  sync.close();
  C.sync.close();
});

// ── 17. order 만 바뀐 품목 ───────────────────────────────
test('17. 품목 하나를 지워 뒤 품목들의 order 만 밀리면 문서 통째가 아니라 order 만 update 한다 (다른 기기의 이름 수정이 지워지지 않게)', async () => {
  const remote = {
    items: { a: { id: 'a', name: 'A', order: 0 }, b: { id: 'b', name: 'B', order: 1 }, c: { id: 'c', name: 'C', order: 2 } },
  };
  const { app, backend, sync } = await boot(baseState({ items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] }), remote);
  backend.calls.length = 0;
  app.state.items = app.state.items.filter((it) => it.id !== 'a');
  sync.schedule();
  await settle();
  assert.deepEqual(
    backend.calls.map((c) => [c.op, c.id, c.patch ?? c.doc?.order]),
    [
      ['update', 'b', { order: 0 }],
      ['update', 'c', { order: 1 }],
      ['remove', 'a', undefined],
    ],
  );
  assert.equal(backend.store.items.get('c').name, 'C');
  sync.close();
});

// ── 18. 다시 연결하기 전에 보내기 ────────────────────────
test('18. drain(): 아직 안 보낸 입력을 보내고 기다린다 — 설정을 바꿔 다시 연결해도 방금 한 입력이 사라지지 않는다', async () => {
  const { app, backend, sync } = await boot(baseState({ sessions: [draft('s1', { counts: { a: 1 } })] }), {});
  backend.calls.length = 0;
  app.state.sessions[0].counts.b = 2;
  sync.schedule(); // 디바운스 대기 중
  await sync.drain();
  assert.deepEqual(backend.calls.map((c) => `${c.op} ${c.coll}/${c.id}`), ['update sessions/s1']);
  assert.equal(backend.store.sessions.get('s1').counts.b, 2);
  sync.close();
  assert.equal(app.last.state, 'off');
  // 닫힌 엔진은 상태를 더 보내지 않는다 (새 엔진의 표시를 덮어쓰지 않게)
  const n = app.statuses.length;
  sync.schedule();
  await settle();
  assert.equal(app.statuses.length, n);
});

// ── 19. 묶어 보내기 ──────────────────────────────────────
test('19. 백엔드에 batch 가 있으면 처음 올리기를 한 번에 보내고, batch 가 실패하면 하나씩 보낸다', async () => {
  const state = () => baseState({ items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: { storeName: 'x' } });
  const app = fakeApp(state());
  const backend = fakeBackend();
  const batches = [];
  backend.batch = async (ops) => {
    batches.push(ops.map((o) => `${o.op} ${o.coll}/${o.id}`));
    for (const o of ops) {
      if (o.op === 'set') backend.store[o.coll].set(o.id, clone(o.doc));
      else if (o.op === 'remove') backend.store[o.coll].delete(o.id);
    }
  };
  const sync = createSync(app, backend, OPTS);
  sync.start();
  backend.emitAll();
  await settle();
  assert.deepEqual(batches, [['set items/a', 'set items/b', 'set meta/settings', 'set meta/store']]);
  assert.equal(backend.calls.length, 0, '하나씩 보낸 것은 없다');
  assert.equal(app.last.state, 'on');
  assert.equal(sync._synced.items.size, 2);
  sync.close();

  const app2 = fakeApp(state());
  const backend2 = fakeBackend();
  backend2.batch = async () => {
    throw Object.assign(new Error('batch unsupported'), { code: 'unavailable' });
  };
  const sync2 = createSync(app2, backend2, OPTS);
  sync2.start();
  backend2.emitAll();
  await settle();
  assert.deepEqual(
    backend2.calls.map((c) => `${c.op} ${c.coll}/${c.id}`),
    ['set items/a', 'set items/b', 'set meta/settings', 'set meta/store'],
    'batch 실패 → 하나씩',
  );
  assert.equal(app2.last.state, 'on');
  sync2.close();
});
