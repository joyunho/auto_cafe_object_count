// POS "그룹별 매출분석" 보고서 텍스트 → 소비 모델 (브라우저·Node 공용)
//
// 여기가 유일한 구현이다. 오프라인 스크립트(scripts/pos-analysis.mjs)와 앱의 설정 탭
// ("포스 자료 넣기")이 같은 함수를 부르므로 둘이 어긋날 수 없다.
//
//   텍스트 → parseSalesReport(src/logic/pos.js)
//          → consumptionByIngredient · consumptionByItem(src/logic/consumption.js)  ← 추정값 층(pos-estimates.js)을 덧씌운 상태
//          → validateModel(src/logic/forecast.js)이 받아들이는 모양의 모델
//
// 모델 모양:
//   { version, source, months: ['YYYY-MM'…], items: { itemId: { perDay: {'YYYY-MM': n}, avgPerDay, unit, assumed, estimated } },
//     coverage: { 'YYYY-MM': { from, to, days } } }
//
//   coverage 는 "그 달의 값이 며칠짜리 보고서에서 나왔는가"다. 한 달 전체(31일)를 넣었는지
//   1일~8일만 넣었는지 기억해 두어야, 나중에 더 긴 보고서가 오면 그것이 이기고 더 짧은 보고서는
//   이미 있는 값을 깎아내리지 않는다. validateModel 은 모르는 필드를 버리므로 coverage 가 없는
//   모델(예전 JSON)은 "그 달 전체"로 본다.

import { parseSalesReport, aggregateSales, daysInMonth } from './pos.js';
import { consumptionByIngredient, consumptionByItem } from './consumption.js';
import * as BASE_MAPS from '../data/pos-map.js';
import { applyEstimates } from '../data/pos-estimates.js';
import { SEED_ITEMS } from '../data/items.js';

// 레시피 표는 공개 저장소에 올리지 않는다 (가게 자료). 들어오는 길이 셋이고, 없으면 빈 표로 두고
// "포스 자료 넣기"가 레시피 자료 없음으로 안내한다.
//   1) window.__RECIPES__      — 단일 파일 빌드가 심어 둔 것 (scripts/build-single.mjs)
//   2) src/data/recipes.js     — 로컬에서 scripts/build-recipes-module.mjs 가 만든 파일, 배포 때는 비밀값 RECIPES_JSON
//   3) analyze(reports, { recipes }) — 오프라인 스크립트가 직접 넘기는 길
// 주소를 변수로 만들어 부른다: 파일이 없어도 번들 빌드가 깨지지 않고(정적 해석 안 함) 실행 중에만 찾는다.
// 최상위 await 는 쓰지 않는다 — 단일 파일 빌드 목표가 es2020 이라 최상위 await 를 넣으면 빌드가 깨진다.
export let RECIPES = [];

function injectedRecipes() {
  try {
    const r = typeof window !== 'undefined' ? window.__RECIPES__ : null;
    return Array.isArray(r) && r.length ? r : null;
  } catch {
    return null;
  }
}

/** 레시피 표를 다 읽을 때까지 기다린다 (앱은 자료를 넣기 전에 이것을 await 한다) */
export const recipesReady = (async () => {
  const injected = injectedRecipes();
  if (injected) return (RECIPES = injected);
  try {
    const url = new URL('../data/recipes.js', import.meta.url).href;
    const m = await import(/* @vite-ignore */ url);
    if (Array.isArray(m.RECIPES)) RECIPES = m.RECIPES;
  } catch {
    /* 레시피 파일 없음 — hasRecipes() 가 false 가 되고 화면이 안내한다 */
  }
  return RECIPES;
})();

/** 레시피 자료가 들어와 있는가 (없으면 소비량을 계산할 수 없다) */
export function hasRecipes() {
  return RECIPES.length > 0;
}

export const NO_RECIPES = '레시피 자료가 아직 이 앱에 들어 있지 않아 소비량을 계산할 수 없습니다. 개발자에게 레시피 자료 넣기를 요청하세요 (README "판매 자료 분석").';

