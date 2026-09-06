// 어떤 공유 백엔드를 쓸지 고른다.
//   1. window.__SHARED_BACKEND__ === 'local' → 같은 브라우저 탭끼리 (테스트·개발) · 'none' → 공유 없이 이 기기만 (테스트)
//   2. claude.ai 아티팩트 안 → 아티팩트 db (같은 Claude 조직 사람끼리 실시간 공유)
//   3. Firebase 설정이 있으면 (window.__SHARE_CONFIG__ > 설정 탭에 붙여넣은 JSON > src/data/share-config.js) → Firestore (링크 있는 누구나)
//   4. 없으면 null → 이 기기에만 저장
import { createLocalBackend } from './local.js';
import { detectArtifactDb, createArtifactBackend } from './artifact.js';
import { SHARE_CONFIG } from '../data/share-config.js';

/** 테스트·개발용: window.__SHARE_CONFIG__ 가 있으면 설정보다 우선한다 (e2e 가 에뮬레이터 설정을 주입한다) */
function injectedConfig() {
  const cfg = globalThis.window?.__SHARE_CONFIG__;
  return cfg && typeof cfg === 'object' ? normalizeConfig(cfg) : null;
}

/** 주입된 설정 → 설정 탭에 붙여넣은 JSON → 저장소에 들어 있는 기본 설정 순으로 쓴다 */
export function shareConfig(settings) {
  const injected = injectedConfig();
  if (injected) return injected;
  const pasted = settings?.shareConfig;
  if (typeof pasted === 'string' && pasted.trim()) {
    try {
      const cfg = JSON.parse(pasted);
      if (cfg && typeof cfg === 'object') return normalizeConfig(cfg);
    } catch {
      /* 형식이 틀리면 기본 설정으로 */
    }
  }
  return SHARE_CONFIG ? normalizeConfig(SHARE_CONFIG) : null;
}

/** { firebase: {...}, storeCode } 또는 Firebase 콘솔의 firebaseConfig 객체 그대로도 받는다 */
function normalizeConfig(cfg) {
  if (cfg.firebase) return { firebase: cfg.firebase, storeCode: cfg.storeCode || 'default', emulator: cfg.emulator || null };
  if (cfg.apiKey && cfg.projectId) return { firebase: cfg, storeCode: cfg.storeCode || 'default', emulator: cfg.emulator || null };
  return null;
}

export async function pickBackend(settings) {
  const forced = globalThis.window?.__SHARED_BACKEND__;
  if (forced === 'local') return createLocalBackend();
  if (forced === 'none') return null; // 테스트: 배포 설정이 있어도 이 기기만
  const db = await detectArtifactDb();
  if (db) return createArtifactBackend(db);
  const cfg = shareConfig(settings);
  if (cfg?.firebase) {
    const { createFirebaseBackend } = await import('./firebase.js');
    return createFirebaseBackend(cfg);
  }
  return null;
}
