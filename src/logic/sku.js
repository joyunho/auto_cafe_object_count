// POS 상품명 정합 층 — 이름이 기간 내내 흔들려도(띄어쓰기·오타·슬래시 병합·재등록) 상품 단위 시계열이 끊기지 않게 안정된 id 를 준다.
//
// src/data/pos-map.js(PRODUCT_MAP: POS 상품명 그대로 → 레시피) 위에 얹는 별도 층이다.
// parseSalesReport 의 rows 와 PRODUCT_MAP 은 건드리지 않는다 — 레시피 소비량 계산이 그 이름을 그대로 쓴다.
// 브라우저·Node 공용, 의존성 없음 (match.js 의 levenshtein 만 감사용으로 재활용).
//
//   canonicalKey(product, group) → 'group|id'   규칙(공백·특수문자·hot/ice 표기·오타) + 대응표(RENAMES) + 중복 분리(DUPLICATES)
//   familyOf(key)                → 가족 id      hot/ice/디카페인 변형과 슬래시 병합(FAMILIES)을 한 묶음으로. 없으면 자기 자신
//   buildSeries(reports, {level}) → { months, items }   각 달의 합계(qty·amount·discount)가 원본과 정확히 같다 — 안에서 검사해 다르면 throw
//   auditSeries(series)          → 사람이 확인할 표: 규칙으로 이은 것 · 대응표로 이은 것 · 의심 쌍 · 동시 판매 중복 · 단기 등장
//
// 원칙: 모르는 건 잇지 않는다. 규칙과 대응표에 없는 이름은 정규화한 이름 그대로 id 가 되고, 의심 쌍은 감사 표에만 남는다.
// 수량 0 인 줄(죽은 코드)은 합계에는 넣되 등장 달·첫/마지막 달·동시 판매 판정에서는 뺀다 — 안 빼면 가짜 그룹 이동·가짜 중복이 생긴다.

import { SPELLING, RENAMES, FAMILIES, DUPLICATES, SEPARATE } from '../data/sku-map.js';
import { levenshtein } from './match.js';

// ── 규칙 층 ──────────────────────────────────────────────────────────────────

// 접두 'hot'/'ice'/'ic' 는 뒤에 공백이나 한글이 와야 변형이다 (hotdog 처럼 영문 단어의 일부면 아님). 입력은 소문자·공백 정리 뒤.
const VARIANT_PREFIX = /^(hot|ice|ic)(?=[\s가-힣])/;
// 접미 ' hot'/' ice'/' only hot'. 'only' 는 버리지 않고 변형에 남긴다 — '대추차 only hot' 과 '대추차 hot' 은 사람이 결정할 중복이다
const VARIANT_SUFFIX = /\s(only\s+)?(hot|ice)$/;
// 정규화된 id 이름 앞의 변형 표기. 규칙 층과 같은 조건 — 뒤에 영문이 이어지면(hotdog·icecream) 변형이 아니다
const VARIANT_TAGS = /^(onlyhot|onlyice|hot|ice)(?=[^a-z])/;

/** 이름에서 hot/ice 변형 표기를 떼어 낸다. 입력은 소문자·공백 정리 뒤. → { base, variant: ''|'hot'|'ice'|'onlyhot'|'onlyice' } */
export function parseVariant(name) {
  const s = String(name || '');
  const p = VARIANT_PREFIX.exec(s);
  if (p) return { base: s.slice(p[0].length).trim(), variant: p[1] === 'ic' ? 'ice' : p[1] };
  const q = VARIANT_SUFFIX.exec(s);
  if (q) return { base: s.slice(0, q.index).trim(), variant: (q[1] ? 'only' : '') + q[2] };
  return { base: s, variant: '' };
}

/**
 * 규칙 정규화: 영문 소문자 → 전각 괄호/슬래시/쉼표 → 반각 → SPELLING 오타 교정 → hot/ice 표기 분리 → 공백·괄호·쉼표·마침표·가운뎃점 제거.
 * 슬래시는 남긴다(병합 SKU 의 구조). 접미 '빵' 탈락이나 약어는 규칙으로 만들지 않는다 — 다른 상품을 합친다.
 * @returns {{ base: string, variant: string, key: string }}  key = variant + base  (예: 'hot대추차', '밤식빵', 'onlyhot대추차')
 */
export function normalizeSkuName(product) {
  let s = String(product || '').trim().replace(/\s+/g, ' ').toLowerCase();
  s = s.replace(/（/g, '(').replace(/）/g, ')').replace(/／/g, '/').replace(/，/g, ',');
  for (const [from, to] of SPELLING) s = s.split(from).join(to);
  const { base, variant } = parseVariant(s);
  const compact = base.replace(/\s+/g, '').replace(/[()[\]{}<>,.·]/g, '').replace(/^\/+|\/+$/g, '');
  return { base: compact, variant, key: variant + compact };
}

const normGroup = (g) => String(g || '').trim().replace(/\s+/g, ' ');
const joinKey = (group, name) => (group ? `${group}|${name}` : name);

/** 'group|name' → { group, name }. 그룹 없는 id 는 이름만 */
export function splitKey(key) {
  const i = String(key).indexOf('|');
  return i < 0 ? { group: '', name: String(key) } : { group: key.slice(0, i), name: key.slice(i + 1) };
}

