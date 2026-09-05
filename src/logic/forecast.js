// 예상 재고: 지난 실측값 + 그 뒤 입고 − 소비 속도 × 경과일
//
// 소비 모델(consumption model)은 판매 자료 × 레시피로 만든 것(scripts/pos-analysis.mjs → data/consumption.json):
//   { version, source, months:[YYYY-MM], items: { itemId: { perDay: {YYYY-MM: n}, avgPerDay: n } } }
//   perDay는 "낱개(포장) / 일". 세는 단위가 박스인 품목은 boxSize로 박스 수로 바꾼다.

import { calcOrderLine, toEach } from './order.js';
import { dayNumber } from './stats.js';

/** 해당 날짜(YYYY-MM-DD)의 소비 속도(낱개/일). 같은 달 자료가 없으면 연평균. 모델에 없으면 null */
export function rateFor(model, itemId, dateStr) {
  const m = model?.items?.[itemId];
  if (!m) return null;
  const ym = dateStr.slice(0, 7);
  const sameMonth = m.perDay?.[ym];
  if (sameMonth != null) return sameMonth;
  // 다른 해의 같은 달
  const mm = ym.slice(5);
  const key = Object.keys(m.perDay || {}).find((k) => k.slice(5) === mm);
  if (key) return m.perDay[key];
  return m.avgPerDay ?? null;
}

function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** lastDate(포함 안 함) 다음 날부터 today(포함)까지 일별 소비 합 (낱개) */
export function consumedBetween(model, itemId, lastDate, today) {
  const days = dayNumber(today) - dayNumber(lastDate);
  if (days <= 0) return { consumed: 0, days: 0, rate: rateFor(model, itemId, today) };
  let consumed = 0;
  let last = null;
  for (let i = 1; i <= days; i++) {
    const d = addDays(lastDate, i);
    const r = rateFor(model, itemId, d);
    if (r == null) return { consumed: null, days, rate: null };
    consumed += r;
    last = r;
  }
  return { consumed, days, rate: last };
}

/**
 * 마지막 확정 조사값과 그 뒤 입고량을 찾는다 (품목의 세는 단위).
 */
export function lastKnown(item, sessions, orders) {
  const submitted = sessions.filter((s) => s.status === 'submitted' && s.counts?.[item.id] != null).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!submitted.length) return null;
  const s = submitted[0];
  let received = 0;
  for (const o of orders) {
    if (o.date < s.date) continue;
    for (const l of o.lines || []) {
      if (l.itemId !== item.id) continue;
      const each = toEach(item, l.qty, l.unit);
      received += (item.countUnit || 'ea') === 'box' ? each / (item.boxSize || 1) : each;
    }
  }
  return { count: s.counts[item.id], date: s.date, received };
}

/**
 * 예상 재고 계산.
 * @returns {null | { expected:number, low:number, high:number, days:number, ratePerDay:number, basis:{count,date,received}, needsCheck:boolean, qtyLow:number, qtyHigh:number }}
 */
export function forecastItem(item, model, sessions, orders, today) {
  if (!model?.items?.[item.id]) return null;
  const basis = lastKnown(item, sessions, orders);
  if (!basis) return null;
  const { consumed, days, rate } = consumedBetween(model, item.id, basis.date, today);
  if (consumed == null) return null;
  // 세는 단위가 박스면 낱개 소비를 박스로
  const perCount = (item.countUnit || 'ea') === 'box' ? (item.boxSize ? 1 / item.boxSize : null) : 1;
  if (perCount == null) return null;
  const used = consumed * perCount;
  const expectedRaw = basis.count + basis.received - used;
  const expected = Math.max(0, Math.round(expectedRaw));
  // 오차 범위: 소비량의 35% 또는 0.5개 중 큰 값 (기록이 쌓이면 실측 오차로 교체)
  const band = Math.max(0.5, used * 0.35);
  const low = Math.max(0, Math.floor(expectedRaw - band));
  const high = Math.max(0, Math.ceil(expectedRaw + band));
  const qtyLow = calcOrderLine(item, low).qty;
  const qtyHigh = calcOrderLine(item, high).qty;
  const qtyExp = calcOrderLine(item, expected).qty;
  const needsCheck = qtyLow !== qtyHigh || qtyExp !== qtyLow;
  return { expected, low, high, days, ratePerDay: (rate ?? 0) * perCount, basis, needsCheck, qtyLow, qtyHigh };
}

/** 모든 활성 품목의 예상값 */
export function forecastAll(items, model, sessions, orders, today) {
  const out = {};
  for (const it of items) {
    if (it.active === false) continue;
    const f = forecastItem(it, model, sessions, orders, today);
    if (f) out[it.id] = f;
  }
  return out;
}

/** 소비 모델 파일 검증 */
export function validateModel(obj) {
  if (!obj || typeof obj !== 'object' || typeof obj.items !== 'object' || obj.items === null) throw new Error('소비 모델 파일이 아닙니다');
  const items = {};
  for (const [id, v] of Object.entries(obj.items)) {
    if (!v || typeof v !== 'object') continue;
    const perDay = {};
    for (const [k, n] of Object.entries(v.perDay || {})) if (/^\d{4}-\d{2}$/.test(k) && Number.isFinite(n) && n >= 0) perDay[k] = n;
    const avg = Number.isFinite(v.avgPerDay) ? v.avgPerDay : Object.values(perDay).length ? Object.values(perDay).reduce((a, b) => a + b, 0) / Object.values(perDay).length : null;
    if (avg == null) continue;
    items[id] = { perDay, avgPerDay: avg };
  }
  if (!Object.keys(items).length) throw new Error('소비 모델에 품목이 없습니다');
  return { version: obj.version || 1, source: typeof obj.source === 'string' ? obj.source : '', months: Array.isArray(obj.months) ? obj.months : [], items };
}
