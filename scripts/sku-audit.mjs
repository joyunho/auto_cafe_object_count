// POS 상품명 정합 감사 — 새 달 자료가 들어올 때마다 돌려서 사람이 확인하는 표
//   node scripts/sku-audit.mjs [data/pos] [--json 파일] [--min-sim 0.6]
//
//   그룹코드            한 달에 같은 그룹의 '합계' 블록이 둘 이상이거나 코드가 전달과 달라진 곳 (그룹 재등록 흔적 — pos.js 는 코드를 버리므로 여기서 따로 읽는다)
//   원본 줄 2개 이상    같은 달 같은 (그룹,이름)이 두 줄 — 재등록(2026-03 빵) 또는 이름 앞 공백이 붙은 별도 코드(2026-07 베이컨크림치즈). 자동 합산
//   (1) 규칙으로 이은 것   공백·괄호·오타·hot/ice 표기만 다른 이름들 (겹친 달과 합계 연속을 같이 보여 준다 — 두 달 이상 겹치면 경고)
//   (2) 대응표로 이은 것   src/data/sku-map.js 의 RENAMES · (2b) FAMILIES
//   (3) 의심 쌍            비슷한 이름인데 다른 id — 교대 서명 / 슬래시 병합 부분 일치 / 편집거리 1. 잇지 않았다. 확인 뒤 대응표로
//   (3b) 조사 후보         두 조사 중 한쪽만 high 이거나 medium 이하로 본 대응 — 대응표에 넣지 않았다. 자료에서 현재 상태를 붙여 보여 준다
//   (3c) 짝 못 찾은 소멸·등장   그 달에 끝난 코드와 시작한 코드를 나란히 (이름이 전혀 달라도 사람 눈에는 보이는 교대가 있다)
//   (4) 동시 판매 중복     대응표 DUPLICATES + 같은 이름이 다른 그룹에서 함께 팔린 것 (합치지 않는다)
//   (5) 3개월 이하 등장    행사·오타·일회성. 잇지 않는다
//
// 판매 수량은 화면에만 찍는다 — 대응표(sku-map.js)에 옮길 때는 이름과 달만 적는다 (공개 저장소).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport, normalizeGroup } from '../src/logic/pos.js';
import { buildSeries, auditSeries, canonicalKey, pairStatus, monthTotals, reportTotals, CONTINUITY_BOUNDS } from '../src/logic/sku.js';
import { PRODUCT_MAP, IGNORED_GROUPS } from '../src/data/pos-map.js';

/**
 * 조사 후보 — 2025-08~2026-07 자료를 이름 관점·시간축 관점으로 따로 조사했을 때 한쪽만 high 이거나 medium 이하로 본 대응.
 * 대응표(sku-map.js)에는 넣지 않았다. 새 달 자료에서 근거가 굳으면(구코드가 확실히 사라지고 합계가 이어지면) 대응표로 옮기고 여기서 지운다.
 * 이름과 달만 적는다 (수량·금액 없음) — 현재 상태(기간·겹침·합계 연속·단가)는 실행 때 자료에서 붙인다.
 * kind: merge = 구성 코드 → 슬래시 병합 코드(가족) / split = 병합 코드 → 다시 단독 코드 / rename = 이름 교대(같은 sku)
 */
