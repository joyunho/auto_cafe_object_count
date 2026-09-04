// 발주 수량 계산 로직 (순수 함수 — UI/저장소에 의존하지 않음)
//
// 품목(item) 필드:
//   par        : 기준 재고 수량(시트의 빨간 숫자). null이면 자동 계산 불가.
//   parUnit    : 'ea' | 'box' — par 값의 단위 (예: 배도라지차 "2BOX" → par 2, parUnit 'box')
//   boxSize    : 1박스에 든 개수 (예: "(1box>6)" → 6). null이면 모름.
//   orderUnit  : 'ea' | 'box' — 발주서에 적는 단위. boxSize가 있으면 보통 'box'.
//   countUnit  : 'ea' | 'box' — 재고조사 때 입력하는 단위. 저장된 count 값은 이 단위다.
//   rule       : null | { type: 'reorderPoint', threshold: n, orderQty: n }
//                 → 현재 수량(낱개)이 threshold 미만이면 orderQty(orderUnit 단위)만큼 발주
//   minOrder   : 최소 발주 수량(orderUnit 단위). null이면 없음.
//
// 단위 규칙: par/count/order 단위가 서로 다르면 boxSize가 있어야 환산할 수 있다.
// 모두 같은 단위(예: 배도라지차 — 전부 박스)면 boxSize 없이도 계산된다.
//
// 반환(OrderLine):
//   { itemId, name, current, currentEach, par, need, qty, unit, reason, auto }
//   current     : 입력된 원래 값(countUnit 단위) — 표시용
//   currentEach : 낱개로 환산한 값
//   need        : 기준 대비 부족한 낱개 수량
//   qty         : 실제 발주 수량 (unit 단위)
//   auto        : true면 자동 계산, false면 계산 불가(미입력, 기준 없음, 단위 미설정)

export function toEach(item, value, unit) {
  if (value == null) return null;
  if (unit === 'box') return value * (item.boxSize || 1);
  return value;
}

/** par 값을 낱개 수로 환산 */
export function parInEach(item) {
  if (item.par == null) return null;
  return toEach(item, item.par, item.parUnit || 'ea');
}

/** par 값을 세는 단위(countUnit)로 환산 — 재고조사 화면의 "기준(N)" 버튼용 */
export function parInCountUnit(item) {
  const each = parInEach(item);
  if (each == null) return null;
  if ((item.countUnit || 'ea') === 'box') return Math.ceil(each / (item.boxSize || 1));
  return each;
}

/** 저장된 count(countUnit 단위) → 낱개 */
export function countToEach(item, count) {
  if (count == null) return null;
  return toEach(item, count, item.countUnit || 'ea');
}

/** par/count/order 단위가 섞여 있는데 boxSize가 없으면 환산 불가 */
export function unitsUnresolved(item) {
  const units = new Set([item.parUnit || 'ea', item.countUnit || 'ea', item.orderUnit || (item.boxSize ? 'box' : 'ea')]);
  return units.size > 1 && !item.boxSize;
}

/**
 * 단일 품목의 발주 수량 계산.
 * @param {object} item 품목
 * @param {number|null} current 현재 재고(품목의 countUnit 단위). null이면 미입력.
 */
