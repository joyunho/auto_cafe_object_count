// 발주 탭
import { esc, fmtDateKo } from './html.js';
import { calcOrder, linesToOrder, formatOrderText, unitLabel } from '../logic/order.js';
import { uid } from '../store.js';
import { bookOf } from '../data/books.js';
import { bookSwitch } from './count.js';

const bookItems = (s, book) => s.items.filter((it) => (it.book || 'product') === (book || 'product'));

export function buildLines(s, sess) {
  return calcOrder(bookItems(s, sess.book), sess.counts, sess.overrides || {});
}

export function orderText(s, sess, lines) {
  const book = sess.book || 'product';
  const groups = s.groups.filter((g) => (g.book || 'product') === book).map((g) => ({ title: g.title, itemIds: s.items.filter((it) => it.group === g.id).map((it) => it.id) }));
  return formatOrderText(lines, {
    title: `${s.settings.orderTitle}${book === 'product' ? '' : ` (${bookOf(book).short})`}`,
    date: fmtDateKo(sess.date) + ` ${sess.date}`,
    store: s.settings.storeName,
    sender: s.settings.senderName,
    groups,
  });
}

/** 모든 장부의 진행 중 초안에서 발주할 품목 수 (탭 배지) */
export function pendingCount(s) {
  return s.sessions.filter((x) => x.status === 'draft').reduce((n, sess) => n + linesToOrder(buildLines(s, sess)).length, 0);
}

/** 기본 보기: 발주할 것 + 직접 수정한 것(0으로 고친 것도 되돌릴 수 있게) */
function visibleLines(lines, showAll) {
  return showAll ? lines : lines.filter((l) => l.qty > 0 || l.overridden);
}

export function render(s, app) {
  const sess = app.activeSession();
  const lines = buildLines(s, sess);
  const toOrder = linesToOrder(lines);
  const uncounted = lines.filter((l) => l.reason === '미입력' && !l.overridden);
  const noPar = lines.filter((l) => l.reason === '기준 수량 없음' && !l.overridden);
  const noBox = lines.filter((l) => l.reason === '1박스 개수 미설정');
  const showAll = !!s.ui.orderShowAll;
  const visible = visibleLines(lines, showAll);
  const text = orderText(s, sess, lines);

  const byGroup = s.groups
    .map((g) => ({ g, lines: visible.filter((l) => s.items.find((it) => it.id === l.itemId)?.group === g.id) }))
    .filter((x) => x.lines.length);
  const rest = visible.filter((l) => !s.groups.some((g) => s.items.find((it) => it.id === l.itemId)?.group === g.id));

  return `
    ${bookSwitch(s)}
    <section class="card">
      <div class="row between wrap">
        <h2 style="margin:0">${esc(app.bookInfo().short)} 발주서 <span class="muted small">${esc(fmtDateKo(sess.date))}</span></h2>
        <span class="pill accent" id="order-count-pill">${toOrder.length}개 품목 발주</span>
      </div>
      ${
        uncounted.length
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill warn">미입력 ${uncounted.length}</span> <span class="muted">${esc(uncounted.slice(0, 6).map((l) => l.name).join(', '))}${uncounted.length > 6 ? ' 외' : ''} — 재고조사 탭에서 입력하면 자동 계산됩니다.</span></p>`
          : ''
      }
      ${
        noPar.length
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill">기준 없음 ${noPar.length}</span> <span class="muted">${esc(noPar.map((l) => l.name).join(', '))} — 필요하면 ${showAll ? '아래에서' : '"모두 보기"를 켜고'} 직접 수량을 적으세요.</span></p>`
          : ''
      }
      ${
        noBox.length
          ? `<p class="small mt" style="margin-bottom:0"><span class="pill warn">단위 미설정 ${noBox.length}</span> <span class="muted">${esc(noBox.map((l) => l.name).join(', '))} — 품목 탭에서 1박스 개수를 입력해야 계산됩니다.</span></p>`
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
  const curLabel = l.current == null ? '미입력' : `현재 ${l.current}${it?.countUnit === 'box' ? '박스' : unitLabel('ea', it)}`;
  return `
    <div class="order-line ${l.overridden ? 'overridden' : ''}" data-line="${esc(l.itemId)}">
      <div>
        <div class="name" style="font-weight:600">${esc(l.name)}</div>
        <div class="tiny muted">${esc(curLabel)} · ${esc(l.reason)}${l.overridden ? ' · <b>직접 수정</b>' : ''}</div>
      </div>
      <div class="qty">
        <input type="number" inputmode="numeric" min="0" value="${l.qty}" data-change="order-qty" data-id="${esc(l.itemId)}" aria-label="${esc(l.name)} 발주 수량" />
        <span class="small">${unitLabel(l.unit, it)}</span>
        ${l.overridden ? `<button type="button" class="btn sm ghost" data-action="order-reset" data-id="${esc(l.itemId)}" title="자동 계산값으로" aria-label="자동 계산값으로 되돌리기">↺</button>` : ''}
      </div>
    </div>`;
}

