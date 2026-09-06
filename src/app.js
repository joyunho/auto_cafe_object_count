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
import { pickBackend, shareConfig } from './sync/index.js';
import { createSync } from './sync/engine.js';
import { createBaselineStore, backendScope, clearBaseline } from './sync/baseline.js';

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
  syncChain: null, // 연결 시도를 한 줄로 세운다 (설정 변경이 겹쳐도 엔진이 둘 생기지 않게)
  syncQueued: false,
  syncRetryTimer: null,
  syncRetryMs: 0,
  syncFailLogged: false,
  sdkRefreshHinted: false,
  stateSaved: true, // 마지막 persist 가 앱 상태를 디스크에 남겼는가 (false 면 엔진이 기준선을 쓰지 않는다)

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
    let saved = save(this.state);
    if (!saved) {
      // 저장 공간이 모자라면 기준선을 버려 자리를 만들고 다시 시도한다 — 센 수량을 못 남기는 것보다 낫다
      // (기준선이 없어도 다음 연결은 "원격에 없는 로컬 입력은 합쳐서 올린다"로 안전하게 시작한다).
      // 엔진에게 맡겨야 마지막 저장 내용 메모도 같이 지워져, 다음 기준선 저장이 건너뛰어지지 않는다
      if (this.sync?.dropBaseline) this.sync.dropBaseline();
      else clearBaseline();
      saved = save(this.state);
      if (!saved) this.toast('저장 공간이 부족해 저장하지 못했습니다.');
    }
    // 상태를 디스크에 못 남긴 주기에는 기준선도 쓰지 않는다 (엔진 saveBaseline 이 이 값을 본다) —
    // 기준선이 상태보다 앞서면 다음 실행이 낡은 로컬 값을 "아직 못 보낸 변경"으로 보고 원격에 덮어쓴다
    this.stateSaved = saved;
    if (!fromRemote) this.sync?.schedule();
  },

  /** 공유 저장소 연결 (아티팩트 db / Firebase / 없음). 설정이 바뀌면 다시 부른다 */
  startSync() {
    clearTimeout(this.syncRetryTimer);
    this.syncRetryTimer = null;
    if (this.syncQueued) return this.syncChain; // 이미 다음 연결이 줄 서 있다
    this.syncQueued = true;
    this.syncChain = Promise.resolve(this.syncChain)
      .catch(() => {})
      .then(() => {
        this.syncQueued = false;
        return this.connectSync();
      });
    return this.syncChain;
  },

  async connectSync() {
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
    // 붙는 동안에는 '이 기기만'이 아니라 '연결 중'으로 보여 준다 — 공유하기로 해 둔 기기인데 아직 안 붙은 상태다
    if (shareConfig(this.state.settings) || globalThis.window?.__SHARED_BACKEND__ === 'local') {
      this.setSyncStatus({ state: 'connecting', backend: null, error: null, lastSyncAt: null });
    }
    let backend = null;
    try {
      backend = await pickBackend(this.state.settings);
    } catch (err) {
      if (this.syncFailLogged) console.debug('[sync] 다시 연결 실패', err?.message || err);
      else console.error(err);
      this.syncFailLogged = true;
      this.setSyncStatus({ state: 'error', backend: null, error: err?.message || String(err), lastSyncAt: null });
      this.scheduleSyncRetry(); // 신호가 없어 SDK 를 못 받았을 뿐일 수 있다 — 앱을 다시 열지 않아도 스스로 붙는다
      return;
    }
    if (!backend) {
      this.setSyncStatus({ state: 'off', backend: null, error: null, lastSyncAt: null });
      return;
    }
    this.syncRetryMs = 0;
    this.syncFailLogged = false;
    this.sync = createSync(this, backend, {
      log: (...a) => console.debug('[sync]', ...a),
      // 마지막으로 원격과 맞춘 상태를 이 기기에 남긴다 — 앱을 다시 열어도 아직 못 보낸 입력을 알아본다
      baseline: createBaselineStore(backendScope(backend)),
    });
    this.sync.start();
  },

  /**
   * 앱을 열 때 Firebase SDK 를 못 받았으면(지하 창고처럼 신호가 없을 때) 브라우저가 그 주소를 "실패"로 기억해서
   * 이 화면에서는 몇 번을 다시 불러도 같은 오류가 난다. gstatic 의 firestore 모듈이 app 모듈을 절대 주소로
   * 불러오기 때문에 주소를 바꿔 다시 받는 우회도 통하지 않는다 — 새로고침만이 확실한 복구다.
   */
  needsSdkReload() {
    return !this.sync && this.syncStatus.state === 'error' && /SDK/.test(this.syncStatus.error || '');
  },

  /** 지금 새로고침해도 괜찮은가 (세는 중이면 방해하지 않는다) */
  safeToReload() {
    if (this.modal) return false;
    const el = document.activeElement;
    return !(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  },

  /**
   * 신호가 돌아왔는데 SDK 를 못 받아 멈춰 있으면 스스로 살아난다.
   * 화면이 꺼져 있을 때(백그라운드)는 조용히 새로고침해 두고, 보고 있을 때는 세는 중이 아닐 때만 한 번 새로고침한다.
   * 센 수량은 이 기기에 그대로 남아 있어 새로고침해도 사라지지 않는다 (기준선 저장).
   */
  recoverBySdkReload({ hidden = false, retry = false } = {}) {
    if (!this.needsSdkReload() || !this.root) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (hidden) return this.reloadForSync();
    // 세는 중이 아니면 바로 새로고침한다. 세는 중이면 미루고, 손을 뗄 때 다시 여기로 온다
    if (this.safeToReload()) return this.reloadForSync();
    if (retry || this.sdkRefreshHinted) return;
    this.sdkRefreshHinted = true;
    this.toast('연결이 돌아왔습니다. 다 세고 손을 떼면 자동으로 이어집니다 (센 수량은 그대로 남아 있습니다).', 6000);
  },

  reloadForSync() {
    this.flushNow();
    try {
      location.reload();
    } catch (err) {
      console.warn('[sync] reload failed', err);
    }
  },

  /** 연결에 실패했으면 점점 뜸하게 다시 시도한다 (5초 → 최대 1분) */
  scheduleSyncRetry() {
    if (this.syncRetryTimer || this.sync) return;
    this.syncRetryMs = Math.min(60000, this.syncRetryMs ? this.syncRetryMs * 2 : 5000);
    this.syncRetryTimer = setTimeout(() => {
      this.syncRetryTimer = null;
      if (!this.sync) this.startSync().then(() => this.recoverBySdkReload());
    }, this.syncRetryMs);
  },

  /** 아직 안 보낸 입력을 지금 보낸다 (앱이 백그라운드로 가거나 닫히기 직전 — iOS 는 곧 정지되어 타이머가 안 돈다) */
  flushNow() {
    try {
      this.sync?.flush();
    } catch (err) {
      console.warn('[sync] flush failed', err);
    }
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
    const stuck = this.needsSdkReload();
    const action = stuck ? 'sync-reload' : 'tab';
    const hint = stuck ? '눌러서 다시 연결 (센 수량은 그대로 남습니다)' : st.error || '';
    return `<span id="sync-pill" class="pill ${cls} sync-pill" title="${esc(hint)}" data-action="${action}" data-tab="settings" role="button">${esc(label)}${stuck ? ' ↻' : ''}</span>`;
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
    this.actions['sync-reload'] = () => this.reloadForSync();
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
    // 앱이 백그라운드로 가거나(홈 버튼) 닫히기 직전에는 디바운스(0.2초)를 기다리지 않고 바로 보낸다.
    // iOS 홈 화면 앱은 그 사이에 정지되면 타이머가 돌지 않아 방금 센 수량이 전송되지 못한 채 남는다
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.flushNow();
        // 화면이 꺼진 김에 조용히 되살린다 — 돌아왔을 때 이미 붙어 있다
        if (this.needsSdkReload()) this.startSync().then(() => this.recoverBySdkReload({ hidden: true }));
        return;
      }
      if (staleFromOtherTab) refreshFromStorage();
      if (!this.sync && this.syncStatus.state === 'error') {
        this.syncRetryMs = 0; // 다시 앞에 왔다 = 사람이 보고 있다. 기다리지 말고 바로 붙어 본다
        this.startSync().then(() => this.recoverBySdkReload());
      }
    });
    // 세는 중(입력칸 포커스)이라 새로고침을 미뤘으면, 손을 떼는 순간 이어서 복구한다
    document.addEventListener('focusout', () => {
      if (!this.needsSdkReload()) return;
      setTimeout(() => this.recoverBySdkReload({ retry: true }), 300); // 다음 칸으로 옮기는 중일 수 있다
    });
    window.addEventListener('pagehide', () => this.flushNow());
    window.addEventListener('freeze', () => this.flushNow()); // 크로미움 계열의 정지 직전 신호
    window.addEventListener('online', () => {
      // 이미 붙어 있으면 Firestore 의 재시도 대기를 초기화해 바로 올린다 (창고에서 나온 직후)
      this.sync?.wake?.();
      this.flushNow();
      if (!this.sync) {
        this.syncRetryMs = 0;
        this.startSync().then(() => this.recoverBySdkReload());
      }
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
