// 공유 저장소(Firebase Firestore) 설정.
// 이 파일은 저장소에 비워 둡니다(null). 실제 설정은 배포할 때 GitHub Actions 가 저장소 비밀값 SHARE_CONFIG_JSON 으로 채워 넣습니다
// (.github/workflows/pages.yml). 공개 저장소에 매장 코드(storeCode)가 그대로 올라가지 않게 하려는 것입니다 —
// Firebase 웹 설정 자체는 비밀이 아니지만, storeCode 는 "링크를 아는 사람만" 데이터에 닿게 하는 유일한 장치이므로 저장소에서 검색되지 않게 둡니다.
//
// 배포하지 않고 한 기기에서 먼저 시험하려면 설정 탭 → 공유 저장소 카드에 같은 JSON 을 붙여 넣으면 됩니다.
// 비공개 저장소라면 여기에 직접 넣어도 됩니다:
// export const SHARE_CONFIG = {
//   firebase: { apiKey: '...', authDomain: '...', projectId: '...', storageBucket: '...', messagingSenderId: '...', appId: '...' },
//   storeCode: 'cnb-xxxxxxxxxxxx', // 매장 구분용 무작위 문자열 12자 이상 (규칙: stores/{storeCode}/** 만 읽고 쓸 수 있음)
// };
export const SHARE_CONFIG = null;
