// 재고 기록 기반 통계: 소비량 추정, 기준 수량 제안
//
// session: { id, date: 'YYYY-MM-DD', counts: {itemId: number|null}, status: 'submitted'|'draft' }
//   counts 값은 각 품목의 countUnit 단위 — 여기서는 모두 낱개로 환산해 계산한다.
// order  : { id, sessionId, date, lines: [{itemId, qty, unit}] }
//
// 소비량 추정 원리:
//   연속된 두 재고조사 사이의 소비량 ≈ (이전 재고 + 그 사이 입고량) − 이번 재고
//   입고량은 이전 조사 직후 확정된 발주(낱개 환산)로 근사한다.

import { toEach, countToEach } from './order.js';

/** 날짜 문자열 → 일수 (정수) */
export function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * 품목별 소비 통계 (낱개 기준).
 * @returns {Record<itemId, {samples:number, avgPerDay:number|null, avgPerPeriod:number|null, lastCount:number|null, lastDate:string|null}>}
 */
export function consumptionStats(items, sessions, orders, { periodDays = 3.5 } = {}) {
  const submitted = sessions
    .filter((s) => s.status === 'submitted')
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const result = {};
  for (const item of items) {
    const usages = []; // {days, used}
    let lastCount = null;
    let lastDate = null;
    for (let i = 0; i < submitted.length; i++) {
      const s = submitted[i];
      const raw = s.counts?.[item.id];
      if (raw == null) continue;
      const c = countToEach(item, raw);
      lastCount = c;
      lastDate = s.date;
      if (i === 0) continue;
      // 직전 조사 중 이 품목이 입력된 것을 찾는다
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (submitted[j].counts?.[item.id] != null) {
          prev = submitted[j];
          break;
        }
      }
      if (!prev) continue;
      const days = dayNumber(s.date) - dayNumber(prev.date);
      if (days <= 0) continue;
      // prev 이후, s 이전에 확정된 발주 입고량
      let received = 0;
      for (const o of orders) {
        if (o.date >= prev.date && o.date < s.date) {
          for (const l of o.lines || []) {
            if (l.itemId === item.id) received += toEach(item, l.qty, l.unit);
          }
        }
      }
      const used = countToEach(item, prev.counts[item.id]) + received - c;
      if (used < 0) continue; // 발주 외 입고 등 — 신뢰 불가, 제외
      usages.push({ days, used });
    }
    if (!usages.length) {
      result[item.id] = { samples: 0, avgPerDay: null, avgPerPeriod: null, lastCount, lastDate };
      continue;
    }
    const totalDays = usages.reduce((a, u) => a + u.days, 0);
    const totalUsed = usages.reduce((a, u) => a + u.used, 0);
    const avgPerDay = totalUsed / totalDays;
    result[item.id] = {
      samples: usages.length,
      avgPerDay,
      avgPerPeriod: avgPerDay * periodDays,
      lastCount,
      lastDate,
    };
  }
  return result;
}

/**
 * 기준 수량 제안(낱개): 한 발주 주기(월→목 3일, 목→월 4일) 소비량 + 안전재고.
 * - 표본이 3회 미만이면 제안하지 않는다.
 * - 재발주점 규칙 품목은 기준이 발주량에 영향을 주지 않으므로 제안하지 않는다.
 * - 소비가 거의 없어 제안값이 1 미만이면 제안하지 않는다(기준 0은 발주를 끊어 버린다).
 */
export function suggestPar(item, stat, { periodDays = 4, safetyFactor = 1.5, minSamples = 3 } = {}) {
  if (!stat || stat.samples < minSamples || stat.avgPerDay == null) return null;
  if (item.rule && item.rule.type === 'reorderPoint') return null;
  const perPeriod = stat.avgPerDay * periodDays;
  const suggested = Math.ceil(perPeriod * safetyFactor);
  if (suggested < 1) return null;
  const currentPar = item.par == null ? null : toEach(item, item.par, item.parUnit || 'ea');
  if (currentPar != null && Math.abs(suggested - currentPar) <= Math.max(1, currentPar * 0.2)) return null;
  return { suggested, currentPar, perPeriod: Math.round(perPeriod * 10) / 10 };
}

/** 최근 N회 조사에서 현재 수량이 0인 횟수(품절 빈도) */
export function stockoutCount(itemId, sessions, n = 6) {
  const recent = sessions
    .filter((s) => s.status === 'submitted')
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, n);
  return recent.filter((s) => s.counts?.[itemId] === 0).length;
}