const REVIEW_CANDIDATES = [
  { group: '빵', from: ['페퍼소세지빵'], to: '페퍼소세지빵/햄치즈 토스트', kind: 'merge', rating: '이름 high · 시간축 medium', note: '2025-11 한 달 겹친 뒤 병합 코드만, 단가 동일. 시간축 조사는 햄치즈토스트와 한 항목으로 묶어 medium' },
  { group: '빵', from: ['햄치즈토스트'], to: '페퍼소세지빵/햄치즈 토스트', kind: 'merge', rating: '둘 다 medium', note: '2025-09 까지 단독, 10월 공백, 11월부터 병합 코드에 이름만 들어감' },
  { group: '빵', from: ['마늘 바게트'], to: '마늘바게트/머쉬룸바게트', kind: 'merge', rating: '이름 high · 시간축 medium', note: '2026-02 까지 단독 → 2026-03 슬래시 코드. 겹치지 않고 이어짐, 단가 동일' },
  { group: '빵', from: ['생과일몽블랑'], to: '생과일 몽블랑 팡도르', kind: 'merge', rating: '이름 high · 시간축 medium', note: '2026-03 재등록 교대 서명이나 "팡도르"가 더해져 같은 상품인지 불확실. "몽블랑"(다른 단가)은 별개' },
  { group: '빵', from: ['호두쉬폰'], to: '호두쉬폰/ 단호박쉬폰', kind: 'merge', rating: '이름 high · 시간축 medium', note: '2025-11 한 달 겹침, 단가 동일, 둘 다 소량' },
  { group: '빵', from: ['앙버터빵'], to: '앙버터빵 / 크렌베리 쌀빵', kind: 'merge', rating: '이름 high · 시간축 medium', note: '"앙버터빵" 단독은 2025-08 한 달뿐, 같은 달부터 병합 코드' },
  { group: '빵', from: ['앙버터빵/크린베리쌀빵'], to: '크린베리쌀빵', kind: 'split', rating: '둘 다 medium', note: '병합 코드 2026-05 마지막, 단독 코드 2026-05 등장(한 달 겹침), 단가 동일. 앙버터빵 부분이 빠진 축소' },
  { group: '빵', from: ['무화과깜빠뉴'], to: '무화과/밤 깜빠뉴', kind: 'merge', rating: '이름 medium', note: '2025-08 한 달만 단독, 같은 달부터 병합 코드, 단가 동일. 한 달 근거뿐' },
  { group: '빵', from: ['카야쨈앙버터'], to: '카야쨈앙버터/칠리 닭가슴살빵', kind: 'merge', rating: '이름 high · 시간축 medium', note: '2025-11 한 달 겹침, 단가 동일. 카야쨈 사슬(→ 카야쨈버터 → …/앙버터소금빵 → 앙버터소금빵)은 한 버튼을 돌려쓴 흔적이라 사슬 전체는 잇지 않음' },
  { group: '빵', from: ['칠리 닭가슴살 빵'], to: '카야쨈앙버터/칠리 닭가슴살빵', kind: 'merge', rating: '둘 다 medium', note: '2025-10 까지 단독, 11월부터 병합 코드(인접, 겹침 없음), 단가 동일' },
  { group: '빵', from: ['카야쨈버터'], to: '카야쨈버터/앙버터소금빵', kind: 'merge', rating: '이름 high · 시간축 medium', note: '2026-01 한 달 단독 → 2026-02 병합 코드, 단가 동일' },
  { group: '빵', from: ['카야쨈버터/앙버터소금빵'], to: '앙버터소금빵', kind: 'split', rating: '둘 다 medium', note: '2026-03 재등록 교대, 단가 동일. 카야쨈버터 부분이 빠진 축소' },
  { group: '빵', from: ['블빵'], to: '블루베리빵', kind: 'rename', rating: '둘 다 medium', note: '2026-03 재등록 교대, 단가 동일. 약어라 이름만으론 보장 없음 — 사람 확인 뒤 RENAMES 로' },
  { group: '디저트', from: ['계피만쥬'], to: '만주/계피만쥬', kind: 'merge', rating: '이름 medium · 시간축 high', note: '2025-08·10 두 달만 단독(단가 다름), 2026-03 병합 코드에 이름이 들어감. 4달 공백' },
  { group: '빵', from: ['잠봉샌드위치'], to: '잠봉/리코타 샌드위치', kind: 'merge', rating: '이름 medium', note: '2025-10 한 달 → 2025-11 병합 코드(인접), 단가 동일' },
  { group: '빵', from: ['쑥모찌빵', '크림범벅'], to: '쑥모찌빵/크림범벅', kind: 'merge', rating: '이름 medium', note: '2026-07 세 코드 동시(병합 진행 중) — 2026-08 자료에서 단독 코드가 사라지면 확정' },
  // low — 이름이 내용 변화를 말해 같은 상품이라는 보장이 없는 것. 사람이 봐도 아니면 여기서 지운다
  { group: '빵', from: ['카야쨈앙버터/칠리 닭가슴살빵'], to: '카야쨈버터', kind: 'rename', rating: '둘 다 low', note: '2026-01 인접 교대이나 "앙"·"칠리"가 빠짐 — 같은 행사 슬롯의 이름 변경일 뿐일 수 있음' },
  { group: '빵', from: ['잠봉/리코타 샌드위치'], to: '크림치즈/잠봉 샌드위치', kind: 'rename', rating: '둘 다 low', note: '2026-03 재등록 교대이나 속재료 이름(리코타 → 크림치즈)이 바뀜' },
  { group: '디저트', from: ['화이트 레몬 마들렌'], to: '레몬마들렌', kind: 'rename', rating: '둘 다 low', note: '2025-10 한 달 겹침, 단가 동일. "화이트"가 빠짐' },
  { group: '빵', from: ['명란바게트'], to: '명란빵', kind: 'rename', rating: '둘 다 low', note: '2025-12 → 2026-01 인접이나 단가가 다르고 규모가 이어지지 않음 — 신상품으로 보임' },
  { group: '쇼케이스', from: ['생딸기 보틀케이크'], to: '생과일보틀', kind: 'rename', rating: '이름 low', note: '2026-05 한 달 겹침, 단가 동일. 계절 과일 교체로 보임' },
  { group: '쇼케이스', from: ['생크림케이크'], to: '생크림/기리쉬', kind: 'rename', rating: '이름 low', note: '2025-08 한 달만 동시, 단가 동일' },
  { group: '빵', from: ['뺑오'], to: '뺑오 쇼콜라', toGroup: '디저트', kind: 'rename', rating: '이름 low', note: '그룹·단가 다름, 2025-08 동시' },
  { group: '빵', from: ['쑥맘모스빵'], to: '맘모스빵', kind: 'rename', rating: '시간축 low', note: '2026-07 급감·신규 동시, 단가 동일. 자료 마지막 달이라 확정 불가 — 2026-08 자료로 확인' },
  { group: '빵', from: ['초코범벅'], to: '크림범벅', kind: 'rename', rating: '시간축 low', note: '2026-07 동시, 단가 다름 — 다른 상품일 가능성' },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = { json: null, 'min-sim': '0.6' };
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) opts[a.slice(2)] = process.argv[++i];
  else positional.push(a);
}
const dir = path.resolve(positional[0] || path.join(root, 'data', 'pos'));
const jsonOut = opts.json;
const minSimilarity = Number(opts['min-sim']);

