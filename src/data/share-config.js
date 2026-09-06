// 공유 저장소(Firebase Firestore) 설정.
// 여기에 Firebase 콘솔의 firebaseConfig 를 넣고 배포하면, 링크가 있는 누구나 같은 데이터를 실시간으로 본다.
// (Firebase 웹 설정은 비밀이 아니라 공개해도 되는 값입니다. 접근 제한은 Firestore 규칙과 storeCode 로 합니다.)
// 만드는 방법: README "직원과 실시간 공유하기" 참고. 비워 두면(null) 이 기기에만 저장합니다.
//
// export const SHARE_CONFIG = {
//   firebase: { apiKey: '...', authDomain: '...', projectId: '...', storageBucket: '...', messagingSenderId: '...', appId: '...' },
//   storeCode: 'cnb-xxxxxxxx', // 매장 구분용 무작위 문자열 (규칙: stores/{storeCode}/** 만 읽고 쓸 수 있음)
// };
export const SHARE_CONFIG = null;
