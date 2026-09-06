// Firebase Firestore 공유 백엔드 — 같은 storeCode 를 설정한 기기끼리 실시간으로 같은 데이터를 본다.
//
// SDK 는 번들에 넣지 않고 실행 시점에 gstatic CDN 에서 불러온다 (설정이 없으면 아예 받지 않고, 단일 파일 빌드도 커지지 않는다).
// 문서 경로: stores/<storeCode>/<컬렉션>/<id>  (Firestore 규칙에서 stores/{code}/** 만 열어 준다)
// 엔진(engine.js)이 기대하는 인터페이스: name · watch · watchDoc · set · update · remove · close
//
// cfg = { firebase: <Firebase 콘솔의 firebaseConfig>, storeCode: string, emulator?: { host, port } }

export const SDK_VERSION = '12.18.0';
const CDN_BASE = 'https://www.gstatic.com/firebasejs/';
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

let sdkPromise = null;

/** SDK 두 모듈(app · firestore)을 한 번만 불러온다. 실패하면 다음 호출에서 다시 시도한다 */
export function loadFirebaseSdk(version = SDK_VERSION) {
  // 테스트용: Node 에서 npm 의 firebase 패키지를 그대로 넣어 줄 수 있다 ({ app, firestore } 모듈 쌍)
  if (globalThis.__FIREBASE_SDK__) return Promise.resolve(globalThis.__FIREBASE_SDK__);
  if (!sdkPromise) {
    // 주소를 변수로 조립해 번들러(esbuild)가 해석하려 들지 않게 한다
    const base = `${CDN_BASE}${version}/`;
    sdkPromise = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js')])
      .then(([app, firestore]) => ({ app, firestore }))
      .catch((e) => {
        sdkPromise = null;
        throw Object.assign(new Error(`Firebase SDK 를 불러오지 못했습니다 (${base}). 인터넷 연결이나 콘텐츠 보안 정책(CSP)을 확인하세요: ${e?.message || e}`), {
          code: 'sdk-load-failed',
          cause: e,
        });
      });
  }
  return sdkPromise;
}

/** SDK 오류 → { code, message } 를 가진 일반 Error (엔진이 상태 표시에 쓴다) */
function wrapErr(e) {
  if (e && typeof e === 'object' && e.code && e.__wrapped) return e;
  const code = (e && typeof e === 'object' && typeof e.code === 'string' && e.code) || 'unknown';
  const raw = String(e?.message || e || '').replace(/^Firebase(Error)?:\s*/i, '');
  const message = raw.startsWith(`${code}:`) || raw.startsWith(`[${code}]`) ? raw : `[${code}] ${raw}`;
  return Object.assign(new Error(message), { code, cause: e, __wrapped: true });
}

/** Firestore 에 넣을 수 있는 값으로: undefined 는 걷어내고(JSON 에 없음) 나머지는 그대로 복사 */
export function clean(x) {
  if (Array.isArray(x)) return x.map((v) => (v === undefined ? null : clean(v)));
  if (isObj(x)) {
    const out = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) out[k] = clean(v);
    return out;
  }
  return x;
}

/**
 * 엔진의 중첩 patch(잎이 null 이면 삭제) → updateDoc 인자 [FieldPath, 값, FieldPath, 값, ...]
 * updateDoc 에 중첩 객체를 그대로 주면 그 맵을 통째로 바꿔 버리므로 잎마다 경로를 따로 준다.
 * 점(.)이 든 문자열 경로 대신 FieldPath 를 써야 품목 id 에 특수문자가 있어도 안전하다.
 */
export function flattenPatch(patch, FieldPath, deleteField, prefix = [], out = []) {
  for (const [k, v] of Object.entries(patch || {})) {
    const path = [...prefix, k];
    if (v === undefined) continue;
    if (v === null) out.push(new FieldPath(...path), deleteField());
    else if (isObj(v) && Object.keys(v).length) flattenPatch(v, FieldPath, deleteField, path, out);
    else out.push(new FieldPath(...path), clean(v)); // 배열·기본값·빈 객체는 통째로
  }
  return out;
}

let instanceSeq = 0;

/**
 * @param {{ firebase: object, storeCode?: string, emulator?: { host: string, port: number } | null }} cfg
 * @returns {Promise<object>} 백엔드. SDK 를 못 받거나 설정이 틀리면 거부한다 (picker 가 '연결 안 됨'으로 보여 준다)
 */
