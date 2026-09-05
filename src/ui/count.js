// 재고조사 탭 — 장부(제품/자재)별로 품목을 세고, 종이 시트처럼 "이름 · 빨간 기준 · 검은 숫자"만 보이게 한다
import { esc } from './html.js';
import { parInCountUnit, unitLabel, unitsUnresolved, formatDate, calcOrderLine } from '../logic/order.js';
import { forecastAll } from '../logic/forecast.js';
import { BOOKS } from '../data/books.js';

function activeItems(s, book) {
  return s.items.filter((it) => it.active !== false && (it.book || 'product') === book);
}

export function progress(s, sess) {
  const items = activeItems(s, sess.book || 'product');
  const done = items.filter((it) => sess.counts[it.id] != null).length;
  return { done, total: items.length };
}

/** 소비 모델이 있으면 품목별 예상 재고 (없으면 빈 객체) */
export function forecasts(s) {
  if (!s.consumption) return {};
  return forecastAll(s.items, s.consumption, s.sessions, s.orders, formatDate(new Date()));
}

/** 장부 전환 (제품 / 자재) */
export function bookSwitch(s) {
  const cur = s.ui.book || 'product';
  return `<div class="seg" role="tablist" aria-label="장부">${BOOKS.map(
    (b) => `<button type="button" role="tab" data-action="book-switch" data-book="${b.id}" class="${b.id === cur ? 'on' : ''}" aria-selected="${b.id === cur}">${esc(b.short)} <span class="tiny">${esc(b.dayText)}</span></button>`,
  ).join('')}</div>`;
}

/** 기준 수량의 단위 (시트에 적힌 단위) */
function parUnitLabel(it) {
  return it.parUnit === 'box' ? '박스' : unitLabel('ea', it);
}

/**
 * 기준 숫자 아래 한 줄짜리 고정 칸. 우선순위:
 *   센 수량으로 발주가 나오면 "발주 N단위" → 예상값이 "확인 필요"인데 아직 안 셌으면 "확인 필요" → 단위
 */
function parSubHtml(it, val, needsCheck, override) {
  if (val != null) {
    const l = calcOrderLine(it, val);
    const qty = override != null ? override : l.qty;
    if (qty > 0) return `<span class="par-sub order-hint">발주 ${qty}${esc(unitLabel(l.unit, it))}</span>`;
  } else if (needsCheck) {
    return '<span class="par-sub check-hint">확인 필요</span>';
  }
  if (it.par == null) return '<span class="par-sub muted">기준 없음</span>';
  return `<span class="par-sub muted">${esc(parUnitLabel(it))}</span>`;
}

/** 기준 수량 열 — 시트의 빨간 인쇄 숫자. 모든 줄에서 같은 자리에 오도록 폭이 고정된 열이다 */
function parCol(it, val, needsCheck, override) {
  const digit = it.par == null ? '<b class="par none" aria-label="기준 없음">–</b>' : `<b class="par">${it.par}</b>`;
  return `<div class="par-col" aria-label="기준 수량">${digit}${parSubHtml(it, val, needsCheck, override)}</div>`;
}

/** 부가 정보 줄 — 누른 줄에서만 보인다 */
function itemMeta(it, f) {
  const parts = [];
  if (it.boxSize) parts.push(`1박스=${it.boxSize}개`);
  if (it.rule?.type === 'reorderPoint') parts.push(`${it.rule.threshold}${unitLabel('ea', it)} 미만이면 ${it.rule.orderQty}${unitLabel(it.orderUnit, it)} 발주`);
  if (it.countUnit === 'box') parts.push('<b>박스 단위로 세기</b>');
  if (unitsUnresolved(it)) parts.push('<span style="color:var(--warn)">1박스 개수 미설정 — 품목 탭에서 입력</span>');
  if (f) {
    const u = it.countUnit === 'box' ? '박스' : unitLabel('ea', it);
    const when = f.days === 0 ? '오늘' : f.days === 1 ? '어제' : `${f.days}일 전`;
    parts.push(`예상 <b>${f.expected}${u}</b> <span class="tiny">(${f.low}~${f.high}, ${when} ${f.basis.count}${u}${f.basis.received ? ` + 입고 ${f.basis.received}` : ''}${f.estimated ? ', 포장 크기 추정' : ''})</span>`);
    if (f.stale) parts.push('<span style="color:var(--warn)">실측한 지 오래됨</span>');
    else if (f.crossesZero) parts.push('<span style="color:var(--warn)">떨어졌을 수 있음</span>');
  }
  return parts.join(' · ');
}