export const REPORT_TITLE = '그룹별 매출분석';
/** 레시피 자료의 기준 시점 (모델 설명에 적는다) */
export const RECIPE_LABEL = '레시피 2026.08';

const PERIOD_RE = /\(\s*(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/;
const PERIOD_RE_G = new RegExp(PERIOD_RE.source, 'g');
const r3 = (n) => Math.round((n || 0) * 1000) / 1000;

/** 'YYYY-MM-DD' 두 개 → 양 끝을 포함한 날 수 (거꾸로면 0) */
export function dayCount(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

/**
 * 붙여 넣은 텍스트에 보고서가 여러 개 들어 있으면 나눈다.
 * 기간 줄은 페이지마다 되풀이되므로(한 보고서가 7~9쪽) 기간 값이 "바뀌는" 곳에서만 자른다.
 * @returns {string[]} 보고서 텍스트 조각 (기간 줄이 하나도 없으면 원문 그대로 한 조각)
 */
export function splitReports(text) {
  const s = String(text || '');
  if (!s.trim()) return [];
  const cuts = [];
  let last = null;
  PERIOD_RE_G.lastIndex = 0;
  for (let m; (m = PERIOD_RE_G.exec(s)); ) {
    const key = `${m[1]}~${m[2]}`;
    if (key === last) continue; // 같은 보고서의 다음 쪽
    last = key;
    const lineStart = s.lastIndexOf('\n', m.index) + 1;
    cuts.push(lineStart);
  }
  if (cuts.length <= 1) return [s];
  return cuts.map((start, i) => s.slice(start, cuts[i + 1] ?? s.length));
}

/**
 * CSV 로 뽑은 보고서를 파서가 읽는 "칸 사이 공백" 모양으로 바꾼다.
 * 따옴표 밖의 쉼표만 칸 구분으로 보고, 따옴표 안의 쉼표(1,234 같은 천 단위)는 그대로 둔다.
 * ⚠ 실제 POS 의 CSV 를 본 적이 없어 확인되지 않은 길이다. 이렇게 해도 안 읽히면 붙여넣기로 안내한다.
 */
export function csvToText(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
        continue;
      }
      if (c === ',' && !q) {
        cells.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    cells.push(cur);
    out.push(cells.map((c) => c.trim()).filter(Boolean).join(' '));
  }
  return out.join('\n');
}

/** 텍스트 한 조각 → { period, rows, unassigned, days, month, totalQty } (보고서가 아니면 null) */
export function readReport(text) {
  const parsed = parseSalesReport(text);
  if (!parsed.period || !parsed.rows.length) return null;
  const { from, to, month } = parsed.period;
  return {
    ...parsed,
    month,
    days: dayCount(from, to) || daysInMonth(month),
    totalQty: parsed.rows.reduce((a, r) => a + (r.qty || 0), 0),
    spansMonths: from.slice(0, 7) !== to.slice(0, 7),
  };
}

/** 여러 텍스트(붙여넣기·파일) → 보고서 목록. 기간 이른 순, 같은 기간이면 짧은 것 먼저(긴 것이 뒤에 이겨서 남게) */
export function readReports(texts) {
  const list = [];
  for (const t of [].concat(texts)) for (const chunk of splitReports(t)) {
    const rep = readReport(chunk);
    if (rep) list.push(rep);
  }
  list.sort((a, b) => a.period.from.localeCompare(b.period.from) || a.days - b.days);
  return list;
}

/** 텍스트가 '그룹별 매출분석' 보고서처럼 생겼는지 — 아니면 왜 아닌지(한국어) */
export function reportProblem(texts) {
  const joined = [].concat(texts).join('\n');
  if (!joined.trim()) return '읽을 내용이 없습니다. 보고서 텍스트를 붙여 넣거나 파일을 고르세요.';
  const hasTitle = joined.includes(REPORT_TITLE);
  const hasPeriod = PERIOD_RE.test(joined);
  if (!hasPeriod) {
    return hasTitle
      ? `기간을 찾지 못했습니다. 보고서 위쪽의 "( 2026-09-01   2026-09-08 )" 줄까지 포함해 전체를 복사해 주세요.`
      : `${REPORT_TITLE} 보고서가 아닙니다. POS에서 "${REPORT_TITLE}"을 기간을 정해 뽑은 뒤, 그 내용을 통째로 붙여 넣어 주세요.`;
  }
  return `기간은 찾았지만 상품 줄을 하나도 읽지 못했습니다. "상품명 단가 수량 금액 할인" 표까지 포함해 전체를 복사해 주세요.`;
}

/**
 * 보고서들 → 재료·품목 소비량 (분석 스크립트와 앱이 함께 쓰는 계산 본체)
 * @param {object[]} reports parseSalesReport 결과들
 * @param {object} [opts] { estimates=true, recipes, maps, items, daysOf }
 *   daysOf: 'YYYY-MM' → 그 달의 소비를 나눌 날 수 (기본 그 달의 일수). 일부 기간만 담은 보고서면 그 기간의 날 수를 준다.
 */
export function analyze(reports, opts = {}) {
  const useEstimates = opts.estimates !== false;
  const srcRecipes = opts.recipes || RECIPES;
  const srcMaps = opts.maps || BASE_MAPS;
  const items = opts.items || SEED_ITEMS;
  const { maps, recipes } = useEstimates ? applyEstimates(srcMaps, srcRecipes) : { maps: srcMaps, recipes: srcRecipes };
  const sales = aggregateSales(reports);
  const { byIngredient, unmapped, ignored, decafShots } = consumptionByIngredient(sales, recipes, maps);
  const { byItem, notes } = consumptionByItem(sales.months, byIngredient, decafShots, maps, items, { daysOf: opts.daysOf });
  return { useEstimates, maps, recipes, items, sales, byIngredient, unmapped, ignored, decafShots, byItem, notes };
}

/** 재료를 쓰는 음료 그룹 (잔 수를 셀 때) */
export const DRINK_GROUPS = ['커피', '티', '에이드', '라떼', '주스/병음료'];

/** analyze 결과 → 음료 판매 잔 수 (옵션 제외). 분석 보고서와 앱 미리보기가 같은 숫자를 쓴다 */
export function cupsOf(a) {
  const byMonth = Object.fromEntries(a.sales.months.map((m) => [m, 0]));
  const byGroup = {};
  for (const [name, p] of Object.entries(a.sales.products)) {
    if (!DRINK_GROUPS.includes(p.group)) continue;
    const map = a.maps.PRODUCT_MAP[name];
    if (!map || map.modifier) continue; // 옵션 제외
    byGroup[p.group] = (byGroup[p.group] || 0) + p.total;
    for (const [m, q] of Object.entries(p.byMonth)) byMonth[m] += q;
  }
  return { byMonth, byGroup, total: Object.values(byMonth).reduce((x, y) => x + y, 0) };
}

/** 모델 설명 문구 (오프라인 스크립트와 앱이 같은 문구를 쓴다) */
export function sourceLabel(months, useEstimates = true) {
  const range = months.length ? `${months[0]} ~ ${months.at(-1)}` : '기간 없음';
  return `POS ${REPORT_TITLE} ${range} × ${RECIPE_LABEL}${useEstimates ? ' (포장 크기 일부 추정)' : ''}`;
}

/** analyze 결과 → 앱용 소비 모델 (품목별 월 일평균, 포장 단위). 일평균이 큰 품목 순 */
export function modelFrom(a, opts = {}) {
  const itemIndex = Object.fromEntries(a.items.map((it) => [it.id, it]));
  const months = a.sales.months;
  const rows = Object.values(a.byItem).sort((x, y) => (y.avgPerDay || 0) - (x.avgPerDay || 0));
  const model = {
    version: 1,
    source: sourceLabel(months, a.useEstimates),
    months,
    items: Object.fromEntries(
      rows
        .filter((r) => r.perPackage && itemIndex[r.itemId])
        .map((r) => [r.itemId, { perDay: Object.fromEntries(months.map((m) => [m, r3(r.perDay[m])])), avgPerDay: r3(r.avgPerDay), unit: r.unit, assumed: r.assumed, estimated: r.assumed }]),
    ),
  };
  if (opts.coverage) model.coverage = opts.coverage;
  return model;
}

/** 보고서들 → 소비 모델 한 벌 (합치기 없이 통째로 계산). 오프라인 스크립트가 쓰는 길 */
export function buildModel(reports, opts = {}) {
  const a = analyze(reports, opts);
  return modelFrom(a, opts);
}

/** 어떤 모양이 와도 합칠 수 있는 모델로 정리 (없으면 빈 모델) */
export function normalizeModel(m) {
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const out = { version: 1, source: '', months: [], items: {}, coverage: {} };
  if (!isObj(m) || !isObj(m.items)) return out;
  out.version = m.version || 1;
  out.source = typeof m.source === 'string' ? m.source : '';
  for (const [id, v] of Object.entries(m.items)) {
    if (!isObj(v)) continue;
    const perDay = {};
    for (const [k, n] of Object.entries(isObj(v.perDay) ? v.perDay : {})) if (/^\d{4}-\d{2}$/.test(k) && Number.isFinite(n) && n >= 0) perDay[k] = n;
    out.items[id] = { perDay, avgPerDay: Number.isFinite(v.avgPerDay) ? v.avgPerDay : 0, unit: typeof v.unit === 'string' ? v.unit : 'ea', assumed: !!v.assumed, estimated: !!(v.estimated || v.assumed) };
  }
  const months = new Set(Array.isArray(m.months) ? m.months.filter((x) => /^\d{4}-\d{2}$/.test(x)) : []);
  for (const it of Object.values(out.items)) for (const k of Object.keys(it.perDay)) months.add(k);
  out.months = [...months].sort();
  if (isObj(m.coverage)) {
    for (const [k, v] of Object.entries(m.coverage)) {
      if (!/^\d{4}-\d{2}$/.test(k) || !isObj(v)) continue;
      const days = Number(v.days);
      if (!Number.isFinite(days) || days <= 0) continue;
      out.coverage[k] = { from: String(v.from || ''), to: String(v.to || ''), days };
    }
  }
  return out;
}

/** 그 달의 값이 며칠짜리 자료에서 왔는가 (기록이 없으면 값이 있는 달은 "그 달 전체", 없는 달은 0) */
export function coveredDays(model, month) {
  const c = model.coverage?.[month];
  if (c) return c.days;
  return model.months.includes(month) ? daysInMonth(month) : 0;
}

function recomputeAverages(model) {
  for (const [id, it] of Object.entries(model.items)) {
    const vals = Object.values(it.perDay);
    if (!vals.length) {
      delete model.items[id]; // 남은 달이 하나도 없는 품목은 뺀다
      continue;
    }
    const used = vals.filter((v) => v > 0);
    it.avgPerDay = r3(used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0);
  }
}

/**
 * 보고서 하나로 만든 모델을 기존 모델의 그 달에 얹는다 (다른 달은 건드리지 않는다).
 * 더 짧은 기간의 보고서는 이미 있는 더 긴 자료를 깎아내리지 않는다.
 * @param {object} base 기존 모델 (없으면 null)
 * @param {object} incoming 보고서 한 개로 만든 모델 (months 는 그 달 하나)
 * @param {{month:string, from:string, to:string, days:number}} range 그 보고서가 담은 기간
 * @returns {{ model, applied:boolean, month:string, prevDays:number, days:number, added:boolean }}
 */
export function mergeMonth(base, incoming, range) {
  const model = normalizeModel(base);
  const { month, days } = range;
  const prevDays = coveredDays(model, month);
  if (days < prevDays) return { model, applied: false, month, prevDays, days, added: false };
  const added = !model.months.includes(month);
  for (const it of Object.values(model.items)) delete it.perDay[month]; // 그 달의 옛 값은 모두 비운다
  for (const [id, src] of Object.entries(incoming.items || {})) {
    const v = src.perDay?.[month];
    if (!Number.isFinite(v)) continue;
    const t = (model.items[id] ||= { perDay: {}, avgPerDay: 0, unit: src.unit || 'ea', assumed: !!src.assumed, estimated: !!src.estimated });
    t.perDay[month] = v;
    t.unit = src.unit || t.unit;
    t.assumed = !!src.assumed;
    t.estimated = !!(src.estimated || src.assumed);
  }
  // 이 달에 판매가 없던 품목은 "0"으로 남긴다 (자료가 없는 것이 아니라 그 기간에 안 나갔다는 뜻).
  // 값을 비워 두면 예상 재고가 연평균으로 되돌아가 실제보다 많이 줄어든다.
  for (const it of Object.values(model.items)) if (it.perDay[month] == null) it.perDay[month] = 0;
  model.months = [...new Set([...model.months, month])].sort();
  model.coverage[month] = { from: range.from, to: range.to, days };
  recomputeAverages(model);
  model.months = model.months.filter((m) => Object.values(model.items).some((it) => it.perDay[m] != null) || model.coverage[m]);
  return { model, applied: true, month, prevDays, days, added };
}

/**
 * 붙여 넣은 텍스트(여러 개 가능) → 미리보기 + 적용할 모델. 아직 아무것도 저장하지 않는다.
 * 레시피 표를 따로 넘기지 않으려면 먼저 `await recipesReady` — 레시피는 앱을 연 뒤 따로 읽어 온다.
 * @param {string|string[]} texts
 * @param {object|null} base 지금 쓰는 모델
 * @param {object} [opts] analyze 로 넘어가는 설정
 * @returns {{ ok:false, error:string } | { ok:true, model, reports:[], months:[], base:{months:number} }}
 */
export function prepareImport(texts, base, opts = {}) {
  const list = readReports(texts);
  if (!list.length) return { ok: false, error: reportProblem(texts) };
  if (!(opts.recipes || RECIPES).length) return { ok: false, error: NO_RECIPES };
  let model = normalizeModel(base);
  const baseMonths = [...model.months];
  const reports = [];
  for (const rep of list) {
    const a = analyze([rep], { ...opts, daysOf: () => rep.days });
    const one = modelFrom(a);
    const cups = cupsOf(a);
    const merged = mergeMonth(model, one, { month: rep.month, from: rep.period.from, to: rep.period.to, days: rep.days });
    model = merged.model;
    const unmapped = [...a.unmapped].sort((x, y) => y.total - x.total);
    reports.push({
      month: rep.month,
      from: rep.period.from,
      to: rep.period.to,
      days: rep.days,
      rows: rep.rows.length,
      totalQty: rep.totalQty,
      cups: cups.total,
      cupsByGroup: cups.byGroup,
      itemCount: Object.keys(one.items).length,
      unmappedCount: unmapped.length,
      unmappedQty: unmapped.reduce((s, u) => s + u.total, 0),
      unmappedTop: unmapped.slice(0, 5).map((u) => ({ product: u.product, total: u.total, reason: u.reason || '' })),
      ignoredCount: a.ignored.length,
      applied: merged.applied,
      prevDays: merged.prevDays,
      added: merged.added,
      partial: rep.days < daysInMonth(rep.month),
      spansMonths: rep.spansMonths,
      unassigned: rep.unassigned,
    });
  }
  if (!reports.some((r) => r.applied)) {
    const r = reports[0];
    return { ok: false, error: `이미 더 긴 기간(${r.prevDays}일)의 ${r.month} 자료가 들어 있어 그대로 두었습니다. 그 달 전체를 다시 뽑아 넣으면 바뀝니다.` };
  }
  model.source = sourceLabel(model.months, opts.estimates !== false);
  return { ok: true, model, reports, months: model.months, baseMonths };
}

/** 모델을 공유 저장소에 올릴 때의 크기 (바이트, UTF-8) */
export function modelBytes(model) {
  const json = JSON.stringify(model || null);
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : Buffer.byteLength(json, 'utf8');
}