if (!fs.existsSync(dir)) { console.error(`자료 폴더가 없습니다: ${dir}`); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => /월.*\.txt$/.test(f));
if (!files.length) { console.error(`${dir} 에 월 보고서(*월*.txt)가 없습니다`); process.exit(1); }

/**
 * 그룹코드 추적 — pos.js 는 5자리 코드 줄을 버리므로 여기서 블록('… 합계' 줄로 끝나는 구간)마다 본 코드를 모은다.
 * 상품 줄·합계 줄을 먼저 가려내고 남은 5자리 줄에서 코드를 읽는다 (코드 정규식을 먼저 대면 '00007 주스/병음료 골드메달사과주스 …' 상품 줄을 삼킨다).
 */
function scanGroupBlocks(text) {
  const blocks = [];
  let codes = new Set();
  let products = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('Page ') || line.includes('그룹코드')) continue;
    const total = /^(.+?)\s+합계\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)$/.exec(line);
    if (total) {
      const cm = /^(\d{5})\s+/.exec(total[1]);
      if (cm) codes.add(cm[1]);
      blocks.push({ group: normalizeGroup(total[1]), codes: [...codes].sort(), products });
      codes = new Set(); products = 0;
      continue;
    }
    const m = /^(.+?)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)$/.exec(line);
    if (m) {
      const name = m[1].trim();
      const cm = /^(\d{5})(?:\s+|$)/.exec(name);
      if (cm) codes.add(cm[1]);
      if (!/^\d{5}$/.test(name)) products += 1;
      continue;
    }
    const cm = /^(\d{5})(?:\s+\S.*)?$/.exec(line);
    if (cm) codes.add(cm[1]);
  }
  return blocks;
}

