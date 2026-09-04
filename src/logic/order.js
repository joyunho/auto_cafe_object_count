// 발주 수량 계산 로직 (순수 함수 — UI/저장소에 의존하지 않음)
//
// 품목(item) 필드:
//   par        : 기준 재고 수량(시트의 빨간 숫자). null이면 자동 계산 불가.
//   parUnit    : 'ea' | 'box' — par 값의 단위 (예: 배도라지차 "2BOX" → par 2, parUnit 'box')
//   boxSize    : 1박스에 든 개수 (예: "(1box>6)" → 6). null이면 낱개 발주.
//   orderUnit  : 'ea' | 'box' — 발주서에 적는 단위. boxSize가 있으면 보통 'box'.
//   rule       : null | { type: 'reorderPoint', threshold: n, orderQty: n }
//                 → 현재 수량이 threshold 미만이면 orderQty(orderUnit 단위)만큼 발주
//   minOrder   : 최소 발주 수량(orderUnit 단위). null이면 없음.
//
// 반환(OrderLine):
//   { itemId, name, current, par, need, qty, unit, reason, auto }
//   need : 기준 대비 부족한 낱개 수량
//   qty  : 실제 발주 수량 (unit 단위)
//   auto : true면 자동 계산, false면 계산 불가(현재 수량 미입력 등)

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

/**
 * 단일 품목의 발주 수량 계산.
 * @param {object} item 품목
 * @param {number|null} current 현재 재고(낱개 기준). null이면 미입력.
 */
export function calcOrderLine(item, current) {
  const unit = item.orderUnit || (item.boxSize ? 'box' : 'ea');
  const base = { itemId: item.id, name: item.name, current, par: item.par, parUnit: item.parUnit || 'ea', unit };

  if (current == null || Number.isNaN(current)) {
    return { ...base, need: null, qty: 0, reason: '미입력', auto: false };
  }
  if (current < 0) current = 0;

  const parEach = parInEach(item);

  // 재발주점 규칙(예: 유자청/청귤청 — 3개 미만이면 1박스)
  if (item.rule && item.rule.type === 'reorderPoint') {
    const { threshold, orderQty } = item.rule;
    if (current < threshold) {
      const qty = Math.max(orderQty, item.minOrder || 0);
      return {
        ...base,
        need: parEach != null ? Math.max(0, parEach - current) : null,
        qty,
        reason: `${threshold}개 미만 → ${qty}${unitLabel(unit)} 발주`,
        auto: true,
      };
    }
    return { ...base, need: parEach != null ? Math.max(0, parEach - current) : 0, qty: 0, reason: `${threshold}개 이상 보유`, auto: true };
  }

  if (parEach == null) {
    return { ...base, need: null, qty: 0, reason: '기준 수량 없음', auto: false };
  }

  const need = Math.max(0, parEach - current);
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

  return { ...base, need, qty, reason: `기준 ${parEach} − 현재 ${current} = ${need}개 부족`, auto: true };
}

/**
 * 전체 품목에 대해 발주 라인 계산.
 * @param {object[]} items 품목 목록
 * @param {Record<string, number|null>} counts itemId → 현재 수량
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
