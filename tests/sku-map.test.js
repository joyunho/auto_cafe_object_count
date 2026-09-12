// 대응표(src/data/sku-map.js)와 규칙 층이 "정말 같은 상품"만 잇는지 반증하는 테스트.
//
// 규칙·대응표가 이은 모든 쌍에 대해 교대의 서명을 요구한다:
//   (a) 두 이름이 함께 팔린 달이 한 달 이하 (두 달 이상 함께 팔렸으면 교대가 아니라 별개 코드·동시 판매)
//   (b) 단가를 공유 (같은 상품이 코드만 바뀐 것이면 단가가 같다)
//   (c) 겹친 달의 두 코드 합이 전달·다음 달과 이어짐 (다른 상품을 합쳤으면 그 달만 합이 튄다)
// 실제 자료(data/pos, 저장소에 올리지 않음)가 있을 때 12개월 전체로 확인하고, 새 달이 들어와 서명이 깨지면 여기서 깨진다 —
// 그때는 항목을 DUPLICATES 로 내리거나 지운다. 거짓 시계열은 없는 것보다 나쁘다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSalesReport } from '../src/logic/pos.js';
import { canonicalKey, familyOf, ruleKey, normalizeSkuName, buildSeries, auditSeries, continuity, skuMapIndex, CONTINUITY_BOUNDS } from '../src/logic/sku.js';
import { SPELLING, RENAMES, FAMILIES, DUPLICATES } from '../src/data/sku-map.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posDir = path.join(root, 'data', 'pos');
const posFiles = fs.existsSync(posDir) ? fs.readdirSync(posDir).filter((f) => /월.*\.txt$/.test(f)) : [];
const skipReal = posFiles.length ? false : 'data/pos 없음';

// 교대 서명의 허용 폭(sku.js 의 감사와 같은 값): 겹친 달의 합 ÷ 전후 달 평균. 두 상품을 합쳤으면 2 근처, 한쪽이 실제로는 안 팔린 달이면 0.5 아래로 떨어진다.
// 전후 달이 없으면(한 달짜리 코드) 판단할 수 없으므로 통과시킨다 — 감사 표에는 ※ 로 뜬다.
const ratioOk = (c) => c.before == null || c.after == null || (c.ratio >= CONTINUITY_BOUNDS.min && c.ratio <= CONTINUITY_BOUNDS.max);

// 가짜 자료 (숫자는 지어낸 값)
const row = (group, product, qty, price = 1000) => ({ group, product, price, qty, amount: qty * price, discount: 0 });
const rep = (month, rows) => ({ period: { from: `${month}-01`, to: `${month}-28`, month }, rows, unassigned: 0 });