export function calcOrderLine(item, current) {
  const unit = item.orderUnit || (item.boxSize ? 'box' : 'ea');
  const base = { itemId: item.id, name: item.name, current, currentEach: null, par: item.par, parUnit: item.parUnit || 'ea', unit };
  const hasRule = !!(item.rule && item.rule.type === 'reorderPoint');

  // 기준도 규칙도 없는 품목은 수량을 세어도 계산할 것이 없다 — 미입력 경고 대신 "기준 없음"으로 안내
  if (item.par == null && !hasRule) {
    if (current != null && !Number.isNaN(current)) base.current = Math.max(0, current);
    return { ...base, need: null, qty: 0, reason: '기준 수량 없음', auto: false };
  }

  if (current == null || Number.isNaN(current)) {
    return { ...base, need: null, qty: 0, reason: '미입력', auto: false };
  }
  if (current < 0) current = 0;
  base.current = current;

  if (unitsUnresolved(item)) {
    return { ...base, need: null, qty: 0, reason: '1박스 개수 미설정', auto: false };
  }

  const currentEach = countToEach(item, current);
  base.currentEach = currentEach;
  const parEach = parInEach(item);

  // 재발주점 규칙(예: 유자청/청귤청 — 3개 미만이면 1박스)
  if (item.rule && item.rule.type === 'reorderPoint') {
    const { threshold, orderQty } = item.rule;
    if (currentEach < threshold) {
      const qty = Math.max(orderQty, item.minOrder || 0);
      return {
        ...base,
        need: parEach != null ? Math.max(0, parEach - currentEach) : null,
        qty,
        reason: `${threshold}개 미만 → ${qty}${unitLabel(unit)} 발주`,
        auto: true,
      };
    }
    return { ...base, need: parEach != null ? Math.max(0, parEach - currentEach) : 0, qty: 0, reason: `${threshold}개 이상 보유`, auto: true };
  }

  if (parEach == null) {
    return { ...base, need: null, qty: 0, reason: '기준 수량 없음', auto: false };
  }

  const need = Math.max(0, parEach - currentEach);
  if (need === 0) {
    return { ...base, need: 0, qty: 0, reason: '충분', auto: true };
  }

  let qty;
  if (unit === 'box') {
    const size = item.boxSize || 1;
    qty = Math.ceil(need / size);
  } else {
    qty = need;
  }
  if (item.minOrder && qty < item.minOrder) qty = item.minOrder;

  const curLabel = (item.countUnit || 'ea') === 'box' ? `${current}박스` : `${current}`;
  const parLabel = (item.parUnit || 'ea') === 'box' ? `${item.par}박스` : `${parEach}`;
  const needLabel = unit === 'box' && (item.parUnit || 'ea') === 'box' && (item.countUnit || 'ea') === 'box' ? `${qty}박스` : `${need}개`;
  return { ...base, need, qty, reason: `기준 ${parLabel} − 현재 ${curLabel} = ${needLabel} 부족`, auto: true };
}

/**
 * 전체 품목에 대해 발주 라인 계산.
 * @param {object[]} items 품목 목록
 * @param {Record<string, number|null>} counts itemId → 현재 수량(각 품목의 countUnit 단위)
 * @param {Record<string, number>} [overrides] itemId → 사용자가 수정한 발주 수량
 */
export function calcOrder(items, counts, overrides = {}) {
  return items
    .filter((it) => it.active !== false)
    .map((it) => {
      const line = calcOrderLine(it, counts[it.id] ?? null);
      if (overrides[it.id] != null) {
        return { ...line, qty: overrides[it.id], overridden: true };
      }
      return line;
    });
}

export function unitLabel(unit) {
  return unit === 'box' ? '박스' : '개';
}

/** 발주할 것이 있는 라인만 */
export function linesToOrder(lines) {
  return lines.filter((l) => l.qty > 0);
}

/**
 * 카카오톡 등으로 보낼 발주 문자열 생성.
 * @param {object[]} lines calcOrder 결과
 * @param {object} opts { title, date, groups: [{title, itemIds}], store, sender }
 */
export function formatOrderText(lines, opts = {}) {
  const toOrder = linesToOrder(lines);
  const header = [];
  if (opts.title) header.push(opts.title);
  if (opts.date) header.push(`발주일: ${opts.date}`);
  if (opts.store) header.push(`매장: ${opts.store}`);

  const body = [];
  if (toOrder.length === 0) {
    body.push('발주할 품목이 없습니다.');
  } else if (opts.groups && opts.groups.length) {
    const seen = new Set();
    for (const g of opts.groups) {
      const gl = toOrder.filter((l) => g.itemIds.includes(l.itemId));
      if (!gl.length) continue;
      body.push(`[${g.title}]`);
      for (const l of gl) {
        body.push(formatLine(l));
        seen.add(l.itemId);
      }
    }
    const rest = toOrder.filter((l) => !seen.has(l.itemId));
    if (rest.length) {
      body.push('[기타]');
      for (const l of rest) body.push(formatLine(l));
    }
  } else {
    for (const l of toOrder) body.push(formatLine(l));
  }

  const footer = [];
  if (opts.sender) footer.push(`담당: ${opts.sender}`);
  footer.push(`총 ${toOrder.length}개 품목`);

  return [...header, header.length ? '' : null, ...body, '', ...footer].filter((x) => x !== null).join('\n');
}

export function formatLine(l) {
  const u = l.unit === 'box' ? '박스' : '개';
  return `- ${l.name} ${l.qty}${u}`;
}

/** 요일 기준으로 다음 발주일(월/목) 계산 — 오늘이 발주일이면 오늘 */
export function nextOrderDate(from = new Date(), orderDays = [1, 4]) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 8; i++) {
    if (orderDays.includes(d.getDay())) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function weekdayKo(d) {
  return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
}
