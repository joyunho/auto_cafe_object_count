// 마지막으로 원격과 맞춘 상태("기준선", engine.js 의 synced)를 이 기기에 남긴다.
//
// 엔진은 세 값을 비교한다: 로컬 상태 · 기준선 · 원격 스냅샷. 기준선이 메모리에만 있으면 앱을 다시 열 때
// (홈 화면 앱 재실행·새로고침·설정 변경으로 다시 연결) 기준선이 비어 있어 "내가 방금 고친 것"과
// "원격이 고친 것"을 구별할 수 없고, 그러면 원격 문서가 통째로 이긴다 — 아직 보내지 못한 입력이
// 화면에서도 저장소에서도 소리 없이 사라진다. 그래서 기준선을 앱 상태 옆에 같이 저장한다.
//
// 저장 순서는 언제나 "앱 상태를 저장한 뒤"다. 그래서 기준선은 상태보다 뒤처질 수는 있어도 앞설 수는 없다.
// 뒤처진 기준선은 안전하다 — 이미 보낸 변경을 한 번 더 보낼 뿐(같은 값이라 결과가 같다) 아무것도 지우지 않는다.
// 반대로 앞선 기준선은 로컬 변경을 "원격이 지운 것"으로 오해해 지워 버린다.
import { STORAGE_KEY } from '../store.js';

/** 앱 저장소 키마다 따로 (테스트에서 한 브라우저 안의 '두 기기'가 섞이지 않게) */
export const baselineKey = () => `${STORAGE_KEY}.synced`;

/**
 * 백엔드가 가리키는 저장소를 나타내는 문자열. 매장 코드나 프로젝트가 바뀌면 기준선도 버려야 한다
 * (다른 저장소의 기준선을 쓰면 남의 문서를 "내가 지운 것"으로 오해한다).
 */
export function backendScope(backend) {
  const info = backend?.info || {};
  return [backend?.name || 'unknown', info.projectId || '', info.storeCode || ''].join(':');
}

/** 저장 공간이 모자랄 때 자리를 내주려고 기준선을 버린다 (없어도 다음 실행이 "합치기"로 입력을 지킨다) */
export function clearBaseline(key = baselineKey()) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * localStorage 에 기준선을 넣고 빼는 작은 저장소. 엔진에 opts.baseline 으로 넘긴다.
 * 읽기·쓰기 모두 실패해도 앱은 그대로 돌아간다 (기준선이 없으면 엔진이 "합치기"로 안전하게 처리한다).
 */
export function createBaselineStore(scope, key = baselineKey()) {
  return {
    scope,
    key,
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' || saved.scope !== scope) return null; // 다른 저장소의 기준선
        return saved;
      } catch {
        return null;
      }
    },
    save(snapshot) {
      try {
        localStorage.setItem(key, JSON.stringify({ ...snapshot, scope }));
        return true;
      } catch {
        return false; // 저장 공간이 부족하면 기준선 없이 간다 (다음 실행은 합치기로 시작)
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* 지울 수 없으면 그대로 둔다 */
      }
    },
  };
}
