// "완성에 필요한 정보" 한 장짜리 정리 → docs/analysis/status.html → PDF
//   node scripts/status-report.mjs && node scripts/make-pdf.mjs docs/analysis/status.html "docs/analysis/완성에-필요한-정보.pdf"
// 채워 주실 값(확인 목록), 시트 판독 확인, 결정 사항, 남은 작업을 한 문서에 모은다. (매출 금액 없음)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChecklist } from './lib/checklist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = JSON.parse(fs.readFileSync(path.join(root, 'data', 'analysis.json'), 'utf8'));
const outDir = path.join(root, 'docs', 'analysis');
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const checklist = buildChecklist(a);
const nValues = checklist.filter((s) => s.key === 'package' || s.key === 'mapping').reduce((n, s) => n + s.rows.length, 0);
const nSheet = checklist.find((s) => s.key === 'sheet').rows.length;
const nDecide = checklist.find((s) => s.key === 'decision').rows.length;

// 현재 상태표
const FEATURES = [
  ['제품 장부 (재료 3장, 월·목)', '완료', '68개 품목, 기준 수량·박스 규칙·재발주점 규칙, 발주 문자'],
  ['자재 장부 (소모품, 수요일)', '완료', '40개 품목(인쇄 33 + 손글씨), 묶음 단위·소수 기준(1.5), 지하창고 기준 표시'],
  ['재고조사 화면', '완료', '이름·빨간 기준·숫자만, 촘촘히/넓게, 그룹 진행 칩, 세는 즉시 "발주 N" 표시'],
  ['발주서 · 발주 문자', '완료', '장부별 자동 계산, 직접 수정, 복사/공유, 기록 저장'],
  ['기록 · 인사이트', '완료', '지난 조사·발주, 소비 속도, 기준 수량 제안(3회 이상 기록 후)'],
  ['예상 재고 (판매 자료 × 레시피)', '추정값 사용', '37개 품목에 소비 속도. 23개는 포장 크기 등 추정값 — 목록의 값이 오면 정확해짐'],
  ['확인 필요 선별', '완료', '예상값으로 발주 결정이 갈릴 수 있는 품목만 표시, 예상값 채우기'],
  ['사진 자동 입력', '보류', '동작하지만 정확도가 아쉬워 계획의 축에서 제외 (API 키 필요)'],
  ['직원 간 공유', '미완', '지금은 기기마다 따로 저장. 백업 파일로 옮기기만 가능 → 결정 필요'],
  ['자재 예상 재고', '미완', '자재는 판매 자료와 연결이 없어 기록이 쌓인 뒤 소비 속도로 계산 (3회 이상)'],
  ['POS 자료 월별 갱신', '미완', '내보낸 PDF를 넣어 소비 속도를 갱신하는 절차는 수동 (스크립트)'],
  ['GitHub 배포 (Pages)', '미완', '저장소 설정에서 Pages를 켜야 함 (1회 클릭). 지금은 claude.ai 아티팩트 링크로 사용'],
];
const statusPill = (t) => `<span class="pill ${t === '완료' ? 'ok' : t === '미완' ? 'bad' : 'warn'}">${esc(t)}</span>`;

