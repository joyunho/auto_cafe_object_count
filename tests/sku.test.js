import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport } from '../src/logic/pos.js';
import { canonicalKey, familyOf, ruleKey, normalizeSkuName, buildSeries, auditSeries, monthTotals, reportTotals, checkTotals, pairStatus } from '../src/logic/sku.js';
import { RENAMES, FAMILIES, DUPLICATES, SPELLING, SEPARATE } from '../src/data/sku-map.js';
import { PRODUCT_MAP } from '../src/data/pos-map.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 가짜 자료 (숫자는 모두 지어낸 값)
const row = (group, product, qty, price = 1000, discount = 0) => ({ group, product, price, qty, amount: qty * price - discount, discount });
const rep = (month, rows) => ({ period: { from: `${month}-01`, to: `${month}-28`, month }, rows, unassigned: 0 });
const M = ['2026-01', '2026-02', '2026-03', '2026-04'];

/** 교대·병합·중복·오타·수량 0·음수·미배정이 한꺼번에 있는 4개월 자료 (달 순서를 일부러 섞어 둠) */
function sampleReports() {
  return [
    rep(M[2], [
      row('빵', '밤 식빵', 49), row('빵', '밤식빵', 30), // 3월 한 달만 둘 다 (교대)
      row('빵', '무화과크림치즈빵', 68), row('빵', '무화과크림치즈', 41), // 대응표 교대
      row('빵', '먹물소금빵', 407), row('빵', '소금빵행사', 1322), row('빵', '소금빵/ 먹물소금빵/초코짠짠', 1041), // 병합
      row('빵', '육쪽마늘빵', 299), row('빵', '육쪽마늘빵', 120), row('빵', '욱쪽마늘빵', 64), // 같은 이름 코드 2개 + 오타 코드
      row('빵', '구름크림빵', 71), row('빵', '구름크림빵', 34), row('빵', '깨찰빵', 171), row('빵', '깨찰빵', 116), row('빵', '몽블랑', 218), row('빵', '몽블랑', 134),
      row('빵', '명란빵', 30, 7400), row('빵', '명란빵', 20, 6400), // 같은 이름 두 코드, 단가 다름
      row('빵', '버터떡', 68), row('디저트', '버터 떡', 69), // 동시 판매 중복 (그룹 다름)
      row('빵', '갈릭 난', 0), // 수량 0 줄 — 합계에는 들어가되 등장으로 세지 않는다
      row('빵', '호두쉬폰/ 단호박쉬폰', 8), // 슬래시 병합 — 대응표에 없음 → 의심 쌍
      row('디저트', '레몬마들렌', 73), row('디저트', '자보르', 3),
      row('디저트', '초코쉘쿠키', 40), row('디저트', '초코셀쿠키', 5), // 편집거리 1, 함께 팔림
      row('커피', 'hot아메리카노', 3290, 6000, 100), row('커피', 'ice아메리카노', 2623, 6500), row('커피', 'ic카페라떼', 273, 7000, 50),
      row('티', '대추차 only hot', 655, 8000, 30),
      row('진동벨', '1번', 5), row('진동벨', '포인트결제', -14, 0, -2000), // 음수 줄
      row('', '미배정상품', 3), // 그룹 없음
      row('커피', 'Take out', 114, 0), row('라떼', 'Take out', 2, 0),
    ]),
    rep(M[0], [
      row('빵', '밤 식빵', 80), row('빵', '무화과크림치즈빵', 118), row('빵', '먹물소금빵', 758), row('빵', '소금빵행사', 2149), row('빵', '육쪽마늘빵', 409),
      row('빵', '구름크림빵', 114), row('빵', '깨찰빵', 305), row('빵', '몽블랑', 382), row('빵', '명란빵', 40, 7400),
      row('빵', '갈릭 난', 12), row('빵', '호두쉬폰', 6),
      row('디저트', '화이트 레몬 마들렌', 63), row('디저트', '한달만', 5), // 한 달만 등장
      row('디저트', '초코쉘쿠키', 38), row('디저트', '초코셀쿠키', 4),
      row('커피', 'hot아메리카노', 3667, 6000), row('커피', 'ice아메리카노', 1837, 6500), row('커피', 'ic카페라떼', 191, 7000),
      row('티', '대추차 only hot', 761, 8000),
      row('진동벨', '1번', 64), row('진동벨', '포인트결제', -17, 0, -1000),
      row('커피', 'Take out', 104, 0), row('라떼', 'Take out', 3, 0),
    ]),
    rep(M[1], [
      row('빵', '밤 식빵', 71), row('빵', '무화과크림치즈빵', 115), row('빵', '먹물소금빵', 697), row('빵', '소금빵행사', 2117), row('빵', '육쪽마늘빵', 534),
      row('빵', '구름크림빵', 109), row('빵', '깨찰빵', 313), row('빵', '몽블랑', 349), row('빵', '명란빵', 42, 7400),
      row('빵', '갈릭 난', 9), row('빵', '호두쉬폰', 2), row('빵', '호두쉬폰/ 단호박쉬폰', 8), // 2월 한 달 겹치고 병합 코드만
      row('디저트', '화이트 레몬 마들렌', 57), row('디저트', '레몬마들렌', 35), // 2월 한 달 겹치고 교대 — 대응표에 없음 → 의심 쌍
      row('디저트', '초코쉘쿠키', 41), row('디저트', '초코셀쿠키', 6),
      row('커피', 'hot아메리카노', 3488, 6000), row('커피', 'ice아메리카노', 2308, 6500), row('커피', 'ic카페라떼', 261, 7000),
      row('티', '대추차 only hot', 753, 8000),
      row('진동벨', '1번', 4), row('진동벨', '포인트결제', -15, 0, -500),
      row('커피', 'Take out', 133, 0), row('라떼', 'Take out', 3, 0),
    ]),
    rep(M[3], [
      row('빵', '밤식빵', 79), row('빵', '무화과크림치즈', 114), row('빵', '소금빵/ 먹물소금빵/초코짠짠', 2652), row('빵', '육쪽마늘빵', 476),
      row('빵', '구름크림빵', 101), row('빵', '깨찰빵', 267), row('빵', '몽블랑', 338), row('빵', '명란빵', 45, 6400),
      row('빵', '버터떡', 257), row('디저트', '버터 떡', 215),
      row('빵', '호두쉬폰/ 단호박쉬폰', 6),
      row('디저트', '레몬마들렌', 65), row('디저트', '자보르', 5),
      row('디저트', '초코쉘쿠키', 39), row('디저트', '초코셀쿠키', 7),
      row('커피', 'hot아메리카노', 2550, 6000), row('커피', 'ice아메리카노', 3104, 6500), row('커피', 'ic카페라떼', 373, 7000),
      row('티', '대추차 only hot', 489, 8000), row('티', '대추차 hot', 117, 8000), row('티', '대추차 ice', 5, 8000),
      row('진동벨', '포인트결제', -11, 0, -300),
      row('커피', 'Take out', 183, 0), row('라떼', 'Take out', 5, 0),
    ]),
  ];
}

