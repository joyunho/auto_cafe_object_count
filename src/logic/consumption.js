// 판매량 × 레시피 → 재료 소비량 → 재고 품목 단위 환산
//
// 입력
//   sales     : aggregateSales() 결과 { months, products: {name: {group, byMonth, total}} }
//   recipes   : [{ menu, variant, ingredients: [{name, qty, unit}] }]  (src/data/recipes.js)
//   maps      : { PRODUCT_MAP, INGREDIENT_MAP, MODIFIERS, IGNORED_GROUPS }  (src/data/pos-map.js)
//   items     : 재고 품목 (src/data/items.js)
//
// 출력
//   byIngredient[name][month] = 소비량 (레시피 단위)
//   byItem[itemId] = { unit, perPackage, assumed, monthly: {month: 낱개 수}, raw: {month: g/ml/ea}, perDay: {month}, avgPerDay, peakPerDay, notes }
//   unmapped : 매출은 있는데 레시피/품목 연결이 없는 상품 (reason이 있으면 "레시피 없음")
//   ignored  : 재료 소비와 무관해 의도적으로 뺀 상품 (PRODUCT_MAP에서 null, 또는 IGNORED_GROUPS의 그룹째: byGroup) — 잔 수만 보고용

import { daysInMonth } from './pos.js';

function recipeKey(menu, variant) {
  return `${menu}|${variant}`;
}

export function indexRecipes(recipes) {
  const idx = new Map();
  for (const r of recipes) idx.set(recipeKey(r.menu, r.variant), r);
  return idx;
}

/** 메뉴·변형에 정확히 맞는 레시피만. 없으면 null (다른 변형으로 대체하지 않는다) */
export function findRecipe(idx, menu, variant) {
  return idx.get(recipeKey(menu, variant)) || null;
}

/**
 * 재료별 월 소비량 (레시피 단위: g/ml/ea/bag/shot)
 */
export function consumptionByIngredient(sales, recipes, maps) {
  const idx = indexRecipes(recipes);
  const { PRODUCT_MAP, MODIFIERS, IGNORED_GROUPS } = maps;
  const by = {}; // name -> { unit, months: {m: qty} }
  const unmapped = [];
  const ignored = [];
  const decafCups = {}; // month -> 디카페인 옵션 잔 수 (원두 분리용)
  const add = (name, unit, month, qty) => {
    const e = (by[name] ||= { unit, months: {} });
    e.months[month] = (e.months[month] || 0) + qty;
  };

  for (const [product, p] of Object.entries(sales.products)) {
    if (IGNORED_GROUPS.includes(p.group)) {
      ignored.push({ product, group: p.group, total: p.total, byGroup: true }); // 그룹째 제외 — 보고서에 건수만
      continue;
    }
    if (!(product in PRODUCT_MAP)) {
      unmapped.push({ product, group: p.group, total: p.total });
      continue;
    }
    const map = PRODUCT_MAP[product];
    if (map == null) {
      ignored.push({ product, group: p.group, total: p.total });
      continue;
    }
    if (map.unknown) {
      unmapped.push({ product, group: p.group, total: p.total, reason: map.unknown });
      continue;
    }
    const recipe = map.menu ? findRecipe(idx, map.menu, map.variant) : null;
    if (map.menu && !recipe) {
      unmapped.push({ product, group: p.group, total: p.total, reason: `레시피 없음: ${map.menu} ${map.variant}` });
      continue;
    }
    for (const [month, qty] of Object.entries(p.byMonth)) {
      if (!qty) continue;
      if (map.espresso) {
        // 에스프레소 단품(싱글 1샷·더블 2샷): 잔이자 샷
        add('에스프레소샷', 'shot', month, qty * map.espresso);
        if (map.decaf) decafCups[month] = (decafCups[month] || 0) + qty * map.espresso;
        continue;
      }
      if (map.modifier) {
        const mod = MODIFIERS[map.modifier];
        if (map.modifier === 'decaf') decafCups[month] = (decafCups[month] || 0) + qty;
        else if (map.modifier === 'shot') add('에스프레소샷', 'shot', month, qty * (map.shots || 1));
        else if (mod) add(mod.ingredient, mod.unit, month, qty * mod.qty);
        continue;
      }
      if (map.item) {
        add(`@item:${map.item}`, 'ea', month, qty * (map.qty || 1));
        continue;
      }
      if (map.items) {
        // 한 POS 상품이 여러 재고 품목 중 하나 (예: 노아주스 4종) → 비중대로 배분
        for (const [id, share] of Object.entries(map.items)) {
          add(`@item:${id}`, 'ea', month, qty * share);
          if (map.assumed) by[`@item:${id}`].assumed = true;
        }
        continue;
      }
      if (map.brunch != null) {
        add('@brunch', 'ea', month, qty * map.brunch);
        continue;
      }
      if (map.brunchKids != null) {
        add('@brunch-kids', 'ea', month, qty * map.brunchKids);
        continue;
      }
      if (map.ramen != null) {
        add('@ramen', 'ea', month, qty * map.ramen);
        continue;
      }
      for (const ing of recipe.ingredients) {
        add(ing.name, ing.unit, month, qty * ing.qty);
        if (recipe.assumed) by[ing.name].assumed = true; // 추정 레시피에서 온 양
      }
      if (map.decaf) decafCups[month] = (decafCups[month] || 0) + qty;
    }
  }
  return { byIngredient: by, unmapped, ignored, decafCups };
}

/**
 * 재료 소비량 → 재고 품목 단위(병·단지·박스…)로 환산
 */