// 시트 판독 확인
const SHEET_PRODUCT = [
  ['시트 1 "레몬"(주스 칸) · 시트 2 "레몬"(시럽 칸)', '같은 품목인지. 앱에는 "레몬(주스)", "레몬(시럽)"으로 따로 넣어 둠', '중'],
  ['각주 "유자·청귤 최소발주 6○○"', '6 뒤의 단위(개/박스). 지금은 "3개 미만이면 1박스" 규칙만 적용', '낮음(흐림)'],
  ['배도라지차 "2BOX"', '1박스에 몇 병인지. 지금은 박스 단위로만 셈', '—'],
  ['원두 / 디카페인 원두', '한 줄로 세는지 따로 세는지. 지금은 한 줄', '—'],
  ['키위드레싱 → "유자드레싱" 고친 흔적', '지금 쓰는 이름이 무엇인지', '중'],
  ['스티커로 고친 기준(유자청 8, 청귤청 8, 블루베리청 6, 아이스크림 3)', '스티커 값을 썼음. 맞는지', '높음'],
];
const SHEET_SUPPLY = [
  ['인쇄된 33칸 (품목명·빨간 기준)', '독립 판독 2회 모두 일치', '높음'],
  ['아이스컵 / 아이스 뚜껑', '한 칸에 두 줄로 적혀 있어 한 품목(기준 2)으로 넣음. 따로 세면 나눠야 함', '중'],
  ['컵캐리어', '기준 칸이 비어 있어 기준 없음', '높음'],
  ['유산지 "베이커리확인"', '기준 대신 글자 → 기준 없이 메모', '높음'],
  ['라텍스장갑 "각 2" · 손글씨 "라텍스 M 4 (2통)"', '사이즈별 기준 2로 봄. M 사이즈 4가 지난 수량인지', '중'],
  ['손글씨 추가: 나무젓가락 · 라면용기 · 쇼핑백 · 대추차 T.O · 빵 스티커(★)', '기준 없이 등록. 대추차 T.O = 테이크아웃 용기로 봄', '높음'],
  ['손글씨 추가: 종이봉투 · 영수증지 · 빵 쇼핑백 · 디너냅킨', '글자가 번져 있어 이름 확인 필요', '중'],
  ['손글씨 추가: 무지비닐 · 비닐포장 손잡이', '판독이 불확실 — 실제 이름 확인 필요', '낮음'],
  ['하단 작은 글씨 "황란반죽 / 구리본"', '품목이 아닌 메모로 보여 넣지 않음', '낮음'],
  ['각주 "지하창고 비품 → 1층 카페창고로 1개씩 이동"', '앱에 규칙으로 넣지 않았음(표시만). 넣을지 결정', '—'],
];

const confPill = (c) => (c.startsWith('높') ? `<span class="pill ok">${esc(c)}</span>` : c.startsWith('낮') ? `<span class="pill bad">${esc(c)}</span>` : c === '—' ? '' : `<span class="pill warn">${esc(c)}</span>`);

// 결정 사항 (추천 포함)
const DECISIONS = [
  ['직원들이 같은 데이터를 쓰는 방식', '① 각자 휴대폰 + 백업 파일로 옮기기 ② 공유 저장소(계정 필요, 실시간)', '2주 써 본 뒤 ②. 그 전엔 ①로 충분'],
  ['재발주 카드(빈 통 뒤의 카드)', '전 품목 / 자주 떨어지는 품목만 / 안 함', '자주 떨어지는 품목만'],
  ['POS 자료 내보내기 주기', '월 1회 / 주 1회', '월 1회 (예상 재고 오차가 크면 주 1회)'],
  ['계산 규칙', '기준 제안 = 최대월 소비 × 커버(3/4일) × 1.5 · 예상 오차 35% · 실측 14일 지나면 확인', '이대로 두고 한 달 뒤 조정'],
  ['자재 "1개씩 이동" 규칙', '앱에 "1층 이동 1개 포함"으로 기준을 +1 할지, 표시만 할지', '표시만 (지금 상태)'],
  ['사진 자동 입력', '유지(API 키 필요) / 숨김', '숨김 — 눈으로 세기로 했으므로'],
  ['GitHub 설정 (관리자 클릭 3개)', 'Settings → Pages 켜기 · 기본 브랜치 main · 옛 브랜치 삭제', 'Pages만 켜면 휴대폰 홈 화면 앱으로 쓸 수 있음'],
];