/** 규칙 층만 거친 id (대응표 적용 전). 감사에서 "규칙으로 이은 것"과 "대응표로 이은 것"을 가르는 데 쓴다 */
export function ruleKey(product, group) {
  return joinKey(normGroup(group), normalizeSkuName(product).key);
}

// 대응표의 중복 항목은 원래 표기로 찾는다 — 규칙이 같은 키로 합쳐 버리는 두 이름(토핑휘낭시에/토핑 휘낭시에)을 가르려면 원래 이름이 필요하다
const rawKey = (product, group) => joinKey(normGroup(group), String(product || '').trim().replace(/\s+/g, ' '));

// ── 대응표 층 ─────────────────────────────────────────────────────────────────

let INDEX = null;

function resolveRename(idx, key) {
  let k = key;
  const seen = new Set();
  while (idx.rename.has(k) && !seen.has(k)) { // 연쇄(A→B→C)는 끝까지, 고리는 끊는다
    seen.add(k);
    k = idx.rename.get(k).to;
  }
  return k;
}

function canonWith(idx, product, group) {
  const sep = idx.separate.get(rawKey(product, group));
  if (sep) return sep.id; // 같은 상품이라는 보장이 없어 떼어 둔 코드 — 규칙보다 먼저
  const d = idx.dupByRaw.get(rawKey(product, group));
  if (d && d.separated) return d.id;
  return resolveRename(idx, ruleKey(product, group));
}

function buildIndex() {
  const idx = { rename: new Map(), dupByRaw: new Map(), dupById: new Map(), separate: new Map(), family: new Map(), familyEntry: new Map() };
  for (const e of SEPARATE) {
    // 규칙이 합쳐 버리는 이름을 '#원래표기' 로 떼어 자기 자신으로 둔다 (DUPLICATES 와 같은 표기, 다만 상대(duplicateOf)는 없다)
    const rk = ruleKey(e.name, e.group);
    idx.separate.set(rawKey(e.name, e.group), { entry: e, id: `${rk}#${String(e.name).trim().replace(/\s+/g, '_')}` });
  }
  for (const e of RENAMES) {
    const to = ruleKey(e.to, e.group);
    for (const f of e.from) idx.rename.set(ruleKey(f, e.group), { to, entry: e });
  }
  for (const e of DUPLICATES) {
    const rk = ruleKey(e.name, e.group);
    const ofKey = resolveRename(idx, ruleKey(e.of.name, e.of.group));
    // 규칙이 둘을 같은 id 로 합쳐 버리면 '#원래표기' 를 붙여 떼어 둔다 — 사람이 결정할 때까지
    const separated = resolveRename(idx, rk) === ofKey;
    const id = separated ? `${rk}#${e.label || String(e.name).trim().replace(/\s+/g, '_')}` : resolveRename(idx, rk);
    const rec = { entry: e, ofKey, separated, id };
    idx.dupByRaw.set(rawKey(e.name, e.group), rec);
    idx.dupById.set(id, rec);
  }
  for (const e of FAMILIES) {
    const fid = canonWith(idx, e.name, e.group);
    idx.familyEntry.set(fid, e);
    idx.family.set(fid, fid);
    for (const m of e.members) idx.family.set(canonWith(idx, m, e.group), fid);
  }
  return idx;
}

function getIndex() {
  return INDEX || (INDEX = buildIndex());
}

/** 테스트용: 대응표 색인을 다시 만든다 (모듈을 다시 불러오지 않고) */
export function resetSkuIndex() {
  INDEX = null;
}

/**
 * 안정된 상품 id. 'group|이름' 꼴 (그룹이 없으면 이름만).
 * 규칙 → RENAMES(연쇄 추적) → DUPLICATES(규칙이 합쳐 버리는 중복 코드는 '#원래표기' 를 붙여 분리).
 * 같은 이름이 두 그룹에 있으면 별개 sku 다 (12개월 안에 실제 그룹 이동은 없었고, 그룹 간 같은 이름은 옵션·중복뿐).
 */
export function canonicalKey(product, group) {
  return canonWith(getIndex(), product, group);
}

/**
 * 가족 id. FAMILIES 에 있으면 그것. 아니면 hot/ice/onlyhot 접두를 떼고, 그 뒤에 남은 '디카페인' 도 뗀 이름 (아메리카노 가족 = hot+ice+디카페인).
 * '디카페인' 은 hot/ice 변형 뒤에 붙었을 때만 변형으로 본다 — '디카페인콜드브루'(변형 접두 없음)·옵션 '디카페인' 은 자기 자신.
 * 떼어 낼 게 없으면 자기 자신. 떼어 둔 중복 코드('#')는 사람이 FAMILIES 에 넣기 전엔 자기 자신.
 */
export function familyOf(key) {
  const idx = getIndex();
  const k = String(key);
  if (idx.family.has(k)) return idx.family.get(k);
  if (k.includes('#')) return k;
  const { group, name } = splitKey(k);
  let base = name.replace(VARIANT_TAGS, '');
  if (base === name) return k;
  if (base.startsWith('디카페인') && base.length > '디카페인'.length) base = base.slice('디카페인'.length);
  const fid = joinKey(group, base);
  return idx.family.get(fid) || fid;
}

