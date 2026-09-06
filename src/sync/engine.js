// 공유 저장소 동기화 엔진
//
// 앱 상태(localStorage)를 원격 문서 저장소(artifact db / Firebase Firestore / 로컬 테스트용)와 맞춘다.
// 세 값을 비교한다: 로컬 상태 · 마지막으로 원격과 맞춘 상태(synced) · 방금 받은 원격 상태.
//   - 원격이 바뀐 문서만 로컬에 덮어쓰고, 그 위에 아직 보내지 않은 로컬 변경(patch)을 다시 얹는다.
//   - 로컬이 바뀐 문서만 원격에 보낸다. 재고조사(sessions)는 항목별 병합(update)이라 두 사람이
//     다른 품목을 동시에 세도 서로 지우지 않는다. 나머지(items·groups·orders·settings)는 문서 통째로 보낸다.
//   - 원격이 완전히 비어 있으면(첫 기기) 로컬 데이터를 그대로 올리고 맨 끝에 meta/store 표시를 쓴다. 표시가 있으면 원격이
//     기준이고, 표시가 없는데 문서가 있으면 "올리다 만 저장소"라서 원격에 없는 로컬 품목·분류를 버리지 않고 같이 올린다.
//   - 서버 확답(fromCache=false) 없이 캐시만 비어 있을 때는 "원격이 비었다"고 판단하지 않는다 (남의 데이터를 시드로 덮어쓰지 않게).
//   - 장부마다 초안은 하나만: 기기마다 자동으로 생긴 초안이 겹치면 가장 먼저 만든 것을 남기고 나머지의 입력은
//     거기에 합친다. 세고 있던 초안이 원격에서 사라져도(다른 기기의 정리와 엇갈림) 입력을 버리지 않고 합치거나 다시 올린다.
//   - 자기 쓰기의 메아리: 백엔드는 쓰기를 확인(ack)하기 전에 그 내용을 스냅샷으로 되돌려 준다(Firestore 의 hasPendingWrites,
//     로컬 백엔드는 동기). 보내는 중인 문서(inflight)와 같은 스냅샷은 원격 변경으로 치지 않는다 — 그 사이에 한 로컬 입력을
//     지키고(다음 flush 가 그 차이만 보낸다) 화면도 다시 그리지 않는다. 병합 결과가 로컬과 같은 스냅샷도 다시 그리지 않는다.
//
// 백엔드 인터페이스 (src/sync/local.js · artifact.js · firebase.js):
//   name: string
//   watch(collection, onDocs, onError) → unsubscribe        onDocs(Map<id, doc>, {fromCache})
//   watchDoc(collection, id, onDoc, onError) → unsubscribe   onDoc(doc|null, {fromCache})
//   set(collection, id, doc) → Promise                       문서 통째로 쓰기(없으면 생성)
//   update(collection, id, patch) → Promise                  중첩 병합. 잎이 null이면 그 필드 삭제. 문서가 없으면 거부
//   remove(collection, id) → Promise
//   batch?(ops) → Promise                                     [{op:'set'|'update'|'remove', coll, id, doc|patch}] 한 번에 (선택)
//   close?()

export const COLLECTIONS = ['items', 'groups', 'sessions', 'orders'];
export const META_COLLECTION = 'meta';
export const SETTINGS_DOC = 'settings';
/** "이 저장소는 처음 올리기가 끝났다" 표시 문서 (meta/store). 없으면 아직 올리는 중이거나 끊긴 것 → 부분 저장소로 본다 */
export const STORE_DOC = 'store';
/** 원격에 올리지 않는 설정 (기기마다 다른 값) */
export const LOCAL_ONLY_SETTINGS = ['apiKey', 'shareConfig'];
/** 문서 단위로 통째로 쓰는 컬렉션 (null이 정상값으로 쓰이는 품목 등) */
const WHOLE_DOC = new Set(['items', 'groups', 'orders']);
/** 필드 단위로 병합하는 컬렉션 (여러 사람이 동시에 다른 품목을 셈) */
const MERGE_DOC = new Set(['sessions']);