test('canonicalKey 규칙: 공백·괄호·영문 대소문자·알려진 오타·hot/ice 표기', () => {
  assert.equal(canonicalKey('밤 식빵', '빵'), '빵|밤식빵');
  assert.equal(canonicalKey('밤식빵', '빵'), '빵|밤식빵');
  assert.equal(canonicalKey('메이플 크림치즈', '빵'), canonicalKey('메이플크림치즈', '빵'));
  assert.equal(canonicalKey('무화과/밤 깜빠뉴', '빵'), canonicalKey('무화과/밤깜빠뉴', '빵'));
  assert.equal(canonicalKey('마늘 바게트 / 머쉬룸 바게트', '빵'), canonicalKey('마늘바게트/머쉬룸바게트', '빵'));
  assert.equal(canonicalKey('소금빵/ 먹물소금빵/초코짠짠', '빵'), '빵|소금빵/먹물소금빵/초코짠짠'); // 슬래시는 남긴다
  // 괄호·쉼표·한자 大
  assert.equal(canonicalKey('호밀빵 (대)', '빵'), '빵|호밀빵대');
  assert.equal(canonicalKey('호밀빵大', '빵'), '빵|호밀빵대');
  assert.notEqual(canonicalKey('호밀빵(깜빠뉴)', '빵'), canonicalKey('호밀빵大', '빵'));
  assert.equal(canonicalKey('조각케익(딸기,멜론)', '쇼케이스'), '쇼케이스|조각케익딸기멜론');
  assert.notEqual(canonicalKey('조각케익(딸기,멜론)', '쇼케이스'), canonicalKey('조각케이크', '쇼케이스')); // 케익/케이크는 규칙에 없다
  // 오타 코드 → 바른 표기 (SPELLING). PRODUCT_MAP 키는 원래 이름 그대로 두고 이 층에서만 바뀐다
  assert.equal(canonicalKey('ic카페라떼', '커피'), '커피|ice카페라떼');
  assert.equal(canonicalKey('ICE 카페라떼', '커피'), '커피|ice카페라떼');
  assert.equal(canonicalKey('에소프레소 싱글', '커피'), '커피|에스프레소싱글');
  assert.equal(canonicalKey('ice카라멜마끼야또', '커피'), '커피|ice카라멜마끼아또');
  assert.equal(canonicalKey('앙버터빵 / 크렌베리 쌀빵', '빵'), canonicalKey('앙버터빵/크린베리쌀빵', '빵'));
  assert.equal(canonicalKey('욱쪽마늘빵', '빵'), canonicalKey('육쪽마늘빵', '빵'));
  assert.equal(canonicalKey('바질장봉뵈르', '빵'), canonicalKey('바질잠봉뵈르', '빵'));
  assert.equal(canonicalKey('인절미브래드', '빵'), canonicalKey('인절미브레드', '빵'));
  for (const [from, to] of SPELLING) assert.notEqual(from, to);
  // hot/ice 는 변형으로 남는다 — 정합 대상이 아니다. 접미 표기는 접두로, 'only' 는 버리지 않는다
  assert.notEqual(canonicalKey('hot청귤차', '티'), canonicalKey('ice청귤차', '티'));
  assert.notEqual(canonicalKey('hot카라멜마끼아또', '커피'), canonicalKey('ice카라멜마끼야또', '커피'));
  assert.equal(canonicalKey('대추차 ice', '티'), '티|ice대추차');
  assert.equal(canonicalKey('대추차 hot', '티'), '티|hot대추차');
  assert.equal(canonicalKey('대추차 only hot', '티'), '티|onlyhot대추차');
  assert.notEqual(canonicalKey('대추차 only hot', '티'), canonicalKey('대추차 hot', '티'));
  assert.equal(normalizeSkuName('hotdog').variant, ''); // 영문 단어의 일부는 변형이 아니다
  assert.equal(normalizeSkuName('Take out').key, 'takeout');
  // 그룹이 다르면 다른 id (버터떡: 디저트·빵에 각각 등록). 그룹 없으면 이름만
  assert.notEqual(canonicalKey('버터 떡', '디저트'), canonicalKey('버터떡', '빵'));
  assert.equal(canonicalKey('밤식빵', ''), '밤식빵');
  // 규칙·대응표에 없는 이름은 정규화한 이름 그대로. 접미 '빵' 탈락·부분 문자열은 규칙이 아니다
  assert.equal(canonicalKey('새로 나온 빵', '빵'), '빵|새로나온빵');
  assert.notEqual(canonicalKey('모카빵', '빵'), canonicalKey('모카번', '빵'));
  assert.notEqual(canonicalKey('식빵', '빵'), canonicalKey('밤식빵', '빵'));
});

test('canonicalKey 대응표: RENAMES 는 그룹 안에서만, 연쇄는 끝까지, 항목마다 달 근거', () => {
  assert.equal(canonicalKey('무화과크림치즈빵', '빵'), canonicalKey('무화과크림치즈', '빵'));
  assert.equal(canonicalKey('무화과크림치즈빵', '빵'), '빵|무화과크림치즈');
  assert.equal(canonicalKey('페퍼소세지빵/햄치즈 토스트', '빵'), canonicalKey('페퍼소세지/햄치즈토스트', '빵'));
  assert.equal(canonicalKey('무화과크림치즈빵', '디저트'), '디저트|무화과크림치즈빵'); // 다른 그룹엔 적용 안 됨
  for (const e of RENAMES) {
    const to = canonicalKey(e.to, e.group);
    assert.equal(to, ruleKey(e.to, e.group), `${e.to}: to 가 또 다른 대응의 from 이면 안 된다`);
    for (const f of e.from) assert.equal(canonicalKey(f, e.group), to, `${f} → ${e.to}`);
    assert.match(e.evidence, /\d{4}-\d{2}/, `${e.to}: 근거에 달이 있어야 한다`);
    assert.ok(!('confidence' in e) || e.confidence === 'high', `${e.to}: 두 조사가 모두 high 로 본 것만 대응표에 넣는다`);
  }
  for (const e of FAMILIES) {
    assert.match(e.evidence, /\d{4}-\d{2}/, `${e.name}: 근거에 달이 있어야 한다`);
    assert.equal(e.kind, 'merge');
    for (const m of e.members) assert.equal(familyOf(canonicalKey(m, e.group)), canonicalKey(e.name, e.group), `${m} ∈ ${e.name}`);
  }
  for (const e of DUPLICATES) {
    assert.match(e.evidence, /\d{4}-\d{2}/, `${e.name}: 근거에 달이 있어야 한다`);
    assert.notEqual(canonicalKey(e.name, e.group), canonicalKey(e.of.name, e.of.group), `${e.name}: 중복은 합치지 않는다`);
  }
});