/** 대응표 색인 조회 (감사·보고서용, 읽기 전용으로 쓸 것) */
export function skuMapIndex() {
  return getIndex();
}

// ── 시계열 ───────────────────────────────────────────────────────────────────

const TOTAL_FIELDS = ['qty', 'amount', 'discount'];
/** 보고서를 달 순서로 (period 가 없는 것은 앞에, 원래 순서 유지). buildSeries·reportTotals 가 같은 순서를 써야 period 없는 보고서의 임시 달 이름(m1, m2 …)이 서로 맞는다 */
const sortReports = (reports) => [...reports].sort((a, b) => String(a.period?.month || '').localeCompare(String(b.period?.month || '')));
const monthOf = (rep, i) => rep.period?.month || `m${i + 1}`;
const zeroTotal = () => ({ qty: 0, amount: 0, discount: 0 });
/**
 * 행의 숫자 필드. 없으면 0, 숫자 문자열('1,234')은 숫자로, 그 밖의 NaN·문자열은 throw —
 * '5' + '5' = '55' 처럼 문자열이 이어 붙거나 NaN 이 0 으로 새면 합계가 조용히 틀리는데 검사(양쪽 다 같은 식으로 틀림)로는 못 잡는다.
 */
function numField(r, f) {
  const v = r[f];
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`숫자가 아닌 ${f}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)} (${r.group || ''}|${r.product ?? ''})`);
  return n;
}
const addTo = (t, r) => { for (const f of TOTAL_FIELDS) t[f] += numField(r, f); };
// 원 단위까지 정확히 같아야 한다 — 파서가 주는 값은 모두 정수라 오차 허용이 필요 없다 (없는 달은 0)
const sameTotal = (a, b) => TOTAL_FIELDS.every((f) => (a?.[f] ?? 0) === (b?.[f] ?? 0));

/**
 * 여러 달 보고서 → 상품(sku) 또는 가족(family) × 월 시계열.
 * 행 하나가 정확히 하나의 항목으로 가므로 각 달의 qty·amount·discount 합은 원본 rows 의 합과 같다 — check 가 켜져 있으면(기본) 안에서 확인하고 다르면 throw.
 *
 * 같은 기간(period.from~to)의 보고서가 두 번 들어오면 throw 한다 — 같은 파일이 두 번 읽히면(3월.txt + 3월_2026.txt) 그 달의 모든 값이 두 배가 되는데,
 * 합계 검사는 원본도 두 배라 못 잡는다. 한 달을 나눈 두 조각(1~15일, 16~31일)은 기간이 다르므로 허용한다.
 *
 * @param {{period, rows}[]} reports parseSalesReport 결과들 (건드리지 않는다)
 * @param {{ level?: 'sku'|'family', check?: boolean }} [opts]
 * @returns {{ level, months: string[], items: Record<string, {
 *   id, name, group, family, byMonth: Record<string, {qty, amount, discount, rows, prices:number[]}>, total: {qty, amount, discount},
 *   variants: string[], variantByMonth: Record<string, Record<string, number>>, skus: string[], prices: number[],
 *   first, last, monthsPresent, activeMonths: string[], mergedInto?, splitFrom?, duplicateOf?, notes: string[] }> }}
 *   first/last/monthsPresent/activeMonths 는 수량이 0 이 아닌 달 기준. name 은 가장 최근 달의 원래 이름(가족은 대응표 이름).
 */
