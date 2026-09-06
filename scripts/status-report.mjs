// "완성에 필요한 정보 정리" → docs/analysis/status.html → PDF
//   node scripts/status-report.mjs && node scripts/make-pdf.mjs docs/analysis/status.html "docs/analysis/완성에-필요한-정보.pdf"
// 채워 주실 값(확인 목록), 종이 재고표 판독 확인, 결정 사항, 남은 작업을 한 문서에 모은다. (매출 금액 없음)
// 읽는 사람: 카페에서 일하는 사용자 본인. 개발 용어는 피하고, 답은 채팅(글·사진)이나 앱에서 직접 고치는 것으로 받는다.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildChecklist } from './lib/checklist.mjs';
import { SEED_ITEMS } from '../src/data/items.js';
import { SEED_SUPPLY_ITEMS } from '../src/data/supplies.js';

// ── 쪽 번호: PDF를 만든 뒤 실제 쪽과 맞춘다 (각 번호 절은 새 쪽에서 시작) ──
const PAGE = { features: '2', values: '3~5', sheet: '6', decide: '7' };
const REF = {
  values: `(2번 표, ${PAGE.values}쪽)`,
  sheetB: `(3번 나, ${PAGE.sheet}쪽)`,
  decide: (n) => `(4번 결정 ${n}, ${PAGE.decide}쪽)`,
};
const TODAY = '2026년 9월 5일';
const DECIDE_BY = '9월 19일쯤'; // 오늘부터 2주 뒤
const APP_URL = 'https://claude.ai/code/artifact/664dbee2-c490-4dd1-b524-e83245996622';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = JSON.parse(fs.readFileSync(path.join(root, 'data', 'analysis.json'), 'utf8'));
const outDir = path.join(root, 'docs', 'analysis');
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── 품목 수는 시드 데이터에서 센다 ──
const nItems = SEED_ITEMS.filter((i) => i.active).length;
const supplies = SEED_SUPPLY_ITEMS.filter((i) => i.active);
const nSupplyHand = supplies.filter((i) => i.par == null && /손글씨/.test(i.note || '')).length;
const nSupply = supplies.length;
const nRate = (a.items || []).filter((i) => i.perPackage).length; // 소비 속도가 나오는 품목
const nAssumed = (a.items || []).filter((i) => i.perPackage && i.assumed).length; // 그중 포장 크기 등이 추정값

// ── 2번 표: 지난 1년 안 팔린 것("0…/년")은 빼고 묻는다 ──
const NEVER_SOLD = /^0\D/;
const checklist = buildChecklist(a);
const valueSections = checklist
  .filter((s) => s.key === 'package' || s.key === 'mapping')
  .map((s) => ({ ...s, rows: s.rows.filter((r) => !NEVER_SOLD.test(r[2] || '')), skipped: s.rows.filter((r) => NEVER_SOLD.test(r[2] || '')).map((r) => r[0].replace(/\s*\(POS\)/, '')) }));
const nValues = valueSections.reduce((n, s) => n + s.rows.length, 0);