export const DEL = Symbol('delete');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** 키 순서에 영향받지 않는 직렬화 (변경 감지용) */
export function stable(x) {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}`;
  return JSON.stringify(x === undefined ? null : x);
}

/** a → b 로 가는 변경. 바뀐 잎만 담고, 없어진 키는 DEL. 배열은 통째로. */
export function diff(a, b) {
  const patch = {};
  const A = isObj(a) ? a : {};
  const B = isObj(b) ? b : {};
  for (const k of Object.keys(A)) if (!(k in B) || B[k] === undefined) patch[k] = DEL;
  for (const k of Object.keys(B)) {
    if (B[k] === undefined) continue;
    if (!(k in A)) patch[k] = clone(B[k]);
    else if (isObj(A[k]) && isObj(B[k])) {
      const sub = diff(A[k], B[k]);
      if (Object.keys(sub).length) patch[k] = sub;
    } else if (stable(A[k]) !== stable(B[k])) patch[k] = clone(B[k]);
  }
  return patch;
}

/** patch 를 obj 에 적용한 새 객체 (원본은 건드리지 않음) */
export function applyPatch(obj, patch) {
  const out = isObj(obj) ? { ...obj } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === DEL) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = applyPatch(out[k], v);
    else if (isObj(v) && !Array.isArray(v)) out[k] = applyPatch({}, v);
    else out[k] = clone(v);
  }
  return out;
}

/** 백엔드로 보내는 patch: DEL → null (백엔드가 "null 잎 = 삭제"로 해석) */
export function patchForBackend(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === DEL ? null : isObj(v) ? patchForBackend(v) : clone(v);
  return out;
}

/** 원격 문서 정리: 병합 컬렉션은 null 잎(삭제 표시)을 걷어낸다 */
export function stripNulls(doc) {
  if (Array.isArray(doc)) return doc.map(stripNulls);
  if (!isObj(doc)) return doc;
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === null || v === undefined) continue;
    out[k] = stripNulls(v);
  }
  return out;
}

export function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

const isEmptyDraft = (s) => s.status === 'draft' && !Object.keys(s.counts || {}).length && !Object.keys(s.overrides || {}).length;

/**
 * dup 초안의 입력(counts·overrides·filled)을 keep 초안에 합친다. keep 에 이미 센 품목은 그대로 둔다 —
 * 그래야 어느 기기가 어떤 순서로 합쳐도 같은 결과가 된다. 옮긴 것이 있으면 true.
 */
function mergeDraft(keep, dup) {
  let moved = false;
  keep.counts ||= {};
  for (const [id, v] of Object.entries(dup.counts || {})) {
    if (v == null || keep.counts[id] != null) continue;
    keep.counts[id] = v;
    if (dup.filled?.[id]) (keep.filled ||= {})[id] = true; // 예상값으로 채운 표시도 같이
    moved = true;
  }
  for (const [id, v] of Object.entries(dup.overrides || {})) {
    if (v == null) continue;
    keep.overrides ||= {};
    if (keep.overrides[id] != null) continue;
    keep.overrides[id] = v;
    moved = true;
  }
  return moved;
}

/**
 * 기기마다 자동으로 생긴 초안이 장부별로 여러 개면 가장 먼저 만든 것만 남긴다. 나머지의 입력은 남는 초안에 합치고
 * (지우지 않는다), 버린 초안은 flush 때 원격에서도 지워진다. 무엇이든 바꿨으면 true.
 */
function dedupeDrafts(s) {
  const keep = new Map(); // book → 남길 초안
  // 같은 밀리초에 만들어져 createdAt 이 같으면 id 로 정하는데, 그래야 모든 기기가 같은 초안을 남긴다
  const drafts = (s.sessions || [])
    .filter((x) => x.status === 'draft')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  for (const d of drafts) {
    const book = d.book || 'product';
    if (!keep.has(book)) keep.set(book, d);
  }
  let changed = false;
  s.sessions = (s.sessions || []).filter((x) => {
    if (x.status !== 'draft') return true;
    const k = keep.get(x.book || 'product');
    if (k === x) return true;
    mergeDraft(k, x);
    changed = true;
    return false;
  });
  return changed;
}

/** 설정 중 공유할 부분 */
export function sharedSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) if (!LOCAL_ONLY_SETTINGS.includes(k)) out[k] = clone(v);
  return out;
}

/** 로컬 상태 → 컬렉션별 문서 맵 */
function localDocs(state, coll) {
  const m = new Map();
  const list = state[coll] || [];
  list.forEach((d, i) => {
    if (!d || typeof d.id !== 'string') return;
    const doc = clone(d);
    if (coll === 'items' || coll === 'groups') doc.order = i; // 표시 순서 보존
    m.set(d.id, doc);
  });
  return m;
}

function sortForState(coll, docs, prevOrder) {
  const arr = [...docs.values()];
  if (coll === 'items' || coll === 'groups') {
    arr.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (prevOrder.get(a.id) ?? 1e9) - (prevOrder.get(b.id) ?? 1e9));
    return arr.map(({ order, ...rest }) => rest);
  }
  // sessions·orders: 원래 있던 순서를 지키고, 새 문서는 만든 시각순으로 뒤에
  arr.sort((a, b) => {
    const pa = prevOrder.get(a.id);
    const pb = prevOrder.get(b.id);
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || ''));
  });
  return arr;
}

/**
 * @param {object} app  { state, persist(), onRemoteChange(), setSyncStatus(status) }
 * @param {object} backend  위 인터페이스
 * @param {object} [opts]  { debounceMs, readyTimeoutMs, log }
 */
export function createSync(app, backend, opts = {}) {
  const debounceMs = opts.debounceMs ?? 200;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 8000;
  const log = opts.log || (() => {});
  const synced = { items: new Map(), groups: new Map(), sessions: new Map(), orders: new Map(), meta: null };
  const remote = { items: null, groups: null, sessions: null, orders: null, meta: undefined, store: undefined }; // 첫 스냅샷 전: null/undefined
  let storeMarked = false; // meta/store 표시가 원격에 있는가 (우리가 썼거나 받았거나)
  const definitive = new Set(); // fromCache=false 스냅샷을 받은 컬렉션
  // 보내는 중(확인 전)인 문서: id → 보낸 뒤 원격이 될 내용(stable). 확인 전에 되돌아오는 메아리를 알아보는 데 쓴다
  const inflight = { items: new Map(), groups: new Map(), sessions: new Map(), orders: new Map(), meta: undefined };
  const unsubs = [];
  let status = { state: 'connecting', backend: backend.name, error: null, lastSyncAt: null };
  let started = false;
  let ready = false; // 부트스트랩(첫 대조) 완료
  let flushing = null; // 진행 중인 flush Promise
  let dirty = false;
  let timer = null;
  let closed = false;
  let backoff = 0;

  const setStatus = (patch) => {
    if (closed && patch.state !== 'off') return; // 닫힌 엔진이 새 엔진의 표시를 덮어쓰지 않게
    status = { ...status, ...patch };
    app.setSyncStatus?.(status);
  };

  function start() {
    if (started) return;
    started = true;
    setStatus({ state: 'connecting', error: null });
    for (const coll of COLLECTIONS) {
      unsubs.push(
        backend.watch(
          coll,
          (docs, meta) => onRemote(coll, docs, meta),
          (err) => fail(err),
        ),
      );
    }
    unsubs.push(
      backend.watchDoc(
        META_COLLECTION,
        SETTINGS_DOC,
        (doc, meta) => onRemote('meta', doc, meta),
        (err) => fail(err),
      ),
    );
    unsubs.push(
      backend.watchDoc(
        META_COLLECTION,
        STORE_DOC,
        (doc, meta) => onRemote('store', doc, meta),
        (err) => fail(err),
      ),
    );
    setTimeout(() => {
      if (ready || closed || !allFirstSnapshots()) return;
      // 서버 확답 없이 캐시만 있을 때: 캐시에 데이터가 있으면 그것으로 맞추고(오프라인 재시작), 캐시가 비어 있으면 계속 기다린다 —
      // "원격이 비었다"는 판단은 서버 확답이 있어야만 한다 (남의 데이터를 이 기기의 시드로 덮어쓰지 않게)
      if (allDefinitive() || !remoteEmpty()) bootstrap('timeout');
      else log('bootstrap: waiting for server (cache empty)');
    }, readyTimeoutMs);
  }

  const allFirstSnapshots = () => COLLECTIONS.every((c) => remote[c] !== null) && remote.meta !== undefined && remote.store !== undefined;
  const allDefinitive = () => COLLECTIONS.every((c) => definitive.has(c)) && definitive.has('meta') && definitive.has('store');
  const remoteEmpty = () => COLLECTIONS.every((c) => !remote[c] || remote[c].size === 0) && !remote.meta && !remote.store;

  function fail(err) {
    log('sync error', err);
    setStatus({ state: 'error', error: err?.message || String(err) });
  }

  function onRemote(coll, docs, meta) {
    if (closed) return;
    remote[coll] = coll === 'meta' || coll === 'store' ? (docs == null ? null : docs) : docs;
    if (!meta?.fromCache) definitive.add(coll);
    if (coll === 'store') {
      if (docs) storeMarked = true;
      if (!ready && allFirstSnapshots() && allDefinitive()) bootstrap('definitive');
      return; // 표시 문서는 로컬 상태와 무관
    }
    if (!ready) {
      if (allFirstSnapshots() && allDefinitive()) bootstrap('definitive');
      return;
    }
    applyRemote(coll);
  }

  /** 첫 대조: 원격이 비었으면 로컬을 올리고, 아니면 원격을 기준으로 로컬을 맞춘다 */
  function bootstrap(reason) {
    if (ready) return;
    ready = true;
    const empty = remoteEmpty();
    const partial = !empty && !remote.store; // 문서는 있는데 "다 올렸다" 표시가 없다 → 다른 기기가 올리는 중이거나 끊긴 저장소
    log('bootstrap', reason, empty ? 'remote empty → push local' : partial ? 'remote partial → union' : 'remote has data → merge');
    const s = app.state;
    if (!empty) {
      // 빈 초안은 원격에 같은 장부의 초안이 있으면 버린다 (기기마다 자동으로 생긴 초안이 겹치지 않게)
      const remoteSessions = remote.sessions || new Map();
      const hasRemoteDraft = (book) => [...remoteSessions.values()].some((x) => x.status === 'draft' && (x.book || 'product') === book);
      s.sessions = (s.sessions || []).filter((x) => remoteSessions.has(x.id) || !(isEmptyDraft(x) && hasRemoteDraft(x.book || 'product')));
      if (s.ui && !s.sessions.some((x) => x.id === s.ui.activeSessionId)) s.ui.activeSessionId = null;
      // 품목·분류는 원격이 기준 (로컬의 기본 시드를 올리지 않는다). 단 올리다 만 저장소(partial)면 원격에 없는 로컬 문서는
      // 남겨서 같이 올린다 — 첫 push 도중 새로고침하거나 두 번째 기기가 그 사이에 들어와도 품목이 잘려 나가지 않게
      for (const coll of ['items', 'groups']) {
        if (remote[coll] && remote[coll].size) {
          const prev = new Map((s[coll] || []).map((d, i) => [d.id, i]));
          const docs = new Map();
          for (const [id, d] of remote[coll]) {
            docs.set(id, clone(d));
            synced[coll].set(id, stable(d));
          }
          if (partial) for (const [id, d] of localDocs(s, coll)) if (!docs.has(id)) docs.set(id, d);
          s[coll] = sortForState(coll, docs, prev);
        }
      }
      for (const coll of ['sessions', 'orders']) applyRemote(coll, true);
      if (remote.meta) {
        synced.meta = stable(remote.meta);
        s.settings = { ...s.settings, ...clone(remote.meta) };
      }
      app.persist(true);
      app.onRemoteChange?.();
    }
    // 원격에 없는 로컬 문서(첫 기기면 전부)를 올린다. 'on'(공유 중)은 그 첫 push 가 다 끝난 뒤에 flush 가 표시한다 —
    // 올리는 동안(품목 100여 개면 수십 초) 이미 "공유 중"으로 보이면 다 올라간 줄 알고 닫을 수 있다
    schedule(0);
  }

  /** 원격 스냅샷을 로컬에 반영 (바뀐 문서만, 그 위에 미전송 로컬 변경을 다시 얹음) */
  function applyRemote(coll, silent = false) {
    const s = app.state;
    let changed = false;
    let needsPush = false; // 반영하면서 생긴 로컬 변경(초안 합치기·정리)이 있어 flush 가 필요한가
    if (coll === 'meta') {
      const doc = remote.meta;
      const json = doc ? stable(doc) : null;
      // 보내는 중인 설정 문서의 메아리는 건너뛴다 (확인 뒤에 flush 가 synced 를 적는다)
      if (json !== synced.meta && json !== inflight.meta) {
        const localShared = sharedSettings(s.settings);
        const syncedObj = synced.meta ? JSON.parse(synced.meta) : {};
        const localPatch = diff(syncedObj, localShared);
        const merged = applyPatch(doc ? clone(doc) : {}, localPatch);
        synced.meta = json;
        if (stable(merged) !== stable(localShared)) {
          s.settings = { ...s.settings, ...merged };
          changed = true;
        }
      }
    } else {
      const docs = remote[coll] || new Map();
      const local = localDocs(s, coll);
      const prevOrder = new Map((s[coll] || []).map((d, i) => [d.id, i]));
      const next = new Map();
      for (const [id, raw] of docs) {
        const d = MERGE_DOC.has(coll) ? stripNulls(raw) : raw;
        const json = stable(d);
        const localDoc = local.get(id);
        if (json === inflight[coll].get(id)) {
          // 보내는 중인 우리 쓰기의 메아리 (확인 전 스냅샷) — 원격 변경이 아니다. 그 사이의 로컬 입력을 그대로 두고
          // (다음 flush 가 그 차이만 보낸다) synced 는 확인 뒤에 flush 가 적는다
          if (localDoc) next.set(id, localDoc);
        } else if (json !== synced[coll].get(id)) {
          const syncedObj = synced[coll].has(id) ? JSON.parse(synced[coll].get(id)) : null;
          // 아직 보내지 않은 로컬 변경은 원격 문서 위에 다시 얹는다
          const localPatch = syncedObj && localDoc ? diff(syncedObj, localDoc) : {};
          const merged = Object.keys(localPatch).length ? applyPatch(clone(d), localPatch) : clone(d);
          next.set(id, merged);
          synced[coll].set(id, json);
          if (!localDoc || stable(merged) !== stable(localDoc)) changed = true; // 병합 결과가 로컬과 같으면 다시 그릴 것도 없다
        } else if (localDoc) next.set(id, localDoc);
        // 원격·synced 와 같은데 로컬에만 없으면 로컬에서 지운 것 — 곧 remove 로 올라가므로 되살리지 않는다
      }
      const removed = new Set(); // 원격에서 지워진 문서 — 로컬에 남아 있어도 다시 올리지 않는다
      for (const id of [...synced[coll].keys()]) {
        if (docs.has(id)) continue;
        synced[coll].delete(id);
        const localDoc = local.get(id);
        if (!localDoc) continue; // 로컬에서도 이미 지운 문서 (우리 remove 의 메아리) — 바뀐 게 없다
        changed = true;
        if (coll === 'sessions' && localDoc.status === 'draft' && !isEmptyDraft(localDoc)) {
          // 세고 있던 초안이 원격에서 사라졌다 (다른 기기의 중복 정리와 엇갈린 경우). 입력은 버리지 않는다:
          // 원격에 같은 장부의 초안이 남아 있으면 거기에 합치고, 없으면 새 문서로 다시 올린다
          const book = localDoc.book || 'product';
          const keeper = [...next.values()].find((x) => x.status === 'draft' && (x.book || 'product') === book);
          if (keeper) {
            if (mergeDraft(keeper, localDoc)) needsPush = true;
            removed.add(id);
          } else {
            next.set(id, localDoc);
            needsPush = true;
          }
        } else removed.add(id);
      }
      for (const [id, d] of local) if (!docs.has(id) && !synced[coll].has(id) && !removed.has(id)) next.set(id, d); // 로컬에서 새로 만든 것 (곧 올라감)
      if (changed) {
        s[coll] = sortForState(coll, next, prevOrder);
        if (coll === 'sessions') {
          if (dedupeDrafts(s)) needsPush = true;
          if (s.ui && !s.sessions.some((x) => x.id === s.ui.activeSessionId)) s.ui.activeSessionId = null;
        }
      }
    }
    if (changed && !silent) {
      app.persist(true);
      app.onRemoteChange?.();
      setStatus({ lastSyncAt: Date.now() });
      if (needsPush) schedule(); // 합치거나 버린 초안은 원격에도 반영해야 한다 (부트스트랩은 스스로 flush 를 예약한다)
    }
    return changed;
  }

  /** 로컬 변경을 곧 원격에 보낸다 (persist 뒤에 호출) */
  function schedule(ms = debounceMs) {
    if (closed || !ready) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => flush(), ms);
  }

  async function flush() {
    if (closed || !ready) return;
    if (flushing) {
      dirty = true;
      return flushing;
    }
    dirty = false;
    flushing = (async () => {
      const s = app.state;
      const ops = [];
      for (const coll of COLLECTIONS) {
        const local = localDocs(s, coll);
        for (const [id, doc] of local) {
          const json = stable(doc);
          const prev = synced[coll].get(id);
          if (prev === json) continue;
          const patch = prev == null ? null : diff(JSON.parse(prev), doc);
          if (patch && !Object.keys(patch).length) continue;
          // 통째로 쓰는 컬렉션도 순서(order)만 바뀐 것은 그 필드만 보낸다 — 품목 하나를 지우면 뒤 품목 전부의 order 가 밀리는데,
          // 그때 문서 통째로 덮어쓰면 그 사이 다른 기기가 고친 이름 등이 지워진다
          const orderOnly = patch && WHOLE_DOC.has(coll) && Object.keys(patch).length === 1 && 'order' in patch && patch.order !== DEL;
          if (prev == null || (WHOLE_DOC.has(coll) && !orderOnly)) ops.push({ op: 'set', coll, id, doc, json });
          else ops.push({ op: 'update', coll, id, doc, json, patch, backendPatch: patchForBackend(patch) });
        }
        for (const id of synced[coll].keys()) if (!local.has(id)) ops.push({ op: 'remove', coll, id });
      }
      const meta = sharedSettings(s.settings);
      const metaJson = stable(meta);
      if (metaJson !== synced.meta) ops.push({ op: 'set', coll: META_COLLECTION, id: SETTINGS_DOC, doc: meta, json: metaJson, meta: true });
      // 처음 올리기가 끝나면(그리고 표시가 아직 없으면) 맨 끝에 "다 올렸다" 표시를 쓴다
      if (!storeMarked) ops.push({ op: 'set', coll: META_COLLECTION, id: STORE_DOC, doc: { seededAt: new Date().toISOString(), version: 1 }, store: true });
      if (!ops.length) {
        if (status.state === 'connecting') setStatus({ state: 'on', error: null, lastSyncAt: Date.now() }); // 부트스트랩에서 올릴 것이 없었다
        return;
      }
      log('flush', ops.length, 'ops');
      let failed = null;
      // 한 번에 보낼 수 있는 백엔드(Firestore writeBatch)면 묶어서 보낸다 — 처음 올리기(문서 100여 개)가 수십 초에서 한두 번의 왕복으로 줄고,
      // 그 사이 새로고침해도 반쯤 올라간 저장소가 남지 않는다. 실패하면 아래에서 하나씩 보낸다 (update 없는 문서 → set 대체 등)
      if (backend.batch && ops.length > 1 && !ops.some((o) => o.op === 'update')) {
        try {
          for (const o of ops) {
            if (o.meta) inflight.meta = o.json;
            else if (!o.store && o.op !== 'remove') inflight[o.coll].set(o.id, o.json);
          }
          await backend.batch(ops.map((o) => ({ op: o.op, coll: o.coll, id: o.id, doc: o.doc })));
          for (const o of ops) {
            if (o.store) storeMarked = true;
            else if (o.meta) synced.meta = o.json;
            else if (o.op === 'remove') synced[o.coll].delete(o.id);
            else synced[o.coll].set(o.id, o.json);
          }
          ops.length = 0;
        } catch (e) {
          log('batch failed, sending one by one', e?.message || e);
        } finally {
          inflight.meta = undefined;
          for (const c of COLLECTIONS) inflight[c].clear();
        }
      }
      for (const o of ops) {
        if (closed) break; // 닫힌 엔진은 더 보내지 않는다 (새 엔진이 이어서 맡는다)
        // 보내는 동안 되돌아오는 메아리(확인 전 스냅샷)를 applyRemote 가 알아보도록 보낸 내용을 적어 둔다
        if (o.meta) inflight.meta = o.json;
        else if (!o.store && o.op !== 'remove') inflight[o.coll].set(o.id, o.json);
        try {
          let patched = false; // update 로 보냈는가 (set 으로 대체했으면 원격 = o.doc)
          if (o.op === 'set') await backend.set(o.coll, o.id, o.doc);
          else if (o.op === 'update') {
            try {
              await backend.update(o.coll, o.id, o.backendPatch);
              patched = true;
            } catch (e) {
              if (e?.code === 'invalid_argument' || e?.code === 'not-found') await backend.set(o.coll, o.id, o.doc);
              else throw e;
            }
          } else await backend.remove(o.coll, o.id);
          if (o.store) storeMarked = true;
          else if (o.meta) synced.meta = o.json;
          else if (o.op === 'remove') synced[o.coll].delete(o.id);
          else if (patched) {
            // 보내는 동안 원격 스냅샷이 synced 를 바꿨을 수 있다 (다른 기기가 다른 품목을 셈).
            // 원격 문서는 "그 스냅샷 + 우리 patch" 이므로 지금의 synced 위에 patch 만 얹는다. 보내기 전 문서로
            // 덮어쓰면 남의 변경이 미전송 로컬 변경으로 둔갑해 다음 스냅샷에서 되돌리고 원격에도 다시 써 버린다.
            const base = synced[o.coll].get(o.id);
            synced[o.coll].set(o.id, base == null ? o.json : stable(applyPatch(JSON.parse(base), o.patch)));
          } else synced[o.coll].set(o.id, o.json);
        } catch (e) {
          failed = e;
          log('write failed', o.coll, o.id, e);
          break;
        } finally {
          if (o.meta) inflight.meta = undefined;
          else if (!o.store && o.op !== 'remove') inflight[o.coll].delete(o.id);
        }
      }
      if (closed) return;
      if (failed) {
        backoff = Math.min(30000, backoff ? backoff * 2 : 1000);
        setStatus({ state: 'error', error: failed?.message || String(failed) });
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(() => flush(), backoff);
      } else {
        backoff = 0;
        setStatus({ state: 'on', error: null, lastSyncAt: Date.now() });
      }
    })().finally(() => {
      flushing = null;
      if (dirty && !backoff) schedule(0);
    });
    return flushing;
  }

  /** 아직 안 보낸 로컬 변경을 보내고 기다린다 (닫기 전에). 시간이 지나면 그냥 돌아온다 */
  async function drain(timeoutMs = 5000) {
    if (closed || !ready) return;
    clearTimeout(timer);
    const p = (async () => {
      await flush();
      if (dirty) await flush();
    })();
    await Promise.race([p, new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  function close() {
    if (closed) return;
    const pending = dirty || timer != null;
    closed = true;
    clearTimeout(timer);
    timer = null;
    for (const u of unsubs) u?.();
    backend.close?.();
    status = { ...status, state: 'off' };
    app.setSyncStatus?.(status);
    if (pending) log('closed with unsent changes — call drain() before close()');
  }

  return {
    start,
    schedule,
    flush,
    drain,
    close,
    get status() {
      return status;
    },
    get ready() {
      return ready;
    },
    /** 테스트용: 마지막으로 맞춘 상태 */
    _synced: synced,
  };
}