export function buildSeries(reports, { level = 'sku', check = true } = {}) {
  if (level !== 'sku' && level !== 'family') throw new Error(`level 은 'sku' 또는 'family' 여야 한다: ${level}`);
  const idx = getIndex();
  const sorted = sortReports(reports);
  const seenPeriod = new Map();
  for (const rep of sorted) {
    if (!rep.period?.from || !rep.period?.to) continue;
    const p = `${rep.period.from}~${rep.period.to}`;
    if (seenPeriod.has(p)) throw new Error(`같은 기간의 보고서가 두 번 들어왔다 (${p}) — 같은 파일이 두 번 읽히면 그 달 값이 두 배가 된다`);
    seenPeriod.set(p, rep);
  }
  const months = [];
  const items = {};
  const expected = {};
  sorted.forEach((rep, i) => {
    const month = monthOf(rep, i);
    if (!months.includes(month)) months.push(month);
    const ex = (expected[month] ||= zeroTotal());
    for (const r of rep.rows) {
      addTo(ex, r);
      const qty = numField(r, 'qty'); // 문자열 '0' 이 활성 달로 새지 않게 같은 숫자 경로로
      const sku = canonicalKey(r.product, r.group);
      const fam = familyOf(sku);
      const id = level === 'family' ? fam : sku;
      const it = (items[id] ||= { id, name: '', group: normGroup(r.group), family: fam, byMonth: {}, total: zeroTotal(), variants: [], variantByMonth: {}, skus: [], prices: [], notes: [], _nameMonth: '' });
      const bm = (it.byMonth[month] ||= { ...zeroTotal(), rows: 0, prices: [] });
      addTo(bm, r);
      addTo(it.total, r);
      bm.rows += 1;
      if (r.price != null && !bm.prices.includes(r.price)) bm.prices.push(r.price);
      if (!it.variants.includes(r.product)) it.variants.push(r.product);
      const vm = (it.variantByMonth[r.product] ||= {});
      vm[month] = (vm[month] || 0) + qty;
      if (!it.skus.includes(sku)) it.skus.push(sku);
      if (r.price && !it.prices.includes(r.price)) it.prices.push(r.price);
      // 가장 최근 달의 이름 — 수량 0 인 죽은 코드 줄보다 실제 팔린 줄의 이름을 우선한다
      if (qty !== 0 && month >= it._nameMonth) { it._nameMonth = month; it.name = r.product; }
      if (!it.name) it.name = r.product;
    }
  });
  months.sort();
  for (const it of Object.values(items)) {
    const all = Object.keys(it.byMonth).sort();
    const active = all.filter((m) => it.byMonth[m].qty !== 0);
    it.activeMonths = active;
    it.first = active[0];
    it.last = active[active.length - 1];
    it.monthsPresent = active.length;
    delete it._nameMonth;
    if (!active.length) it.notes.push(`수량 0 인 줄만 있음 (${all.join(', ')}) — 죽은 코드`);
    if (level === 'family') {
      const fe = idx.familyEntry.get(it.id);
      if (fe) it.name = fe.name;
      else if (it.skus.length > 1) it.name = splitKey(it.id).name;
      continue;
    }
    for (const m of all) {
      const b = it.byMonth[m];
      if (b.rows > 1) it.notes.push(`${m}: 같은 이름 코드 ${b.rows}개${b.prices.length > 1 ? ` (단가 ${b.prices.join('/')})` : ''}`);
    }
    let renamed = false;
    for (const v of it.variants) {
      const rn = idx.rename.get(ruleKey(v, it.group));
      if (rn) { renamed = true; it.notes.push(`대응표: ${v} → ${rn.entry.to} (${rn.entry.evidence})`); }
    }
    if (it.variants.length > 1 && !renamed) it.notes.push(`규칙으로 이음: ${it.variants.join(' = ')}`);
    const d = idx.dupById.get(it.id) || it.variants.map((v) => idx.dupByRaw.get(rawKey(v, it.group))).find(Boolean);
    if (d) { it.duplicateOf = d.ofKey; it.notes.push(`동시 판매 중복 → ${d.ofKey} (${d.entry.evidence})`); }
    const sep = it.variants.map((v) => idx.separate.get(rawKey(v, it.group))).find(Boolean);
    if (sep) it.notes.push(`떼어 둠: 규칙은 '${sep.entry.sameAs}' 와 합치지만 같은 상품인지 알 수 없다 (${sep.entry.evidence})`);
  }
  if (level === 'sku') {
    // 병합 가족(FAMILIES kind 'merge'): 구성 코드가 병합 코드 등장 전에 끝났으면 mergedInto, 병합 코드가 끝난 뒤 나왔으면 splitFrom
    for (const it of Object.values(items)) {
      const fe = idx.familyEntry.get(it.family);
      if (!fe || fe.kind !== 'merge' || it.family === it.id) continue;
      const famItem = items[it.family];
      if (!famItem) { it.notes.push(`가족(병합) 코드 ${it.family} 는 자료에 없음`); continue; }
      if (!it.monthsPresent || !famItem.monthsPresent) continue;
      if (it.last <= famItem.first) it.mergedInto = it.family;
      else if (it.first >= famItem.last) it.splitFrom = it.family;
      else it.notes.push(`가족(병합) 코드 ${it.family} 와 여러 달 겹침 — 병합이 아닐 수 있음`);
    }
  }
  const series = { level, months, items };
  if (check) assertTotals(expected, series);
  return series;
}

/** 각 달 합계 — 시계열 쪽 */
export function monthTotals(series) {
  const out = {};
  for (const it of Object.values(series.items)) for (const [m, b] of Object.entries(it.byMonth)) addTo((out[m] ||= zeroTotal()), b);
  return out;
}

/** 각 달 합계 — 원본 보고서 쪽 (buildSeries 와 같은 달 순서로 세어 period 없는 보고서의 임시 달 이름도 맞는다) */
export function reportTotals(reports) {
  const out = {};
  sortReports(reports).forEach((rep, i) => { const t = (out[monthOf(rep, i)] ||= zeroTotal()); for (const r of rep.rows) addTo(t, r); });
  return out;
}

function assertTotals(expected, series) {
  const got = monthTotals(series);
  const months = new Set([...Object.keys(expected), ...Object.keys(got)]);
  for (const m of months) {
    if (!sameTotal(expected[m], got[m])) {
      throw new Error(`합계 불변 위반 (${series.level} ${m}): 원본 ${JSON.stringify(expected[m])} ≠ 시계열 ${JSON.stringify(got[m])}`);
    }
  }
}

/** 원본 보고서와 시계열의 각 달 합계가 같은지 확인한다. 다르면 throw (buildSeries 가 기본으로 부른다) */
export function checkTotals(reports, series) {
  assertTotals(reportTotals(reports), series);
  return true;
}

// ── 감사 (사람이 확인할 표) ──────────────────────────────────────────────────

const prevMonth = (months, m) => months[months.indexOf(m) - 1];
const nextMonth = (months, m) => months[months.indexOf(m) + 1];
const qtyBy = (it) => Object.fromEntries(Object.entries(it.byMonth).map(([m, b]) => [m, b.qty]));

