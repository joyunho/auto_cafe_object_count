// 판매 자료(data/analysis.json) → 품목별 "필요 재고(기준 수량)" 가이드라인
//   node scripts/par-guideline.mjs            → 표 출력 + data/par-guideline.json
//
// 규칙 (기획안과 같음):
//   기준 수량 = 그 품목을 가장 많이 쓴 달의 일평균 × 발주 간격(일) × 안전계수 1.5, 올림
//   발주 간격: 월요일 발주 → 목요일까지 3일 / 목요일 발주 → 월요일까지 4일
//   시트의 기준은 하나뿐이므로 긴 쪽(4일)을 권장값으로 삼는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_ITEMS } from '../src/data/items.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = JSON.parse(fs.readFileSync(path.join(root, 'data', 'analysis.json'), 'utf8'));

export const SAFETY = 1.5;
export const COVER = { mon_thu: 3, thu_mon: 4 };

/** 세는 단위(사람 말로) + 한 상자에 몇 개인지 — 구매표·시트에서 확인된 것만 */
const UNITS = {
  beans: ['봉', null, '1봉 1kg'],
  milk: ['팩', null, '1L 팩'],
  'condensed-milk': ['개', null, '500g'],
  'decaf-coldbrew': ['봉', null, '1봉 1L'],
  'sparkling-water': ['병', 30, '1병 190ml · 1박스 30병'],
  'vanilla-syrup': ['병', 6, '1L 병 (1box>6)'],
  'cafe-syrup': ['병', 6, '1.5L 병 (1box>6)'],
  'caramel-syrup': ['병', null, '750ml 병'],
  'caramel-sauce': ['병', null, '1.89L 병'],
  'choco-sauce': ['통', null, '2L(2.6kg)'],
  'hazelnut-syrup': ['병', null, '1L 병으로 봄'],
  grapefruit: ['통', null, '2kg'],
  'green-grape': ['통', null, '2kg'],
  'kiwi-sauce': ['통', null, '2kg'],
  'ice-tea': ['통', 6, '2kg (1box>6)'],
  'lemon-syrup': ['개/봉', null, '생레몬 1개 ≈ 청 100g · 건조레몬 1봉 100g'],
  'orange-garnish': ['봉', null, '1봉 100g'],
  'yuja-cheong': ['단지', 6, '2.2kg (3개 미만이면 1박스)'],
  'cheonggyul-cheong': ['단지', 6, '2.2kg (3개 미만이면 1박스)'],
  'strawberry-cheong': ['단지', null, '1단지 1kg'],
  'blueberry-cheong': ['단지', null, '1단지 1kg'],
  'boseong-green-tea': ['병', null, '1L 병'],
  'earl-grey': ['통', null, '1.2kg'],
  'pear-bellflower-tea': ['병', null, '1병 470g'],
  chamomile: ['통', null, '20티백'],
  rooibos: ['통', null, '30티백'],
  'pine-oolong': ['통', null, '20티백'],
  'jakseol-green-tea': ['통', null, '30티백'],
  'apple-tea': ['통', null, '25티백'],
  'cinnamon-powder': ['봉', null, '500g'],
  misugaru: ['봉', null, '1봉 1kg'],
  'grape-juice': ['병', null, '기준도 병 (사용자 확인)'],
  'golden-apple-juice': ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
  'sweet-apple': ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
  evian: ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
  'noa-orange': ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
  'noa-carrot': ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
  'noa-mango': ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
  'noa-kiwi': ['병', null, '기준은 박스 — 박스당 병 수 확인 필요'],
};
/** 1포장 양을 아직 몰라 낱개로 못 바꾼 품목: 원자료 단위 이름 */
const RAW_UNITS = { tomato: 'g', kiwi: 'g', jujube: '조각', 'pine-nut': '개', 'ice-cream': '스쿱' };

const par = (perDay, days) => (perDay > 0 ? Math.max(1, Math.ceil(perDay * days * SAFETY)) : null);
const itemIndex = Object.fromEntries(SEED_ITEMS.map((it) => [it.id, it]));

export const rows = a.items
  .map((r) => {
    const it = itemIndex[r.itemId];
    const [unit, boxSize, spec] = UNITS[r.itemId] || [];
    const known = r.perPackage != null;
    return {
      itemId: r.itemId,
      name: r.name,
      group: it?.group || '',
      unit: known ? unit || '개' : RAW_UNITS[r.itemId] || r.unit,
      spec: spec || '',
      known,
      perPackage: r.perPackage,
      avgPerDay: known ? r.avgPerDay : r.totalRaw / 365,
      peakPerDay: known ? r.peakPerDay : null,
      monThu: known ? par(r.peakPerDay, COVER.mon_thu) : null,
      thuMon: known ? par(r.peakPerDay, COVER.thu_mon) : null,
      boxSize: boxSize || null,
      sheetPar: it?.par ?? null,
      sheetParUnit: it?.parUnit || 'ea',
      assumed: !!r.assumed,
      note: r.note || '',
      sources: r.sources || [],
    };
  })
  .sort((x, y) => (y.thuMon || 0) - (x.thuMon || 0) || (y.avgPerDay || 0) - (x.avgPerDay || 0));

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.writeFileSync(path.join(root, 'data', 'par-guideline.json'), JSON.stringify({ generatedAt: new Date().toISOString(), months: a.months, safety: SAFETY, cover: COVER, rows }, null, 1));
  const f = (x, d = 2) => (x == null ? '-' : x.toFixed(d));
  console.log('품목 | 단위 | 일평균 | 최대월/일 | 월→목(3일) | 목→월(4일) | 지금 시트 기준 | 비고');
  for (const r of rows) {
    const box = r.boxSize && r.thuMon ? ` (=${Math.ceil(r.thuMon / r.boxSize)}박스)` : '';
    console.log(
      [r.name, r.unit, f(r.avgPerDay), f(r.peakPerDay), r.monThu ?? '-', (r.thuMon ?? '-') + box, r.sheetPar ?? '-', (r.assumed ? '추정 포함 ' : '') + (r.known ? '' : '1포장 양 모름')].join(' | '),
    );
  }
}
