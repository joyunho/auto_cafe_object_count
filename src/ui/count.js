// 재고조사 탭 — 장부(제품/자재)별로 품목을 세고, 종이 시트처럼 "이름 · 빨간 기준 · 검은 숫자"만 보이게 한다
import { esc, fmtDateKo } from './html.js';
import { parInCountUnit, unitLabel, unitsUnresolved, formatDate, calcOrderLine, calcOrder, linesToOrder } from '../logic/order.js';
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
    (b) => `<button type="button" role="tab" data-action="book-switch" data-book="${b.id}" class="${b.id === cur ? 'on' : ''}" aria-selected="${b.id === cur}">${esc(b.short)} <span class="tiny">${esc(b.dayLabel)}</span></button>`,
  ).join('')}</div>`;
}

/** 이름 옆에 붙는 기준 수량 (시트의 빨간 숫자) */
function parInline(it) {
  if (it.par == null) return '<span class="par-inline muted">기준 없음</span>';
  const u = it.parUnit === 'box' ? '박스' : unitLabel('ea', it);
  return `<span class="par-inline">기준 <b class="par">${it.par}</b>${esc(u)}</span>`;
}

/** 부가 정보 줄 — 있을 때만 표시 */
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

/** 수량을 넣은 줄에 "발주 N" 표시 — 세면서 바로 발주 결과가 보이게 */
function orderPill(it, val, override) {
  if (val == null) return '';
  const l = calcOrderLine(it, val);
  const qty = override != null ? override : l.qty;
  if (!qty) return l.auto ? '<span class="pill ok tiny-pill">충분</span>' : '';
  return `<span class="pill accent tiny-pill">발주 ${qty}${esc(unitLabel(l.unit, it))}</span>`;
}

function rowHtml(it, val, f, override) {
  const has = val != null;
  const parCount = parInCountUnit(it);
  const unit = it.countUnit === 'box' ? '박스' : it.unitName || '';
  const check = f?.needsCheck;
  const meta = itemMeta(it, f);
  return `
    <div class="item-row ${has ? 'done' : ''} ${check ? 'needs-check' : ''}" data-row="${esc(it.id)}">
      <div class="item-main" data-action="row-focus" data-id="${esc(it.id)}">
        <div class="name">${esc(it.name)} ${parInline(it)}${check ? ' <span class="pill warn">확인 필요</span>' : f ? ' <span class="pill ok tiny-pill">예상 OK</span>' : ''} <span class="order-pill">${orderPill(it, val, override)}</span></div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
      <div class="item-ctl">
        <div class="stepper" role="group" aria-label="${esc(it.name)} 수량">
          <button type="button" data-action="count-dec" data-id="${esc(it.id)}" aria-label="1 빼기">−</button>
          <input type="number" inputmode="decimal" min="0" step="0.5" data-input="count" data-id="${esc(it.id)}"
            value="${has ? val : ''}" placeholder="${f ? f.expected : '–'}" class="${has ? '' : 'empty'}" aria-label="${esc(it.name)} 현재 수량${unit ? ` (${esc(unit)})` : ''}" />
          <button type="button" data-action="count-inc" data-id="${esc(it.id)}" aria-label="1 더하기">+</button>
        </div>
        <div class="quick">
          <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="0">0</button>
          ${f ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${f.expected}">예상(${f.expected})</button>` : ''}
          ${parCount != null ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${parCount}">기준(${parCount}${esc(unit)})</button>` : ''}
          <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="" title="입력 지우기">지움</button>
        </div>
      </div>
    </div>`;
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
  const dense = s.ui.countDense !== false; // 기본: 촘촘히
  const pending = linesToOrder(calcOrder(items, sess.counts, sess.overrides || {})).length;
  const overrides = sess.overrides || {};
  // 그룹 진행 칩: 어느 그룹이 끝났는지 한눈에 + 눌러서 이동
  const allGroups = s.groups.filter((g) => (g.book || 'product') === book).map((g) => ({ g, items: items.filter((it) => it.group === g.id) })).filter((x) => x.items.length);
  const chips = allGroups
    .map(({ g, items: gi }) => {
      const d = gi.filter((it) => sess.counts[it.id] != null).length;
      const cls = d === gi.length ? 'done' : d ? 'part' : '';
      return `<button type="button" class="chip ${cls}" data-action="jump-group" data-id="${esc(g.id)}">${esc(g.title)} <b>${d}/${gi.length}</b></button>`;
    })
    .join('');

  return `
    ${bookSwitch(s)}
    <section class="card compact">
      <div class="row between wrap">
        <div>
          <h2 style="margin:0">${esc(info.short)} 재고조사 <span class="muted small">${esc(fmtDateKo(sess.date))} 발주분</span></h2>
          <div class="small muted" id="progress-text">${done}/${total} 입력 (${pct}%)${book === 'supply' ? ' · 지하창고 기준' : ''}</div>
        </div>
        <input type="date" value="${esc(sess.date)}" data-change="session-date" aria-label="발주일" class="date-input" />
      </div>
      ${stale ? `<p class="small mt" style="color:var(--warn);margin-bottom:0">지난 발주일(${esc(sess.date)})로 진행 중입니다. 날짜를 확인하세요.</p>` : ''}
      <div class="progress mt" aria-hidden="true"><div id="progress-bar" style="width:${pct}%"></div></div>
      <div class="row between wrap mt" style="row-gap:4px">
        <span class="small"><span class="pill accent" id="pending-pill">발주 예정 ${pending}</span></span>
        <button type="button" class="btn sm ghost" data-action="count-dense-toggle" aria-pressed="${dense}">${dense ? '넓게 보기' : '촘촘히 보기'}</button>
      </div>
      ${
        nForecast
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill ${nCheck ? 'warn' : 'ok'}">확인 필요 ${nCheck}</span> <span class="muted">예상값이 있는 ${nForecast}개 중 ${nCheck}개만 직접 세면 됩니다.</span></p>
             <label class="row small mt"><input type="checkbox" data-change="count-only-check" ${onlyCheck ? 'checked' : ''}/> 확인 필요 품목과 예상값 없는 품목만 보기</label>`
          : ''
      }
      <div class="toolbar mt">
        <button type="button" class="btn sm" data-action="photo-open">📷 사진</button>
        ${nForecast ? `<button type="button" class="btn sm" data-action="count-fill-forecast" title="입력 안 한 품목을 예상값으로">예상값 채우기</button>` : ''}
        <button type="button" class="btn sm" data-action="count-fill-par" title="입력 안 한 품목을 모두 기준 수량으로">빈칸=기준</button>
        <button type="button" class="btn sm ghost" data-action="count-clear">전체 지움</button>
      </div>
    </section>

    ${chips ? `<div class="chips" aria-label="그룹 진행">${chips}</div>` : ''}
    <div class="${dense ? 'dense' : ''}" id="count-list">
    ${groups
      .map(
        ({ g, items }) => `
      <section class="group" id="g-${esc(g.id)}">
        <div class="group-head"><span>${esc(g.title)}</span><span class="tiny">${items.filter((it) => sess.counts[it.id] != null).length}/${items.length}</span></div>
        <div class="item-list">${items.map((it) => rowHtml(it, sess.counts[it.id], fc[it.id], overrides[it.id])).join('')}</div>
      </section>`,
      )
      .join('')}
    ${
      ungrouped.length
        ? `<section class="group"><div class="group-head"><span>기타</span></div><div class="item-list">${ungrouped.map((it) => rowHtml(it, sess.counts[it.id], fc[it.id], overrides[it.id])).join('')}</div></section>`
        : ''
    }
    </div>
    ${onlyCheck && !groups.length && !ungrouped.length ? `<div class="card empty">확인이 필요한 품목이 없습니다. 예상값을 채우고 발주서로 넘어가세요.</div>` : ''}
    ${!groups.length && !ungrouped.length && !onlyCheck ? `<div class="card empty">이 장부에 품목이 없습니다. 품목 탭에서 추가하세요.</div>` : ''}

    <div class="sticky-actions">
      <button type="button" class="btn primary block" data-action="tab" data-tab="order">${esc(info.short)} 발주서 확인 →</button>
    </div>`;
}

/** 숫자 칸에 포커스가 가면 그 줄만 빠른 버튼을 펼친다 (iOS는 버튼 탭으로 포커스가 안 바뀌므로 클래스로 관리) */
export function afterRender(s, app) {
  const main = app.root?.querySelector('main.view');
  if (!main) return;
  main.addEventListener('focusin', (e) => {
    const row = e.target.closest?.('.item-row');
    if (row && e.target.matches('input[data-input="count"]')) setActiveRow(row);
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
    if (input) input.classList.toggle('empty', v == null);
    const pill = row.querySelector('.order-pill');
    if (pill && it) pill.innerHTML = orderPill(it, v);
  }
  const pendingPill = document.getElementById('pending-pill');
  if (pendingPill) {
    const items = activeItems(s, sess.book || 'product');
    pendingPill.textContent = `발주 예정 ${linesToOrder(calcOrder(items, sess.counts, sess.overrides || {})).length}`;
  }
  const chip = it && document.querySelector(`.chip[data-id="${CSS.escape(it.group)}"]`);
  if (chip) {
    const gi = activeItems(s, sess.book || 'product').filter((x) => x.group === it.group);
    const d = gi.filter((x) => sess.counts[x.id] != null).length;
    chip.querySelector('b').textContent = `${d}/${gi.length}`;
    chip.classList.toggle('done', d === gi.length);
    chip.classList.toggle('part', d > 0 && d < gi.length);
  }
  const { done, total } = progress(s, sess);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pt = document.getElementById('progress-text');
  if (pt) pt.textContent = `${done}/${total} 입력 (${pct}%)${(sess.book || 'product') === 'supply' ? ' · 지하창고 기준' : ''}`;
  const pb = document.getElementById('progress-bar');
  if (pb) pb.style.width = `${pct}%`;
  const groupHead = row?.closest('.group')?.querySelector('.group-head .tiny');
  if (groupHead) {
    const ids = [...row.closest('.item-list').querySelectorAll('[data-row]')].map((r) => r.dataset.row);
    groupHead.textContent = `${ids.filter((i) => sess.counts[i] != null).length}/${ids.length}`;
  }
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
    const y = target.getBoundingClientRect().top + window.scrollY - 64; // 상단 고정 헤더만큼
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
