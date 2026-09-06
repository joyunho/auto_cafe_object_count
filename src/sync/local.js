// 로컬 테스트용 공유 백엔드 — 같은 브라우저의 탭끼리 localStorage 로 공유한다.
// (브라우저 테스트와 개발용. 실제 공유는 artifact.js / firebase.js)
const KEY = 'cafe-inventory-shared';
const bus = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeAll(all) {
  localStorage.setItem(KEY, JSON.stringify(all));
  bus?.dispatchEvent(new Event('change'));
}
/**
 * 테스트용: window.__SHARED_WRITE_GATE__ 가 함수면 쓰기마다 (op, coll, id) 로 부르고, Promise 를 돌려주면 그것이 풀릴 때까지
 * 쓰기를 미룬다 — 실제 백엔드처럼 "전송 중"인 상태(그 사이 다른 기기의 변경이 먼저 닿는 경우)를 흉내 낸다.
 */
const gate = (op, coll, id) => {
  const g = window.__SHARED_WRITE_GATE__;
  return typeof g === 'function' ? g(op, coll, id) : null;
};
function mergeInto(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (isObj(v)) {
      if (!isObj(target[k])) target[k] = {};
      mergeInto(target[k], v);
    } else target[k] = v;
  }
}

export function createLocalBackend() {
  const listeners = new Set();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  const onStorage = (e) => {
    if (e.key === KEY || e.key === null) notify();
  };
  window.addEventListener('storage', onStorage);
  bus?.addEventListener('change', notify);
  const meta = { fromCache: false, hasPendingWrites: false };
  return {
    name: 'local',
    watch(coll, onDocs) {
      const emit = () => onDocs(new Map(Object.entries(readAll()[coll] || {})), meta);
      listeners.add(emit);
      queueMicrotask(emit);
      return () => listeners.delete(emit);
    },
    watchDoc(coll, id, onDoc) {
      const emit = () => onDoc(readAll()[coll]?.[id] ?? null, meta);
      listeners.add(emit);
      queueMicrotask(emit);
      return () => listeners.delete(emit);
    },
    async set(coll, id, doc) {
      await gate('set', coll, id);
      const all = readAll();
      (all[coll] ||= {})[id] = JSON.parse(JSON.stringify(doc));
      writeAll(all);
    },
    async update(coll, id, patch) {
      await gate('update', coll, id);
      const all = readAll();
      if (!all[coll]?.[id]) throw Object.assign(new Error('document does not exist'), { code: 'invalid_argument' });
      mergeInto(all[coll][id], patch);
      writeAll(all);
    },
    async remove(coll, id) {
      await gate('remove', coll, id);
      const all = readAll();
      if (all[coll]) delete all[coll][id];
      writeAll(all);
    },
    close() {
      window.removeEventListener('storage', onStorage);
      bus?.removeEventListener('change', notify);
      listeners.clear();
    },
  };
}