/**
 * 교대 서명의 합계 연속 허용 폭 — 겹친 달의 두 코드 합 ÷ 전후 달 평균.
 * 다른 두 상품을 하나로 합쳤으면 그 달만 2 근처로 튀고, 한쪽이 그 달에 실제로는 안 팔렸으면 0.5 아래로 떨어진다.
 * 하한 0.4 는 대응표에서 가장 약한 '말차스콘/크렌베리스콘'(겹친 달만 저조)을 통과시키되 그보다 나쁜 것은 경고한다. 감사와 테스트(tests/sku-map.test.js)가 같은 값을 쓴다.
 */
export const CONTINUITY_BOUNDS = { min: 0.4, max: 1.8 };
// 전달·다음 달이 모두 있을 때만 판단한다 — 한쪽이 없으면(한 달짜리 코드) 비율이 의미가 없어 경고 대신 ※(caveat)로 낸다
const continuityWarning = (c) => (c.before != null && c.after != null && c.ratio != null && (c.ratio < CONTINUITY_BOUNDS.min || c.ratio > CONTINUITY_BOUNDS.max) ? `×${c.ratio.toFixed(2)}` : '');

/** 두 이름 시계열 A→B 의 교대 달 M 에서 합계가 이어지는지: 전달 A, 겹친 달 A+B, 다음 달 B (교대라면 셋이 비슷해야 한다) */
export function continuity(months, aBy, bBy, m) {
  const before = aBy[prevMonth(months, m)] ?? null;
  const during = (aBy[m] || 0) + (bBy[m] || 0);
  const after = bBy[nextMonth(months, m)] ?? aBy[nextMonth(months, m)] ?? null; // 오타 코드가 한 달 끼어든 경우엔 구코드가 이어진다
  const ref = before != null && after != null ? (before + after) / 2 : before ?? after;
  const ratio = ref ? during / ref : null;
  return { month: m, before, during, after, ratio };
}

/** 두 sku 항목의 관계 요약 — 감사 스크립트의 조사 후보 표에서 쓴다 */
export function pairStatus(series, a, b) {
  const { months } = series;
  const overlap = months.filter((m) => a.byMonth[m]?.qty && b.byMonth[m]?.qty);
  const m = b.first && a.last ? (b.first >= a.first ? b.first : a.first) : null;
  const c = m ? continuity(months, qtyBy(a), qtyBy(b), m) : { month: null, before: null, during: null, after: null, ratio: null };
  const samePrice = a.prices.some((p) => b.prices.includes(p));
  return { overlap, samePrice, sameFamily: a.family === b.family, ...c };
}

/** 비교용 문자열: id 의 이름 부분에서 변형 접두와 슬래시를 뺀 것 */
const bareName = (it) => splitKey(it.id).name.replace(VARIANT_TAGS, '').replace(/\//g, '');
/** 편집거리 유사도 (match.similarity 는 포함 관계에 0.8+ 를 줘서 '식빵'⊂'밤식빵' 이 0.93 이 된다 — 자동 연결 근거로 쓰면 안 된다) */
const editSimilarity = (a, b) => (a && b ? Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length)) : 0);
/** 원래 이름을 공백·슬래시·쉼표·괄호로 나눈 토큰(2자 이상)의 자카드 겹침 — '잠봉/리코타 샌드위치' vs '크림치즈/잠봉 샌드위치' */
function tokenOverlap(a, b) {
  const tok = (s) => new Set(String(s).toLowerCase().split(/[\s/,()]+/).filter((t) => t.length >= 2));
  const ta = tok(a), tb = tok(b);
  if (!ta.size || !tb.size) return 0;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  return both / (ta.size + tb.size - both);
}
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * sku 수준 시계열을 훑어 사람이 확인할 표를 만든다. 아무것도 잇지 않는다 — 후보만 낸다.
 * @param {ReturnType<typeof buildSeries>} series level 'sku'
 * @param {{ ignoreNames?: string[], ignoreGroups?: string[], minSimilarity?: number }} [opts]
 *   ignoreNames: 옵션(연하게·Take out …)처럼 그룹마다 등록되는 이름 — 의심 쌍·중복·단기 표에서 뺀다
 *   ignoreGroups: 상품이 아닌 그룹(진동벨: 호출 번호·결제 수단·정식) — 의심 쌍·중복·단기 표에서 뺀다
 *   minSimilarity: 교대 후보의 편집거리 유사도 문턱. 0.5 면 '생크림케이크→엔젤케이크' 같은 잡음이 든다 (짧은 한글 이름의 편집거리 2~3은 무의미)
 */
