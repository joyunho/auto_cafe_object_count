// 앱 엔트리: 상태 관리, 렌더링 루프, 이벤트 위임
import { load, save, uid } from './store.js';
import { esc } from './ui/html.js';
import { nextOrderDate, formatDate, weekdayKo } from './logic/order.js';
import * as countView from './ui/count.js';
import * as orderView from './ui/order.js';
import * as historyView from './ui/history.js';
import * as itemsView from './ui/items.js';
import * as settingsView from './ui/settings.js';
import * as photoView from './ui/photo.js';

const TABS = [
  { id: 'count', label: '재고조사', ico: '📋' },
  { id: 'order', label: '발주', ico: '🧾' },
  { id: 'history', label: '기록', ico: '📈' },
  { id: 'items', label: '품목', ico: '🏷️' },
  { id: 'settings', label: '설정', ico: '⚙️' },
];

const VIEWS = { count: countView, order: orderView, history: historyView, items: itemsView, settings: settingsView };

export const app = {
  state: load(),
  root: null,
  modal: null,
  actions: {},
  inputs: {},
  changes: {},

  /** 상태를 바꾸고 저장 + 전체 렌더 */
  update(fn) {
    fn(this.state);
    this.persist();
    this.render();
  },

  /** 상태를 바꾸고 저장만 (렌더 안 함 — 입력 중 포커스 유지용) */
  set(fn) {
    fn(this.state);
    this.persist();
  },

  persist() {
    if (!save(this.state)) this.toast('저장 공간이 부족해 저장하지 못했습니다.');
  },

  go(tab) {
    this.update((s) => {
      s.ui.tab = tab;
    });
    window.scrollTo(0, 0);
  },

  /** 진행 중(초안) 세션을 돌려주고, 없으면 만든다 */
  activeSession(create = true) {
    const s = this.state;
    let sess = s.sessions.find((x) => x.id === s.ui.activeSessionId && x.status === 'draft');
    if (!sess) sess = s.sessions.find((x) => x.status === 'draft');
    if (!sess && create) {
      sess = {
        id: uid('s_'),
        date: formatDate(nextOrderDate(new Date(), s.settings.orderDays)),
        status: 'draft',
        counts: {},
        overrides: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      s.sessions.push(sess);
    }
    if (sess) s.ui.activeSessionId = sess.id;
    return sess;
  },

  toast(msg, ms = 2200) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  openModal(html, onMount) {
    this.closeModal();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('click', (e) => {
      if (e.target === back) this.closeModal();
    });
    document.body.appendChild(back);
    this.modal = back;
    if (onMount) onMount(back.querySelector('.modal'));
  },

  closeModal() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  },

  render() {
    const s = this.state;
    const tab = VIEWS[s.ui.tab] ? s.ui.tab : 'count';
    const next = nextOrderDate(new Date(), s.settings.orderDays);
    const nextLabel = `${next.getMonth() + 1}/${next.getDate()} (${weekdayKo(next)})`;
    const orderCount = orderView.pendingCount(s);
    const html = `
      <header class="topbar">
        <div>
          <h1>${esc(s.settings.storeName || '카페')} 재고관리</h1>
          <div class="sub">다음 발주일 ${esc(nextLabel)} · ${esc(s.settings.supplierName || '')}</div>
        </div>
        <div class="row">${VIEWS[tab].headerActions ? VIEWS[tab].headerActions(s) : ''}</div>
      </header>
      <main class="view" data-tab="${tab}">${VIEWS[tab].render(s, this)}</main>
      <nav class="tabbar" aria-label="주요 탭">
        ${TABS.map(
          (t) => `<button type="button" data-action="tab" data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}" aria-current="${t.id === tab ? 'page' : 'false'}">
            <span class="ico" aria-hidden="true">${t.ico}</span>${t.label}
            ${t.id === 'order' && orderCount > 0 ? `<span class="badge">${orderCount}</span>` : ''}
          </button>`,
        ).join('')}
      </nav>`;
    this.root.innerHTML = html;
    if (VIEWS[tab].afterRender) VIEWS[tab].afterRender(s, this);
  },

  registerView(v) {
    Object.assign(this.actions, v.actions || {});
    Object.assign(this.inputs, v.inputs || {});
    Object.assign(this.changes, v.changes || {});
  },

  mount(root) {
    this.root = root;
    for (const v of Object.values(VIEWS)) this.registerView(v);
    this.registerView(photoView);
    this.actions.tab = (el) => this.go(el.dataset.tab);

    // 이벤트 위임 (본문 + 모달)
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const fn = this.actions[el.dataset.action];
      if (fn) {
        e.preventDefault();
        fn(el, e, this);
      }
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      const fn = this.inputs[el.dataset.input];
      if (fn) fn(el, e, this);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (!el) return;
      const fn = this.changes[el.dataset.change];
      if (fn) fn(el, e, this);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal) this.closeModal();
    });

    this.render();
  },
};

// 단일 파일 빌드(scripts/build-single.mjs)에서는 esbuild define으로 true가 된다.
const SINGLE_FILE = typeof __SINGLE_FILE__ !== 'undefined' && __SINGLE_FILE__;

function boot() {
  app.mount(document.getElementById('app'));
  if (!SINGLE_FILE && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

// 디버깅용
window.__cafeApp = app;