export function consumptionByItem(months, byIngredient, decafCups, maps, items) {
  const { INGREDIENT_MAP } = maps;
  const itemIndex = Object.fromEntries(items.map((it) => [it.id, it]));
  const out = {}; // itemId -> record
  const notes = [];

  const rec = (itemId, map) => {
    const it = itemIndex[itemId];
    return (out[itemId] ||= {
      itemId,
      name: it?.name || itemId,
      unit: map?.unit || 'ea',
      perPackage: map?.perPackage ?? null,
      assumed: !!map?.assumed,
      raw: {},
      monthly: {},
      sources: new Set(),
      note: map?.note || '',
    });
  };

  for (const [name, e] of Object.entries(byIngredient)) {
    if (name.startsWith('@item:')) {
      const itemId = name.slice(6);
      const r = rec(itemId, { unit: 'ea', perPackage: 1 });
      r.perPackage = 1;
      if (e.assumed) {
        r.assumed = true;
        r.note = r.note || 'POS에 종류 없음 → 균등 배분(가정)';
      }
      for (const [m, q] of Object.entries(e.months)) {
        r.raw[m] = (r.raw[m] || 0) + q;
        r.monthly[m] = (r.monthly[m] || 0) + q;
      }
      r.sources.add('병음료 판매');
      continue;
    }
    if (name.startsWith('@')) continue; // brunch/ramen: 별도 집계
    const map = INGREDIENT_MAP[name];
    if (map === undefined) {
      notes.push(`재료 연결 없음: ${name}`);
      continue;
    }
    if (map === null || !map.item) continue;

    if (name === '에스프레소샷') {
      // 샷 → 원두. 1샷 원두 g(perShotG)을 알면 g로, 모르면 샷 수 그대로 집계한다.
      // 시트에는 "원두 / 디카페인 원두"가 한 줄이라 합쳐서 기록하고, 디카페인 잔 수만큼은 decafRaw로 따로 적어 둔다.
      const gPerShot = map.perShotG || null;
      const r = rec(map.item, { ...map, unit: gPerShot ? 'g' : 'shot' });
      if (map.assumed) r.assumed = true;
      r.decafRaw ||= {};
      for (const [m, shots] of Object.entries(e.months)) {
        const decaf = Math.min(shots, decafCups[m] || 0);
        r.raw[m] = (r.raw[m] || 0) + shots * (gPerShot || 1);
        r.decafRaw[m] = (r.decafRaw[m] || 0) + decaf * (gPerShot || 1);
      }
      r.sources.add('에스프레소 메뉴');
      if (Object.values(r.decafRaw).some((v) => v > 0)) r.sources.add('디카페인 옵션');
      continue;
    }

    const r = rec(map.item, map);
    if (map.assumed || e.assumed) r.assumed = true; // 추정값이 하나라도 섞이면 품목 전체를 추정으로 표시
    if (map.assumed && map.note && !r.note.includes(map.note)) r.note = r.note ? `${r.note} · ${map.note}` : map.note;
    for (const [m, q] of Object.entries(e.months)) {
      let v = q;
      // 레시피에 수량이 없어 "1잔"으로만 센 재료: 1잔당 양(추정)이 있으면 그 단위로
      if (e.unit === 'serving' && map.perServing != null) v = v * map.perServing;
      if (map.milkShare) v *= map.milkShare; // 크림우유 중 우유 비중
      // 레시피 g ↔ 포장 ml 환산
      if (e.unit === 'g' && map.unit === 'ml' && map.density) v = v / map.density;
      if (e.unit === 'ml' && map.unit === 'g' && map.density) v = v * map.density;
      r.raw[m] = (r.raw[m] || 0) + v;
    }
    r.sources.add(name);
  }

  // 낱개 환산과 일평균
  for (const r of Object.values(out)) {
    r.sources = [...r.sources];
    let sumPerDay = 0;
    let n = 0;
    r.perDay = {};
    for (const m of months) {
      const raw = r.raw[m] || 0;
      if (r.perPackage) r.monthly[m] = raw / r.perPackage;
      const days = daysInMonth(m);
      const perDay = r.perPackage ? raw / r.perPackage / days : raw / days;
      r.perDay[m] = perDay;
      if (raw > 0) {
        sumPerDay += perDay;
        n++;
      }
    }
    r.avgPerDay = n ? sumPerDay / n : 0;
    r.peakPerDay = Math.max(0, ...months.map((m) => r.perDay[m] || 0));
    r.lowPerDay = n ? Math.min(...months.filter((m) => (r.raw[m] || 0) > 0).map((m) => r.perDay[m])) : 0;
    r.totalRaw = months.reduce((a, m) => a + (r.raw[m] || 0), 0);
    r.totalUnits = r.perPackage ? r.totalRaw / r.perPackage : null;
    if (r.decafRaw) r.totalDecafRaw = months.reduce((a, m) => a + (r.decafRaw[m] || 0), 0);
  }
  return { byItem: out, notes };
}

/**
 * 기준 수량 제안: 발주 간격(월→목 3일, 목→월 4일) 동안 쓰는 양 × 안전계수.
 * perDay는 포장 단위. 결과는 낱개(포장) 단위 정수.
 */
export function suggestParFromRate(perDay, { coverDays = 4, safety = 1.5, min = 1 } = {}) {
  if (!perDay || perDay <= 0) return null;
  return Math.max(min, Math.ceil(perDay * coverDays * safety));
}

/** 월별 계절 지수 (연평균 대비) */
export function seasonality(perDayByMonth, months) {
  const vals = months.map((m) => perDayByMonth[m] || 0);
  const avg = vals.reduce((a, b) => a + b, 0) / (vals.filter((v) => v > 0).length || 1);
  return Object.fromEntries(months.map((m, i) => [m, avg ? vals[i] / avg : 0]));
}
