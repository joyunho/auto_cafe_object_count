import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesReport, aggregateSales, normalizeProduct, daysInMonth } from '../src/logic/pos.js';

const SAMPLE = `그룹별 매출분석
( 2026-01-01   2026-01-31 ) ∼
그룹코드 상품그룹 상품 단가 수량 금액 할인
00002
00001
티
커피
샷 추가 500 53 26,000 500
hot아메리카노 5,523 3,667 17,696,500 2,557,500
ice아메리카노 6,029 1,837 10,182,000 893,500
커피 합계 8,889 42,322,750 5,417,250
00002 티
대추차 only hot 8,000 761 5,172,000 916,000
Page 1 of 7 2026-8-14  16:40:14
hot청귤차 7,000 145 882,000 133,000
티 합계 2,854 17,564,830 2,434,170
00007 주스/병음료 골드메달사과주스 3,500 12 42,000 0
주스/병음료 토마토주스 6,500 20 130,000 0
주스/병음료 합계 32 172,000 0
`;

test('parseSalesReport: 기간, 그룹 배정, 숫자 변환', () => {
  const rep = parseSalesReport(SAMPLE);
  assert.deepEqual(rep.period, { from: '2026-01-01', to: '2026-01-31', month: '2026-01' });
  assert.equal(rep.unassigned, 0);
  const byName = Object.fromEntries(rep.rows.map((r) => [r.product, r]));
  assert.equal(byName['hot아메리카노'].qty, 3667);
  assert.equal(byName['hot아메리카노'].group, '커피');
  assert.equal(byName['hot아메리카노'].amount, 17696500);
  assert.equal(byName['hot청귤차'].group, '티'); // 페이지 넘김 뒤에도 같은 그룹
  assert.equal(byName['대추차 only hot'].group, '티');
  assert.equal(byName['골드메달사과주스'].group, '주스/병음료'); // 그룹코드+그룹명 접두어 제거
  assert.equal(byName['토마토주스'].qty, 20);
  assert.ok(!('00002' in byName));
});

test('normalizeProduct: 접두어 제거와 공백 정리', () => {
  assert.equal(normalizeProduct('00007 주스/병음료 골드메달사과주스'), '골드메달사과주스');
  assert.equal(normalizeProduct('  ice크림   카페라떼 '), 'ice크림 카페라떼');
  assert.equal(normalizeProduct('티'), '티');
});

test('aggregateSales: 상품×월 합산', () => {
  const a = parseSalesReport(SAMPLE);
  const b = parseSalesReport(SAMPLE.replace('2026-01-01   2026-01-31', '2026-02-01   2026-02-28').replace('3,667', '100'));
  const agg = aggregateSales([b, a]);
  assert.deepEqual(agg.months, ['2026-01', '2026-02']);
  assert.equal(agg.products['hot아메리카노'].byMonth['2026-01'], 3667);
  assert.equal(agg.products['hot아메리카노'].byMonth['2026-02'], 100);
  assert.equal(agg.products['hot아메리카노'].total, 3767);
  assert.equal(agg.products['hot아메리카노'].group, '커피');
});

test('daysInMonth', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2026-07'), 31);
});