export function auditSeries(series, { ignoreNames = [], ignoreGroups = [], minSimilarity = 0.6 } = {}) {
  if (series.level !== 'sku') throw new Error("auditSeries 는 level:'sku' 시계열을 받는다");
  const idx = getIndex();
  const { months } = series;
  const lastMonth = months[months.length - 1];
  const all = Object.values(series.items);
  const ignore = new Set(ignoreNames.map((n) => normalizeSkuName(n).key));
  const skipGroup = new Set(ignoreGroups.map(normGroup));
  const nameOf = (it) => splitKey(it.id).name;
  const skip = (it) => skipGroup.has(it.group) || ignore.has(nameOf(it));
  const list = all.filter((it) => !skip(it) && it.monthsPresent > 0); // 의심 쌍·중복·단기 표용 (죽은 코드는 따로)
  const activeIn = (it, m) => Boolean(it.byMonth[m]?.qty);
  const coActive = (a, b) => months.filter((m) => activeIn(a, m) && activeIn(b, m));

  // 재등록 서명: 같은 달에 같은 (그룹,이름)이 두 줄 이상 — 그룹코드가 다시 등록됐거나(2026-03 빵) 이름 앞 공백이 붙은 별도 코드(2026-07 베이컨크림치즈)
  const multiRow = [];
  for (const it of all) for (const m of months) {
    const b = it.byMonth[m];
    if (b && b.rows > 1) multiRow.push({ month: m, id: it.id, group: it.group, rows: b.rows, prices: b.prices });
  }
  const reregistration = [];
  for (const m of months) {
    const byGroup = {};
    for (const r of multiRow) if (r.month === m) (byGroup[r.group] ||= []).push(r.id);
    for (const [group, ids] of Object.entries(byGroup)) if (ids.length >= 3) reregistration.push({ month: m, group, count: ids.length, ids });
  }

  // (1)(2) 한 sku 에 원래 이름이 둘 이상: 규칙으로 이은 것 / 대응표(RENAMES)로 이은 것. 두 이름이 같은 달에 함께 팔렸으면 경고
  const variantRows = (it) => it.variants
    .map((name) => { const by = it.variantByMonth[name]; const ms = Object.keys(by).filter((m) => by[m] !== 0).sort(); return { name, byMonth: by, first: ms[0], last: ms[ms.length - 1] }; })
    .sort((a, b) => String(a.first).localeCompare(String(b.first)) || String(a.last).localeCompare(String(b.last)));
  const joined = (it) => {
    const vs = variantRows(it);
    const pairs = [];
    for (let i = 1; i < vs.length; i++) {
      const a = vs[i - 1], b = vs[i];
      const overlap = months.filter((m) => a.byMonth[m] && b.byMonth[m]);
      pairs.push({ from: a.name, to: b.name, overlap, ...continuity(months, a.byMonth, b.byMonth, b.first || a.last) });
    }
    // warnings = 교대 서명 위반(두 달 이상 함께 팔림·합계가 튐) → 다른 상품을 합쳤을 수 있다. caveats = 판단할 근거가 부족한 것(한 달짜리 코드라 전후 달이 없음)
    const warnings = [];
    const caveats = [];
    for (const p of pairs) {
      if (p.overlap.length >= 2) warnings.push(`'${p.from}' 과 '${p.to}' 가 ${p.overlap.length}달 함께 팔림 — 교대가 아니라 동시 판매일 수 있음`);
      const bad = continuityWarning(p);
      if (bad) warnings.push(`'${p.from}' → '${p.to}' 합계가 이어지지 않음 (${bad}) — 다른 상품을 합쳤거나 한쪽이 그 달에 안 팔림`);
      if (p.before == null) caveats.push(`'${p.from}' 은 겹친 달 전에 팔린 달이 없음 — 합계 연속을 볼 수 없다`);
      else if (p.after == null) caveats.push(`'${p.to}' 는 겹친 달 뒤에 팔린 달이 없음 — 합계 연속을 볼 수 없다`);
    }
    return { id: it.id, group: it.group, name: it.name, family: it.family, variants: vs, pairs, notes: it.notes, duplicateOf: it.duplicateOf, warnings, caveats };
  };
  const ruleJoined = [];
  const renames = [];
  for (const it of all) {
    if (it.variants.length < 2) continue;
    const viaMap = it.variants.some((v) => idx.rename.has(ruleKey(v, it.group)));
    (viaMap ? renames : ruleJoined).push(joined(it));
  }

  // (2b) 대응표 가족: 구성 코드들의 기간과 mergedInto/splitFrom. 근거와 어긋나면(구성 코드가 병합 코드와 여러 달 겹침) 경고
  const families = [];
  for (const [fid, entry] of idx.familyEntry) {
    const members = all.filter((it) => it.family === fid).map((it) => ({ id: it.id, name: it.name, first: it.first, last: it.last, byMonth: qtyBy(it), mergedInto: it.mergedInto, splitFrom: it.splitFrom, isFamilyCode: it.id === fid }));
    const famItem = series.items[fid];
    const warnings = [];
    if (!famItem) warnings.push('가족 코드가 자료에 없음');
    for (const m of members) if (!m.isFamilyCode && !m.mergedInto && !m.splitFrom && famItem) warnings.push(`${m.name}: 병합 코드와 여러 달 겹침`);
    const expectedMembers = entry.members.map((n) => canonicalKey(n, entry.group));
    for (const [i, k] of expectedMembers.entries()) if (!series.items[k]) warnings.push(`구성 코드 '${entry.members[i]}' 가 자료에 없음`);
    // 가족 합계 연속: 구성 코드 전부 + 병합 코드의 달 합이 병합 코드 등장 달을 지나며 이어지는지 (구성 코드가 여럿이면 각각이 아니라 가족 합으로 봐야 한다)
    const famBy = {};
    for (const m of members) for (const [mo, q] of Object.entries(m.byMonth)) famBy[mo] = (famBy[mo] || 0) + q;
    const cont = famItem?.first ? continuity(months, famBy, {}, famItem.first) : { month: null, before: null, during: null, after: null, ratio: null };
    const bad = continuityWarning(cont);
    if (bad) warnings.push(`가족 합계가 병합 달을 지나며 이어지지 않음 (${bad}) — 구성 코드가 이 가족이 아닐 수 있음`);
    families.push({ family: fid, name: entry.name, group: entry.group, kind: entry.kind, evidence: entry.evidence, hasFamilyCode: Boolean(famItem), members: members.sort((a, b) => String(a.first).localeCompare(String(b.first))), continuity: cont, warnings });
  }

  // (3) 의심 쌍 — 잇지 않는다. 같은 그룹에서 이름이 비슷한데 id 가 다른 것
  const related = (a, b) => a.family === b.family || a.duplicateOf === b.id || b.duplicateOf === a.id;
  const contains = (x, y) => x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
  const seenPair = new Map();
  const suspects = [];
  // 같은 쌍이 여러 근거(교대·슬래시·편집거리)로 잡히면 한 줄에 근거를 모은다
  const push = (kind, a, b, why, c, flags) => {
    const pk = JSON.stringify([a.id, b.id]); // id 에 '|'·'#' 이 들어가므로 이어 붙이지 않고 JSON 으로 (원시 NUL 구분자는 파일을 바이너리로 만든다)
    const prev = seenPair.get(pk);
    if (prev) {
      if (!prev.kind.includes(kind)) prev.kind += `·${kind}`;
      for (const w of why) if (!prev.why.includes(w)) prev.why.push(w);
      for (const f of flags) if (!prev.flags.includes(f)) prev.flags.push(f);
      return;
    }
    const s = { kind, a: { id: a.id, name: a.name, first: a.first, last: a.last }, b: { id: b.id, name: b.name, first: b.first, last: b.last }, why: [...why], ...c, flags: [...flags] };
    seenPair.set(pk, s);
    suspects.push(s);
  };
  const priceFlag = (a, b) => (a.prices.length && b.prices.length && !a.prices.some((p) => b.prices.includes(p)) ? ['단가 다름'] : []);
  // (3a) 교대 후보: A 가 M 에 끝나고 B 가 M(한 달 겹침) 또는 M+1(인접)에 시작. 두 달 이상 겹치면 교대가 아니다
  for (const a of list) for (const b of list) {
    if (a === b || a.group !== b.group || related(a, b) || b.first <= a.first) continue;
    const gap = months.indexOf(b.first) - months.indexOf(a.last);
    if (gap < 0 || gap > 1) continue;
    const aBy = qtyBy(a), bBy = qtyBy(b);
    // 마지막 달에 끝난 것은 아직 끝났는지 모른다 — 그 달에 급감(전달의 40% 미만)한 것만 후보로
    if (a.last === lastMonth && !(a.monthsPresent > 1 && aBy[lastMonth] < 0.4 * (aBy[prevMonth(months, lastMonth)] || 0))) continue;
    const na = bareName(a), nb = bareName(b);
    const sim = editSimilarity(na, nb);
    const why = [];
    if (sim >= minSimilarity) why.push(`편집거리 유사도 ${sim.toFixed(2)}`);
    if (contains(na, nb)) why.push('이름 포함');
    const tok = tokenOverlap(a.name, b.name);
    if (tok >= 0.4) why.push(`토큰 겹침 ${tok.toFixed(2)}`);
    const pre = commonPrefix(na, nb);
    if (pre >= 3 && pre >= Math.min(na.length, nb.length) * 0.4) why.push(`앞 ${pre}자 같음`);
    if (!why.length) continue;
    const flags = [...priceFlag(a, b)];
    if (a.last === lastMonth) flags.push('마지막 달 — 다음 자료로 확인');
    if (gap === 1) flags.push('한 달 비고 등장');
    if (a.monthsPresent <= 1 || b.monthsPresent <= 1) flags.push('한쪽이 한 달만');
    push('교대', a, b, why, continuity(months, aBy, bBy, b.first), flags);
  }
  // (3b) 슬래시 병합 후보: 병합 이름을 '/' 로 나눈 부분이 같은 그룹의 단독 코드 이름과 정확히 같은 것 (부분 문자열 포함은 근거가 아니다)
  const standalone = new Map();
  for (const it of list) if (!nameOf(it).includes('/')) standalone.set(it.id, it);
  for (const merged of list) {
    const name = nameOf(merged);
    if (!name.includes('/')) continue;
    for (const part of name.split('/').filter(Boolean)) {
      const single = standalone.get(joinKey(merged.group, part));
      if (!single || related(single, merged)) continue;
      // 단독 코드가 먼저면 병합(단독 → 병합 코드 등장 달), 병합 코드가 먼저면 분리(병합 → 단독 코드 등장 달)
      const isSplit = single.first > merged.first;
      const [a, b] = isSplit ? [merged, single] : [single, merged];
      const c = continuity(months, qtyBy(a), qtyBy(b), b.first);
      const ov = coActive(single, merged);
      const flags = [...priceFlag(single, merged)];
      if (ov.length >= 2) flags.push(`${ov.length}달 함께 팔림`);
      if (isSplit) flags.push('단독 코드가 병합 코드보다 늦게 등장 (분리?)');
      push(isSplit ? '슬래시 분리' : '슬래시 병합', a, b, [`병합 이름의 부분 '${part}' 과 정확히 일치`], c, flags);
    }
  }
  // (3c) 편집거리 1: 새 오타 후보. 짧은 이름(4자 미만)은 잡음이라 뺀다. 같은 달에 함께 팔렸으면 별개 상품일 가능성
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.group !== b.group || related(a, b)) continue;
    const na = bareName(a), nb = bareName(b);
    if (na.length < 4 || nb.length < 4 || levenshtein(na, nb) !== 1) continue;
    const [x, y] = a.first <= b.first ? [a, b] : [b, a];
    const ov = coActive(x, y);
    const flags = [...priceFlag(x, y)];
    if (ov.length) flags.push(`${ov.length}달 함께 팔림 — 별개일 가능성`);
    push('편집거리 1', x, y, ['편집거리 1'], continuity(months, qtyBy(x), qtyBy(y), y.first), flags);
  }
  suspects.sort((x, y) => String(x.month).localeCompare(String(y.month)) || x.a.id.localeCompare(y.a.id));

  // (3d) 짝을 못 찾은 소멸·등장: 그 달에 끝난 코드와 시작한 코드를 나란히 — 이름이 전혀 달라도 사람 눈에는 보이는 교대가 있다
  const explained = new Set();
  for (const s of suspects) { explained.add(s.a.id); explained.add(s.b.id); }
  for (const it of list) {
    if (it.mergedInto || it.splitFrom || it.duplicateOf || it.variants.length > 1) explained.add(it.id);
    if (it.mergedInto) explained.add(it.mergedInto); // 병합 코드의 등장은 구성 코드의 소멸로 설명된다
    if (it.splitFrom) explained.add(it.splitFrom);
    if (it.duplicateOf) explained.add(it.duplicateOf);
  }
  const unexplained = [];
  for (const m of months) {
    const ended = list.filter((it) => it.last === m && m !== lastMonth && !explained.has(it.id) && it.monthsPresent > 1).map((it) => ({ id: it.id, qty: it.byMonth[m].qty }));
    const started = list.filter((it) => it.first === m && m !== months[0] && !explained.has(it.id) && (it.monthsPresent > 1 || m === lastMonth)).map((it) => ({ id: it.id, qty: it.byMonth[m].qty }));
    if (ended.length || started.length) unexplained.push({ month: m, ended, started });
  }

  // (4) 동시 판매 중복: 대응표(DUPLICATES) + 자동(같은 이름이 다른 그룹에서 함께 팔림)
  const duplicates = [];
  for (const it of list) if (it.duplicateOf) {
    const of = series.items[it.duplicateOf];
    const rec = idx.dupById.get(it.id) || it.variants.map((v) => idx.dupByRaw.get(rawKey(v, it.group))).find(Boolean);
    duplicates.push({ id: it.id, name: it.name, of: it.duplicateOf, ofName: of?.name, overlap: of ? coActive(it, of) : [], source: '대응표', evidence: rec?.entry.evidence, warning: of ? '' : '중복 대상이 자료에 없음' });
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.group === b.group || a.duplicateOf || b.duplicateOf || related(a, b) || nameOf(a) !== nameOf(b)) continue;
    const ov = coActive(a, b);
    if (!ov.length) continue;
    const [x, y] = a.first <= b.first ? [b, a] : [a, b]; // 나중에 생긴 코드를 중복으로
    duplicates.push({ id: x.id, name: x.name, of: y.id, ofName: y.name, overlap: ov, source: '자동', evidence: '같은 이름이 다른 그룹에서 함께 팔림', warning: '' });
  }

  // (5) 단기 등장 (3개월 이하): 잇지 않는다. 자료 경계에 걸친 것은 표시만
  const shortLived = list.filter((it) => it.monthsPresent <= 3).map((it) => ({
    id: it.id, name: it.name, group: it.group, months: Object.fromEntries(it.activeMonths.map((m) => [m, it.byMonth[m].qty])), total: it.total.qty,
    edge: it.first === months[0] ? '자료 시작 전부터' : it.last === lastMonth ? '진행 중' : '',
  })).sort((a, b) => a.group.localeCompare(b.group) || Object.keys(a.months)[0].localeCompare(Object.keys(b.months)[0]));

  // 죽은 코드: 수량 0 인 줄만 있는 것 (등장으로 세지 않는다)
  const dead = all.filter((it) => !skip(it) && !it.monthsPresent).map((it) => ({ id: it.id, months: Object.keys(it.byMonth).sort() }));

  const rawNames = new Set();
  for (const it of all) for (const v of it.variants) rawNames.add(rawKey(v, it.group));
  return {
    months,
    counts: { rawNames: rawNames.size, skus: all.length, allMonths: all.filter((it) => it.monthsPresent === months.length).length, shortLived: shortLived.length, dead: dead.length },
    reregistration, multiRow, ruleJoined, renames, families, suspects, unexplained, duplicates, shortLived, dead,
  };
}
