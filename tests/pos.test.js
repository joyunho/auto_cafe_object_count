import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesReport, aggregateSales, normalizeProduct, daysInMonth } from '../src/logic/pos.js';

// 보고서 형식만 흉내 낸 가짜 자료 (숫자는 모두 지어낸 값)
const SAMPLE = `그룹별 매출분석
( 2026-01-01   2026-01-31 ) ∼
그룹코드 상품그룹 상품 단가 수량 금액 할인
00002
00001
티
커피
샷 추가 500 12 6,000 0
hot아메리카노 4,000 1,234 4,936,000 12,000
ice아메리카노 4,500 987 4,441,500 9,000
커피 합계 2,233 9,383,500 21,000
00002 티
대추차 only hot 6,000 45 270,000 0
Page 1 of 2 2026-2-1  09:00:00
hot청귤차 5,500 21 115,500 5,500
티 합계 66 385,500 5,500
00007 주스/병음료 골드메달사과주스 3,000 7 21,000 0
주스/병음료 토마토주스 5,000 10 50,000 0
주스/병음료 합계 17 71,000 0
`;

test('parseSalesReport: 기간, 그룹 배정, 숫자 변환', () => {
  const rep = parseSalesReport(SAMPLE);
  assert.deepEqual(rep.period, { from: '2026-01-01', to: '2026-01-31', month: '2026-01' });
  assert.equal(rep.unassigned, 0);
  const byName = Object.fromEntries(rep.rows.map((r) => [r.product, r]));
  assert.equal(byName['hot아메리카노'].qty, 1234);
  assert.equal(byName['hot아메리카노'].group, '커피');
  assert.equal(byName['hot아메리카노'].amount, 4936000);
  assert.equal(byName['hot청귤차'].group, '티'); // 페이지 넘김 뒤에도 같은 그룹
  assert.equal(byName['대추차 only hot'].group, '티');
  assert.equal(byName['골드메달사과주스'].group, '주스/병음료'); // 그룹코드+그룹명 접두어 제거
  assert.equal(byName['토마토주스'].qty, 10);
  assert.ok(!('00002' in byName));
});

test('normalizeProduct: 접두어 제거와 공백 정리', () => {
  assert.equal(normalizeProduct('00007 주스/병음료 골드메달사과주스'), '골드메달사과주스');
  assert.equal(normalizeProduct('  ice크림   카페라떼 '), 'ice크림 카페라떼');
  assert.equal(normalizeProduct('티'), '티');
});

test('aggregateSales: 상품×월 합산', () => {
  const a = parseSalesReport(SAMPLE);
  const b = parseSalesReport(SAMPLE.replace('2026-01-01   2026-01-31', '2026-02-01   2026-02-28').replace('1,234', '100'));
  const agg = aggregateSales([b, a]);
  assert.deepEqual(agg.months, ['2026-01', '2026-02']);
  assert.equal(agg.products['hot아메리카노'].byMonth['2026-01'], 1234);
  assert.equal(agg.products['hot아메리카노'].byMonth['2026-02'], 100);
  assert.equal(agg.products['hot아메리카노'].total, 1334);
  assert.equal(agg.products['hot아메리카노'].group, '커피');
  // 같은 상품이 달마다 다른 그룹이면 가장 최근 달의 그룹 (파일 순서와 무관)
  const c = parseSalesReport(SAMPLE.replace('2026-01-01   2026-01-31', '2025-12-01   2025-12-31').replace('00007 주스/병음료 골드메달사과주스', '00009 디저트 골드메달사과주스').replace('주스/병음료 합계 17 71,000 0', '디저트 합계 17 71,000 0'));
  assert.equal(aggregateSales([a, c]).products['골드메달사과주스'].group, '주스/병음료');
  assert.equal(aggregateSales([c, a]).products['골드메달사과주스'].group, '주스/병음료');
});

test('daysInMonth', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2026-07'), 31);
});

// 실제 보고서에는 금액이 음수인 줄이 있다 (포인트결제·계좌이체 등). 숫자 정규식이 마이너스를 못 읽으면
// 그 줄이 통째로 버려져 합계가 원본과 어긋난다 — 12개월 누계로 수량 5,509건·할인 275만원이 빠졌었다.
test('parseSalesReport: 금액이 음수인 줄도 읽는다', () => {
  const src = `그룹별 매출분석
( 2026-01-01   2026-01-31 ) ∼
그룹코드 상품그룹 상품 단가 수량 금액 할인
기타
포인트결제 0 -12 -24,000 -1,000
계좌이체 0 -1 -5,000 0
hot아메리카노 4,000 10 40,000 0
기타 합계 -3 11,000 -1,000
`;
  const rep = parseSalesReport(src);
  const by = Object.fromEntries(rep.rows.map((r) => [r.product, r]));
  assert.equal(rep.rows.length, 3);
  assert.equal(rep.unassigned, 0);
  assert.equal(by['포인트결제'].qty, -12);
  assert.equal(by['포인트결제'].amount, -24000);
  assert.equal(by['포인트결제'].discount, -1000);
  assert.equal(by['계좌이체'].amount, -5000);
  assert.equal(by['hot아메리카노'].amount, 40000);
  for (const r of rep.rows) assert.equal(r.group, '기타');
});