/** 수량 수정 후 화면을 통째로 다시 그리지 않고 필요한 부분만 갱신 (다음 탭/입력이 씹히지 않게) */
function patchOrderView(app, itemId) {
  const s = app.state;
  const sess = app.activeSession();
  const lines = buildLines(s, sess);
  const line = lines.find((l) => l.itemId === itemId);
  const row = document.querySelector(`.order-line[data-line="${CSS.escape(itemId)}"]`);
  if (row && line) {
    // 행을 통째로 바꾸지 않는다 — 사용자가 막 누른 버튼(↺ 등)이 DOM에서 떨어져 나가면 탭이 씹힌다.
    const fresh = document.createElement('div');
    fresh.innerHTML = lineHtml(line, s);
    const next = fresh.firstElementChild;
    const input = row.querySelector('input[data-change="order-qty"]');
    row.classList.toggle('overridden', !!line.overridden);
    row.querySelector('.tiny.muted').innerHTML = next.querySelector('.tiny.muted').innerHTML;
    if (input && document.activeElement !== input) input.value = String(line.qty);
    const resetBtn = row.querySelector('[data-action="order-reset"]');
    const nextReset = next.querySelector('[data-action="order-reset"]');
    if (resetBtn && !nextReset) resetBtn.remove();
    else if (!resetBtn && nextReset) row.querySelector('.qty').appendChild(nextReset);
  }
  const pre = document.getElementById('order-text');
  if (pre) pre.textContent = orderText(s, sess, lines);
  const n = linesToOrder(lines).length;
  const pill = document.getElementById('order-count-pill');
  if (pill) pill.textContent = `${n}개 품목 발주`;
  // 탭 배지는 전체 장부 합계 (app.render와 같은 정의)
  const total = pendingCount(s);
  const tabBtn = document.querySelector('.tabbar [data-tab="order"]');
  if (tabBtn) {
    let badge = tabBtn.querySelector('.badge');
    if (total > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge';
        tabBtn.appendChild(badge);
      }
      badge.textContent = String(total);
    } else if (badge) badge.remove();
  }
  const submit = document.querySelector('[data-action="order-submit"]');
  if (submit) submit.disabled = n === 0 && lines.every((l) => l.reason === '미입력' && !l.overridden);
}

/** @returns {Promise<boolean>} 복사 성공 여부 */
async function copyText(text, app) {
  try {
    await navigator.clipboard.writeText(text);
    app.toast('발주 내용을 복사했습니다');
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    app.toast(ok ? '발주 내용을 복사했습니다' : '복사하지 못했습니다. 미리보기 글을 길게 눌러 복사하세요.');
    return ok;
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
    const id = el.dataset.id;
    const sess = app.activeSession();
    sess.overrides = sess.overrides || {};
    // 같은 값이면 아무것도 하지 않는다 (blur 때 change가 한 번 더 올 수 있다)
    if ((v == null && !(id in sess.overrides)) || sess.overrides[id] === v) return;
    app.set(() => {
      if (v == null) delete sess.overrides[id];
      else sess.overrides[id] = v;
    });
    patchOrderView(app, id);
  },
};

export const actions = {
  'order-reset'(el, e, app) {
    const id = el.dataset.id;
    app.set(() => {
      const sess = app.activeSession();
      delete sess.overrides[id];
    });
    patchOrderView(app, id);
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
    const uncounted = lines.filter((l) => l.reason === '미입력' && !l.overridden).length;
    let msg = `${toOrder.length}개 품목을 발주 확정할까요?`;
    if (uncounted) msg += `\n(미입력 ${uncounted}개 품목은 발주 0으로 기록됩니다)`;
    if (!confirm(msg)) return;
    const text = orderText(s, sess, lines);
    app.update((st) => {
      st.orders.push({
        id: uid('o_'),
        sessionId: sess.id,
        book: sess.book || 'product',
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
