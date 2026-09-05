// POS "그룹별 매출분석" 보고서(텍스트) 파서
//
// 보고서를 PDF로 인쇄한 파일에서 뽑은 텍스트를 받아 상품별 판매 수량을 돌려준다.
// 줄 형식:  상품명 단가 수량 금액 할인   (숫자는 1,234 형식)
//           그룹명 합계 수량 금액 할인   ← 그 위의 상품 줄들이 이 그룹에 속함
// 기간:     ( 2026-01-01   2026-01-31 ) ∼

const GROUP_NAMES = ['커피', '티', '에이드', '디저트', '빵', '라떼', '주스/병음료', '브런치/밀키트', '쇼케이스', '진동벨'];

/** 상품명 정리: 앞에 붙은 그룹코드/그룹명 제거, 공백 정리 */
export function normalizeProduct(name) {
  let s = String(name || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/^\d{5}\s+/, '');
  for (const g of GROUP_NAMES) {
    if (s.startsWith(g + ' ') && s.length > g.length + 1) s = s.slice(g.length + 1);
  }
  return s.trim();
}

export function normalizeGroup(name) {
  return String(name || '').trim().replace(/^\d{5}\s+/, '');
}

const num = (s) => Number(String(s).replace(/,/g, ''));

/**
 * @param {string} text 보고서 텍스트 (여러 페이지 이어붙인 것)
 * @returns {{ period: {from:string,to:string,month:string}|null, rows: {group:string, product:string, price:number, qty:number, amount:number, discount:number}[], unassigned: number }}
 */
export function parseSalesReport(text) {
  const rows = [];
  let period = null;
  const pm = /\(\s*(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/.exec(text);
  if (pm) period = { from: pm[1], to: pm[2], month: pm[1].slice(0, 7) };
  let pending = [];
  let unassigned = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('Page ') || line.includes('그룹코드')) continue;
    const total = /^(.+?)\s+합계\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/.exec(line);
    if (total) {
      const group = normalizeGroup(total[1]);
      for (const r of pending) rows.push({ ...r, group });
      pending = [];
      continue;
    }
    const m = /^(.+?)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    if (/^\d{5}$/.test(name)) continue; // 그룹코드만 있는 줄
    pending.push({ product: normalizeProduct(name), price: num(m[2]), qty: num(m[3]), amount: num(m[4]), discount: num(m[5]) });
  }
  if (pending.length) {
    unassigned = pending.length;
    for (const r of pending) rows.push({ ...r, group: '' });
  }
  return { period, rows, unassigned };
}

/**
 * 여러 달 보고서를 상품×월 수량표로 합친다.
 * @param {{period, rows}[]} reports parseSalesReport 결과들
 * @returns {{ months: string[], products: Record<string, {group:string, byMonth: Record<string, number>, total:number}> }}
 */
export function aggregateSales(reports) {
  const months = [];
  const products = {};
  // 달 순서로 처리해 같은 상품이 여러 그룹에 나오면 가장 최근 달의 그룹을 쓴다 (파일 읽기 순서와 무관)
  const sorted = [...reports].sort((a, b) => String(a.period?.month || '').localeCompare(String(b.period?.month || '')));
  for (const rep of sorted) {
    const month = rep.period?.month || `m${months.length + 1}`;
    if (!months.includes(month)) months.push(month);
    for (const r of rep.rows) {
      const p = (products[r.product] ||= { group: r.group, byMonth: {}, total: 0 });
      if (r.group) p.group = r.group;
      p.byMonth[month] = (p.byMonth[month] || 0) + r.qty;
      p.total += r.qty;
    }
  }
  months.sort();
  return { months, products };
}

/** 'YYYY-MM' → 그 달의 일수 */
export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