// ── 1번: 현재 상태표 ──
const FEATURES = [
  ['제품 장부 (재료 3장, 월·목)', '완료', `${nItems}개 품목, 기준 수량·박스 규칙·몇 개 남으면 시키는지 규칙, 발주 문자`],
  ['자재 장부 (소모품, 수요일)', '완료', `${nSupply}개 품목(인쇄 ${nSupply - nSupplyHand} + 손글씨 ${nSupplyHand}), 묶음 단위·소수 기준(1.5), 지하창고 기준 표시`],
  ['재고조사 화면', '완료', '이름 · 빨간 기준 · 검은 숫자가 한 줄에 정렬, 세면 기준 밑에 "발주 3"처럼 표시, 분류별 진행 표시, 크게/작게 보기'],
  ['발주서 · 발주 문자', '완료', '장부별 자동 계산, 직접 수정, 복사/공유, 기록 저장'],
  ['기록 · 통계', '완료', '지난 조사·발주, 소비 속도, 기준 수량 제안(3회 이상 기록 후)'],
  ['예상 재고 (포스 매출 × 레시피)', '추정값 사용', `${nRate}개 품목에 소비 속도. 그중 ${nAssumed}개는 포장 크기 등 추정값 — 2번 표의 값이 오면 정확해짐`],
  ['확인 필요 선별', '완료', '예상값으로 발주 결정이 갈릴 수 있는 품목만 표시, 예상값 채우기'],
  ['사진 자동 입력', '보류', '동작하지만 정확도가 아쉬워 기본 사용법에서 뺌 (유료 사진 인식 기능, API 키 필요)'],
  ['직원 간 공유', '미완', `지금은 기기마다 따로 저장. 백업 파일로 옮기기만 가능 → 결정 필요 ${REF.decide(1)}`],
  ['자재 예상 재고', '미완', '자재는 포스 매출과 연결이 없어 기록이 쌓인 뒤 소비 속도로 계산 (3회 이상)'],
  ['포스 자료 월별 갱신', '미완', '지금은 파일을 보내 주시면 제가 넣음. 앱에서 바로 올리는 기능은 나중에'],
  ['휴대폰 홈 화면 앱', '미완', `GitHub 설정 1회 ${REF.decide(7)} 뒤에 새 주소가 생김. 지금은 임시 주소로 사용`],
];
const NOW_USABLE = ['완료', '추정값 사용'];
const nNow = FEATURES.filter((f) => NOW_USABLE.includes(f[1])).length;
const nLater = FEATURES.length - nNow;
const nEstFeat = FEATURES.filter((f) => f[1] === '추정값 사용').length;
const statusPill = (t) => `<span class="pill ${t === '완료' ? 'ok' : t === '미완' ? 'bad' : 'warn'}">${esc(t)}</span>`;

// ── 3번: 종이 재고표를 제대로 읽었는지 ── (배도라지차 박스는 2번 가에, 지하창고 규칙은 4번 결정 5에만 둔다)
const SHEET_PRODUCT = [
  ['1장째 "레몬"(주스 칸) · 2장째 "레몬"(시럽 칸)', '과일로 확인됨. 같은 레몬인지, 기준(1 / 6)은 어느 쪽인지. 앱에는 따로 넣어 둠', '중'],
  ['각주 "유자·청귤 최소발주 6○○"', '6 뒤의 단위(개/박스). 지금은 "3개 미만이면 1박스" 규칙만 적용', '낮음(흐림)'],
  ['원두 / 디카페인 원두', '한 줄로 세는지 따로 세는지. 지금은 한 줄', '—'],
  ['키위드레싱 → "유자드레싱" 고친 흔적', '지금 쓰는 이름이 무엇인지', '중'],
  ['스티커로 고친 기준(유자청 8, 청귤청 8, 블루베리청 6, 아이스크림 3)', '스티커 값을 썼음. 맞는지', '높음'],
];
const SHEET_SUPPLY = [
  ['아이스컵 / 아이스 뚜껑', '한 칸에 두 줄로 적혀 있어 한 품목(기준 2)으로 넣음. 따로 세면 나눠야 함', '중'],
  ['컵캐리어', '기준 칸이 비어 있어 기준 없음', '높음'],
  ['유산지 "베이커리확인"', '기준 대신 글자 → 기준 없이 메모', '높음'],
  ['라텍스장갑 "각 2" · 손글씨 "라텍스 M 4 (2통)"', '사이즈별 기준 2로 봄. M 사이즈 4가 지난 수량인지', '중'],
  ['손글씨 추가: 나무젓가락 · 라면용기 · 쇼핑백 · 대추차 T.O · 빵 스티커(★)', '기준 없이 등록. 대추차 T.O = 테이크아웃 용기로 봄', '높음'],
  ['손글씨 추가: 종이봉투 · 영수증지 · 빵 쇼핑백 · 디너냅킨', '글자가 번져 있어 이름 확인 필요', '중'],
  ['손글씨 추가: 무지비닐 · 비닐포장 손잡이', '읽은 것이 불확실 — 실제 이름 확인 필요', '낮음'],
  ['하단 작은 글씨 "황란반죽 / 구리본"', '품목이 아닌 메모로 보여 넣지 않음', '낮음'],
];
const nSheet = [...SHEET_PRODUCT, ...SHEET_SUPPLY].filter((r) => !r[2].startsWith('높')).length;
const confPill = (c) => (c.startsWith('높') ? `<span class="pill ok">${esc(c)}</span>` : c.startsWith('낮') ? `<span class="pill bad">${esc(c)}</span>` : c === '—' ? '<span class="pill">질문</span>' : `<span class="pill warn">${esc(c)}</span>`);