test('auditSeries: 규칙이 이은 쌍의 합계가 튀면 경고, 전후 달이 없으면 ※(caveat), 가족은 가족 합계 연속을 낸다', () => {
  assert.ok(CONTINUITY_BOUNDS.min > 0 && CONTINUITY_BOUNDS.min < 1 && CONTINUITY_BOUNDS.max > 1);
  const a = auditSeries(buildSeries([
    // '밤 식빵' 과 '밤식빵' 이 3월 한 달 겹치는데 합이 두 배 — 규칙이 다른 두 상품을 합친 모양
    rep('2026-02', [row('빵', '밤 식빵', 80), row('빵', '무화과크림치즈빵', 100), row('빵', '먹물소금빵', 300), row('빵', '소금빵행사', 700)]),
    rep('2026-03', [row('빵', '밤 식빵', 80), row('빵', '밤식빵', 80), row('빵', '무화과크림치즈빵', 60), row('빵', '무화과크림치즈', 45),
      row('빵', '먹물소금빵', 100), row('빵', '소금빵행사', 300), row('빵', '소금빵/ 먹물소금빵/초코짠짠', 600),
      row('빵', '마늘 바게트 / 머쉬룸 바게트', 40), row('빵', '마늘바게트/머쉬룸바게트', 20)]), // 구이름이 한 달만 — 전달이 없다
    rep('2026-04', [row('빵', '밤식빵', 80), row('빵', '무화과크림치즈', 105), row('빵', '소금빵/ 먹물소금빵/초코짠짠', 1010), row('빵', '마늘바게트/머쉬룸바게트', 25)]),
  ]));
  const bam = a.ruleJoined.find((j) => j.id === '빵|밤식빵');
  assert.ok(bam.warnings.some((w) => w.includes('합계가 이어지지 않음') && w.includes('×2.00')), bam.warnings.join(' / '));
  assert.deepEqual(bam.caveats, []);
  const garlic = a.ruleJoined.find((j) => j.id === '빵|마늘바게트/머쉬룸바게트');
  assert.deepEqual(garlic.warnings, []); // 전달이 없으면 합계 연속을 판단하지 않는다 — 경고가 아니라 ※
  assert.ok(garlic.caveats.some((c) => c.includes('전에 팔린 달이 없음')), garlic.caveats.join(' / '));
  const fig = a.renames.find((j) => j.id === '빵|무화과크림치즈');
  assert.deepEqual(fig.warnings, []); assert.deepEqual(fig.caveats, []);
  // 가족: 구성 코드 합 → 구성 코드 + 병합 코드 → 병합 코드
  const salt = a.families.find((f) => f.family === canonicalKey('소금빵/ 먹물소금빵/초코짠짠', '빵'));
  assert.deepEqual({ month: salt.continuity.month, before: salt.continuity.before, during: salt.continuity.during, after: salt.continuity.after }, { month: '2026-03', before: 1000, during: 1000, after: 1010 });
  assert.deepEqual(salt.warnings, []);
  // 병합 달의 가족 합이 전후의 두 배면 경고 — 구성 코드가 이 가족이 아닐 수 있다
  const b = auditSeries(buildSeries([
    rep('2026-02', [row('빵', '식빵', 100)]),
    rep('2026-03', [row('빵', '식빵', 100), row('빵', '식빵/잡곡식빵', 100)]),
    rep('2026-04', [row('빵', '식빵/잡곡식빵', 100)]),
  ]));
  const bread = b.families.find((f) => f.family === canonicalKey('식빵/잡곡식빵', '빵'));
  assert.equal(bread.continuity.ratio, 2);
  assert.ok(bread.warnings.some((w) => w.includes('가족 합계가 병합 달을 지나며 이어지지 않음')), bread.warnings.join(' / '));
});

test('SPELLING: 짝이 있는 표기만 바꾸고, 치환끼리 얽히지 않으며, 무관한 이름은 건드리지 않는다', () => {
  for (const [from, to] of SPELLING) {
    assert.equal(normalizeSkuName(`${from}빵`).key, normalizeSkuName(`${to}빵`).key, `${from} → ${to}`);
    // 치환 결과가 다른 치환의 입력이 되면 순서에 따라 결과가 달라진다
    for (const [from2] of SPELLING) assert.ok(!to.includes(from2), `'${to}' 안에 다른 치환의 입력 '${from2}' 이 있다`);
    // 한 치환의 입력이 다른 치환의 입력을 포함하면 먼저 적용된 쪽이 나중 것을 가린다
    for (const [from2] of SPELLING) if (from2 !== from) assert.ok(!from.includes(from2), `'${from}' 이 '${from2}' 를 포함한다`);
  }
  // 치환이 닿지 않아야 하는 이름들 (실제 자료에 있는 이웃 이름)
  for (const [name, key] of [
    ['잠봉/리코타 샌드위치', '잠봉/리코타샌드위치'], ['크림치즈/잠봉 샌드위치', '크림치즈/잠봉샌드위치'],
    ['크렌베리스콘', '크렌베리스콘'], ['크렌베리 마들렌', '크렌베리마들렌'], ['말차스콘/크렌베리스콘', '말차스콘/크렌베리스콘'],
    ['크림치즈코코넛브레드', '크림치즈코코넛브레드'], ['콘브레드', '콘브레드'],
    ['호밀빵(깜빠뉴)', '호밀빵깜빠뉴'], ['페스츄리 롱소세지', '페스츄리롱소세지'],
  ]) assert.equal(normalizeSkuName(name).key, key, name);
  // 오타 교정은 sku 를 합치지 않는 경우에도(hot/ice 가 다름) 가족을 하나로 만든다
  assert.notEqual(canonicalKey('ice카라멜마끼야또', '커피'), canonicalKey('hot카라멜마끼아또', '커피'));
  assert.equal(familyOf(canonicalKey('ice카라멜마끼야또', '커피')), familyOf(canonicalKey('hot카라멜마끼아또', '커피')));
});

