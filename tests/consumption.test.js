import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumptionByIngredient, consumptionByItem, suggestParFromRate, seasonality, findRecipe, indexRecipes } from '../src/logic/consumption.js';

// 계산 검증용 가짜 레시피 (실제 레시피 수치가 아님)
const recipes = [
  { menu: '바닐라라떼', variant: 'ICE', ingredients: [{ name: '우유', qty: 150, unit: 'ml' }, { name: '바닐라시럽', qty: 30, unit: 'g' }, { name: '에스프레소샷', qty: 1, unit: 'shot' }] },
  { menu: '바닐라라떼', variant: 'HOT', ingredients: [{ name: '스팀우유', qty: 200, unit: 'ml' }, { name: '바닐라시럽', qty: 30, unit: 'g' }, { name: '에스프레소샷', qty: 1, unit: 'shot' }] },
  { menu: '티백 캐모마일', variant: 'HOT', ingredients: [{ name: '티백 캐모마일', qty: 1, unit: 'bag' }] },
  { menu: '티백 캐모마일', variant: 'ICE', ingredients: [{ name: '티백 캐모마일', qty: 1, unit: 'bag' }] },
];
const maps = {
  PRODUCT_MAP: {
    'ice바닐라라떼': { menu: '바닐라라떼', variant: 'ICE' },
    'hot바닐라라떼': { menu: '바닐라라떼', variant: 'HOT' },
    'ice로얄캐모마일': { menu: '티백 캐모마일', variant: 'ICE' },
    '대추차 ice': { menu: '대추차', variant: 'ICE' }, // ICE 레시피 없음 → 레시피 없음으로 남아야 함
    '노아주스 x': { unknown: '종류 불명' },
    '브런치어린이': { brunchKids: 1 },
    '샷 추가': { modifier: 'shot', shots: 1 },
    '디카페인': { modifier: 'decaf' },
    '에비앙': { item: 'evian', qty: 1 },
    '노아주스': { items: { 'noa-a': 0.5, 'noa-b': 0.5 }, assumed: true },
    '에소프레소 더블': { espresso: 2 },
    '진동벨 1번': null,
    '연하게': null,
    '수상한메뉴': { menu: '없는메뉴', variant: 'ICE' },
  },
  MODIFIERS: { shot: { ingredient: '에스프레소샷', unit: 'shot' } },
  IGNORED_GROUPS: ['빵'],
  INGREDIENT_MAP: {
    '에스프레소샷': { item: 'beans', perShotG: 18, perPackage: 1000, unit: 'g' },
    '우유': { item: 'milk', perPackage: 1000, unit: 'ml' },
    '스팀우유': { item: 'milk', perPackage: 1000, unit: 'ml' },
    '바닐라시럽': { item: 'vanilla-syrup', perPackage: 1000, unit: 'ml', density: 1.3, assumed: true },
    '티백 캐모마일': { item: 'chamomile', perPackage: 20, unit: 'bag' },
  },
};
const items = [
  { id: 'beans', name: '원두' }, { id: 'milk', name: '우유' }, { id: 'vanilla-syrup', name: '바닐라시럽' }, { id: 'chamomile', name: '캐모마일' }, { id: 'evian', name: '에비앙' },
];
const sales = {
  months: ['2026-01', '2026-02'],
  products: {
    'ice바닐라라떼': { group: '커피', byMonth: { '2026-01': 100, '2026-02': 50 }, total: 150 },
    'hot바닐라라떼': { group: '커피', byMonth: { '2026-01': 20 }, total: 20 },
    'ice로얄캐모마일': { group: '티', byMonth: { '2026-01': 40 }, total: 40 },
    '샷 추가': { group: '커피', byMonth: { '2026-01': 10 }, total: 10 },
    '디카페인': { group: '커피', byMonth: { '2026-01': 30 }, total: 30 },
    '에비앙': { group: '주스/병음료', byMonth: { '2026-02': 7 }, total: 7 },
    '노아주스': { group: '주스/병음료', byMonth: { '2026-02': 8 }, total: 8 },
    '에소프레소 더블': { group: '커피', byMonth: { '2026-02': 5 }, total: 5 },
    '소금빵': { group: '빵', byMonth: { '2026-01': 999 }, total: 999 },
    '진동벨 1번': { group: '진동벨', byMonth: { '2026-01': 5 }, total: 5 },
    '연하게': { group: '커피', byMonth: { '2026-01': 50 }, total: 50 },
    '대추차 ice': { group: '티', byMonth: { '2026-01': 6 }, total: 6 },
    '노아주스 x': { group: '주스/병음료', byMonth: { '2026-01': 9 }, total: 9 },
    '브런치어린이': { group: '브런치', byMonth: { '2026-01': 4 }, total: 4 },
    '수상한메뉴': { group: '커피', byMonth: { '2026-01': 3 }, total: 3 },
    '모르는상품': { group: '커피', byMonth: { '2026-01': 2 }, total: 2 },
  },
};

test('findRecipe: 정확히 같은 메뉴·변형만 (다른 변형으로 대체하지 않음)', () => {
  const idx = indexRecipes(recipes);
  assert.equal(findRecipe(idx, '티백 캐모마일', 'ICE').variant, 'ICE');
  assert.equal(findRecipe(idx, '바닐라라떼', 'ANY'), null);
  assert.equal(findRecipe(idx, '없음', 'ICE'), null);
});

