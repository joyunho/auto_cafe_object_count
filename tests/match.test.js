import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, similarity, matchItem, matchRecognized, levenshtein } from '../src/logic/match.js';

const items = [
  { id: 'yuja', name: '유자청' },
  { id: 'cheonggyul', name: '청귤청' },
  { id: 'icetea', name: '아이스티(1box>6)', aliases: ['아이스티'] },
  { id: 'cafe-syrup', name: '카페시럽(1box>6)' },
  { id: 'lemon-fruit', name: '레몬' },
  { id: 'lemon-tea', name: '레몬티', aliases: ['레몬 (티)'] },
  { id: 'noa-orange', name: '노아(오렌지)' },
  { id: 'noa-mango', name: '노아(망고)' },
];

test('normalizeName은 공백/괄호/박스표기를 제거', () => {
  assert.equal(normalizeName('아이스티 (1box>6)'), '아이스티');
  assert.equal(normalizeName('노아 (오렌지)'), '노아오렌지');
});

test('levenshtein', () => {
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', 'abd'), 1);
  assert.equal(levenshtein('', 'ab'), 2);
});

test('similarity: 동일 1, 부분일치 0.8+, 무관 낮음', () => {
  assert.equal(similarity('유자청', '유자청'), 1);
  assert.ok(similarity('아이스티', '아이스티(1box>6)') >= 0.8);
  assert.ok(similarity('유자청', '초코소스') < 0.4);
});

test('matchItem: 정확/별칭/괄호 무시 매칭', () => {
  assert.equal(matchItem('유자청', items).item.id, 'yuja');
  assert.equal(matchItem('아이스티', items).item.id, 'icetea');
  assert.equal(matchItem('카페 시럽', items).item.id, 'cafe-syrup');
  assert.equal(matchItem('노아 (망고)', items).item.id, 'noa-mango');
});

test('matchItem: 짧은 이름끼리 혼동하지 않음', () => {
  assert.equal(matchItem('레몬', items).item.id, 'lemon-fruit');
  assert.equal(matchItem('레몬티', items).item.id, 'lemon-tea');
});

test('matchItem: 임계값 미만이면 null', () => {
  assert.equal(matchItem('완전다른것', items), null);
});

test('matchRecognized: 중복 인식 시 점수 높은 것 채택, 나머지 unmatched', () => {
  const rec = [
    { name: '유자청', count: 2 },
    { name: '유자 청', count: 3 },
    { name: '알수없음xyz', count: 1 },
  ];
  const { matched, unmatched } = matchRecognized(rec, items);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].itemId, 'yuja');
  assert.equal(matched[0].count, 2);
  assert.equal(unmatched.length, 2);
});