test('규칙의 폭: 공백·괄호·쉼표 제거는 표기 차이만 잇고, 접미 탈락·약어·부분 이름·슬래시 병합은 잇지 않는다', () => {
  const same = (a, b, g = '빵') => assert.equal(canonicalKey(a, g), canonicalKey(b, g), `${a} = ${b}`);
  const diff = (a, b, g = '빵') => assert.notEqual(canonicalKey(a, g), canonicalKey(b, g), `${a} ≠ ${b}`);
  same('초코 마들렌', '초코마들렌', '디저트');
  same('초코,아몬드스콘', '초코 아몬드 스콘', '디저트');
  same('호두쉬폰/ 단호박쉬폰', '호두쉬폰/단호박쉬폰');
  same('단호박파운드 / 무화과파운드', '단호박파운드/무화과파운드');
  diff('초코 마들렌', '초코 아몬드 마들렌', '디저트');
  diff('식빵', '식빵/잡곡식빵'); // 슬래시 병합은 대응표(가족)로만
  diff('소금빵행사', '소금빵묶음'); diff('먹물소금빵', '먹물소금빵묶음'); diff('소금빵행사', '소금빵/ 먹물소금빵/초코짠짠');
  diff('앙버터빵', '앙버터소금빵'); diff('앙버터빵', '앙버터빵 / 크렌베리 쌀빵'); diff('크린베리쌀빵', '앙버터빵/크린베리쌀빵');
  diff('만주', '만주/계피만쥬', '디저트'); diff('계피만쥬', '만주/계피만쥬', '디저트');
  diff('두쫀쿠', '두바이쫀득 쿠키', '디저트'); diff('쫀득쿠키', '두바이쫀득 쿠키', '디저트');
  diff('블빵', '블루베리빵'); diff('생과일몽블랑', '생과일 몽블랑 팡도르'); diff('몽블랑', '생과일몽블랑');
  diff('화이트 레몬 마들렌', '레몬마들렌', '디저트'); diff('명란바게트', '명란빵'); diff('쑥맘모스빵', '맘모스빵');
  diff('생크림케이크', '생크림/기리쉬', '쇼케이스'); diff('조각케익(딸기,멜론)', '조각케이크', '쇼케이스');
  diff('페퍼소세지빵', '페퍼소세지빵/햄치즈 토스트'); diff('햄치즈토스트', '페퍼소세지빵/햄치즈 토스트');
  // hot/ice 는 sku 로는 갈리고 가족으로만 묶인다. 영문 단어 안의 hot/ice 는 변형이 아니다
  diff('hot초코', 'ice초코', '라떼');
  assert.equal(familyOf(canonicalKey('hot초코', '라떼')), familyOf(canonicalKey('ice초코', '라떼')));
  assert.notEqual(familyOf(canonicalKey('핫초코', '라떼')), familyOf(canonicalKey('hot초코', '라떼')));
  assert.equal(canonicalKey('hot dog', '빵'), '빵|hotdog');
  assert.equal(familyOf('빵|hotdog'), '빵|hotdog');
  assert.equal(familyOf('빵|icecream'), '빵|icecream');
  // '디카페인' 은 hot/ice 변형 뒤에 붙었을 때만 변형이다
  assert.equal(familyOf(canonicalKey('hot디카페인아메리카노', '커피')), '커피|아메리카노');
  assert.equal(familyOf(canonicalKey('디카페인콜드브루', '라떼')), '라떼|디카페인콜드브루');
  assert.equal(familyOf(canonicalKey('디카페인', '커피')), '커피|디카페인');
  // 그룹이 다르면 규칙으로도 대응표로도 잇지 않는다
  assert.notEqual(canonicalKey('쌀롤', '빵'), canonicalKey('쌀롤', '디저트'));
  assert.notEqual(familyOf(canonicalKey('쌀롤', '빵')), familyOf(canonicalKey('쌀롤', '디저트')));
});

