// 재고조사 탭
import { esc, fmtDateKo } from './html.js';
import { parInEach, unitLabel } from '../logic/order.js';

function activeItems(s) {
  return s.items.filter((it) => it.active !== false);
}

export function progress(s, sess) {
  const items = activeItems(s);
  const done = items.filter((it) => sess.counts[it.id] != null).length;
  return { done, total: items.length };
}

function itemMeta(it) {
  const parts = [];
  if (it.par != null) parts.push(`기준 <span class="par">${it.par}</span>${it.parUnit === 'box' ? '박스' : '개'}`);
  else parts.push('기준 없음');
  if (it.boxSize) parts.push(`1박스=${it.boxSize}개`);
  if (it.rule?.type === 'reorderPoint') parts.push(`${it.rule.threshold}개 미만 시 ${it.rule.orderQty}${unitLabel(it.orderUnit)}`);
  if (it.countUnit === 'box') parts.push('박스 단위로 세기');
  return parts.join(' · ');
}

function rowHtml(it, val) {
  const has = val != null;
  const parEach = parInEach(it);
  return `
    <div class="item-row ${has ? 'done' : ''}" data-row="${esc(it.id)}">
      <div>
        <div class="name">${esc(it.name)}</div>
        <div class="meta">${itemMeta(it)}</div>
      </div>
      <div>
        <div class="stepper" role="group" aria-label="${esc(it.name)} 수량">
          <button type="button" data-action="count-dec" data-id="${esc(it.id)}" aria-label="1 빼기">−</button>
          <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" data-input="count" data-id="${esc(it.id)}"
            value="${has ? val : ''}" placeholder="–" class="${has ? '' : 'empty'}" aria-label="${esc(it.name)} 현재 수량" />
          <button type="button" data-action="count-inc" data-id="${esc(it.id)}" aria-label="1 더하기">+</button>
        </div>
        <div class="quick">
          <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="0">0</button>
          ${parEach != null ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${parEach}">기준(${parEach})</button>` : ''}
          <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="" title="입력 지우기">지움</button>
        </div>
      </div>
    </div>`;
}

export function render(s, app) {
  const sess = app.activeSession();
  const { done, total } = progress(s, sess);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const groups = s.groups
    .map((g) => ({ g, items: activeItems(s).filter((it) => it.group === g.id) }))
    .filter((x) => x.items.length);
  const ungrouped = activeItems(s).filter((it) => !s.groups.some((g) => g.id === it.group));

  return `
    <section class="card">
      <div class="row between wrap">
        <div>
          <h2 style="margin:0">재고조사 <span class="muted small">${esc(fmtDateKo(sess.date))} 발주분</span></h2>
          <div class="small muted" id="progress-text">${done}/${total} 품목 입력 (${pct}%)</div>
        </div>
        <input type="date" value="${esc(sess.date)}" data-change="session-date" aria-label="발주일" style="min-height:40px;border:1px solid var(--line);border-radius:8px;padding:4px 8px;background:var(--surface)" />
      </div>
      <div class="progress mt" aria-hidden="true"><div id="progress-bar" style="width:${pct}%"></div></div>
      <div class="row mt wrap">
        <button type="button" class="btn primary" data-action="photo-open">📷 사진으로 자동 입력</button>
        <button type="button" class="btn" data-action="count-fill-par" title="입력 안 한 품목을 모두 기준 수량으로">빈칸=기준</button>
        <button type="button" class="btn ghost" data-action="count-clear">전체 지움</button>
      </div>
      <p class="tiny muted mt" style="margin-bottom:0">현재 남은 수량을 입력하면 발주 탭에서 발주 수량이 자동 계산됩니다. 입력은 자동 저장됩니다.</p>
    </section>

    ${groups
      .map(
        ({ g, items }) => `
      <section class="group">
        <div class="group-head"><span>${esc(g.title)}</span><span class="tiny">${items.filter((it) => sess.counts[it.id] != null).length}/${items.length}</span></div>
        <div class="item-list">${items.map((it) => rowHtml(it, sess.counts[it.id])).join('')}</div>
      </section>`,
      )
      .join('')}
    ${
      ungrouped.length
        ? `<section class="group"><div class="group-head"><span>기타</span></div><div class="item-list">${ungrouped.map((it) => rowHtml(it, sess.counts[it.id])).join('')}</div></section>`
        : ''
    }

    <div class="sticky-actions">
      <button type="button" class="btn primary block" data-action="tab" data-tab="order">발주서 확인 →</button>
    </div>`;
}

/** 값 갱신 + DOM 부분 갱신 (포커스 유지) */
function setCount(app, id, val) {
  const s = app.state;
  const sess = app.activeSession();
  let v = val;
  if (v === '' || v == null || Number.isNaN(v)) v = null;
  else v = Math.max(0, Math.round(Number(v)));
  app.set(() => {
    if (v == null) delete sess.counts[id];
    else sess.counts[id] = v;
    sess.updatedAt = new Date().toISOString();
  });
  const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (row) {
    row.classList.toggle('done', v != null);
    const input = row.querySelector('input[data-input="count"]');
    if (input && document.activeElement !== input) input.value = v == null ? '' : String(v);
    if (input) input.classList.toggle('empty', v == null);
  }
  const { done, total } = progress(s, sess);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pt = document.getElementById('progress-text');
  if (pt) pt.textContent = `${done}/${total} 품목 입력 (${pct}%)`;
  const pb = document.getElementById('progress-bar');
  if (pb) pb.style.width = `${pct}%`;
  // 그룹 카운터
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
    app.update((s) => {
      const sess = app.activeSession();
      sess.date = el.value;
    });
  },
};

export const actions = {
  'count-inc'(el, e, app) {
    const sess = app.activeSession();
    const cur = sess.counts[el.dataset.id];
    setCount(app, el.dataset.id, cur == null ? 1 : cur + 1);
  },
  'count-dec'(el, e, app) {
    const sess = app.activeSession();
    const cur = sess.counts[el.dataset.id];
    setCount(app, el.dataset.id, cur == null ? 0 : Math.max(0, cur - 1));
  },
  'count-set'(el, e, app) {
    setCount(app, el.dataset.id, el.dataset.val === '' ? null : Number(el.dataset.val));
  },
  'count-fill-par'(el, e, app) {
    app.update((s) => {
      const sess = app.activeSession();
      for (const it of activeItems(s)) {
        if (sess.counts[it.id] == null) {
          const p = parInEach(it);
          if (p != null) sess.counts[it.id] = p;
        }
      }
      sess.updatedAt = new Date().toISOString();
    });
    app.toast('입력하지 않은 품목을 기준 수량으로 채웠습니다');
  },
  'count-clear'(el, e, app) {
    if (!confirm('입력한 수량을 모두 지울까요?')) return;
    app.update(() => {
      const sess = app.activeSession();
      sess.counts = {};
      sess.overrides = {};
      sess.updatedAt = new Date().toISOString();
    });
  },
};