// ── 4번: 결정 사항 (추천 포함) ──
const DECISIONS = [
  ['직원들이 같은 데이터를 쓰는 방식', '① 각자 휴대폰 + 백업 파일로 옮기기 ② 모두 같은 데이터를 보는 공유 저장 방식(계정 1개 필요)', '2주 써 본 뒤 ②. 그 전엔 ①로 충분'],
  ['재발주 카드(빈 통 뒤의 카드)', '전 품목 / 자주 떨어지는 품목만 / 안 함', '자주 떨어지는 품목만'],
  ['포스 자료 내보내기 주기', '월 1회 / 주 1회', '월 1회 (예상 재고 오차가 크면 주 1회)'],
  ['계산 규칙', '지금 계산 방식 그대로 / 한 달 뒤 조정', '그대로 두고 한 달 뒤 조정'],
  ['자재 "1개씩 이동" 규칙 (재고표 각주 "지하창고 비품 → 1층 카페창고로 1개씩 이동")', '앱에 "1층 이동 1개 포함"으로 기준을 +1 할지, 표시만 할지', '표시만 (지금 상태)'],
  ['사진 자동 입력', '유지(유료 사진 인식) / 숨김', '숨김 — 눈으로 세기로 했으므로'],
  ['GitHub 설정 1회 (휴대폰 홈 화면 앱)', 'GitHub 저장소 → Settings → Pages → Source를 "GitHub Actions"로 · 기본 브랜치가 main인지 확인', '켜기 — 켜면 휴대폰 홈 화면 앱 주소가 생김'],
];
const NEXT = [
  ['채워 주신 값 반영', `2번 표의 답 → 재료 연결 수정 → 예상 재고 다시 계산 · 앱 갱신`, '며칠'],
  ['휴대폰 홈 화면 앱 주소', 'GitHub 설정 1회 (4번 결정 7) → 휴대폰 홈 화면 앱 주소 생성', '반나절'],
  ['직원 간 공유', '결정 1이 ②면: 직원 모두 같은 앱을 보게 하는 방식 만들기 (계정 1개 필요)', '1~2주'],
  ['포스 자료 월별 갱신', '내보낸 PDF를 앱 설정에서 바로 올리면 소비 속도가 갱신되게', '1주'],
  ['자재 예상 재고', '자재 기록 3회 이상 쌓이면 소비 속도로 "지금쯤" 계산 (제품과 같은 방식)', '며칠'],
  ['자주 떨어지는 품목 표시 · 재발주 카드 안내', '결정 2 이후. 자주 떨어지는 품목을 자동으로 표시', '며칠'],
];