test('대응표 항목의 모양: 그룹 안에서만, 규칙이 이미 잇는 쌍은 대응표에 없고, 중복은 sku·가족 어느 수준에서도 합치지 않는다', () => {
  for (const e of RENAMES) for (const f of e.from) assert.notEqual(ruleKey(f, e.group), ruleKey(e.to, e.group), `${f}: 규칙이 이미 잇는다 — RENAMES 에 둘 필요 없음`);
  for (const e of FAMILIES) {
    const fid = canonicalKey(e.name, e.group);
    for (const m of e.members) {
      const k = canonicalKey(m, e.group);
      assert.notEqual(k, fid, `${m}: 구성 코드가 병합 코드와 같은 sku 면 안 된다 (sku 는 따로, 가족만 하나)`);
      assert.equal(familyOf(k), fid);
    }
  }
  for (const e of DUPLICATES) {
    const a = canonicalKey(e.name, e.group), b = canonicalKey(e.of.name, e.of.group);
    assert.notEqual(a, b, `${e.name}: 중복은 sku 로 합치지 않는다`);
    // 가족도 따로 — hot/ice 규칙 가족(대추차 only hot / hot)만 예외
    if (normalizeSkuName(e.name).variant === '' && normalizeSkuName(e.of.name).variant === '') assert.notEqual(familyOf(a), familyOf(b), `${e.name}: 중복은 가족으로도 합치지 않는다`);
  }
  // 대응표에 이름이 두 번 나오면(한 이름이 두 항목의 from) 어느 쪽으로 갈지 정해지지 않는다
  const froms = RENAMES.flatMap((e) => e.from.map((f) => ruleKey(f, e.group)));
  assert.equal(new Set(froms).size, froms.length, 'RENAMES 의 from 이 겹친다');
  const members = FAMILIES.flatMap((e) => e.members.map((m) => canonicalKey(m, e.group)));
  assert.equal(new Set(members).size, members.length, 'FAMILIES 의 구성 코드가 겹친다');
});

// ── 실제 자료로 반증 ──
function loadReal() {
  const reports = posFiles.map((f) => parseSalesReport(fs.readFileSync(path.join(posDir, f), 'utf8')));
  const sku = buildSeries(reports);
  const fam = buildSeries(reports, { level: 'family' });
  const audit = auditSeries(sku, { ignoreGroups: ['진동벨'] });
  // 원래 (그룹,이름) 별 단가 집합 — 규칙이 합친 이름끼리 단가를 공유하는지 보려면 sku 가 아니라 원래 이름 단위가 필요하다
  const prices = new Map();
  for (const r of reports) for (const x of r.rows) {
    const k = `${x.group}|${x.product}`;
    if (x.price) (prices.get(k) || prices.set(k, new Set()).get(k)).add(x.price);
  }
  // 월중에 가격이 바뀌면 POS 가 그 달 단가를 평균으로 찍는다(앙버터치아바타 2025-04: 7,277 vs 7,400, 아메리카노 2026-01: 5,523).
  // 그래서 정확히 같은 단가가 없어도 3% 안이면 공유로 본다 — 교대 판정은 겹친 달·합계 연속이 따로 지킨다.
  const sharePrice = (group, a, b) => {
    const pa = prices.get(`${group}|${a}`), pb = prices.get(`${group}|${b}`);
    return Boolean(pa && pb && [...pa].some((p) => [...pb].some((q) => Math.abs(p - q) / Math.max(p, q) <= 0.03)));
  };
  return { reports, sku, fam, audit, sharePrice };
}

test('실제 자료: 규칙이 이은 모든 쌍이 교대 서명을 지킨다 — 함께 팔린 달 ≤ 1, 단가 공유, 합계 연속', { skip: skipReal }, () => {
  const { audit, sharePrice } = loadReal();
  // 2025-08~2026-07 에서 규칙이 이은 것으로 확인된 9쌍 — 새 달이 들어와 늘어나는 것은 좋지만, 이 9개가 갈라지거나 사라지면 규칙이 바뀐 것이다
  const known = ['빵|마늘바게트/머쉬룸바게트', '빵|메이플크림치즈', '빵|무화과/밤깜빠뉴', '빵|바질잠봉뵈르', '빵|밤식빵', '빵|앙버터빵/크렌베리쌀빵', '빵|육쪽마늘빵', '빵|인절미브레드', '빵|호밀빵대'];
  const ids = audit.ruleJoined.map((j) => j.id);
  for (const k of known) assert.ok(ids.includes(k), `${k} 가 규칙으로 이어져 있어야 한다`);
  for (const j of audit.ruleJoined) {
    assert.deepEqual(j.warnings, [], `${j.id}: ${j.warnings.join(' / ')}`);
    for (const p of j.pairs) {
      assert.ok(p.overlap.length <= 1, `${j.id}: '${p.from}' 과 '${p.to}' 가 ${p.overlap.length}달 함께 팔림 — 규칙이 별개 코드를 삼켰다. DUPLICATES 로 떼어 둘 것`);
      assert.ok(sharePrice(j.group, p.from, p.to), `${j.id}: '${p.from}' 과 '${p.to}' 의 단가가 다르다`);
      assert.ok(ratioOk(p), `${j.id}: '${p.from}' → '${p.to}' 합계가 이어지지 않는다 (${p.before} → ${p.during} → ${p.after})`);
    }
  }
  // 규칙이 합쳐 버릴 뻔한 중복(토핑휘낭시에)은 '#' 로 갈라져 각자 항목이다
  for (const e of DUPLICATES) {
    const a = canonicalKey(e.name, e.group);
    if (a.includes('#')) assert.ok(audit.duplicates.some((d) => d.id === a), `${e.name}: 떼어 둔 중복이 표에 없다`);
  }
});