test('consumptionByIngredient: 판매량 × 레시피, 옵션, 병음료, 무시 그룹, 미연결', () => {
  const { byIngredient, unmapped, ignored, decafCups } = consumptionByIngredient(sales, recipes, maps);
  assert.equal(byIngredient['바닐라시럽'].months['2026-01'], 120 * 30);
  assert.equal(byIngredient['바닐라시럽'].months['2026-02'], 50 * 30);
  assert.equal(byIngredient['우유'].months['2026-01'], 100 * 150);
  assert.equal(byIngredient['스팀우유'].months['2026-01'], 20 * 200);
  assert.equal(byIngredient['에스프레소샷'].months['2026-01'], 120 + 10);
  assert.equal(byIngredient['티백 캐모마일'].months['2026-01'], 40);
  assert.equal(byIngredient['@item:evian'].months['2026-02'], 7);
  // 노아주스 8병 → 2종에 4병씩; 에스프레소 더블 5잔 → 10샷
  assert.equal(byIngredient['@item:noa-a'].months['2026-02'], 4);
  assert.equal(byIngredient['@item:noa-b'].months['2026-02'], 4);
  assert.equal(byIngredient['에스프레소샷'].months['2026-02'], 50 + 10);
  assert.equal(decafCups['2026-01'], 30);
  assert.deepEqual(unmapped.map((u) => u.product).sort(), ['노아주스 x', '대추차 ice', '모르는상품', '수상한메뉴']);
  assert.equal(unmapped.find((u) => u.product === '수상한메뉴').reason, '레시피 없음: 없는메뉴 ICE');
  assert.equal(unmapped.find((u) => u.product === '대추차 ice').reason, '레시피 없음: 대추차 ICE');
  assert.equal(unmapped.find((u) => u.product === '노아주스 x').reason, '종류 불명');
  assert.equal(byIngredient['@brunch-kids'].months['2026-01'], 4);
  // null로 연결한 옵션은 ignored에 잔 수와 함께 남는다 (무시 그룹은 아예 안 나옴)
  assert.deepEqual(ignored.map((u) => `${u.product}:${u.total}`).sort(), ['소금빵:999', '연하게:50', '진동벨 1번:5']);
  assert.equal(ignored.find((u) => u.product === '소금빵').byGroup, true);
  assert.ok(!('소금빵' in byIngredient));
});

test('consumptionByItem: 포장 단위 환산, 밀도, 원두 분리, 일평균', () => {
  const { byIngredient, decafCups } = consumptionByIngredient(sales, recipes, maps);
  const { byItem } = consumptionByItem(sales.months, byIngredient, decafCups, maps, items);
  // 바닐라시럽: 3600g / 1.3 = 2769.2ml → 2.77병 (1월)
  assert.ok(Math.abs(byItem['vanilla-syrup'].monthly['2026-01'] - 3600 / 1.3 / 1000) < 1e-9);
  assert.equal(byItem['vanilla-syrup'].assumed, true);
  // 우유: 15000 + 4000 = 19000ml → 19병
  assert.ok(Math.abs(byItem['milk'].monthly['2026-01'] - 19) < 1e-9);
  // 원두: 130샷 × 18g = 2.34kg (시트에 원두/디카페인이 한 줄이라 합산), 그중 30샷 디카페인 = 0.54kg
  assert.ok(Math.abs(byItem['beans'].monthly['2026-01'] - 2.34) < 1e-9);
  assert.ok(Math.abs(byItem['beans'].decafRaw['2026-01'] - 540) < 1e-9);
  assert.ok(Math.abs(byItem['beans'].totalDecafRaw - 540) < 1e-9);
  assert.ok(!('beans-decaf' in byItem));
  // 에스프레소 더블 2월: 50 + 10샷 → 1.08kg
  assert.ok(Math.abs(byItem['beans'].monthly['2026-02'] - 1.08) < 1e-9);
  // 노아주스 배분: 품목 목록에 없는 id도 이름은 id로 기록됨
  assert.equal(byItem['noa-a'].monthly['2026-02'], 4);
  assert.equal(byItem['noa-a'].assumed, true);
  assert.equal(byItem['evian'].assumed, false);
  // 캐모마일 40봉 / 20 = 2박스; 에비앙 7개
  assert.equal(byItem['chamomile'].monthly['2026-01'], 2);
  assert.equal(byItem['evian'].monthly['2026-02'], 7);
  // 일평균: 1월 31일
  assert.ok(Math.abs(byItem['chamomile'].perDay['2026-01'] - 2 / 31) < 1e-9);
  assert.ok(byItem['chamomile'].avgPerDay > 0);
  assert.equal(byItem['chamomile'].totalUnits, 2);
});

test('consumptionByItem: 1샷 원두 g을 모르면 샷 수로 집계', () => {
  const m2 = { ...maps, INGREDIENT_MAP: { ...maps.INGREDIENT_MAP, '에스프레소샷': { item: 'beans', perShotG: null, perPackage: null, unit: 'shot' } } };
  const { byIngredient, decafCups } = consumptionByIngredient(sales, recipes, m2);
  const { byItem } = consumptionByItem(sales.months, byIngredient, decafCups, m2, items);
  assert.equal(byItem['beans'].unit, 'shot');
  assert.equal(byItem['beans'].raw['2026-01'], 130);
  assert.equal(byItem['beans'].decafRaw['2026-01'], 30);
  assert.equal(byItem['beans'].totalUnits, null);
});

test('suggestParFromRate & seasonality', () => {
  assert.equal(suggestParFromRate(1.0), 6); // 1/day × 4일 × 1.5
  assert.equal(suggestParFromRate(0), null);
  assert.equal(suggestParFromRate(0.05), 1);
  const s = seasonality({ '2026-01': 1, '2026-02': 3 }, ['2026-01', '2026-02']);
  assert.equal(s['2026-01'], 0.5);
  assert.equal(s['2026-02'], 1.5);
});