const reports = [];
const blocksByMonth = {};
const fileByPeriod = new Map(); // 같은 기간 파일이 둘이면(3월.txt + 3월_2026.txt) 그 달 값이 두 배가 된다 — buildSeries 도 throw 하지만 어느 파일인지는 여기서만 안다
let dupFile = false;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const rep = parseSalesReport(text);
  if (!rep.period) console.warn(`경고: ${f} 기간을 못 읽음`);
  if (rep.unassigned) console.warn(`경고: ${f} 그룹 미배정 ${rep.unassigned}줄`);
  if (rep.period) {
    const p = `${rep.period.from}~${rep.period.to}`;
    if (fileByPeriod.has(p)) { dupFile = true; console.error(`오류: 같은 기간(${p}) 파일이 둘 — ${fileByPeriod.get(p)} 와 ${f}. 하나를 치우고 다시 돌릴 것`); }
    else fileByPeriod.set(p, f);
  }
  reports.push(rep);
  blocksByMonth[rep.period?.month || f] = scanGroupBlocks(text);
}
if (dupFile) process.exit(1);

// buildSeries 는 각 달 합계가 원본과 다르면 throw 한다. 여기서는 한 번 더 표로 확인한다
const sku = buildSeries(reports, { level: 'sku' });
const fam = buildSeries(reports, { level: 'family' });
const orig = reportTotals(reports);
let sumOk = true;
for (const s of [sku, fam]) for (const [m, t] of Object.entries(monthTotals(s))) {
  const o = orig[m];
  if (!o || o.qty !== t.qty || o.amount !== t.amount || o.discount !== t.discount) { sumOk = false; console.error(`합계 불일치 ${s.level} ${m}: 원본 ${JSON.stringify(o)} 시계열 ${JSON.stringify(t)}`); }
}

// 옵션(연하게·Take out·디카페인 …)은 그룹마다 등록되므로 중복/의심 표에서 뺀다. 진동벨 그룹(호출 번호·결제 수단·정식)은 상품이 아니다
const ignoreNames = Object.entries(PRODUCT_MAP).filter(([, v]) => v === null || (v && v.modifier)).map(([k]) => k);
const audit = auditSeries(sku, { ignoreNames, ignoreGroups: ['진동벨'], minSimilarity });

// ── 표 출력 ──
const width = (s) => [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - width(s)));
function table(headers, rows) {
  if (!rows.length) { console.log('  (없음)'); return; }
  const all = [headers, ...rows.map((r) => r.map((c) => (c == null ? '' : String(c))))];
  const w = headers.map((_, i) => Math.max(...all.map((r) => width(r[i] || ''))));
  for (const [i, r] of all.entries()) {
    console.log('  ' + r.map((c, j) => pad(c, w[j])).join(' | '));
    if (i === 0) console.log('  ' + w.map((x) => '-'.repeat(x)).join('-+-'));
  }
}
const mm = (m) => (m ? m.slice(2) : '-');
const range = (a, b) => (!a ? '수량 0 만' : a === b ? mm(a) : `${mm(a)}~${mm(b)}`);
const cont = (c) => (c.month ? `${c.before ?? '-'} → ${c.during} → ${c.after ?? '-'}${c.ratio != null ? ` (×${c.ratio.toFixed(2)})` : ''}` : '-');
const variantsCell = (vs) => vs.map((v) => `${v.name} (${range(v.first, v.last)})`).join('  →  ');
const pairsCell = (ps) => ps.map((p) => `${p.overlap.length ? '겹침 ' + p.overlap.map(mm).join(',') : '안 겹침'} · ${cont(p)}`).join(' / ');
// 경고(교대 서명 위반)는 그대로, 근거 부족(한 달짜리 코드라 전후 달이 없음)은 ※ 를 붙여 구분한다
const warnCell = (j) => [...j.warnings, ...(j.caveats || []).map((c) => `※ ${c}`)].join(' / ');

const { months } = audit;
console.log(`== 자료: ${months[0]} ~ ${months[months.length - 1]} (${months.length}개월) · POS 이름(그룹별) ${audit.counts.rawNames} → sku ${audit.counts.skus} → family ${Object.keys(fam.items).length} · 전 기간 등장 sku ${audit.counts.allMonths} · 3개월 이하 ${audit.counts.shortLived} · 수량 0 만 ${audit.counts.dead}`);
console.log(`== 합계 불변: ${sumOk ? '확인 — 각 달 qty·amount·discount 가 원본과 같음 (sku·family)' : '불일치!'}`);

