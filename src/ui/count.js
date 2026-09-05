// 재고조사 탭
import { esc, fmtDateKo } from './html.js';
import { parInCountUnit, unitLabel, unitsUnresolved, formatDate } from '../logic/order.js';
import { forecastAll } from '../logic/forecast.js';

function activeItems(s) {
  return s.items.filter((it) => it.active !== false);
}

export function progress(s, sess) {
  const items = activeItems(s);
  const done = items.filter((it) => sess.counts[it.id] != null).length;
  return { done, total: items.length };
}

/** 소비 모델이 있으면 품목별 예상 재고 (없으면 빈 객체) */
export function forecasts(s) {
  if (!s.consumption) return {};
  return forecastAll(s.items, s.consumption, s.sessions, s.orders, formatDate(new Date()));
}

function itemMeta(it, f) {
  const parts = [];
  if (it.par != null) parts.push(`기준 <span class="par">${it.par}</span>${it.parUnit === 'box' ? '박스' : '개'}`);
  else parts.push('기준 없음');
  if (it.boxSize) parts.push(`1박스=${it.boxSize}개`);
  if (it.rule?.type === 'reorderPoint') parts.push(`${it.rule.threshold}개 미만이면 ${it.rule.orderQty}${unitLabel(it.orderUnit)} 발주`);
  if (it.countUnit === 'box') parts.push('<b>박스 단위로 세기</b>');
  if (unitsUnresolved(it)) parts.push('<span style="color:var(--warn)">1박스 개수 미설정 — 품목 탭에서 입력</span>');
  if (f) {
    const u = it.countUnit === 'box' ? '박스' : '개';
    const when = f.days === 0 ? '오늘' : f.days === 1 ? '어제' : `${f.days}일 전`;
    parts.push(`예상 <b>${f.expected}${u}</b> <span class="tiny">(${f.low}~${f.high}, ${when} ${f.basis.count}${u}${f.basis.received ? ` + 입고 ${f.basis.received}` : ''}${f.estimated ? ', 포장 크기 추정' : ''})</span>`);
    if (f.stale) parts.push('<span style="color:var(--warn)">실측한 지 오래됨</span>');
    else if (f.crossesZero) parts.push('<span style="color:var(--warn)">떨어졌을 수 있음</span>');
  }
  return parts.join(' · ');
}

