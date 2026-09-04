// 기록 탭: 지난 재고조사/발주, 소비량 통계, 기준 수량 제안
import { esc, fmtDateKo, fmtDateTime } from './html.js';
import { consumptionStats, suggestPar, stockoutCount } from '../logic/stats.js';
import { unitLabel, parInEach } from '../logic/order.js';

export function render(s, app) {
  const submitted = s.sessions.filter((x) => x.status === 'submitted').slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const stats = consumptionStats(s.items, s.sessions, s.orders);
  const activeItems = s.items.filter((it) => it.active !== false);

  const suggestions = activeItems
    .map((it) => ({ it, sug: suggestPar(it, stats[it.id]) }))
    .filter((x) => x.sug);
  const stockouts = activeItems
    .map((it) => ({ it, n: stockoutCount(it.id, s.sessions) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n);
  const topUse = activeItems
    .map((it) => ({ it, st: stats[it.id] }))
    .filter((x) => x.st && x.st.avgPerDay != null)
    .sort((a, b) => b.st.avgPerDay - a.st.avgPerDay)
    .slice(0, 10);

  return `
    ${s.ui.lastOrderId ? `<div class="card" style="border-left:4px solid var(--ok)"><b>발주가 기록되었습니다.</b> <span class="small muted">아래 목록에서 발주 문자를 복사해 거래처에 보내세요.</span> <button type="button" class="btn sm ghost" data-action="history-dismiss">닫기</button></div>` : ''}

    <section class="card">
      <h2>인사이트</h2>
      ${
        submitted.length < 2
          ? `<p class="small muted" style="margin:0">재고조사를 2회 이상 확정하면 품목별 소비 속도와 기준 수량 제안이 여기에 표시됩니다. (현재 ${submitted.length}회)</p>`
          : `
        ${
          stockouts.length
            ? `<div class="mb"><div class="small" style="font-weight:600">자주 품절되는 품목</div>
              <div class="small muted">${stockouts.map((x) => `${esc(x.it.name)} (최근 6회 중 ${x.n}회 0)`).join(', ')}</div></div>`
            : ''
        }
        ${
          suggestions.length
            ? `<div class="mb"><div class="small" style="font-weight:600">기준 수량 제안 <span class="tiny muted">(4일 소비량 × 1.5 안전계수)</span></div>
              <div class="table-wrap"><table class="simple"><thead><tr><th>품목</th><th class="num">현재 기준</th><th class="num">제안</th><th></th></tr></thead><tbody>
              ${suggestions
                .map(
                  (x) => `<tr><td>${esc(x.it.name)}</td><td class="num">${x.sug.currentPar ?? '-'}</td><td class="num"><b>${x.sug.suggested}</b></td>
                  <td><button type="button" class="btn sm" data-action="history-apply-par" data-id="${esc(x.it.id)}" data-val="${x.sug.suggested}">적용</button></td></tr>`,
                )
                .join('')}
              </tbody></table></div></div>`
            : `<p class="small muted">기준 수량을 바꿀 만한 품목은 아직 없습니다. (표본 3회 이상 필요)</p>`
        }
        ${
          topUse.length
            ? `<details><summary class="small">소비 속도 상위 품목</summary>
              <div class="table-wrap"><table class="simple"><thead><tr><th>품목</th><th class="num">하루 평균</th><th class="num">발주주기(3.5일)</th><th class="num">표본</th></tr></thead><tbody>
              ${topUse
                .map(
                  (x) => `<tr><td>${esc(x.it.name)}</td><td class="num">${x.st.avgPerDay.toFixed(2)}</td><td class="num">${x.st.avgPerPeriod.toFixed(1)}</td><td class="num">${x.st.samples}</td></tr>`,
                )
                .join('')}
              </tbody></table></div></details>`
            : ''
        }`
      }
    </section>

    <section class="card">
      <h2>지난 기록 <span class="muted small">${submitted.length}회</span></h2>
      ${submitted.length === 0 ? `<p class="small muted" style="margin:0">아직 확정한 재고조사가 없습니다.</p>` : ''}
      ${submitted.map((sess) => sessionHtml(s, sess)).join('')}
    </section>`;
}

function sessionHtml(s, sess) {
  const order = s.orders.find((o) => o.sessionId === sess.id);
  const rows = s.items
    .filter((it) => sess.counts[it.id] != null || order?.lines.some((l) => l.itemId === it.id))
    .map((it) => {
      const line = order?.lines.find((l) => l.itemId === it.id);
      return `<tr><td>${esc(it.name)}</td><td class="num">${sess.counts[it.id] ?? '-'}</td><td class="num">${line ? `${line.qty}${unitLabel(line.unit)}` : ''}</td></tr>`;
    })
    .join('');
  return `
    <details class="mt">
      <summary>${esc(fmtDateKo(sess.date))} ${esc(sess.date)} <span class="pill ${order ? 'ok' : ''}">${order ? `발주 ${order.lines.length}품목` : '발주 없음'}</span>
        <span class="tiny muted">${esc(fmtDateTime(sess.submittedAt))}</span></summary>
      ${order ? `<pre class="order-text small mt">${esc(order.text)}</pre>` : ''}
      <div class="row mt wrap">
        ${order ? `<button type="button" class="btn sm" data-action="history-copy" data-id="${esc(order.id)}">📋 발주 문자 복사</button>` : ''}
        <button type="button" class="btn sm" data-action="history-reuse" data-id="${esc(sess.id)}">이 수량으로 새 조사 시작</button>
        <button type="button" class="btn sm danger" data-action="history-delete" data-id="${esc(sess.id)}">삭제</button>
      </div>
      <div class="table-wrap mt"><table class="simple"><thead><tr><th>품목</th><th class="num">재고</th><th class="num">발주</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
}

export const actions = {
  'history-dismiss'(el, e, app) {
    app.update((s) => {
      s.ui.lastOrderId = null;
    });
  },
  async 'history-copy'(el, e, app) {
    const o = app.state.orders.find((x) => x.id === el.dataset.id);
    if (!o) return;
    try {
      await navigator.clipboard.writeText(o.text);
      app.toast('복사했습니다');
    } catch {
      app.toast('복사에 실패했습니다');
    }
  },
  'history-reuse'(el, e, app) {
    const src = app.state.sessions.find((x) => x.id === el.dataset.id);
    if (!src) return;
    const draft = app.state.sessions.find((x) => x.status === 'draft');
    if (draft && Object.keys(draft.counts).length && !confirm('진행 중인 재고조사 입력을 덮어쓸까요?')) return;
    app.update((s) => {
      const sess = app.activeSession();
      sess.counts = { ...src.counts };
      sess.overrides = {};
      sess.updatedAt = new Date().toISOString();
      s.ui.tab = 'count';
    });
  },
  'history-delete'(el, e, app) {
    if (!confirm('이 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
    app.update((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== el.dataset.id);
      s.orders = s.orders.filter((o) => o.sessionId !== el.dataset.id);
    });
  },
  'history-apply-par'(el, e, app) {
    app.update((s) => {
      const it = s.items.find((x) => x.id === el.dataset.id);
      if (!it) return;
      const v = Number(el.dataset.val);
      // 제안값은 낱개 기준 → par 단위로 환산
      if (it.parUnit === 'box' && it.boxSize) it.par = Math.ceil(v / it.boxSize);
      else it.par = v;
    });
    app.toast('기준 수량을 변경했습니다');
  },
};

export { parInEach };