console.log('\n== 그룹코드 — 한 달에 같은 그룹의 합계 블록이 둘 이상이거나 코드가 전달과 달라진 곳 (그룹 재등록 흔적)');
{
  const rows = [];
  let prev = {};
  for (const m of months) {
    const cur = {};
    for (const b of blocksByMonth[m] || []) (cur[b.group] ||= []).push(b);
    for (const [g, bs] of Object.entries(cur)) {
      const codes = bs.map((b) => b.codes.join('+') || '?');
      const prevCodes = (prev[g] || []).map((b) => b.codes.join('+') || '?');
      if (bs.length > 1) rows.push([mm(m), g, `합계 블록 ${bs.length}개`, bs.map((b, i) => `${codes[i]} (상품 ${b.products}줄)`).join(' / ')]);
      else if (prev[g] && prevCodes.join('|') !== codes.join('|')) rows.push([mm(m), g, '코드 바뀜', `${prevCodes.join('/')} → ${codes.join('/')}`]);
    }
    prev = cur;
  }
  table(['달', '그룹', '표시', '코드 (블록별)'], rows);
}

console.log(`\n== 같은 달 같은 (그룹,이름) 원본 줄 2개 이상 — 자동 합산 (${audit.multiRow.length}) · 그룹 재등록 흔적: ${audit.reregistration.map((r) => `${mm(r.month)} ${r.group} ${r.count}개`).join(', ') || '없음'}`);
table(['달', 'id', '줄 수', '단가'], audit.multiRow.map((r) => [mm(r.month), r.id, r.rows, r.prices.length > 1 ? r.prices.join(' / ') + ' ← 다름' : r.prices.join('')]));

console.log(`\n== (1) 규칙으로 이은 것 — 공백·괄호·오타·hot/ice 표기만 다른 이름 (${audit.ruleJoined.length})`);
console.log('   합계 연속 = 전달(구) → 겹친 달(구+신) → 다음 달(신). 교대라면 세 값이 비슷해야 한다 (×비율이 1 근처). 두 달 이상 겹치면 경고');
console.log(`   경고 = 두 달 이상 함께 팔림 / 합계가 ×${CONTINUITY_BOUNDS.min}~×${CONTINUITY_BOUNDS.max} 를 벗어남 → 다른 상품을 합쳤을 수 있다. ※ = 전후 달이 없어 판단 불가`);
table(['id', '원래 이름 (기간)', '겹친 달 · 합계 연속', '경고'], audit.ruleJoined.sort((a, b) => a.id.localeCompare(b.id)).map((j) => [j.id, variantsCell(j.variants), pairsCell(j.pairs), warnCell(j)]));

console.log(`\n== (2) 대응표로 이은 것 — RENAMES (${audit.renames.length})`);
table(['id', '원래 이름 (기간)', '겹친 달 · 합계 연속', '경고'], audit.renames.sort((a, b) => a.id.localeCompare(b.id)).map((j) => [j.id, variantsCell(j.variants), pairsCell(j.pairs), warnCell(j)]));

console.log(`\n== (2b) 대응표 가족 — FAMILIES (${audit.families.length}) · 구성 코드는 sku 로는 따로, 가족으로만 한 묶음 (★ 병합 코드, 병합→ mergedInto, 분리← splitFrom)`);
console.log('   가족 합계 연속 = 병합 전달(구성 코드 합) → 병합 달(구성 코드 + 병합 코드) → 다음 달(병합 코드). 가족이 맞다면 세 값이 비슷해야 한다');
table(['가족', '구성 코드 (기간)', '병합 달 · 가족 합계 연속', '경고'], audit.families.sort((a, b) => a.family.localeCompare(b.family)).map((f) => [
  f.family,
  f.members.map((m) => `${m.name} (${range(m.first, m.last)})${m.isFamilyCode ? ' ★' : m.mergedInto ? ' 병합→' : m.splitFrom ? ' 분리←' : ''}`).join('  '),
  f.continuity.month ? `${mm(f.continuity.month)} · ${cont(f.continuity)}` : '-',
  f.warnings.join(' / '),
]));