test('실제 자료: RENAMES 마다 구이름이 신이름 등장 달에 끝나고(한 달 겹침), 단가를 공유하며, 합계가 이어진다', { skip: skipReal }, () => {
  const { sku, audit, sharePrice } = loadReal();
  assert.equal(audit.renames.length, RENAMES.length);
  for (const e of RENAMES) {
    const it = sku.items[canonicalKey(e.to, e.group)];
    assert.ok(it, `${e.to} 가 자료에 없다`);
    const j = audit.renames.find((x) => x.id === it.id);
    assert.ok(j && j.variants.length === e.from.length + 1, `${e.to}: 원래 이름이 ${e.from.length + 1}개여야 한다`);
    assert.deepEqual(j.warnings, [], `${e.to}: ${j.warnings.join(' / ')}`);
    const to = j.variants.find((v) => v.name === e.to);
    for (const f of e.from) {
      const from = j.variants.find((v) => v.name === f);
      assert.ok(from && to, `${f} → ${e.to}: 둘 다 자료에 있어야 한다`);
      assert.ok(from.last <= to.first, `${f}(~${from.last}) 가 ${e.to}(${to.first}~) 뒤에도 팔렸다 — 교대가 아니다`);
      const p = j.pairs.find((x) => x.from === f && x.to === e.to);
      assert.ok(p, `${f} → ${e.to} 쌍이 표에 없다`);
      assert.ok(p.overlap.length <= 1, `${f} → ${e.to}: ${p.overlap.length}달 함께 팔림`);
      assert.ok(sharePrice(e.group, f, e.to), `${f} → ${e.to}: 단가가 다르다`);
      assert.ok(ratioOk(p), `${f} → ${e.to}: 합계가 이어지지 않는다 (${p.before} → ${p.during} → ${p.after})`);
      assert.match(e.evidence, new RegExp(String(to.first)), `${e.to}: 근거의 달(${to.first})이 자료와 다르다`);
    }
  }
});

test('실제 자료: FAMILIES 마다 구성 코드가 병합 코드 등장 달에 끝나고(mergedInto), 단가를 공유하며, 가족 합계가 이어진다', { skip: skipReal }, () => {
  const { sku, fam, audit, sharePrice } = loadReal();
  for (const e of FAMILIES) {
    const fid = canonicalKey(e.name, e.group);
    const famCode = sku.items[fid];
    const famItem = fam.items[fid];
    assert.ok(famCode && famItem, `${e.name} 가 자료에 없다`);
    const af = audit.families.find((f) => f.family === fid);
    assert.ok(af && af.hasFamilyCode, `${e.name}: 감사 표에 있어야 한다`);
    assert.deepEqual(af.warnings, [], `${e.name}: ${af.warnings.join(' / ')}`);
    assert.match(e.evidence, new RegExp(famCode.first), `${e.name}: 근거의 달(${famCode.first})이 자료와 다르다`);
    for (const m of e.members) {
      const it = sku.items[canonicalKey(m, e.group)];
      assert.ok(it, `${m} 가 자료에 없다`);
      assert.equal(it.mergedInto, fid, `${m}: 병합 코드 등장 전에 끝나야 한다 (${it.first}~${it.last} vs ${famCode.first}~)`);
      const overlap = sku.months.filter((mo) => it.byMonth[mo]?.qty && famCode.byMonth[mo]?.qty);
      assert.ok(overlap.length <= 1, `${m} 과 ${e.name} 가 ${overlap.length}달 함께 팔림`);
      assert.ok(sharePrice(e.group, m, e.name), `${m} 과 ${e.name} 의 단가가 다르다`);
    }
    // 가족 전체의 달 합계가 병합 달을 지나며 이어지는지 (구성 코드 여럿이면 각각이 아니라 가족 합으로 봐야 한다)
    const by = Object.fromEntries(Object.entries(famItem.byMonth).map(([mo, b]) => [mo, b.qty]));
    const c = continuity(fam.months, by, {}, famCode.first);
    assert.ok(ratioOk(c), `${e.name}: 가족 합계가 이어지지 않는다 (${c.before} → ${c.during} → ${c.after})`);
    // 가족 합 = 구성 코드 합 + 병합 코드 (합계 불변이 가족 수준에서도)
    for (const mo of fam.months) {
      const parts = [fid, ...e.members.map((m) => canonicalKey(m, e.group))].reduce((s, k) => s + (sku.items[k]?.byMonth[mo]?.qty || 0), 0);
      assert.equal(famItem.byMonth[mo]?.qty || 0, parts, `${e.name} ${mo}`);
    }
  }
});