// 사용법 · 다음 순서
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>완성에 필요한 정보</title>
<style>
  @font-face { font-family: 'Noto Sans KR'; font-weight: 400; src: url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family: 'Noto Sans KR'; font-weight: 700; src: url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --red:#c93a3a; --red-soft:#fbe9e9; --warn:#a8690f; --warn-soft:#fbeed2; --ok:#2e7d4f; --ok-soft:#e3f1e8; --bad:#b3261e; --bad-soft:#f8dcd9; }
  @page { size: A4; margin: 14mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Sans KR', sans-serif; font-size:10.5pt; line-height:1.55; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:22pt; margin:0 0 1mm; }
  h2 { font-size:14pt; margin:0 0 3mm; padding-bottom:1.5mm; border-bottom:2px solid var(--ink); }
  h2 .num { color:var(--red); margin-right:2.5mm; }
  h3 { font-size:11.5pt; margin:5mm 0 2mm; }
  p { margin:0 0 2.5mm; }
  .section { page-break-before: always; }
  .muted { color:var(--muted); } .small { font-size:9pt; }
  table { width:100%; border-collapse:collapse; font-size:9pt; margin:1.5mm 0 4mm; }
  tr { page-break-inside: avoid; }
  th, td { text-align:left; vertical-align:top; padding:1.5mm 2mm; border-bottom:1px solid var(--line); }
  th { font-size:8.5pt; color:var(--muted); background:var(--tint); border-bottom:1.5px solid var(--ink); }
  td.lead { font-weight:700; }
  .pill { display:inline-block; border-radius:99px; padding:0 2.2mm; font-size:8pt; font-weight:700; background:var(--tint); color:var(--muted); white-space:nowrap; }
  .pill.ok { background:var(--ok-soft); color:var(--ok); } .pill.warn { background:var(--warn-soft); color:var(--warn); } .pill.bad { background:var(--bad-soft); color:var(--bad); }
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:3mm; margin:4mm 0 5mm; }
  .tile { border:1px solid var(--line); border-radius:2.5mm; padding:3mm 3.5mm; }
  .tile .v { font-size:22pt; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
  .tile .l { font-size:8.5pt; color:var(--muted); margin-top:1.5mm; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
  .box { border:1px solid var(--line); border-radius:2.5mm; padding:3mm 4mm; }
  .box.ok { border-color:var(--ok); background:var(--ok-soft); } .box.warn { border-color:var(--warn); background:var(--warn-soft); }
  .box h3 { margin:0 0 1.5mm; font-size:10.5pt; }
  .box ul { margin:0; padding-left:4.5mm; } .box li { margin:0 0 1mm; }
  .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:3mm; margin:3mm 0; }
  .step { border-left:3px solid var(--red); padding:1.5mm 3mm; background:var(--tint); border-radius:0 2mm 2mm 0; }
  .step b { display:block; font-size:10.5pt; }
  .eyebrow { font-size:8.5pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
  .ans { width:26mm; } .ans .b { border:1px solid #9aa1a8; border-radius:1.5mm; height:7mm; }
  .callout { border-left:3px solid var(--red); background:var(--red-soft); padding:2.5mm 4mm; border-radius:0 2mm 2mm 0; margin:3mm 0; }
</style></head><body>

<div class="eyebrow">카페 재고관리 · 2026년 9월 5일</div>
<h1>완성에 필요한 정보 한 장 정리</h1>
<p class="muted">앱은 지금 바로 쓸 수 있는 상태입니다. 이 문서는 "더 정확해지려면 무엇이 필요한지"를 한곳에 모은 것입니다. 답을 주시는 만큼 반영하고, 답이 없는 항목은 지금 값(추정)으로 계속 갑니다.</p>

<div class="tiles">
  <div class="tile"><div class="v">${FEATURES.filter((f) => f[1] === '완료').length}<span class="small muted">/${FEATURES.length}</span></div><div class="l">기능 완료 (나머지는 추정값 사용·보류·미완)</div></div>
  <div class="tile"><div class="v">${nValues}</div><div class="l">채워 주실 값 (포장 크기·연결)</div></div>
  <div class="tile"><div class="v">${SHEET_PRODUCT.length + SHEET_SUPPLY.filter((r) => !r[2].startsWith('높')).length}</div><div class="l">시트 판독 중 확인이 필요한 것</div></div>
  <div class="tile"><div class="v">${DECISIONS.length}</div><div class="l">결정해 주실 것 (추천 답 표시)</div></div>
</div>

<div class="two">
  <div class="box ok"><h3>지금 바로 되는 것</h3><ul>
    <li>제품(월·목)·자재(수) 두 장부를 따로 세고 따로 발주 문자 만들기</li>
    <li>세는 즉시 줄마다 "발주 N" 표시, 위에 발주 예정 개수</li>
    <li>기준 수량·박스 규칙(1box&gt;6, 3개 미만이면 1박스, 묶음·1.5 기준) 자동 계산</li>
    <li>제품 37개 품목의 예상 재고와 "확인 필요" 선별 (판매 자료 기반)</li>
    <li>기록·소비 속도·기준 수량 제안, 백업 파일로 다른 휴대폰에 옮기기</li>
  </ul></div>
  <div class="box warn"><h3>아직 안 되는 것 · 이유</h3><ul>
    <li>직원끼리 실시간 공유 — 저장 방식을 정해야 함 (4장 결정 1)</li>
    <li>예상 재고의 정확도 — 포장 크기 23개가 추정값 (3장)</li>
    <li>자재 예상 재고 — 판매 자료와 연결이 없어 기록 3회 뒤부터</li>
    <li>휴대폰 홈 화면 앱(GitHub Pages) — 관리자 설정 1회 필요 (4장 결정 7)</li>
    <li>자재 시트 손글씨 일부 판독 불확실 (3장 나)</li>
  </ul></div>
</div>

<h3>다음 순서</h3>
<div class="steps">
  <div class="step"><b>① 이번 주</b>앱으로 월·목·수 재고조사 1회씩 해 보기. 불편한 점 메모</div>
  <div class="step"><b>② 아는 것만 채우기</b>3장의 빈칸 중 포장에 적힌 값(용량·무게·봉 수)만 적어 주기. 사진도 됨</div>
  <div class="step"><b>③ 2주 뒤 결정</b>4장의 결정 7개 중 공유 방식·재발주 카드·Pages 켜기</div>
</div>
<div class="callout"><b>앱 링크</b> — https://claude.ai/code/artifact/664dbee2-c490-4dd1-b524-e83245996622 (내 Claude 계정으로 열림 · 다른 직원과 쓰려면 백업 파일을 보내거나 4장 결정 1 후 공유 저장소)</div>

<section class="section">
<h2><span class="num">1</span>현재 상태</h2>
<table>
<thead><tr><th style="width:44mm">기능</th><th style="width:20mm">상태</th><th>내용</th></tr></thead>
<tbody>${FEATURES.map((f) => `<tr><td class="lead">${esc(f[0])}</td><td>${statusPill(f[1])}</td><td>${esc(f[2])}</td></tr>`).join('')}</tbody>
</table>
<h3>사용 흐름 (지금 방식)</h3>
<table>
<thead><tr><th style="width:26mm">언제</th><th>무엇을</th><th style="width:60mm">앱에서</th></tr></thead>
<tbody>
<tr><td class="lead">월·목 아침</td><td>제품 재고조사 → 발주</td><td>재고조사 탭 [제품] → 숫자 입력(확인 필요 품목 위주) → 발주서 확인 → 복사 → 카톡</td></tr>
<tr><td class="lead">수요일</td><td>자재 재고조사 → 발주 (지하창고 기준)</td><td>재고조사 탭 [자재] → 숫자 입력 → 자재 발주서 → 복사</td></tr>
<tr><td class="lead">입고 시</td><td>발주 확정 기록이 입고로 계산됨</td><td>따로 할 일 없음 (기록 탭에서 확인)</td></tr>
<tr><td class="lead">매달 초</td><td>POS "그룹별 매출분석" 내보내기</td><td>지금은 파일을 보내 주시면 소비 속도를 갱신 (자동화 예정)</td></tr>
<tr><td class="lead">기기 바꿀 때</td><td>백업 내보내기/불러오기</td><td>설정 탭 → 백업 (API 키는 포함 안 됨)</td></tr>
</tbody></table>
</section>

<section class="section">
<h2><span class="num">2</span>채워 주실 값 <span class="small muted">— 지금 쓰는 추정값이 있으면 틀린 것만 고쳐 주세요</span></h2>
${checklist
  .filter((sec) => sec.key === 'package' || sec.key === 'mapping')
  .map(
    (sec) => `<h3>${esc(sec.title)}</h3>
<table>
<thead><tr><th style="width:34mm">${esc(sec.head[0])}</th><th>${esc(sec.head[1])}</th><th style="width:30mm">지금 쓰는 추정값</th><th style="width:26mm">답</th></tr></thead>
<tbody>${sec.rows.map((r) => `<tr><td class="lead">${esc(r[0])}</td><td>${esc(r[1])}<div class="small muted">${esc(r[2])}</div></td><td class="small">${esc(r[3] || '')}</td><td class="ans"><div class="b"></div></td></tr>`).join('')}</tbody>
</table>`,
  )
  .join('')}
</section>

<section class="section">
<h2><span class="num">3</span>시트 판독 확인</h2>
<h3>가. 제품 시트 3장 (월·목)</h3>
<table>
<thead><tr><th style="width:52mm">항목</th><th>확인할 것</th><th style="width:16mm">판독</th><th style="width:26mm">답</th></tr></thead>
<tbody>${SHEET_PRODUCT.map((r) => `<tr><td class="lead">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${confPill(r[2])}</td><td class="ans"><div class="b"></div></td></tr>`).join('')}</tbody>
</table>
<h3>나. 자재 시트 (수요일) — 사진 독립 판독 2회 대조</h3>
<table>
<thead><tr><th style="width:52mm">항목</th><th>확인할 것</th><th style="width:16mm">판독</th><th style="width:26mm">답</th></tr></thead>
<tbody>${SHEET_SUPPLY.map((r) => `<tr><td class="lead">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${confPill(r[2])}</td><td class="ans"><div class="b"></div></td></tr>`).join('')}</tbody>
</table>
<p class="small muted">판독 "낮음" 항목은 앱 품목 탭에서 이름을 바로 고칠 수 있습니다. 시트 사진을 다시 찍어 주시면 재판독합니다.</p>
</section>

<section class="section">
<h2><span class="num">4</span>결정해 주실 것 <span class="small muted">— 추천 답을 적어 두었습니다. 그대로 두셔도 됩니다</span></h2>
<table>
<thead><tr><th style="width:40mm">항목</th><th>선택지</th><th style="width:44mm">추천</th><th style="width:22mm">답</th></tr></thead>
<tbody>${DECISIONS.map((r, i) => `<tr><td class="lead">${i + 1}. ${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="ans"><div class="b"></div></td></tr>`).join('')}</tbody>
</table>

<h3>이 다음에 만들 것 (순서 제안)</h3>
<table>
<thead><tr><th style="width:8mm">#</th><th style="width:48mm">할 일</th><th>필요한 것</th><th style="width:22mm">크기</th></tr></thead>
<tbody>
<tr><td>1</td><td class="lead">채워 주신 값 반영</td><td>2장의 답 → 연결표 수정 → 예상 재고 재계산 · 앱 갱신</td><td>작음</td></tr>
<tr><td>2</td><td class="lead">GitHub Pages 켜기</td><td>관리자 클릭 1회 → 휴대폰 홈 화면 앱 주소 생성</td><td>아주 작음</td></tr>
<tr><td>3</td><td class="lead">직원 간 공유 저장소</td><td>결정 1이 ②면: 계정 1개 + 로그인 없는 매장 코드 방식 설계·구현</td><td>중간 (1~2주)</td></tr>
<tr><td>4</td><td class="lead">POS 월별 갱신 자동화</td><td>내보낸 PDF를 앱 설정에서 바로 올리면 소비 속도 갱신</td><td>중간</td></tr>
<tr><td>5</td><td class="lead">자재 예상 재고</td><td>자재 기록 3회 이상 쌓이면 소비 속도로 "지금쯤" 계산 (제품과 같은 방식)</td><td>작음</td></tr>
<tr><td>6</td><td class="lead">품목 등급(A/B/C)·재발주 카드 안내</td><td>결정 2 이후. 자주 떨어지는 품목 자동 표시</td><td>작음</td></tr>
</tbody></table>
<p class="small muted">모든 자료(판매 보고서·레시피·소비 모델·이 문서)는 공개 저장소에 올리지 않았습니다. 코드만 GitHub에 있습니다.</p>
</section>
</body></html>`;
fs.writeFileSync(path.join(outDir, 'status.html'), html);
console.log(`docs/analysis/status.html (${(html.length / 1024).toFixed(0)} KB)`);