// ── QR 코드 (파이썬 qrcode 패키지, 없으면 글자만) ──
function qrSvg(text) {
  try {
    const py = 'import qrcode,qrcode.image.svg as s,io,sys;q=qrcode.QRCode(box_size=10,border=3,image_factory=s.SvgPathImage);q.add_data(sys.argv[1]);q.make(fit=True);b=io.BytesIO();q.make_image().save(b);sys.stdout.write(b.getvalue().decode())';
    const svg = execSync(`python3 -c "${py}" "${text}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const body = svg.replace(/^<\?xml[^>]*\?>\s*/, '').trim();
    if (!body.startsWith('<svg')) return '';
    return body.replace(/<svg /, '<svg shape-rendering="crispEdges" ').replace(/width="[^"]*"/, 'width="28mm"').replace(/height="[^"]*"/, 'height="28mm"');
  } catch {
    return '';
  }
}
const qr = qrSvg(APP_URL);

// ── 답 칸 ──
const cb = (label) => `<span class="cb"></span>${esc(label)}`;
const chk = () => `<div class="chk">${cb('맞음')}<span class="gap"></span>${cb('다름')}</div>`;
const fieldHtml = (label) => `<div class="f">${esc(label).split('__').map((part, i, arr) => part + (i < arr.length - 1 ? '<span class="u"></span>' : '')).join('')}</div>`;
const answerCell = (fields, blank = 'b') => `<td class="ans">${chk()}${fields && fields.length ? `<div class="fields${fields.length <= 2 ? ' few' : ''}">${fields.map(fieldHtml).join('')}</div>` : `<div class="${blank}"></div>`}</td>`;
const decisionCell = () => `<td class="ans"><div class="chk">${cb('추천대로')}</div><div class="chk">${cb('다른 선택:')} <span class="u long"></span></div></td>`;
const lead = (no, text) => `<td class="lead"><span class="no">${no}.</span>${esc(text)}</td>`;

// 문서 안 용어 통일 (다른 스크립트가 같은 목록을 쓰므로 렌더할 때만 바꾼다)
const plain = (t) => String(t ?? '').replace(/시트 (\d)/g, '재고표 $1장째').replace(/시트 기준/g, '재고표 기준').replace(/시트 품목/g, '재고표 품목').replace(/\(POS\)/g, '(포스 상품)').replace(/POS 상품/g, '포스 상품').replace(/시트/g, '재고표');
const valueTable = (sec) => `<h3>${esc(plain(sec.title))}</h3>
<table>
<thead><tr><th style="width:34mm">${esc(plain(sec.head[0]))}</th><th>${esc(sec.head[1])}</th><th style="width:46mm">답</th></tr></thead>
<tbody>${sec.rows
  .map(
    (r, i) => `<tr>${lead(i + 1, plain(r[0]))}<td>${esc(plain(r[1]))}${r[2] || r[3] ? `<div class="small">${[r[2] ? `<span class="muted">${esc(r[2])}</span>` : '', r[3] ? `<span class="now">지금: ${esc(plain(r[3]))}</span>` : ''].filter(Boolean).join(' <span class="muted">·</span> ')}</div>` : ''}</td>${answerCell(r[4])}</tr>`,
  )
  .join('')}</tbody>
</table>${sec.skipped.length ? `<p class="small muted skip">지난 1년 안 팔린 메뉴(${esc(sec.skipped.join(' · '))})는 나중에 팔리기 시작하면 물어보겠습니다.</p>` : ''}`;

const sheetTable = (rows) => `<table class="sheet">
<thead><tr><th style="width:46mm">항목</th><th>확인할 것</th><th class="nw" style="width:19mm">읽은 정확도</th><th style="width:46mm">답</th></tr></thead>
<tbody>${rows.map((r, i) => `<tr>${lead(i + 1, r[0])}<td>${esc(r[1])}</td><td>${confPill(r[2])}</td>${answerCell(null, 'b short')}</tr>`).join('')}</tbody>
</table>`;

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><title>완성에 필요한 정보 정리</title>
<style>
  @font-face { font-family: 'Noto Sans KR'; font-weight: 400; src: url('../proposal/fonts/NotoSansKR-400.ttf') format('truetype'); }
  @font-face { font-family: 'Noto Sans KR'; font-weight: 700; src: url('../proposal/fonts/NotoSansKR-700.ttf') format('truetype'); }
  :root { --ink:#17191c; --muted:#5f666d; --line:#d7dbdf; --tint:#f3f4f2; --red:#c93a3a; --red-soft:#fbe9e9; --warn:#a8690f; --warn-soft:#fbeed2; --ok:#2e7d4f; --ok-soft:#e3f1e8; --bad:#b3261e; --bad-soft:#f8dcd9; --blank:#8d949b; }
  @page { size: A4; margin: 14mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Sans KR', sans-serif; font-size:10.5pt; line-height:1.55; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:22pt; margin:0; line-height:1.2; }
  .subtitle { font-size:11pt; color:var(--red); font-weight:700; margin:0.5mm 0 2mm; }
  h2 { font-size:14pt; margin:0 0 3mm; padding-bottom:1.5mm; border-bottom:2px solid var(--ink); }
  h2 .num { color:var(--red); margin-right:2.5mm; }
  h3 { font-size:11.5pt; margin:4mm 0 1.5mm; }
  p { margin:0 0 2.5mm; }
  .section { page-break-before: always; }
  .muted { color:var(--muted); } .small { font-size:9pt; }
  .guide { font-size:9.5pt; background:var(--tint); border-radius:2mm; padding:1.5mm 3.5mm; margin:0 0 3mm; }
  table { width:100%; border-collapse:collapse; font-size:9pt; margin:1.5mm 0 2.5mm; }
  tr { page-break-inside: avoid; }
  th, td { text-align:left; vertical-align:top; padding:1.3mm 2mm; border-bottom:1px solid var(--line); }
  th.nw { white-space:nowrap; }
  th { font-size:8.5pt; color:var(--muted); background:var(--tint); border-bottom:1.5px solid var(--ink); }
  thead { display: table-header-group; }
  td.lead { font-weight:700; }
  td .no { color:var(--muted); font-weight:400; margin-right:1mm; font-variant-numeric:tabular-nums; }
  td .now { color:var(--ink); }
  .pill { display:inline-block; border-radius:99px; padding:0 2.2mm; font-size:8pt; font-weight:700; background:var(--tint); color:var(--muted); white-space:nowrap; }
  .pill.ok { background:var(--ok-soft); color:var(--ok); } .pill.warn { background:var(--warn-soft); color:var(--warn); } .pill.bad { background:var(--bad-soft); color:var(--bad); }
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:3mm; margin:3.5mm 0 4mm; }
  .tile { border:1px solid var(--line); border-radius:2.5mm; padding:2.5mm 3.5mm; }
  .tile .v { font-size:22pt; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
  .tile .v .small { font-size:10pt; font-weight:400; }
  .tile .l { font-size:8.5pt; color:var(--muted); margin-top:1.2mm; line-height:1.4; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
  .box { border:1px solid var(--line); border-radius:2.5mm; padding:3mm 4mm; }
  .box.ok { border-color:var(--ok); background:var(--ok-soft); } .box.warn { border-color:var(--warn); background:var(--warn-soft); }
  .box.red { border-color:var(--red); background:var(--red-soft); }
  .box h3 { margin:0 0 1.5mm; font-size:10.5pt; }
  .box ul, .box ol { margin:0; padding-left:4.5mm; } .box li { margin:0 0 1mm; }
  .box ol.circ { list-style:none; padding-left:0; } .box ol.circ li { padding-left:5mm; text-indent:-5mm; }
  .box p:last-child { margin-bottom:0; }
  .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:3mm; margin:2mm 0 3.5mm; }
  .step { border-left:3px solid var(--red); padding:1.5mm 3mm; background:var(--tint); border-radius:0 2mm 2mm 0; }
  .step b { display:block; font-size:10.5pt; }
  .eyebrow { font-size:8.5pt; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
  .qrrow { display:flex; gap:3.5mm; align-items:flex-start; }
  .qr { flex:0 0 28mm; width:28mm; height:28mm; background:#fff; border-radius:1.5mm; padding:0; }
  .qr svg { display:block; width:28mm; height:28mm; }
  .qrrow p { font-size:9.5pt; line-height:1.5; margin:0 0 1.5mm; }
  .url { font-size:8pt; word-break:break-all; line-height:1.3; }
  /* 답 칸 */
  .ans { width:46mm; }
  .chk { font-size:8.5pt; color:var(--ink); white-space:nowrap; margin:0 0 .5mm; line-height:1.4; }
  .chk .gap { display:inline-block; width:4mm; }
  .cb { display:inline-block; width:3.4mm; height:3.4mm; border:1px solid var(--blank); border-radius:.6mm; vertical-align:-0.7mm; margin-right:1.2mm; background:#fff; }
  .b { border:1px solid var(--blank); border-radius:1.5mm; min-height:10.5mm; background:#fff; }
  .b.short { min-height:7mm; }
  .sheet td, .sheet th { padding:1.2mm 2mm; }
  .fields { display:flex; flex-wrap:wrap; column-gap:3mm; row-gap:.4mm; }
  .f { font-size:8.5pt; line-height:1.4; white-space:nowrap; }
  .f .u, .chk .u { display:inline-block; width:13mm; height:4.2mm; border-bottom:1px solid var(--blank); vertical-align:-1.1mm; margin:0 .6mm; }
  .chk .u.long { width:22mm; }
  .fields.few .u { width:18mm; }
  .skip { margin:-1.5mm 0 3mm; }
  .legend { font-size:9pt; color:var(--muted); margin:0 0 1.5mm; }
</style></head><body>

<div class="eyebrow">카페 재고관리 · ${TODAY}</div>
<h1>완성에 필요한 정보 정리</h1>
<p class="subtitle">첫 장만 보셔도 됩니다</p>
<p class="muted">앱은 지금 바로 쓸 수 있는 상태입니다. 이 문서는 "더 정확해지려면 무엇이 필요한지"를 한곳에 모은 것입니다. 답을 주시는 만큼 반영하고, 답이 없는 항목은 지금 값(추정)으로 계속 갑니다.</p>
<p class="guide"><b>이 문서 보는 법</b> — 2번 = 값 채우기(${PAGE.values}쪽) · 3번 = 종이 재고표 읽은 것 확인(${PAGE.sheet}쪽) · 4번 = 결정(${PAGE.decide}쪽)</p>

<div class="tiles">
  <div class="tile"><div class="v">${nNow}<span class="small muted"> / 나중에 ${nLater}</span></div><div class="l">지금 쓰는 기능 ${nNow} / 나중에 ${nLater} — ${nNow}개 중 ${nEstFeat}개(예상 재고)는 추정값으로 돌아감</div></div>
  <div class="tile"><div class="v">${nValues}</div><div class="l">확인해 주실 값 — 포장 용량 · 메뉴별 재료. 맞으면 체크만</div></div>
  <div class="tile"><div class="v">${nSheet}</div><div class="l">종이 재고표에서 확인이 필요한 것 (높음 제외)</div></div>
  <div class="tile"><div class="v">${DECISIONS.length}</div><div class="l">결정해 주실 것 (추천 답 표시)</div></div>
</div>

<div class="two">
  <div class="box ok"><h3>지금 바로 되는 것</h3><ul>
    <li>제품(월·목)·자재(수) 두 장부를 따로 세고 따로 발주 문자 만들기</li>
    <li>세는 즉시 줄마다 "발주 3"처럼 몇 개 시킬지 표시</li>
    <li>기준 넘는 것은 박스 단위로, 3개 미만이면 1박스 — 종이 재고표 규칙 그대로 자동 계산</li>
    <li>제품 ${nItems}개 중 ${nRate}개(포스 매출이 있는 품목)의 예상 재고와 "확인 필요" 선별</li>
    <li>기록·소비 속도·기준 수량 제안, 백업 파일로 다른 휴대폰에 옮기기</li>
  </ul></div>
  <div class="box warn"><h3>아직 안 되는 것 · 이유</h3><ul>
    <li>직원끼리 실시간 공유 — 저장 방식을 정해야 함 ${REF.decide(1)}</li>
    <li>예상 재고의 정확도 — 포장 크기 ${nAssumed}개가 추정값 ${REF.values}</li>
    <li>자재 예상 재고 — 포스 매출과 연결이 없어 기록 3회 뒤부터</li>
    <li>휴대폰 홈 화면에 앱 아이콘 — GitHub 설정 1회 ${REF.decide(7)}</li>
    <li>자재 종이 재고표의 손글씨 일부를 잘못 읽었을 수 있음 ${REF.sheetB}</li>
  </ul></div>
</div>

<h3>다음 순서</h3>
<div class="steps">
  <div class="step"><b>① 이번 주</b>앱으로 월·목·수 재고조사 1회씩 해 보기. 불편한 점 메모</div>
  <div class="step"><b>② 아는 것만 채우기</b>2번 표(${PAGE.values}쪽)의 빈칸 중 포장에 적힌 값(용량·무게·봉 수)만 적어 주기. 사진도 됨</div>
  <div class="step"><b>③ ${DECIDE_BY} 결정</b>4번 표(${PAGE.decide}쪽)의 결정 ${DECISIONS.length}개 중 공유 방식·재발주 카드·GitHub 설정 1회</div>
</div>

<div class="two">
  <div class="box red"><h3>앱 여는 법</h3>
    <div class="qrrow">${qr ? `<div class="qr">${qr}</div>` : ''}<div>
      <p>QR을 찍거나 채팅에 있는 링크를 누르면 열립니다. 이 링크는 Claude 계정으로 로그인한 기기(본인)에서 열립니다. 다른 직원 휴대폰에서 쓰려면 4번 결정 7(GitHub 설정 1회, ${PAGE.decide}쪽) 뒤에 새 주소가 생기고, 그 전엔 설정 탭 → 백업 파일로 옮길 수 있습니다.</p>
      <div class="muted url">${esc(APP_URL)}</div>
    </div></div>
  </div>
  <div class="box"><h3>답 보내는 법</h3>
    <ol class="circ">
      <li>① 이 문서를 인쇄해 '답' 칸에 적고 사진으로 보내 주시거나, 채팅에 "2-가 3번: 1,300g"처럼 번호와 값만 적어 주세요</li>
      <li>② 포장 뒷면(용량·무게) 사진만 보내 주셔도 됩니다</li>
      <li>③ 품목 이름·기준 수량은 앱 &gt; 품목 탭에서 직접 고칠 수 있습니다</li>
    </ol>
    <p class="small muted" style="margin-top:1.5mm">모르는 칸은 비워 두세요. 아는 것부터, 순서는 상관없습니다.</p>
  </div>
</div>

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
<tr><td class="lead">매달 초</td><td>포스 "그룹별 매출분석" 내보내기</td><td>지금은 파일을 보내 주시면 제가 소비 속도를 갱신 (앱에서 바로 올리는 기능은 나중에)</td></tr>
<tr><td class="lead">기기 바꿀 때</td><td>백업 내보내기/불러오기</td><td>설정 탭 → 백업 (사진 인식 설정은 포함 안 됨)</td></tr>
</tbody></table>
</section>

<section class="section">
<h2><span class="num">2</span>채워 주실 값 <span class="small muted">— 맞으면 "맞음"에 체크만, 다르면 값을 적어 주세요</span></h2>
<p class="legend">회색 숫자는 지난 1년 사용량(참고용)입니다. 숫자가 큰 것부터 봐 주시면 예상 재고가 가장 많이 정확해집니다. "지금:"은 현재 쓰는 추정값입니다.</p>
${valueSections.map(valueTable).join('')}
</section>

<section class="section">
<h2><span class="num">3</span>종이 재고표를 제대로 읽었는지 확인</h2>
<p class="legend">높음 = 맞는지만 봐 주세요 · 중 = 확인 필요 · 낮음 = 꼭 봐 주세요 · 질문 = 읽기는 됐고 방식을 묻는 것<br />"낮음" 항목은 앱 &gt; 품목 탭에서 이름을 바로 고칠 수 있습니다. 종이 재고표 사진을 다시 찍어 주시면 다시 읽겠습니다.</p>
<h3>가. 제품 재고표 3장 (월·목)</h3>
${sheetTable(SHEET_PRODUCT)}
<h3>나. 자재 재고표 (수요일)</h3>
<p class="small muted">인쇄된 33칸(품목명·빨간 기준 — 아이스컵·뚜껑 두 줄은 한 품목으로 보아 32개 품목)은 사진을 두 번 따로 읽어 모두 일치했습니다. 아래는 손글씨와 애매한 칸입니다.</p>
${sheetTable(SHEET_SUPPLY)}
</section>

<section class="section">
<h2><span class="num">4</span>결정해 주실 것 <span class="small muted">— 추천 답을 적어 두었습니다. 그대로 두셔도 됩니다</span></h2>
<table>
<thead><tr><th style="width:36mm">항목</th><th>선택지</th><th style="width:36mm">추천</th><th style="width:46mm">답</th></tr></thead>
<tbody>${DECISIONS.map((r, i) => `<tr>${lead(i + 1, r[0])}<td>${esc(r[1])}</td><td>${esc(r[2])}</td>${decisionCell()}</tr>`).join('')}</tbody>
</table>

<h3>이 다음에 만들 것 (순서 제안)</h3>
<table>
<thead><tr><th style="width:8mm">#</th><th style="width:48mm">할 일</th><th>필요한 것</th><th style="width:22mm">걸리는 시간</th></tr></thead>
<tbody>${NEXT.map((r, i) => `<tr><td>${i + 1}</td><td class="lead">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table>
<p class="small muted">매출 자료·레시피·이 문서는 GitHub에 올리지 않았습니다(코드만 올라가 있습니다).</p>
</section>
</body></html>`;
fs.writeFileSync(path.join(outDir, 'status.html'), html);
console.log(`docs/analysis/status.html (${(html.length / 1024).toFixed(0)} KB) · 기능 지금 ${nNow}/나중에 ${nLater} · 값 ${nValues} · 판독 확인 ${nSheet} · 결정 ${DECISIONS.length} · QR ${qr ? '있음' : '없음'}`);
