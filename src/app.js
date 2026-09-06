// 앱 엔트리: 상태 관리, 렌더링 루프, 이벤트 위임
import { load, save, uid, exportJSON, defaultState, STORAGE_KEY } from './store.js';
import { esc } from './ui/html.js';
import { nextOrderDate, formatDate, weekdayKo } from './logic/order.js';
import { bookOf, orderDaysFor } from './data/books.js';
import * as countView from './ui/count.js';
import * as orderView from './ui/order.js';
import * as historyView from './ui/history.js';
import * as itemsView from './ui/items.js';
import * as settingsView from './ui/settings.js';
import * as photoView from './ui/photo.js';
import { pickBackend } from './sync/index.js';
import { createSync } from './sync/engine.js';

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
  /** 공유 저장소 동기화 (없으면 이 기기에만 저장) */
  sync: null,
  syncStatus: { state: 'off', backend: null, error: null, lastSyncAt: null },

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

  /** @param {boolean} [fromRemote] 원격에서 받은 변경이면 다시 올리지 않는다 */
  persist(fromRemote = false) {
    if (!save(this.state)) this.toast('저장 공간이 부족해 저장하지 못했습니다.');
    if (!fromRemote) this.sync?.schedule();
  },

  /** 공유 저장소 연결 (아티팩트 db / Firebase / 없음). 설정이 바뀌면 다시 부른다 */
  async startSync() {
    if (this.sync) {
      const old = this.sync;
      this.sync = null;
      try {
        await old.drain(); // 방금 한 입력을 보내고 나서 끊는다
      } catch (err) {
        console.warn('[sync] drain failed', err);
      }
      old.close();
    }
    let backend = null;
    try {
      backend = await pickBackend(this.state.settings);
    } catch (err) {
      console.error(err);
      this.setSyncStatus({ state: 'error', backend: null, error: err?.message || String(err), lastSyncAt: null });
      return;
    }
    if (!backend) {
      this.setSyncStatus({ state: 'off', backend: null, error: null, lastSyncAt: null });
      return;
    }
    this.sync = createSync(this, backend, { log: (...a) => console.debug('[sync]', ...a) });
    this.sync.start();
  },

  setSyncStatus(st) {
    this.syncStatus = st;
    const pill = document.getElementById('sync-pill');
    if (pill) pill.outerHTML = this.syncPill();
    if (this.state.ui.tab === 'settings' && document.getElementById('sync-card')) this.render({ restoreFocus: true });
  },

  /** 상단 표시: 공유 중 / 이 기기만 / 연결 안 됨 */
  syncPill() {
    const st = this.syncStatus || { state: 'off' };
    const label = { on: '공유 중', connecting: '연결 중', error: '연결 안 됨', off: '이 기기만' }[st.state] || st.state;
    const cls = { on: 'ok', connecting: '', error: 'danger', off: '' }[st.state] || '';
    return `<span id="sync-pill" class="pill ${cls} sync-pill" title="${esc(st.error || '')}" data-action="tab" data-tab="settings" role="button">${esc(label)}</span>`;
  },

  /** 원격 변경이 반영되면 화면을 다시 그리되, 입력 중인 칸의 포커스는 지킨다 */
  onRemoteChange() {
    this.render({ restoreFocus: true });
  },

  go(tab) {
    this.update((s) => {
      s.ui.tab = tab;
    });
    window.scrollTo(0, 0);
  },

  /** 지금 보고 있는 장부(제품/자재) id */
  book() {
    return this.state.ui.book || 'product';
  },
  bookInfo() {
    return bookOf(this.book());
  },
  orderDays(book = this.book()) {
    return orderDaysFor(this.state.settings, book);
  },
  /** 장부의 진행 중(초안) 세션을 돌려주고, 없으면 만든다 */
  activeSession(create = true, book = this.book()) {
    const s = this.state;
    const isDraft = (x) => x.status === 'draft' && (x.book || 'product') === book;
    let sess = s.sessions.find((x) => x.id === s.ui.activeSessionId && isDraft(x));
    if (!sess) sess = s.sessions.find(isDraft);
    const today = formatDate(new Date());
    if (!sess && create) {
      sess = {
        id: uid('s_'),
        book,
        date: formatDate(nextOrderDate(new Date(), this.orderDays(book))),
        status: 'draft',
        counts: {},
        overrides: {},
        filled: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      s.sessions.push(sess);
      s.ui.activeSessionId = sess.id;
      this.persist();
    } else if (sess && sess.date < today && Object.keys(sess.counts || {}).length === 0) {
      // 아무것도 입력하지 않은 지난 초안은 다음 발주일로 옮긴다
      sess.date = formatDate(nextOrderDate(new Date(), this.orderDays(book)));
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

  render({ restoreFocus = false } = {}) {
    const s = this.state;
    const active = restoreFocus ? document.activeElement : null;
    const focusKey = active?.dataset?.input && active.dataset.id ? { input: active.dataset.input, id: active.dataset.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const tab = VIEWS[s.ui.tab] ? s.ui.tab : 'count';
    const book = this.bookInfo();
    const next = nextOrderDate(new Date(), this.orderDays());
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
          <div class="sub">${esc(book.short)} 다음 발주일 ${esc(nextLabel)} · ${esc(s.settings.supplierName || '')}</div>
        </div>
        <div class="row">${this.syncPill()}${VIEWS[tab].headerActions ? VIEWS[tab].headerActions(s) : ''}</div>
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
    if (focusKey) {
      const el = this.root.querySelector(`[data-input="${CSS.escape(focusKey.input)}"][data-id="${CSS.escape(focusKey.id)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        try {
          if (focusKey.start != null && el.type !== 'number') el.setSelectionRange(focusKey.start, focusKey.end);
          else if (el.type === 'number' && el.value) {
            // 숫자 칸은 선택 범위를 읽고 되살릴 수 없고, 다시 만든 칸에 focus() 하면 커서가 맨 앞에 놓인다 (이어서 치면 앞에 붙어 1→21).
            // 값을 다시 넣으면 커서가 끝으로 가므로 이어서 친 숫자가 뒤에 붙는다 (1→12)
            const v = el.value;
            el.value = '';
            el.value = v;
          }
        } catch {
          /* 숫자 입력칸은 선택 범위를 지원하지 않음 */
        }
        el.closest('.item-row')?.classList.add('active');
      }
    }
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
    this.actions['book-switch'] = (el) => {
      const book = bookOf(el.dataset.book).id;
      this.update((st) => {
        st.ui.book = book;
        st.ui.activeSessionId = null;
      });
    };
    this.actions['recovery-export'] = () => settingsView.downloadBackup(this, exportJSON(this.state));
    this.actions['recovery-reset'] = () => {
      if (!confirm(`모든 데이터를 지우고 처음 상태로 돌릴까요?${this.syncStatus?.state === 'on' ? '\n(공유 저장소의 데이터도 같이 지워집니다. 다른 기기에서 세는 중인 초안은 남습니다)' : ''}`)) return;
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
    this.startSync();
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