function rowHtml(it, val, f, override) {
  const has = val != null;
  const parCount = parInCountUnit(it);
  const unit = it.countUnit === 'box' ? '박스' : it.unitName || '';
  const check = !!f?.needsCheck;
  const meta = itemMeta(it, f);
  return `
    <div class="item-row ${has ? 'done' : ''} ${check ? 'needs-check' : ''}" data-row="${esc(it.id)}">
      <div class="item-main" data-action="row-focus" data-id="${esc(it.id)}">
        <div class="name">${esc(it.name)}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
      ${parCol(it, val, check, override)}
      <div class="item-ctl">
        <div class="stepper" role="group" aria-label="${esc(it.name)} 수량">
          <button type="button" data-action="count-dec" data-id="${esc(it.id)}" aria-label="1 빼기">−</button>
          <input type="number" inputmode="decimal" min="0" step="0.5" data-input="count" data-id="${esc(it.id)}"
            value="${has ? val : ''}" placeholder="${f ? f.expected : '–'}" class="${has ? '' : 'blank'}" aria-label="${esc(it.name)} 현재 수량${unit ? ` (${esc(unit)})` : ''}" />
          <button type="button" data-action="count-inc" data-id="${esc(it.id)}" aria-label="1 더하기">+</button>
        </div>
      </div>
      <div class="quick">
        <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="0">0</button>
        ${f ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${f.expected}">예상(${f.expected})</button>` : ''}
        ${parCount != null ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${parCount}">기준(${parCount}${esc(unit)})</button>` : ''}
        <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="" title="입력 지우기">지움</button>
      </div>
    </div>`;
}

function progressText(done, total, book) {
  return `${done}/${total} 입력${book === 'supply' ? ' · 지하창고 기준' : ''}`;
}

/** 그룹 칩 안쪽 — 하나라도 세기 시작한 그룹에만 분수를 붙인다 */
function chipInner(title, d, n) {
  return `${esc(title)}${d > 0 ? ` <b>${d}/${n}</b>` : ''}`;
}

export function render(s, app) {
  const book = app.book();
  const info = app.bookInfo();
  const sess = app.activeSession();
  const { done, total } = progress(s, sess);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fc = book === 'product' ? forecasts(s) : {};
  const nForecast = Object.keys(fc).length;
  const nCheck = Object.values(fc).filter((f) => f.needsCheck).length;
  // 예상값이 하나도 없으면(모델 지움 등) 필터를 적용하지 않는다 — 체크박스도 안 보이므로 품목이 사라지면 안 됨
  const onlyCheck = nForecast > 0 && !!s.ui.countOnlyCheck;
  const visible = (it) => !onlyCheck || fc[it.id]?.needsCheck || (sess.counts[it.id] == null && !fc[it.id]);
  const items = activeItems(s, book);
  const groups = s.groups
    .filter((g) => (g.book || 'product') === book)
    .map((g) => ({ g, items: items.filter((it) => it.group === g.id && visible(it)) }))
    .filter((x) => x.items.length);
  const ungrouped = items.filter((it) => !s.groups.some((g) => g.id === it.group) && visible(it));
  const stale = sess.date < formatDate(new Date());
  const dense = s.ui.countDense !== false; // 기본: 작게(촘촘히)
  const overrides = sess.overrides || {};
  // 그룹 칩: 상단에 붙어 다니는 그룹 이동 + 진행 표시
  const allGroups = s.groups.filter((g) => (g.book || 'product') === book).map((g) => ({ g, items: items.filter((it) => it.group === g.id) })).filter((x) => x.items.length);
  const chips = allGroups
    .map(({ g, items: gi }) => {
      const d = gi.filter((it) => sess.counts[it.id] != null).length;
      const cls = d === gi.length ? 'done' : d ? 'part' : '';
      return `<button type="button" class="chip ${cls}" data-action="jump-group" data-id="${esc(g.id)}">${chipInner(g.title, d, gi.length)}</button>`;
    })
    .join('');

  const rows = (list) => list.map((it) => rowHtml(it, sess.counts[it.id], fc[it.id], overrides[it.id])).join('');

  return `
    ${bookSwitch(s)}
    <section class="card compact count-head">
      <div class="count-head-row">
        <div class="count-title">
          <h2>${esc(info.short)} 재고조사</h2>
          <span class="small muted" id="progress-text">${progressText(done, total, book)}</span>
        </div>
        <input type="date" value="${esc(sess.date)}" data-change="session-date" aria-label="발주일" class="date-input" />
        <details class="menu">
          <summary class="btn sm ghost" aria-label="더보기">⋯</summary>
          <div class="menu-panel">
            <button type="button" class="btn sm ghost" data-action="photo-open">📷 사진으로 입력</button>
            ${nForecast ? `<button type="button" class="btn sm ghost" data-action="count-fill-forecast">안 센 품목을 예상값으로 채우기</button>` : ''}
            <button type="button" class="btn sm ghost" data-action="count-fill-par">안 센 품목을 기준 수량으로 채우기</button>
            <button type="button" class="btn sm ghost" data-action="count-clear">입력 전부 지우기</button>
            <button type="button" class="btn sm ghost" data-action="count-dense-toggle" aria-pressed="${dense}">${dense ? '크게 보기' : '작게 보기'}</button>
          </div>
        </details>
      </div>
      ${stale ? `<p class="small head-line" style="color:var(--warn)">지난 발주일(${esc(sess.date)})로 진행 중입니다. 날짜를 확인하세요.</p>` : ''}
      ${
        nForecast
          ? `<label class="row small head-line"><span class="pill ${nCheck ? 'warn' : 'ok'}">확인 필요 ${nCheck}</span><input type="checkbox" data-change="count-only-check" ${onlyCheck ? 'checked' : ''}/> <span class="muted">확인 필요·예상 없는 품목만 보기</span></label>`
          : ''
      }
      <div class="progress" aria-hidden="true"><div id="progress-bar" style="width:${pct}%"></div></div>
    </section>

    ${chips ? `<div class="chips" aria-label="그룹 이동"><div class="chips-scroll">${chips}</div></div>` : ''}
    <div class="${dense ? 'dense' : ''}" id="count-list">
    ${groups
      .map(
        ({ g, items }) => `
      <section class="group" id="g-${esc(g.id)}">
        <div class="group-head"><span>${esc(g.title)}</span></div>
        <div class="item-list">${rows(items)}</div>
      </section>`,
      )
      .join('')}
    ${ungrouped.length ? `<section class="group"><div class="group-head"><span>기타</span></div><div class="item-list">${rows(ungrouped)}</div></section>` : ''}
    </div>
    ${onlyCheck && !groups.length && !ungrouped.length ? `<div class="card empty">확인이 필요한 품목이 없습니다. 예상값을 채우고 발주서로 넘어가세요.</div>` : ''}
    ${!groups.length && !ungrouped.length && !onlyCheck ? `<div class="card empty">이 장부에 품목이 없습니다. 품목 탭에서 추가하세요.</div>` : ''}
    ${groups.length || ungrouped.length ? `<button type="button" class="btn block" data-action="tab" data-tab="order">${esc(info.short)} 발주서 확인 →</button>` : ''}`;
}

/** 숫자 칸에 포커스가 가면 그 줄만 빠른 버튼을 펼친다 (iOS는 버튼 탭으로 포커스가 안 바뀌므로 클래스로 관리) */
export function afterRender(s, app) {
  const main = app.root?.querySelector('main.view');
  if (!main) return;
  main.addEventListener('focusin', (e) => {
    const row = e.target.closest?.('.item-row');
    if (row && e.target.matches('input[data-input="count"]')) setActiveRow(row);
  });
  // ⋯ 메뉴: 항목을 누르거나 바깥을 누르면 닫는다 (상태가 바뀌는 항목은 다시 그려지며 저절로 닫힌다)
  main.addEventListener('click', (e) => {
    const open = main.querySelector('details.menu[open]');
    if (!open || e.target.closest?.('summary')) return;
    if (!open.contains(e.target) || e.target.closest('[data-action]')) open.open = false;
  });
}

function setActiveRow(row) {
  document.querySelectorAll('.item-row.active').forEach((r) => r !== row && r.classList.remove('active'));
  row.classList.add('active');
}

function setCount(app, id, val) {
  const s = app.state;
  const sess = app.activeSession();
  let v = val;
  if (v === '' || v == null || Number.isNaN(v)) v = null;
  else v = Math.max(0, Math.round(Number(v) * 2) / 2); // 0.5 단위까지 (자재 "1.5묶음")
  app.set(() => {
    if (v == null) delete sess.counts[id];
    else sess.counts[id] = v;
    if (sess.overrides) delete sess.overrides[id];
    if (sess.filled) delete sess.filled[id]; // 직접 입력한 값은 실측
    sess.updatedAt = new Date().toISOString();
  });
  const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  const it = s.items.find((x) => x.id === id);
  if (row) {
    row.classList.toggle('done', v != null);
    const input = row.querySelector('input[data-input="count"]');
    if (input && document.activeElement !== input) input.value = v == null ? '' : String(v);
    if (input) input.classList.toggle('blank', v == null);
    const sub = row.querySelector('.par-sub');
    if (sub && it) sub.outerHTML = parSubHtml(it, v, row.classList.contains('needs-check'));
  }
  const chip = it && document.querySelector(`.chip[data-id="${CSS.escape(it.group)}"]`);
  if (chip) {
    const gi = activeItems(s, sess.book || 'product').filter((x) => x.group === it.group);
    const d = gi.filter((x) => sess.counts[x.id] != null).length;
    const g = s.groups.find((x) => x.id === it.group);
    chip.innerHTML = chipInner(g?.title || '', d, gi.length);
    chip.classList.toggle('done', d === gi.length);
    chip.classList.toggle('part', d > 0 && d < gi.length);
  }
  const { done, total } = progress(s, sess);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pt = document.getElementById('progress-text');
  if (pt) pt.textContent = progressText(done, total, sess.book || 'product');
  const pb = document.getElementById('progress-bar');
  if (pb) pb.style.width = `${pct}%`;
}

export const inputs = {
  count(el, e, app) {
    setCount(app, el.dataset.id, el.value);
  },
};

export const changes = {
  'session-date'(el, e, app) {
    if (!el.value) return;
    app.update(() => {
      const sess = app.activeSession();
      sess.date = el.value;
    });
  },
  'count-only-check'(el, e, app) {
    app.update((s) => {
      s.ui.countOnlyCheck = el.checked;
    });
  },
};

export const actions = {
  'jump-group'(el) {
    const target = document.getElementById(`g-${el.dataset.id}`);
    if (!target) return;
    // 상단 고정 헤더 + 그룹 칩 높이만큼 위로
    const offset = (document.querySelector('.topbar')?.offsetHeight || 0) + (document.querySelector('.chips')?.offsetHeight || 0);
    const y = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  },
  'count-dense-toggle'(el, e, app) {
    app.update((s) => {
      s.ui.countDense = s.ui.countDense === false ? true : false;
    });
  },
  'row-focus'(el, e) {
    if (e.target.closest('button, input')) return;
    const row = el.closest('.item-row');
    if (!row) return;
    setActiveRow(row);
    row.querySelector('input[data-input="count"]')?.focus();
  },
  'count-inc'(el, e, app) {
    const sess = app.activeSession();
    const cur = sess.counts[el.dataset.id];
    setCount(app, el.dataset.id, cur == null ? 1 : cur + 1);
    setActiveRow(el.closest('.item-row'));
  },
  'count-dec'(el, e, app) {
    const sess = app.activeSession();
    const cur = sess.counts[el.dataset.id];
    setCount(app, el.dataset.id, cur == null ? 0 : Math.max(0, cur - 1));
    setActiveRow(el.closest('.item-row'));
  },
  'count-set'(el, e, app) {
    setCount(app, el.dataset.id, el.dataset.val === '' ? null : Number(el.dataset.val));
  },
  'count-fill-forecast'(el, e, app) {
    let n = 0;
    app.update((s) => {
      const sess = app.activeSession();
      const fc = forecasts(s);
      sess.filled ||= {};
      for (const it of activeItems(s, sess.book || 'product')) {
        if (sess.counts[it.id] == null && fc[it.id]) {
          sess.counts[it.id] = fc[it.id].expected;
          sess.filled[it.id] = true; // 실측이 아니므로 다음 예상 계산의 기준으로 쓰지 않는다
          if (sess.overrides) delete sess.overrides[it.id];
          n++;
        }
      }
      sess.updatedAt = new Date().toISOString();
    });
    app.toast(n ? `${n}개 품목을 예상값으로 채웠습니다. "확인 필요" 품목은 실제로 확인하세요.` : '채울 품목이 없습니다');
  },
  'count-fill-par'(el, e, app) {
    let n = 0;
    app.update((s) => {
      const sess = app.activeSession();
      sess.filled ||= {};
      for (const it of activeItems(s, sess.book || 'product')) {
        if (sess.counts[it.id] == null) {
          const p = parInCountUnit(it);
          if (p != null) {
            sess.counts[it.id] = p;
            sess.filled[it.id] = true; // 기준값으로 채운 것도 실측이 아님
            if (sess.overrides) delete sess.overrides[it.id];
            n++;
          }
        }
      }
      sess.updatedAt = new Date().toISOString();
    });
    app.toast(n ? `입력하지 않은 ${n}개 품목을 기준 수량으로 채웠습니다` : '채울 품목이 없습니다');
  },
  'count-clear'(el, e, app) {
    if (!confirm('입력한 수량을 모두 지울까요?')) return;
    app.update(() => {
      const sess = app.activeSession();
      sess.counts = {};
      sess.overrides = {};
      sess.filled = {};
      sess.updatedAt = new Date().toISOString();
    });
  },
};