function rowHtml(it, val, f) {
  const has = val != null;
  const parCount = parInCountUnit(it);
  const unit = it.countUnit === 'box' ? '박스' : '';
  const check = f?.needsCheck;
  return `
    <div class="item-row ${has ? 'done' : ''} ${check ? 'needs-check' : ''}" data-row="${esc(it.id)}">
      <div>
        <div class="name">${esc(it.name)}${check ? ' <span class="pill warn">확인 필요</span>' : f ? ' <span class="pill ok">예상 OK</span>' : ''}</div>
        <div class="meta">${itemMeta(it, f)}</div>
      </div>
      <div>
        <div class="stepper" role="group" aria-label="${esc(it.name)} 수량">
          <button type="button" data-action="count-dec" data-id="${esc(it.id)}" aria-label="1 빼기">−</button>
          <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" data-input="count" data-id="${esc(it.id)}"
            value="${has ? val : ''}" placeholder="${f ? f.expected : '–'}" class="${has ? '' : 'empty'}" aria-label="${esc(it.name)} 현재 수량${unit ? ' (박스)' : ''}" />
          <button type="button" data-action="count-inc" data-id="${esc(it.id)}" aria-label="1 더하기">+</button>
        </div>
        <div class="quick">
          <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="0">0</button>
          ${f ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${f.expected}">예상(${f.expected})</button>` : ''}
          ${parCount != null ? `<button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="${parCount}">기준(${parCount}${unit})</button>` : ''}
          <button type="button" data-action="count-set" data-id="${esc(it.id)}" data-val="" title="입력 지우기">지움</button>
        </div>
      </div>
    </div>`;
}

export function render(s, app) {
  const sess = app.activeSession();
  const { done, total } = progress(s, sess);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fc = forecasts(s);
  const nForecast = Object.keys(fc).length;
  const nCheck = Object.values(fc).filter((f) => f.needsCheck).length;
  // 예상값이 하나도 없으면(모델 지움 등) 필터를 적용하지 않는다 — 체크박스도 안 보이므로 품목이 사라지면 안 됨
  const onlyCheck = nForecast > 0 && !!s.ui.countOnlyCheck;
  const visible = (it) => !onlyCheck || fc[it.id]?.needsCheck || (sess.counts[it.id] == null && !fc[it.id]);
  const groups = s.groups
    .map((g) => ({ g, items: activeItems(s).filter((it) => it.group === g.id && visible(it)) }))
    .filter((x) => x.items.length);
  const ungrouped = activeItems(s).filter((it) => !s.groups.some((g) => g.id === it.group) && visible(it));
  const stale = sess.date < formatDate(new Date());

  return `
    <section class="card">
      <div class="row between wrap">
        <div>
          <h2 style="margin:0">재고조사 <span class="muted small">${esc(fmtDateKo(sess.date))} 발주분</span></h2>
          <div class="small muted" id="progress-text">${done}/${total} 품목 입력 (${pct}%)</div>
        </div>
        <input type="date" value="${esc(sess.date)}" data-change="session-date" aria-label="발주일" style="min-height:40px;border:1px solid var(--line);border-radius:8px;padding:4px 8px;background:var(--surface)" />
      </div>
      ${stale ? `<p class="small mt" style="color:var(--warn);margin-bottom:0">지난 발주일(${esc(sess.date)})로 진행 중입니다. 날짜를 확인하세요.</p>` : ''}
      <div class="progress mt" aria-hidden="true"><div id="progress-bar" style="width:${pct}%"></div></div>
      ${
        nForecast
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill ${nCheck ? 'warn' : 'ok'}">확인 필요 ${nCheck}</span> <span class="muted">예상 재고가 있는 품목 ${nForecast}개 중 발주 결정이 갈릴 수 있는 ${nCheck}개만 직접 세면 됩니다. 나머지는 "예상값 채우기"로 넣고 넘어가도 됩니다.</span></p>
             <label class="row small mt"><input type="checkbox" data-change="count-only-check" ${onlyCheck ? 'checked' : ''}/> 확인 필요 품목과 예상값 없는 품목만 보기</label>`
          : s.consumption
            ? `<p class="tiny muted mt" style="margin-bottom:0">소비 모델은 있지만 아직 확정한 재고조사가 없어 예상 재고를 계산할 수 없습니다. 이번 조사를 확정하면 다음부터 예상값이 나옵니다.</p>`
            : ''
      }
      <div class="row mt wrap">
        <button type="button" class="btn primary" data-action="photo-open">📷 사진으로 자동 입력</button>
        ${nForecast ? `<button type="button" class="btn" data-action="count-fill-forecast" title="입력 안 한 품목을 예상값으로">예상값 채우기</button>` : ''}
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
        <div class="item-list">${items.map((it) => rowHtml(it, sess.counts[it.id], fc[it.id])).join('')}</div>
      </section>`,
      )
      .join('')}
    ${
      ungrouped.length
        ? `<section class="group"><div class="group-head"><span>기타</span></div><div class="item-list">${ungrouped.map((it) => rowHtml(it, sess.counts[it.id], fc[it.id])).join('')}</div></section>`
        : ''
    }
    ${onlyCheck && !groups.length && !ungrouped.length ? `<div class="card empty">확인이 필요한 품목이 없습니다. 예상값을 채우고 발주서로 넘어가세요.</div>` : ''}

    <div class="sticky-actions">
      <button type="button" class="btn primary block" data-action="tab" data-tab="order">발주서 확인 →</button>
    </div>`;
}

/** 값 갱신 + DOM 부분 갱신 (포커스 유지). 수량이 바뀌면 그 품목의 수동 발주 수정은 무효가 된다. */
function setCount(app, id, val) {
  const s = app.state;
  const sess = app.activeSession();
  let v = val;
  if (v === '' || v == null || Number.isNaN(v)) v = null;
  else v = Math.max(0, Math.round(Number(v)));
  app.set(() => {
    if (v == null) delete sess.counts[id];
    else sess.counts[id] = v;
    if (sess.overrides) delete sess.overrides[id];
    if (sess.filled) delete sess.filled[id]; // 직접 입력한 값은 실측
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
  'count-fill-forecast'(el, e, app) {
    let n = 0;
    app.update((s) => {
      const sess = app.activeSession();
      const fc = forecasts(s);
      sess.filled ||= {};
      for (const it of activeItems(s)) {
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
      for (const it of activeItems(s)) {
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
