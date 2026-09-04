// 발주 탭
import { esc, fmtDateKo } from './html.js';
import { calcOrder, linesToOrder, formatOrderText, unitLabel } from '../logic/order.js';
import { uid } from '../store.js';

export function buildLines(s, sess) {
  return calcOrder(s.items, sess.counts, sess.overrides || {});
}

export function orderText(s, sess, lines) {
  const groups = s.groups.map((g) => ({ title: g.title, itemIds: s.items.filter((it) => it.group === g.id).map((it) => it.id) }));
  return formatOrderText(lines, {
    title: s.settings.orderTitle,
    date: fmtDateKo(sess.date) + ` ${sess.date}`,
    store: s.settings.storeName,
    sender: s.settings.senderName,
    groups,
  });
}

export function pendingCount(s) {
  const sess = s.sessions.find((x) => x.status === 'draft');
  if (!sess) return 0;
  return linesToOrder(buildLines(s, sess)).length;
}

export function render(s, app) {
  const sess = app.activeSession();
  const lines = buildLines(s, sess);
  const toOrder = linesToOrder(lines);
  const uncounted = lines.filter((l) => l.reason === '미입력');
  const noPar = lines.filter((l) => l.reason === '기준 수량 없음');
  const showAll = !!s.ui.orderShowAll;
  const visible = showAll ? lines : toOrder;
  const text = orderText(s, sess, lines);

  const byGroup = s.groups
    .map((g) => ({ g, lines: visible.filter((l) => s.items.find((it) => it.id === l.itemId)?.group === g.id) }))
    .filter((x) => x.lines.length);
  const rest = visible.filter((l) => !s.groups.some((g) => s.items.find((it) => it.id === l.itemId)?.group === g.id));

  return `
    <section class="card">
      <div class="row between wrap">
        <h2 style="margin:0">발주서 <span class="muted small">${esc(fmtDateKo(sess.date))}</span></h2>
        <span class="pill accent">${toOrder.length}개 품목 발주</span>
      </div>
      ${
        uncounted.length
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill warn">미입력 ${uncounted.length}</span> <span class="muted">${esc(uncounted.slice(0, 6).map((l) => l.name).join(', '))}${uncounted.length > 6 ? ' 외' : ''} — 재고조사 탭에서 입력하면 자동 계산됩니다.</span></p>`
          : ''
      }
      ${
        noPar.length
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill">기준 없음 ${noPar.length}</span> <span class="muted">${esc(noPar.map((l) => l.name).join(', '))} — 필요하면 아래에서 직접 수량을 적으세요.</span></p>`
          : ''
      }
      <label class="row mt small"><input type="checkbox" data-change="order-show-all" ${showAll ? 'checked' : ''}/> 발주 없는 품목도 모두 보기</label>
    </section>

    ${
      visible.length === 0
        ? `<div class="card empty">발주할 품목이 없습니다.<br/><span class="tiny">재고를 입력했는데 비어 있다면 모두 기준 수량 이상입니다.</span></div>`
        : ''
    }
    ${byGroup
      .map(
        ({ g, lines }) => `
      <section class="group">
        <div class="group-head"><span>${esc(g.title)}</span></div>
        <div class="item-list">${lines.map((l) => lineHtml(l, s)).join('')}</div>
      </section>`,
      )
      .join('')}
    ${rest.length ? `<section class="group"><div class="group-head"><span>기타</span></div><div class="item-list">${rest.map((l) => lineHtml(l, s)).join('')}</div></section>` : ''}

    <section class="card">
      <h2>발주 문자 미리보기</h2>
      <pre class="order-text" id="order-text">${esc(text)}</pre>
      <div class="row mt wrap">
        <button type="button" class="btn" data-action="order-copy">📋 복사</button>
        ${typeof navigator !== 'undefined' && navigator.share ? `<button type="button" class="btn" data-action="order-share">📤 공유</button>` : ''}
      </div>
    </section>

    <div class="sticky-actions">
      <button type="button" class="btn primary block" data-action="order-submit" ${toOrder.length === 0 && uncounted.length === lines.length ? 'disabled' : ''}>발주 확정 (기록에 저장)</button>
    </div>`;
}

function lineHtml(l, s) {
  const it = s.items.find((x) => x.id === l.itemId);
  const curLabel = l.current == null ? '미입력' : `현재 ${l.current}${it?.countUnit === 'box' ? '박스' : '개'}`;
  return `
    <div class="order-line ${l.overridden ? 'overridden' : ''}">
      <div>
        <div class="name" style="font-weight:600">${esc(l.name)}</div>
        <div class="tiny muted">${esc(curLabel)} · ${esc(l.reason)}${l.overridden ? ' · <b>직접 수정</b>' : ''}</div>
      </div>
      <div class="qty">
        <input type="number" inputmode="numeric" min="0" value="${l.qty}" data-change="order-qty" data-id="${esc(l.itemId)}" aria-label="${esc(l.name)} 발주 수량" />
        <span class="small">${unitLabel(l.unit)}</span>
        ${l.overridden ? `<button type="button" class="btn sm ghost" data-action="order-reset" data-id="${esc(l.itemId)}" title="자동 계산값으로">↺</button>` : ''}
      </div>
    </div>`;
}

async function copyText(text, app) {
  try {
    await navigator.clipboard.writeText(text);
    app.toast('발주 내용을 복사했습니다');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      app.toast('발주 내용을 복사했습니다');
    } catch {
      app.toast('복사에 실패했습니다. 텍스트를 길게 눌러 복사하세요.');
    }
    ta.remove();
  }
}

export const changes = {
  'order-show-all'(el, e, app) {
    app.update((s) => {
      s.ui.orderShowAll = el.checked;
    });
  },
  'order-qty'(el, e, app) {
    const v = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
    app.update(() => {
      const sess = app.activeSession();
      sess.overrides = sess.overrides || {};
      if (v == null) delete sess.overrides[el.dataset.id];
      else sess.overrides[el.dataset.id] = v;
    });
  },
};

export const actions = {
  'order-reset'(el, e, app) {
    app.update(() => {
      const sess = app.activeSession();
      delete sess.overrides[el.dataset.id];
    });
  },
  'order-copy'(el, e, app) {
    const s = app.state;
    const sess = app.activeSession();
    copyText(orderText(s, sess, buildLines(s, sess)), app);
  },
  async 'order-share'(el, e, app) {
    const s = app.state;
    const sess = app.activeSession();
    const text = orderText(s, sess, buildLines(s, sess));
    try {
      await navigator.share({ title: s.settings.orderTitle, text });
    } catch {
      /* 사용자가 취소 */
    }
  },
  'order-submit'(el, e, app) {
    const s = app.state;
    const sess = app.activeSession();
    const lines = buildLines(s, sess);
    const toOrder = linesToOrder(lines);
    const uncounted = lines.filter((l) => l.reason === '미입력').length;
    let msg = `${toOrder.length}개 품목을 발주 확정할까요?`;
    if (uncounted) msg += `\n(미입력 ${uncounted}개 품목은 발주 0으로 기록됩니다)`;
    if (!confirm(msg)) return;
    const text = orderText(s, sess, lines);
    app.update((st) => {
      st.orders.push({
        id: uid('o_'),
        sessionId: sess.id,
        date: sess.date,
        lines: toOrder.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, unit: l.unit, current: l.current })),
        text,
        createdAt: new Date().toISOString(),
      });
      sess.status = 'submitted';
      sess.submittedAt = new Date().toISOString();
      st.ui.activeSessionId = null;
      st.ui.tab = 'history';
      st.ui.lastOrderId = st.orders[st.orders.length - 1].id;
    });
    copyText(text, app);
  },
};