export async function createFirebaseBackend(cfg) {
  if (!cfg?.firebase || typeof cfg.firebase !== 'object' || !cfg.firebase.projectId) {
    throw Object.assign(new Error('Firebase 설정에 projectId 가 없습니다'), { code: 'invalid-config' });
  }
  const storeCode = String(cfg.storeCode || 'default');
  const { app: appSdk, firestore: fs } = await loadFirebaseSdk();

  // 앱 이름을 매장 코드로 고정해 두면 IndexedDB 캐시도 매장별로 나뉜다. 설정을 바꿔 다시 연결할 때는 이전 앱을 지우고 새로 만든다.
  const appName = `cafe-inventory:${storeCode}`;
  let fbApp;
  try {
    const existing = appSdk.getApps().find((a) => a.name === appName);
    if (existing) await appSdk.deleteApp(existing).catch(() => {});
    fbApp = appSdk.initializeApp(cfg.firebase, appName);
  } catch (e) {
    throw wrapErr(e);
  }

  let db;
  let cache = 'persistent';
  try {
    // 오프라인에서도 읽고 쓸 수 있게 IndexedDB 캐시. 여러 탭이 같은 캐시를 나눠 쓴다.
    db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn('[sync] Firestore 영구 캐시를 켜지 못해 메모리 캐시로 시작합니다:', e?.message || e);
    cache = 'memory';
    try {
      db = fs.getFirestore(fbApp);
    } catch (e2) {
      throw wrapErr(e2);
    }
  }
  if (cfg.emulator?.host) {
    try {
      fs.connectFirestoreEmulator(db, cfg.emulator.host, Number(cfg.emulator.port) || 8080);
    } catch (e) {
      throw wrapErr(e);
    }
  }

  const id = ++instanceSeq;
  const unsubs = new Set();
  let closed = false;
  const collRef = (coll) => fs.collection(db, 'stores', storeCode, coll);
  const docRef = (coll, docId) => fs.doc(db, 'stores', storeCode, coll, docId);
  const meta = (snap) => ({ fromCache: !!snap.metadata?.fromCache, hasPendingWrites: !!snap.metadata?.hasPendingWrites });
  const track = (unsub) => {
    unsubs.add(unsub);
    return () => {
      unsubs.delete(unsub);
      unsub();
    };
  };

  return {
    name: 'firebase',
    /** 진단용 */
    info: { storeCode, projectId: cfg.firebase.projectId, emulator: cfg.emulator ? `${cfg.emulator.host}:${cfg.emulator.port}` : null, cache, sdk: SDK_VERSION, instance: id },

    watch(coll, onDocs, onError) {
      if (closed) return () => {};
      const unsub = fs.onSnapshot(
        collRef(coll),
        { includeMetadataChanges: true },
        (qs) => {
          const m = new Map();
          qs.forEach((d) => m.set(d.id, clean(d.data())));
          onDocs(m, meta(qs));
        },
        (e) => onError?.(wrapErr(e)),
      );
      return track(unsub);
    },

    watchDoc(coll, docId, onDoc, onError) {
      if (closed) return () => {};
      const unsub = fs.onSnapshot(
        docRef(coll, docId),
        { includeMetadataChanges: true },
        (snap) => onDoc(snap.exists() ? clean(snap.data()) : null, meta(snap)),
        (e) => onError?.(wrapErr(e)),
      );
      return track(unsub);
    },

    async set(coll, docId, doc) {
      try {
        await fs.setDoc(docRef(coll, docId), clean(doc));
      } catch (e) {
        throw wrapErr(e);
      }
    },

    /** 중첩 patch 를 필드 경로별로 풀어 보낸다. 문서가 없으면 code 'not-found' 로 거부 → 엔진이 set 으로 대체 */
    async update(coll, docId, patch) {
      const args = flattenPatch(patch, fs.FieldPath, fs.deleteField);
      if (!args.length) return;
      try {
        await fs.updateDoc(docRef(coll, docId), ...args);
      } catch (e) {
        throw wrapErr(e);
      }
    },

    async remove(coll, docId) {
      try {
        await fs.deleteDoc(docRef(coll, docId));
      } catch (e) {
        throw wrapErr(e);
      }
    },

    /** 여러 쓰기를 writeBatch 로 묶어 보낸다 (Firestore 한 배치 최대 500 → 400 씩). 하나라도 실패하면 그 배치 전체가 거부된다 */
    async batch(ops) {
      const CHUNK = 400;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const b = fs.writeBatch(db);
        for (const o of ops.slice(i, i + CHUNK)) {
          const ref = docRef(o.coll, o.id);
          if (o.op === 'set') b.set(ref, clean(o.doc));
          else if (o.op === 'update') {
            const args = flattenPatch(o.patch, fs.FieldPath, fs.deleteField);
            if (args.length) b.update(ref, ...args);
          } else if (o.op === 'remove') b.delete(ref);
        }
        try {
          await b.commit();
        } catch (e) {
          throw wrapErr(e);
        }
      }
    },

    close() {
      if (closed) return;
      closed = true;
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* 이미 해제됨 */
        }
      }
      unsubs.clear();
      // 네트워크·캐시를 정리하고 앱을 지워 같은 이름으로 다시 만들 수 있게 한다
      Promise.resolve()
        .then(() => fs.terminate(db))
        .catch(() => {})
        .then(() => appSdk.deleteApp(fbApp))
        .catch(() => {});
    },
  };
}