test('sku-map.js 에는 판매 수량·금액을 적지 않는다 (공개 저장소)', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'data', 'sku-map.js'), 'utf8');
  // 날짜(2026-03)·연도·두 자리 달·그룹코드(0 으로 시작하는 5자리)는 허용
  const stripped = src.replace(/\d{4}-\d{2}(-\d{2})?/g, '').replace(/\b0\d{4}\b/g, '').replace(/\b20\d{2}\b/g, '').replace(/\b\d{2}\b/g, '');
  assert.doesNotMatch(stripped, /\d{3,}|\d,\d{3}/, '세 자리 이상 숫자(수량·금액)가 있다');
});

// 원시 NUL 같은 제어 문자가 소스에 들어가면 grep·diff 가 파일을 바이너리로 취급한다 (이전 초안이 쌍 키 구분자로 NUL 을 넣었었다)
test('sku 층 소스는 텍스트 파일이다 — 제어 문자 없음', () => {
  for (const f of ['src/logic/sku.js', 'src/data/sku-map.js', 'scripts/sku-audit.mjs', 'tests/sku.test.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/, `${f} 에 제어 문자가 있다`);
  }
});

test('familyOf: hot/ice/디카페인 변형과 병합 SKU 를 한 묶음으로, 없으면 자기 자신', () => {
  const fam = (p, g) => familyOf(canonicalKey(p, g));
  assert.equal(fam('hot아메리카노', '커피'), '커피|아메리카노');
  assert.equal(fam('ice아메리카노', '커피'), '커피|아메리카노');
  assert.equal(fam('hot디카페인아메리카노', '커피'), '커피|아메리카노');
  assert.equal(fam('ice디카페인아메리카노', '커피'), '커피|아메리카노');
  assert.equal(fam('hot청귤차', '티'), fam('ice청귤차', '티'));
  assert.equal(fam('ic카페라떼', '커피'), fam('hot카페라떼', '커피'));
  assert.notEqual(fam('ice크림 카페라떼', '커피'), fam('hot카페라떼', '커피')); // 다른 메뉴 (크림 변형)
  assert.equal(fam('디카페인', '커피'), '커피|디카페인'); // 옵션 자체는 그대로
  assert.equal(fam('디카페인콜드브루', '라떼'), '라떼|디카페인콜드브루'); // 변형 접두가 없으면 디카페인을 떼지 않는다
  assert.equal(fam('바닐라크림 콜드브루', '라떼'), fam('ice바닐라크림 콜드브루', '라떼'));
  // 병합 SKU (대응표)
  const salt = canonicalKey('소금빵/ 먹물소금빵/초코짠짠', '빵');
  assert.equal(fam('먹물소금빵', '빵'), salt);
  assert.equal(fam('소금빵행사', '빵'), salt);
  assert.equal(familyOf(salt), salt);
  assert.notEqual(fam('소금빵묶음', '빵'), salt); // 부분 이름이 같다고 잇지 않는다
  assert.equal(fam('단호박파운드', '빵'), fam('무화과파운드', '빵'));
  assert.equal(fam('단호박파운드', '빵'), fam('단호박파운드 / 무화과파운드', '빵'));
  assert.equal(fam('식빵', '빵'), fam('식빵/잡곡식빵', '빵'));
  assert.notEqual(fam('밤식빵', '빵'), fam('식빵/잡곡식빵', '빵'));
  // 무변형 코드가 hot/ice 로 갈라진 것: sku 셋, 가족 하나
  assert.equal(fam('설국차', '티'), fam('hot설국차', '티'));
  assert.equal(fam('설국차', '티'), fam('ice설국차', '티'));
  // 대추차: only hot(중복 표시) · hot · ice 모두 한 가족
  assert.equal(fam('대추차 only hot', '티'), '티|대추차');
  assert.equal(fam('대추차 hot', '티'), '티|대추차');
  assert.equal(fam('대추차 ice', '티'), '티|대추차');
  // 진짜 중복은 가족으로도 묶지 않는다
  assert.notEqual(fam('버터떡', '빵'), fam('버터 떡', '디저트'));
  assert.notEqual(fam('토핑휘낭시에', '디저트'), fam('토핑 휘낭시에', '디저트'));
  // 모르는 건 자기 자신, 가족의 가족은 자기 자신. 영문 단어의 일부(hotdog·icecream)는 규칙 층과 같이 변형이 아니다
  assert.equal(familyOf('빵|밤식빵'), '빵|밤식빵');
  assert.equal(familyOf('미배정상품'), '미배정상품');
  assert.equal(fam('hotdog', '빵'), '빵|hotdog');
  assert.equal(fam('icecream', '디저트'), '디저트|icecream');
  for (const k of ['커피|hot아메리카노', '빵|먹물소금빵', '티|hot대추차', '디저트|타르트', salt]) assert.equal(familyOf(familyOf(k)), familyOf(k));
});

test('buildSeries: 각 달의 합계(qty·amount·discount)가 원본과 정확히 같다 — sku·family 모두, 안에서도 검사한다', () => {
  const reports = sampleReports();
  const before = JSON.stringify(reports);
  const orig = reportTotals(reports);
  for (const level of ['sku', 'family']) {
    const s = buildSeries(reports, { level });
    assert.deepEqual(s.months, M);
    assert.deepEqual(monthTotals(s), orig, level);
    assert.ok(checkTotals(reports, s));
    for (const it of Object.values(s.items)) {
      const sum = Object.values(it.byMonth).reduce((a, b) => a + b.qty, 0);
      assert.equal(it.total.qty, sum, it.id);
    }
  }
  assert.equal(JSON.stringify(reports), before, '입력을 바꾸면 안 된다');
  assert.throws(() => buildSeries(reports, { level: 'menu' }));
  // 시계열이 원본과 어긋나면 throw — 1원 차이도
  const s = buildSeries(reports);
  s.items['빵|밤식빵'].byMonth[M[0]].qty += 1;
  assert.throws(() => checkTotals(reports, s), /합계 불변 위반/);
  const s2 = buildSeries(reports);
  s2.items['빵|밤식빵'].byMonth[M[0]].amount += 1;
  assert.throws(() => checkTotals(reports, s2), /합계 불변 위반/);
});

/** 시계열 항목들의 달별 합·행 수를 모아 원본과 맞춰 보는 공통 검사 — 이중 계상·누락·항목 합계·가족 합 */
function assertSeriesConsistent(reports, sku, fam) {
  const F = ['qty', 'amount', 'discount'];
  const sum = (obj) => F.reduce((o, f) => ({ ...o, [f]: Object.values(obj).reduce((a, b) => a + b[f], 0) }), {});
  // 행 하나 → 항목 하나: 각 달의 행 수가 원본과 같다 (어떤 행도 두 id 에 들어가거나 빠지지 않는다)
  for (const s of [sku, fam]) {
    const rows = {};
    for (const it of Object.values(s.items)) for (const [m, b] of Object.entries(it.byMonth)) rows[m] = (rows[m] || 0) + b.rows;
    for (const rep of reports) assert.equal(rows[rep.period.month], rep.rows.length, `${s.level} ${rep.period.month} 행 수`);
    // 항목 total = byMonth 합 (세 필드 모두), variantByMonth 의 수량 합 = byMonth 수량
    for (const it of Object.values(s.items)) {
      assert.deepEqual(it.total, sum(it.byMonth), `${s.level} ${it.id} total`);
      for (const m of Object.keys(it.byMonth)) assert.equal(Object.values(it.variantByMonth).reduce((a, v) => a + (v[m] || 0), 0), it.byMonth[m].qty, `${s.level} ${it.id} ${m} variantByMonth`);
    }
  }
  // family 수준 합 = 그 family 의 sku 합, skus 목록도 같다
  const byFam = {};
  for (const it of Object.values(sku.items)) {
    const f = (byFam[it.family] ||= { skus: [], byMonth: {} });
    f.skus.push(it.id);
    for (const [m, b] of Object.entries(it.byMonth)) { const t = (f.byMonth[m] ||= { qty: 0, amount: 0, discount: 0, rows: 0 }); for (const k of [...F, 'rows']) t[k] += b[k]; }
  }
  assert.deepEqual(Object.keys(fam.items).sort(), Object.keys(byFam).sort());
  for (const [fid, f] of Object.entries(byFam)) {
    assert.deepEqual([...fam.items[fid].skus].sort(), f.skus.sort(), fid);
    for (const [m, t] of Object.entries(f.byMonth)) for (const k of [...F, 'rows']) assert.equal(fam.items[fid].byMonth[m][k], t[k], `${fid} ${m} ${k}`);
  }
}

test('buildSeries: 행 하나가 항목 하나로만 간다 — 행 수·항목 total·family 합 = sku 합 (가짜 자료)', () => {
  const reports = sampleReports();
  assertSeriesConsistent(reports, buildSeries(reports), buildSeries(reports, { level: 'family' }));
});

test('buildSeries: period 없는 보고서 · 같은 기간 두 번 · 한 달을 나눈 두 조각 · 숫자가 아닌 필드', () => {
  const p = (from, to) => ({ from, to, month: from.slice(0, 7) });
  // period 가 없으면 임시 달 이름(m1 …)을 쓰는데, 안 검사와 checkTotals 가 같은 순서로 세어야 한다 (전에는 m1/m2 가 엇갈려 헛 throw)
  const noP = [rep(M[0], [row('빵', '밤식빵', 5)]), { period: null, rows: [row('빵', '밤식빵', 7)], unassigned: 0 }];
  const s = buildSeries(noP);
  assert.deepEqual(monthTotals(s), reportTotals(noP));
  assert.ok(checkTotals(noP, s));
  assert.deepEqual(monthTotals(buildSeries([...noP].reverse())), monthTotals(s));
  // 같은 기간(from~to)이 두 번 → throw. 합계 검사로는 못 잡는다 (원본도 두 배)
  const dup = [{ period: p('2026-01-01', '2026-01-31'), rows: [row('빵', '밤식빵', 5)] }, { period: p('2026-01-01', '2026-01-31'), rows: [row('빵', '밤식빵', 5)] }];
  assert.throws(() => buildSeries(dup), /같은 기간의 보고서가 두 번/);
  assert.throws(() => buildSeries(dup, { level: 'family' }), /같은 기간의 보고서가 두 번/);
  // 한 달을 나눈 두 조각(기간이 다름)은 같은 달로 더한다
  const halves = [{ period: p('2026-01-16', '2026-01-31'), rows: [row('빵', '밤식빵', 6)] }, { period: p('2026-01-01', '2026-01-15'), rows: [row('빵', '밤식빵', 5)] }];
  const h = buildSeries(halves);
  assert.deepEqual(h.months, ['2026-01']);
  assert.equal(h.items['빵|밤식빵'].byMonth['2026-01'].qty, 11);
  assert.equal(h.items['빵|밤식빵'].byMonth['2026-01'].rows, 2);
  assert.deepEqual(monthTotals(h), reportTotals(halves));
  // 숫자 문자열은 숫자로 (전에는 '5'+'5' 가 '55' 로 이어 붙어도 양쪽이 같이 틀려 검사를 통과했다). NaN·문자는 throw. 없는 필드는 0
  const str = [rep(M[0], [{ group: '빵', product: '밤식빵', price: 1000, qty: '5', amount: '5,000', discount: '0' }, { group: '빵', product: '밤식빵', price: 1000, qty: '0', amount: '0', discount: '0' }])];
  const ss = buildSeries(str);
  assert.deepEqual(monthTotals(ss), { [M[0]]: { qty: 5, amount: 5000, discount: 0 } });
  assert.deepEqual(reportTotals(str), { [M[0]]: { qty: 5, amount: 5000, discount: 0 } });
  assert.equal(ss.items['빵|밤식빵'].byMonth[M[0]].qty, 5);
  assert.deepEqual(ss.items['빵|밤식빵'].variantByMonth['밤식빵'], { [M[0]]: 5 });
  assert.throws(() => buildSeries([rep(M[0], [{ group: '빵', product: '밤식빵', price: 1000, qty: NaN, amount: 5000, discount: 0 }])]), /숫자가 아닌 qty: NaN/);
  assert.throws(() => buildSeries([rep(M[0], [{ group: '빵', product: '밤식빵', price: 1000, qty: 5, amount: 'abc', discount: 0 }])]), /숫자가 아닌 amount: "abc"/);
  const missing = buildSeries([rep(M[0], [{ group: '빵', product: '밤식빵', price: 1000, qty: 5 }])]);
  assert.deepEqual(missing.items['빵|밤식빵'].total, { qty: 5, amount: 0, discount: 0 });
});

test('buildSeries: 교대·오타 코드를 한 sku 로, variants 에 원래 이름, 같은 달 코드 2개는 notes 에, 수량 0 줄은 등장에서 뺀다', () => {
  const s = buildSeries(sampleReports());
  const bam = s.items['빵|밤식빵'];
  assert.deepEqual(bam.variants, ['밤 식빵', '밤식빵']);
  assert.equal(bam.name, '밤식빵'); // 가장 최근 달의 이름
  assert.equal(bam.byMonth[M[2]].qty, 49 + 30);
  assert.equal(bam.byMonth[M[2]].rows, 2);
  assert.deepEqual(bam.variantByMonth['밤 식빵'], { [M[0]]: 80, [M[1]]: 71, [M[2]]: 49 });
  assert.equal(bam.first, M[0]); assert.equal(bam.last, M[3]); assert.equal(bam.monthsPresent, 4);
  assert.ok(bam.notes.some((n) => n.startsWith('규칙으로 이음')));
  assert.ok(bam.notes.includes(`${M[2]}: 같은 이름 코드 2개`));
  const garlic = s.items['빵|육쪽마늘빵'];
  assert.deepEqual(garlic.variants, ['육쪽마늘빵', '욱쪽마늘빵']);
  assert.equal(garlic.byMonth[M[2]].qty, 299 + 120 + 64);
  assert.equal(garlic.byMonth[M[2]].rows, 3);
  const fig = s.items['빵|무화과크림치즈'];
  assert.deepEqual(fig.variants, ['무화과크림치즈빵', '무화과크림치즈']);
  assert.ok(fig.notes.some((n) => n.startsWith('대응표: 무화과크림치즈빵 → 무화과크림치즈')));
  assert.ok(!('빵|무화과크림치즈빵' in s.items));
  // 같은 이름 두 코드의 단가가 다르면 기록
  assert.ok(s.items['빵|명란빵'].notes.includes(`${M[2]}: 같은 이름 코드 2개 (단가 7400/6400)`));
  // 수량 0 줄: 합계에는 있고 등장에서는 빠진다
  const naan = s.items['빵|갈릭난'];
  assert.equal(naan.byMonth[M[2]].qty, 0);
  assert.deepEqual(naan.activeMonths, [M[0], M[1]]);
  assert.equal(naan.last, M[1]); assert.equal(naan.monthsPresent, 2);
  const dead = buildSeries([rep(M[0], [row('빵', '무화과파이', 0)])]).items['빵|무화과파이'];
  assert.equal(dead.monthsPresent, 0); assert.equal(dead.first, undefined);
  assert.ok(dead.notes.some((n) => n.includes('죽은 코드')));
  // 그룹 없는 행도 한 항목으로. 옵션은 그룹마다 따로
  assert.equal(s.items['미배정상품'].byMonth[M[2]].qty, 3);
  assert.equal(s.items['커피|takeout'].byMonth[M[0]].qty, 104);
  assert.equal(s.items['라떼|takeout'].byMonth[M[0]].qty, 3);
  // 음수 줄도 그대로
  assert.equal(s.items['진동벨|포인트결제'].byMonth[M[0]].qty, -17);
});

test('buildSeries: 병합 SKU — sku 는 따로 두고 mergedInto, family 수준에서 한 묶음', () => {
  const sku = buildSeries(sampleReports());
  const fid = canonicalKey('소금빵/ 먹물소금빵/초코짠짠', '빵');
  assert.equal(sku.items['빵|먹물소금빵'].mergedInto, fid);
  assert.equal(sku.items['빵|소금빵행사'].mergedInto, fid);
  assert.equal(sku.items[fid].mergedInto, undefined);
  assert.equal(sku.items['빵|먹물소금빵'].family, fid);
  assert.equal(sku.items[fid].family, fid);
  assert.equal(sku.items['빵|먹물소금빵'].last, M[2]);
  const fam = buildSeries(sampleReports(), { level: 'family' });
  const f = fam.items[fid];
  assert.equal(f.name, '소금빵/ 먹물소금빵/초코짠짠');
  assert.deepEqual([...f.skus].sort(), ['빵|먹물소금빵', '빵|소금빵행사', fid].sort());
  assert.equal(f.byMonth[M[2]].qty, 407 + 1322 + 1041);
  assert.equal(f.byMonth[M[3]].qty, 2652);
  assert.equal(f.byMonth[M[0]].qty, 758 + 2149);
  assert.ok(!('빵|먹물소금빵' in fam.items));
  // 대응표에 없는 슬래시 병합은 잇지 않는다 (의심 쌍으로만)
  assert.ok('빵|호두쉬폰' in fam.items && '빵|호두쉬폰/단호박쉬폰' in fam.items);
  assert.equal(sku.items['빵|호두쉬폰'].mergedInto, undefined);
  // 아메리카노 가족: hot·ice 두 sku
  const am = fam.items['커피|아메리카노'];
  assert.deepEqual([...am.skus].sort(), ['커피|hot아메리카노', '커피|ice아메리카노']);
  assert.equal(am.byMonth[M[0]].qty, 3667 + 1837);
  assert.equal(am.name, '아메리카노');
  // 병합 코드가 자료에 없으면 mergedInto 없이 메모만
  const only = buildSeries([rep(M[0], [row('빵', '먹물소금빵', 10)])]);
  assert.equal(only.items['빵|먹물소금빵'].mergedInto, undefined);
  assert.ok(only.items['빵|먹물소금빵'].notes.some((n) => n.includes('자료에 없음')));
  // 병합 코드가 끝난 뒤 갈라져 나온 코드는 splitFrom (수량 0 줄은 기간 판정에 안 들어간다)
  const split = buildSeries([
    rep(M[0], [row('디저트', '무화과파이/딸기파이', 80)]),
    rep(M[1], [row('디저트', '무화과파이/딸기파이', 92), row('디저트', '무화과파이', 9)]),
    rep(M[2], [row('디저트', '무화과파이', 45), row('디저트', '무화과파이/딸기파이', 0)]),
  ]);
  const merged = canonicalKey('무화과파이/딸기파이', '디저트');
  assert.equal(split.items['디저트|무화과파이'].splitFrom, merged);
  assert.equal(split.items['디저트|무화과파이'].mergedInto, undefined);
  assert.equal(split.items[merged].last, M[1]);
});

test('buildSeries: 동시 판매 중복은 합치지 않고 duplicateOf 로만 표시', () => {
  const sku = buildSeries(sampleReports());
  assert.ok('빵|버터떡' in sku.items && '디저트|버터떡' in sku.items);
  assert.equal(sku.items['빵|버터떡'].duplicateOf, '디저트|버터떡');
  assert.equal(sku.items['디저트|버터떡'].duplicateOf, undefined);
  assert.equal(sku.items['빵|버터떡'].byMonth[M[2]].qty, 68);
  assert.equal(sku.items['디저트|버터떡'].byMonth[M[2]].qty, 69);
  const fam = buildSeries(sampleReports(), { level: 'family' });
  assert.ok('빵|버터떡' in fam.items && '디저트|버터떡' in fam.items); // 가족으로도 합치지 않는다
  // 규칙이 합쳐 버릴 두 이름(토핑휘낭시에/토핑 휘낭시에)은 '#원래표기' 로 떼어 둔다
  const fin = buildSeries([rep(M[0], [row('디저트', '토핑휘낭시에', 14), row('디저트', '토핑 휘낭시에', 8)]), rep(M[1], [row('디저트', '토핑 휘낭시에', 12)])]);
  assert.equal(Object.keys(fin.items).length, 2);
  const old = fin.items[canonicalKey('토핑휘낭시에', '디저트')];
  assert.equal(old.id, '디저트|토핑휘낭시에#토핑휘낭시에');
  assert.equal(old.duplicateOf, '디저트|토핑휘낭시에');
  assert.equal(old.byMonth[M[0]].qty, 14);
  assert.equal(fin.items['디저트|토핑휘낭시에'].byMonth[M[0]].qty, 8);
  assert.deepEqual(monthTotals(fin), { [M[0]]: { qty: 22, amount: 22000, discount: 0 }, [M[1]]: { qty: 12, amount: 12000, discount: 0 } });
  assert.equal(familyOf(old.id), old.id);
  // 대추차 only hot / hot: sku 는 따로(중복 표시), 가족은 하나
  assert.equal(sku.items['티|onlyhot대추차'].duplicateOf, '티|hot대추차');
  assert.equal(sku.items['티|hot대추차'].duplicateOf, undefined);
  const jujube = fam.items['티|대추차'];
  assert.equal(jujube.skus.length, 3);
  assert.equal(jujube.byMonth[M[3]].qty, 489 + 117 + 5);
});

test('auditSeries: 규칙/대응표로 이은 것, 의심 쌍(교대·슬래시·편집거리), 중복, 재등록 서명, 단기 등장', () => {
  const sku = buildSeries(sampleReports());
  const a = auditSeries(sku, { ignoreNames: ['Take out'], ignoreGroups: ['진동벨'] });
  assert.deepEqual(a.months, M);
  // (1) 규칙으로 이은 것: 겹친 달과 합계 연속
  const bam = a.ruleJoined.find((j) => j.id === '빵|밤식빵');
  assert.ok(bam);
  assert.deepEqual(bam.pairs[0].overlap, [M[2]]);
  assert.deepEqual({ before: bam.pairs[0].before, during: bam.pairs[0].during, after: bam.pairs[0].after }, { before: 71, during: 79, after: 79 });
  assert.deepEqual(bam.warnings, []);
  assert.ok(a.ruleJoined.some((j) => j.id === '빵|육쪽마늘빵'));
  // 규칙이 합친 두 이름이 두 달 이상 함께 팔리면 경고
  const long = auditSeries(buildSeries([rep(M[0], [row('빵', '밤 식빵', 1), row('빵', '밤식빵', 1)]), rep(M[1], [row('빵', '밤 식빵', 1), row('빵', '밤식빵', 1)])]));
  assert.ok(long.ruleJoined[0].warnings.some((w) => w.includes('함께 팔림')));
  // (2) 대응표
  assert.ok(a.renames.some((j) => j.id === '빵|무화과크림치즈'));
  assert.ok(!a.ruleJoined.some((j) => j.id === '빵|무화과크림치즈'));
  const salt = a.families.find((f) => f.family === canonicalKey('소금빵/ 먹물소금빵/초코짠짠', '빵'));
  assert.ok(salt && salt.hasFamilyCode);
  assert.deepEqual(salt.members.map((m) => [m.name, Boolean(m.mergedInto), m.isFamilyCode]), [['먹물소금빵', true, false], ['소금빵행사', true, false], ['소금빵/ 먹물소금빵/초코짠짠', false, true]]);
  assert.deepEqual(salt.warnings, []);
  // (3) 의심 쌍 — 잇지 않았다
  const sus = a.suspects.find((s) => s.a.id === '디저트|화이트레몬마들렌' && s.b.id === '디저트|레몬마들렌');
  assert.ok(sus && sus.kind.includes('교대'));
  assert.equal(sus.month, M[1]);
  assert.deepEqual({ before: sus.before, during: sus.during, after: sus.after }, { before: 63, during: 92, after: 73 });
  assert.ok('디저트|화이트레몬마들렌' in sku.items && '디저트|레몬마들렌' in sku.items);
  const slash = a.suspects.find((s) => s.a.id === '빵|호두쉬폰' && s.b.id === '빵|호두쉬폰/단호박쉬폰');
  assert.ok(slash && slash.kind.includes('슬래시 병합'));
  assert.ok(slash.why.some((w) => w.includes("'호두쉬폰'")));
  const edit = a.suspects.find((s) => s.a.id === '디저트|초코쉘쿠키' && s.b.id === '디저트|초코셀쿠키');
  assert.ok(edit && edit.kind === '편집거리 1');
  assert.ok(edit.flags.some((f) => f.includes('함께 팔림')));
  assert.ok(!a.suspects.some((s) => s.a.id.startsWith('진동벨|') || s.b.id.startsWith('진동벨|')));
  assert.ok(!a.suspects.some((s) => s.a.id.endsWith('|takeout') || s.b.id.endsWith('|takeout')));
  // 이미 이어진 것(같은 가족·중복)은 의심 쌍에 없다
  assert.ok(!a.suspects.some((s) => s.a.id === '빵|먹물소금빵' && s.b.id === salt.family));
  assert.ok(!a.suspects.some((s) => [s.a.id, s.b.id].includes('티|onlyhot대추차')));
  // (4) 중복
  const dup = a.duplicates.find((d) => d.id === '빵|버터떡');
  assert.deepEqual({ of: dup.of, overlap: dup.overlap, source: dup.source }, { of: '디저트|버터떡', overlap: [M[2], M[3]], source: '대응표' });
  // 대응표에 없는 같은 이름이 다른 그룹에서 함께 팔리면 자동으로 띄운다 (나중에 생긴 코드를 중복으로)
  const auto = auditSeries(buildSeries([rep(M[0], [row('빵', '초코파운드', 1)]), rep(M[1], [row('빵', '초코파운드', 1), row('디저트', '초코파운드', 1)])])).duplicates.find((d) => d.source === '자동');
  assert.deepEqual({ id: auto.id, of: auto.of, overlap: auto.overlap }, { id: '디저트|초코파운드', of: '빵|초코파운드', overlap: [M[1]] });
  // 재등록 서명: 3월 빵 그룹에서 한 sku 가 코드 2개인 상품 ≥ 3
  assert.ok(a.reregistration.some((r) => r.month === M[2] && r.group === '빵' && r.count >= 3));
  assert.ok(a.multiRow.some((r) => r.id === '빵|명란빵' && r.prices.length === 2));
  // (5) 단기 등장: 잇지 않고 경계만 표시
  const one = a.shortLived.find((s) => s.id === '디저트|한달만');
  assert.deepEqual(one.months, { [M[0]]: 5 });
  assert.equal(one.edge, '자료 시작 전부터');
  assert.equal(a.shortLived.find((s) => s.id === '디저트|자보르').edge, '진행 중');
  assert.ok(!a.shortLived.some((s) => s.id.startsWith('진동벨|')));
  assert.equal(a.counts.rawNames, new Set(sampleReports().flatMap((r) => r.rows.map((x) => `${x.group}|${x.product}`))).size);
  // 조사 후보 표용 관계 요약
  const st = pairStatus(sku, sku.items['디저트|화이트레몬마들렌'], sku.items['디저트|레몬마들렌']);
  assert.deepEqual({ overlap: st.overlap, samePrice: st.samePrice, sameFamily: st.sameFamily, month: st.month }, { overlap: [M[1]], samePrice: true, sameFamily: false, month: M[1] });
  assert.throws(() => auditSeries(buildSeries(sampleReports(), { level: 'family' })));
});

// 이 층은 PRODUCT_MAP(POS 상품명 그대로 → 레시피) 위에 얹힌다. parseSalesReport 의 상품명이 바뀌거나 입력이 변형되면 레시피 소비량 계산이 깨진다.
test('pos-map 경로 불변: PRODUCT_MAP 키는 parseSalesReport 상품명 그대로이고 sku 층은 입력을 건드리지 않는다', () => {
  const text = `그룹별 매출분석
( 2026-03-01   2026-03-31 ) ∼
그룹코드 상품그룹 상품 단가 수량 금액 할인
00001
커피
ic카페라떼 7,000 273 1,599,500 311,500
에소프레소 싱글 5,000 11 45,000 10,000
ice카라멜마끼야또 7,500 63 412,500 60,000
hot카라멜마끼아또 7,000 82 504,000 70,000
Take out 0 114 0 0
커피 합계 543 2,561,000 451,500
00002 티
대추차 only hot 8,000 655 4,156,000 1,084,000
대추차 hot 8,000 117 732,000 204,000
설국차 10,000 3 30,000 0
hot설국차 10,000 17 135,000 35,000
티 합계 792 5,053,000 1,323,000
`;
  const rep = parseSalesReport(text);
  assert.equal(rep.rows.length, 9);
  for (const r of rep.rows) assert.ok(r.product in PRODUCT_MAP, `PRODUCT_MAP 에 그대로 있어야 한다: ${r.product}`);
  const mapBefore = JSON.stringify(PRODUCT_MAP);
  const repBefore = JSON.stringify(rep);
  const s = buildSeries([rep]);
  auditSeries(s);
  assert.equal(JSON.stringify(rep), repBefore);
  assert.equal(JSON.stringify(PRODUCT_MAP), mapBefore);
  // sku 층은 원래 이름을 variants 로 보존한다 — 어떤 sku 에서든 PRODUCT_MAP 키로 되돌아갈 수 있다
  for (const r of rep.rows) {
    const it = s.items[canonicalKey(r.product, r.group)];
    assert.ok(it && it.variants.includes(r.product), r.product);
  }
  assert.deepEqual(monthTotals(s), reportTotals([rep]));
  // PRODUCT_MAP 의 모든 키가 canonicalKey 를 지나갈 수 있고, hot/ice 쌍은 sku 로는 갈리되 가족으로는 한 묶음
  for (const k of Object.keys(PRODUCT_MAP)) {
    const key = canonicalKey(k, '커피');
    assert.ok(typeof key === 'string' && key.length > '커피|'.length, k);
  }
  assert.notEqual(canonicalKey('hot아메리카노', '커피'), canonicalKey('ice아메리카노', '커피'));
  assert.equal(familyOf(canonicalKey('hot아메리카노', '커피')), familyOf(canonicalKey('ice아메리카노', '커피')));
});

// 실제 자료(data/pos, 저장소에 올리지 않음)가 있으면 12개월 전체로 합계 불변과 대응표 항목의 존재를 확인한다
const posDir = path.join(root, 'data', 'pos');
const posFiles = fs.existsSync(posDir) ? fs.readdirSync(posDir).filter((f) => /월.*\.txt$/.test(f)) : [];
test('실제 자료: 각 달 합계 불변, 대응표의 이름이 자료에 있고 진짜 중복은 갈라져 있다', { skip: posFiles.length ? false : 'data/pos 없음' }, () => {
  const reports = posFiles.map((f) => parseSalesReport(fs.readFileSync(path.join(posDir, f), 'utf8')));
  const sku = buildSeries(reports);
  const fam = buildSeries(reports, { level: 'family' });
  assert.deepEqual(monthTotals(sku), reportTotals(reports));
  assert.deepEqual(monthTotals(fam), reportTotals(reports));
  assert.ok(Object.keys(fam.items).length < Object.keys(sku.items).length);
  for (const e of RENAMES) for (const n of [...e.from, e.to]) assert.ok(sku.items[canonicalKey(n, e.group)]?.variants.includes(n), `${n} 가 자료에 없다`);
  for (const e of FAMILIES) for (const n of [...e.members, e.name]) assert.ok(sku.items[canonicalKey(n, e.group)]?.variants.includes(n), `${n} 가 자료에 없다`);
  for (const e of DUPLICATES) {
    const a = sku.items[canonicalKey(e.name, e.group)], b = sku.items[canonicalKey(e.of.name, e.of.group)];
    assert.ok(a && b && a !== b, `${e.name} / ${e.of.name}`);
    assert.equal(a.duplicateOf, b.id);
  }
  for (const e of FAMILIES) for (const m of e.members) assert.equal(sku.items[canonicalKey(m, e.group)].mergedInto, canonicalKey(e.name, e.group), `${m} → ${e.name}`);
  const audit = auditSeries(sku, { ignoreGroups: ['진동벨'] });
  assert.equal(audit.renames.length, RENAMES.length);
  assert.ok(audit.reregistration.some((r) => r.month === '2026-03' && r.group === '빵'));
  // 이중 계상·누락 없음, 항목 total·family 합 = sku 합 (열두 달 전부)
  assertSeriesConsistent(reports, sku, fam);
  assert.equal(Object.values(sku.items).reduce((a, it) => a + it.total.qty, 0), Object.values(reportTotals(reports)).reduce((a, t) => a + t.qty, 0));
  // 진짜 중복은 family 로도 갈라져 있다 — 규칙 가족(hot/ice: 대추차)만 예외. '#' 로 떼어 둔 id 는 DUPLICATES 의 분리 항목뿐
  for (const e of DUPLICATES) {
    const a = canonicalKey(e.name, e.group), b = canonicalKey(e.of.name, e.of.group);
    if (familyOf(a) === familyOf(b)) assert.equal(normalizeSkuName(e.name).base, normalizeSkuName(e.of.name).base, `${e.name}: hot/ice 변형이 아닌데 가족이 같다`);
    else assert.ok(familyOf(a) in fam.items && familyOf(b) in fam.items && fam.items[familyOf(a)] !== fam.items[familyOf(b)]);
  }
  // '#' 로 떼어 둔 id 는 DUPLICATES 의 분리 항목과 SEPARATE(같은 상품인지 알 수 없어 떼어 둔 것)뿐
  const hashIds = Object.keys(sku.items).filter((k) => k.includes('#'));
  const expectedHash = [
    ...DUPLICATES.filter((e) => ruleKey(e.name, e.group) === ruleKey(e.of.name, e.of.group)).map((e) => canonicalKey(e.name, e.group)),
    ...SEPARATE.map((e) => canonicalKey(e.name, e.group)),
  ];
  assert.deepEqual(hashIds.sort(), expectedHash.sort());
  for (const e of SEPARATE) assert.ok(sku.items[canonicalKey(e.name, e.group)]?.variants.includes(e.name), `${e.name}(SEPARATE) 가 자료에 없다`);
});

// 2026-03 재등록 교대: 구코드는 3월을 마지막으로 끝나고 신코드는 3월에 시작하며, 이은 sku 의 2월→3월→4월 수량이 자연스럽게 이어진다.
// 실제 수량은 적지 않는다(공개 저장소) — 모양만 확인한다: 3월 = 구+신, 앞뒤 달과의 비율이 0.5~2 안.
test('실제 자료: 2026-03 교대 상품의 시계열이 끊기지 않는다', { skip: posFiles.length ? false : 'data/pos 없음' }, () => {
  const reports = posFiles.map((f) => parseSalesReport(fs.readFileSync(path.join(posDir, f), 'utf8')));
  const sku = buildSeries(reports);
  const near = (a, b) => a > 0 && b > 0 && a / b >= 0.5 && a / b <= 2;
  const cases = [
    ['빵|밤식빵', '밤 식빵', '밤식빵'], // 규칙(공백)
    ['빵|메이플크림치즈', '메이플 크림치즈', '메이플크림치즈'], // 규칙(공백)
    ['빵|무화과/밤깜빠뉴', '무화과/밤 깜빠뉴', '무화과/밤깜빠뉴'], // 규칙(공백, 슬래시 유지)
    ['빵|인절미브레드', '인절미브래드', '인절미브레드'], // 규칙(SPELLING)
    ['빵|무화과크림치즈', '무화과크림치즈빵', '무화과크림치즈'], // 대응표(RENAMES)
  ];
  for (const [id, oldName, newName] of cases) {
    const it = sku.items[id];
    assert.ok(it, id);
    assert.deepEqual([...it.variants].sort(), [oldName, newName].sort(), id);
    const o = it.variantByMonth[oldName], n = it.variantByMonth[newName];
    const active = (by) => Object.keys(by).filter((m) => by[m] !== 0).sort();
    assert.equal(active(o).at(-1), '2026-03', `${oldName} 는 3월이 마지막`);
    assert.equal(active(n)[0], '2026-03', `${newName} 는 3월이 처음`);
    assert.ok(!('2026-04' in o) && !('2026-02' in n), `${id}: 겹치는 달은 3월 하나`);
    assert.equal(it.byMonth['2026-03'].qty, o['2026-03'] + n['2026-03'], `${id} 3월 = 구+신`);
    assert.equal(it.byMonth['2026-03'].rows, 2, `${id} 3월 원본 줄 2개`);
    const q = (m) => it.byMonth[m].qty;
    assert.ok(near(q('2026-03'), q('2026-02')) && near(q('2026-04'), q('2026-03')), `${id} 2→3→4월 비율: ${q('2026-02')} → ${q('2026-03')} → ${q('2026-04')}`);
    // 처음 팔린 달부터 마지막 달까지 빠진 달이 없어야 한다. "전 기간 등장"은 자료가 12개월일 때만 참이었다 —
    // 23개월(2024-08~)로 늘리자 메이플크림치즈처럼 2025-08 에 생긴 상품이 있다.
    const present = sku.months.filter((m) => it.byMonth[m] && it.byMonth[m].qty !== 0);
    const span = sku.months.slice(sku.months.indexOf(present[0]), sku.months.indexOf(present.at(-1)) + 1);
    assert.deepEqual(present, span, `${id} 처음~마지막 사이에 빠진 달 없음`);
  }
  // 병합 가족: sku 로는 세 코드가 따로, 가족으로는 3월 전후가 이어진다
  const fam = buildSeries(reports, { level: 'family' });
  const salt = fam.items[canonicalKey('소금빵/ 먹물소금빵/초코짠짠', '빵')];
  assert.equal(salt.skus.length, 3);
  assert.equal(salt.byMonth['2026-03'].rows, 3);
  assert.ok(near(salt.byMonth['2026-03'].qty, salt.byMonth['2026-02'].qty) && near(salt.byMonth['2026-04'].qty, salt.byMonth['2026-03'].qty));
  assert.equal(salt.monthsPresent, sku.months.length);
  // 동시 판매 중복은 두 코드가 같은 달에 각각 팔린 채로 남는다
  const bread = sku.items['빵|버터떡'], dessert = sku.items['디저트|버터떡'];
  const both = sku.months.filter((m) => bread.byMonth[m]?.qty && dessert.byMonth[m]?.qty);
  assert.ok(both.length >= 3, `버터떡 동시 판매 달: ${both.join(',')}`);
  assert.equal(bread.duplicateOf, dessert.id);
});