console.log(`\n== (3) 의심 쌍 — 잇지 않았다. 확인해서 같은 상품이면 sku-map.js RENAMES/FAMILIES 로 (${audit.suspects.length})`);
console.log('   교대: A 가 끝난 달(또는 다음 달)에 B 가 나타남 · 슬래시 병합/분리: 병합 이름의 한 부분이 단독 코드와 정확히 같음 · 편집거리 1: 새 오타 후보 (함께 팔렸으면 별개일 가능성)');
console.log('   합계 연속 = 전달(A) → 교대 달(A+B) → 다음 달(B)');
table(['종류', 'A (기간)', 'B (기간)', '달', '왜 후보인가', '합계 연속', '표시'], audit.suspects.map((s) => [s.kind, `${s.a.id} (${range(s.a.first, s.a.last)})`, `${s.b.id} (${range(s.b.first, s.b.last)})`, mm(s.month), s.why.join(', '), cont(s), s.flags.join(', ')]));

console.log(`\n== (3b) 조사 후보 — 두 조사 중 한쪽만 high 이거나 medium 이하 (대응표에 넣지 않음, ${REVIEW_CANDIDATES.length}) · 근거가 굳으면 sku-map.js 로 옮기고 여기서 지운다`);
{
  const rows = [];
  for (const c of REVIEW_CANDIDATES) {
    const to = sku.items[canonicalKey(c.to, c.toGroup || c.group)];
    for (const fname of c.from) {
      const from = sku.items[canonicalKey(fname, c.group)];
      if (!from || !to) { rows.push([c.kind, `${fname}${from ? '' : ' (자료에 없음)'}`, `${c.to}${to ? '' : ' (자료에 없음)'}`, '-', '-', '-', c.rating, c.note]); continue; }
      const st = pairStatus(sku, from, to);
      const flags = [];
      if (from.id === to.id) flags.push('이미 같은 sku — 후보에서 지울 것');
      else if (st.sameFamily) flags.push('이미 같은 가족 — 후보에서 지울 것');
      if (!st.samePrice) flags.push('단가 다름');
      if (from.last === months[months.length - 1]) flags.push('구코드 아직 진행 중');
      rows.push([c.kind, `${fname} (${range(from.first, from.last)})`, `${c.to} (${range(to.first, to.last)})`, st.overlap.length ? st.overlap.map(mm).join(',') : '안 겹침', cont(st), flags.join(', '), c.rating, c.note]);
    }
  }
  table(['종류', 'from (기간)', 'to (기간)', '겹친 달', '합계 연속', '표시', '조사 평가', '메모'], rows);
}

console.log('\n== (3c) 짝을 못 찾은 소멸·등장 — 그 달에 끝난 코드와 시작한 코드를 나란히 (이름이 전혀 달라도 사람 눈에는 보이는 교대가 있다)');
table(['달', '그 달에 끝남 (수량)', '그 달에 시작 (수량)'], audit.unexplained.map((u) => [mm(u.month), u.ended.map((e) => `${e.id} (${e.qty})`).join(', '), u.started.map((e) => `${e.id} (${e.qty})`).join(', ')]));

console.log(`\n== (4) 동시 판매 중복 — 합치지 않는다. 사람이 결정 (${audit.duplicates.length})`);
table(['코드', '중복 대상', '함께 팔린 달', '출처', '근거'], audit.duplicates.map((d) => [d.id, d.of, d.overlap.map(mm).join(',') || '-', d.source, [d.evidence, d.warning].filter(Boolean).join(' / ')]));

console.log(`\n== (5) 3개월 이하 등장 — 행사·오타·일회성. 잇지 않는다 (${audit.shortLived.length}) · 재고 계산에서 빼는 그룹(${IGNORED_GROUPS.join('·')}) 포함`);
table(['id', '달: 수량', '경계'], audit.shortLived.map((s) => [s.id, Object.entries(s.months).map(([m, q]) => `${mm(m)}:${q}`).join(' '), s.edge]));

console.log(`\n== 수량 0 인 줄만 있는 코드 — 등장으로 세지 않는다 (${audit.dead.length})`);
table(['id', '달'], audit.dead.map((d) => [d.id, d.months.map(mm).join(',')]));

if (jsonOut) {
  fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ generatedAt: new Date().toISOString(), sumOk, audit, sku, family: fam }, null, 1));
  console.log(`\nJSON: ${jsonOut}`);
}
if (!sumOk) process.exit(2);
