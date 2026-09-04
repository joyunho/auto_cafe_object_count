// 앱 엔트리: 상태 관리, 렌더링 루프, 이벤트 위임
import { load, save, uid, exportJSON, defaultState, STORAGE_KEY } from './store.js';
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

/** <label>텍스트</label><input> 짝을 for/id로 연결 (스크린리더·탭 포커스용) */
export function linkLabels(root) {
  let n = 0;
  for (const field of root.querySelectorAll('.field')) {
    const label = field.querySelector(':scope > label');
    const input = field.querySelector('input, select, textarea');
    if (!label || !input || label.contains(input) || label.htmlFor) continue;
    if (!input.id) input.id = `f-${Date.now().toString(36)}-${n++}`;
    label.htmlFor = input.id;
  }
}

export const app = {
  state: load(),
  root: null,
  modal: null,
  modalOnClose: null,
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
    const today = formatDate(new Date());
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
      s.ui.activeSessionId = sess.id;
      this.persist();
    } else if (sess && sess.date < today && Object.keys(sess.counts || {}).length === 0) {
      // 아무것도 입력하지 않은 지난 초안은 다음 발주일로 옮긴다
      sess.date = formatDate(nextOrderDate(new Date(), s.settings.orderDays));
      this.persist();
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

  /**
   * @param {string} html 모달 내용
   * @param {(modal:HTMLElement)=>void} [onMount]
   * @param {()=>void} [onClose] 닫힐 때(배경 클릭·ESC 포함) 호출
   */
  openModal(html, onMount, onClose) {
    this.closeModal();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('click', (e) => {
      if (e.target === back) this.closeModal();
    });
    document.body.appendChild(back);
    this.modal = back;
    this.modalOnClose = onClose || null;
    linkLabels(back);
    if (onMount) onMount(back.querySelector('.modal'));
  },

  closeModal() {
    if (this.modal) {
      const cb = this.modalOnClose;
      this.modal.remove();
      this.modal = null;
      this.modalOnClose = null;
      if (cb) cb();
    }
  },

  render() {
    const s = this.state;
    const tab = VIEWS[s.ui.tab] ? s.ui.tab : 'count';
    const next = nextOrderDate(new Date(), s.settings.orderDays);
    const nextLabel = `${next.getMonth() + 1}/${next.getDate()} (${weekdayKo(next)})`;
    let body;
    try {
      body = VIEWS[tab].render(s, this);
    } catch (err) {
      this.renderRecovery(err);
      return;
    }
    const orderCount = orderView.pendingCount(s);
    const html = `
      <header class="topbar">
        <div>
          <h1>${esc(s.settings.storeName || '카페')} 재고관리</h1>
          <div class="sub">다음 발주일 ${esc(nextLabel)} · ${esc(s.settings.supplierName || '')}</div>
        </div>
        <div class="row">${VIEWS[tab].headerActions ? VIEWS[tab].headerActions(s) : ''}</div>
      </header>
      <main class="view" data-tab="${tab}">${body}</main>
      <nav class="tabbar" aria-label="주요 탭">
        ${TABS.map(
          (t) => `<button type="button" data-action="tab" data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}" aria-current="${t.id === tab ? 'page' : 'false'}">
            <span class="ico" aria-hidden="true">${t.ico}</span>${t.label}
            ${t.id === 'order' && orderCount > 0 ? `<span class="badge">${orderCount}</span>` : ''}
          </button>`,
        ).join('')}
      </nav>`;
    this.root.innerHTML = html;
    linkLabels(this.root);
    if (VIEWS[tab].afterRender) VIEWS[tab].afterRender(s, this);
  },

  /** 저장된 데이터가 깨져 화면을 그릴 수 없을 때의 복구 화면 */
  renderRecovery(err) {
    console.error(err);
    this.root.innerHTML = `
      <div class="view">
        <section class="card">
          <h2>화면을 그리지 못했습니다</h2>
          <p class="small muted">저장된 데이터에 문제가 있는 것 같습니다. 백업을 내려받아 두고 초기화하면 다시 쓸 수 있습니다.</p>
          <pre class="order-text small">${esc(err?.message || String(err))}</pre>
          <div class="row wrap mt">
            <button type="button" class="btn" data-action="recovery-export">⬇️ 현재 데이터 백업</button>
            <button type="button" class="btn danger" data-action="recovery-reset">모든 데이터 초기화</button>
          </div>
        </section>
      </div>`;
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
    this.actions['recovery-export'] = () => settingsView.downloadBackup(this, exportJSON(this.state));
    this.actions['recovery-reset'] = () => {
      if (!confirm('모든 데이터를 지우고 처음 상태로 돌릴까요?')) return;
      this.state = defaultState();
      this.persist();
      this.render();
    };

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
    // role="button"인 요소(품목 행 등)를 키보드로도 누를 수 있게
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal) {
        this.closeModal();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]')) {
        e.preventDefault();
        e.target.click();
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

    // 다른 탭/창(홈 화면 앱 + 브라우저 탭)에서 저장하면 여기에도 반영
    let staleFromOtherTab = false;
    const refreshFromStorage = () => {
      staleFromOtherTab = false;
      this.state = load();
      if (!this.modal) this.render();
    };
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (document.hidden || !typing) refreshFromStorage();
      else staleFromOtherTab = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && staleFromOtherTab) refreshFromStorage();
    });

    this.render();
  },
};

// 단일 파일 빌드(scripts/build-single.mjs)에서는 esbuild define으로 true가 된다.
const SINGLE_FILE = typeof __SINGLE_FILE__ !== 'undefined' && __SINGLE_FILE__;

function boot() {
  app.mount(document.getElementById('app'));
  const isDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!SINGLE_FILE && !isDev && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // 새 버전이 배포되어 서비스 워커가 바뀌면 새로고침을 안내
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // 최초 설치는 안내 불필요
      app.toast('새 버전이 준비되었습니다. 화면을 새로고침하면 적용됩니다.', 6000);
    });
  }
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

// 디버깅용
window.__cafeApp = app;