test('실제 자료: DUPLICATES 는 실제로 함께 팔렸고 갈라져 있으며, 조사 후보는 이어지지 않고 의심 쌍에 남아 있다', { skip: skipReal }, () => {
  const { sku, audit } = loadReal();
  for (const e of DUPLICATES) {
    const a = sku.items[canonicalKey(e.name, e.group)], b = sku.items[canonicalKey(e.of.name, e.of.group)];
    assert.ok(a && b && a !== b, `${e.name} / ${e.of.name}`);
    const overlap = sku.months.filter((m) => a.byMonth[m]?.qty && b.byMonth[m]?.qty);
    assert.ok(overlap.length >= 1, `${e.name}: 함께 팔린 달이 없다 — 중복이 아니라 교대일 수 있음 (RENAMES 후보)`);
    assert.match(e.evidence, new RegExp(overlap[0]), `${e.name}: 근거의 달이 자료(${overlap.join(',')})와 다르다`);
  }
  // 대응표에 넣지 않은 대응(약어·재료 변경·"팡도르" 추가·슬래시 부분 일치)은 각자 sku·가족으로 남아 있고, 의심 쌍 표에 뜬다
  const separate = [
    ['빵', '블빵', '블루베리빵'], ['빵', '생과일몽블랑', '생과일 몽블랑 팡도르'], ['빵', '마늘 바게트', '마늘바게트/머쉬룸바게트'],
    ['빵', '페퍼소세지빵', '페퍼소세지빵/햄치즈 토스트'], ['빵', '호두쉬폰', '호두쉬폰/ 단호박쉬폰'], ['디저트', '화이트 레몬 마들렌', '레몬마들렌'],
    ['디저트', '계피만쥬', '만주/계피만쥬'], ['빵', '잠봉/리코타 샌드위치', '크림치즈/잠봉 샌드위치'], ['빵', '앙버터빵/크린베리쌀빵', '크린베리쌀빵'],
  ];
  for (const [g, a, b] of separate) {
    const ka = canonicalKey(a, g), kb = canonicalKey(b, g);
    assert.ok(sku.items[ka] && sku.items[kb], `${a} / ${b} 가 자료에 있어야 한다`);
    assert.notEqual(ka, kb, `${a} 와 ${b} 는 잇지 않는다`);
    assert.notEqual(familyOf(ka), familyOf(kb), `${a} 와 ${b} 는 가족으로도 잇지 않는다`);
    // 의심 쌍 표에 뜨거나('블빵'처럼 이름이 너무 짧아 유사도로는 못 잡는 것은) 같은 달의 소멸·등장 표에 나란히 떠야 사람이 본다
    const inSuspects = audit.suspects.some((s) => (s.a.id === ka && s.b.id === kb) || (s.a.id === kb && s.b.id === ka));
    const inUnexplained = audit.unexplained.some((u) => u.ended.some((e) => e.id === ka) && u.started.some((e) => e.id === kb));
    assert.ok(inSuspects || inUnexplained, `${a} / ${b} 가 의심 쌍 표나 소멸·등장 표에 있어야 사람이 본다`);
  }
  // 대응표에 있는 것은 의심 쌍에 다시 뜨지 않는다
  const idx = skuMapIndex();
  for (const s of audit.suspects) assert.ok(idx.family.get(s.a.id) !== idx.family.get(s.b.id) || !idx.family.has(s.a.id), `${s.a.id} / ${s.b.id}: 이미 같은 가족인데 의심 쌍에 있다`);
});
