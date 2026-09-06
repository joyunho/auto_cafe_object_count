// claude.ai 아티팩트의 db 기능(공유 문서 저장소)을 백엔드 인터페이스에 맞춘다.
// 아티팩트를 열 수 있는 사람(같은 Claude 조직에 로그인한 사람)끼리 실시간 공유된다.
// API 는 Firestore 와 거의 같다: db.collection(path).onSnapshot / db.doc(path).set·update·delete
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** 아티팩트 안에서 실행 중이고 db 를 쓸 수 있으면 백엔드를, 아니면 null */
export async function detectArtifactDb() {
  try {
    const use = globalThis.window?.claude?.use;
    if (typeof use !== 'function') return null;
    const db = await window.claude.use('db');
    return db || null;
  } catch {
    return null;
  }
}

export function createArtifactBackend(db) {
  const wrapErr = (e) => Object.assign(new Error(e?.message || String(e)), { code: e?.code || 'unavailable' });
  return {
    name: 'artifact',
    watch(coll, onDocs, onError) {
      return db.collection(coll).onSnapshot(
        (qs) => {
          const m = new Map();
          for (const d of qs.docs) if (d.exists) m.set(d.id, clean(d.data()));
          onDocs(m, { fromCache: !!qs.metadata?.fromCache, hasPendingWrites: !!qs.metadata?.hasPendingWrites });
        },
        (e) => onError?.(wrapErr(e)),
      );
    },
    watchDoc(coll, id, onDoc, onError) {
      return db.doc(`${coll}/${id}`).onSnapshot(
        (snap) => onDoc(snap.exists ? clean(snap.data()) : null, { fromCache: !!snap.metadata?.fromCache }),
        (e) => onError?.(wrapErr(e)),
      );
    },
    set: (coll, id, doc) => db.doc(`${coll}/${id}`).set(clean(doc)).catch((e) => Promise.reject(wrapErr(e))),
    update: (coll, id, patch) => db.doc(`${coll}/${id}`).update(clean(patch)).catch((e) => Promise.reject(wrapErr(e))),
    remove: (coll, id) => db.doc(`${coll}/${id}`).delete().catch((e) => Promise.reject(wrapErr(e))),
  };
}

/** 스냅샷 객체는 동결되어 있으므로 복사하고, undefined 는 JSON 에 없으므로 걷어낸다 */
function clean(x) {
  if (Array.isArray(x)) return x.map(clean);
  if (isObj(x)) {
    const out = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) out[k] = clean(v);
    return out;
  }
  return x;
}
