// 로컬 저장소 (localStorage) — 상태 로드/저장/백업/복원
import { SEED_ITEMS, SEED_GROUPS, SEED_SETTINGS } from './data/items.js';
import { SEED_SUPPLY_ITEMS, SEED_SUPPLY_GROUPS } from './data/supplies.js';
import { BOOKS, DEFAULT_BOOK } from './data/books.js';

export const STORAGE_KEY = 'cafe-inventory-v1';
export const SAFETY_KEY = 'cafe-inventory-v1.before-import';
export const SCHEMA_VERSION = 1;

export function uid(prefix = '') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/** 단일 파일 빌드가 window.__CONSUMPTION_MODEL__ 로 심어 둔 소비 모델(있으면) */
export function builtinModel() {
  try {
    const m = typeof window !== 'undefined' ? window.__CONSUMPTION_MODEL__ : null;
    return m && typeof m === 'object' && m.items ? m : null;
  } catch {
    return null;
  }
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    consumption: builtinModel(),
    items: [...SEED_ITEMS, ...SEED_SUPPLY_ITEMS].map((it) => ({ ...it })),
    groups: [...SEED_GROUPS, ...SEED_SUPPLY_GROUPS].map((g) => ({ ...g })),
    sessions: [],
    orders: [],
    settings: { ...SEED_SETTINGS, orderDaysByBook: { ...SEED_SETTINGS.orderDaysByBook } },
    seeded: { supply: true }, // 어떤 시드가 이미 들어갔는지 (한 번만 덧붙이기 위한 표시)
    ui: { tab: 'count', book: DEFAULT_BOOK, activeSessionId: null },
  };
}

function safeGet(key = STORAGE_KEY) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(v, key = STORAGE_KEY) {
  try {
    localStorage.setItem(key, v);
    return true;
  } catch {
    return false;
  }
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const objList = (arr) => (Array.isArray(arr) ? arr.filter(isObj) : []);

/** 어떤 모양의 입력이 와도 앱이 렌더링할 수 있는 상태로 정리한다 */
export function migrate(raw) {
  if (!isObj(raw)) return defaultState();
  const base = defaultState();
  const state = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(isObj(raw.settings) ? raw.settings : {}) },
    ui: { ...base.ui, ...(isObj(raw.ui) ? raw.ui : {}) },
  };
  const bookIds = BOOKS.map((b) => b.id);
  const bookOr = (b) => (bookIds.includes(b) ? b : DEFAULT_BOOK);
  state.items = objList(state.items)
    .filter((it) => typeof it.id === 'string' && typeof it.name === 'string')
    .map((it) => ({ ...it, book: bookOr(it.book) }));
  if (!state.items.length) state.items = base.items;
  state.groups = objList(state.groups)
    .filter((g) => typeof g.id === 'string' && typeof g.title === 'string')
    .map((g) => ({ ...g, book: bookOr(g.book) }));
  if (!state.groups.length) state.groups = base.groups;
  // 자재 장부가 없는 예전 데이터에는 자재 시트 시드를 한 번만 붙인다 (지웠다면 다시 붙이지 않음)
  state.seeded = isObj(raw.seeded) ? { ...raw.seeded } : {}; // 기본 상태의 표시는 상속하지 않는다 (예전 데이터는 표시가 없음)
  if (!state.seeded.supply) {
    if (!state.items.some((it) => it.book === 'supply')) {
      for (const g of SEED_SUPPLY_GROUPS) if (!state.groups.some((x) => x.id === g.id)) state.groups.push({ ...g });
      for (const it of SEED_SUPPLY_ITEMS) if (!state.items.some((x) => x.id === it.id)) state.items.push({ ...it });
    }
    state.seeded.supply = true;
  }
  state.sessions = objList(state.sessions)
    .filter((s) => typeof s.id === 'string')
    .map((s) => ({
      ...s,
      date: typeof s.date === 'string' ? s.date : '',
      status: s.status === 'submitted' ? 'submitted' : 'draft',
      book: bookOr(s.book),
      counts: isObj(s.counts) ? s.counts : {},
      overrides: isObj(s.overrides) ? s.overrides : {},
      filled: isObj(s.filled) ? s.filled : {}, // 예상값·기준값으로 채운 품목 (실측 아님)
    }));
  state.orders = objList(state.orders)
    .filter((o) => typeof o.id === 'string')
    .map((o) => ({ ...o, book: bookOr(o.book), lines: objList(o.lines), text: typeof o.text === 'string' ? o.text : '' }));
  const days = Array.isArray(state.settings.orderDays) ? state.settings.orderDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  state.settings.orderDays = days.length ? [...new Set(days)].sort() : [...SEED_SETTINGS.orderDays];
  const byBook = isObj(state.settings.orderDaysByBook) ? state.settings.orderDaysByBook : {};
  state.settings.orderDaysByBook = {};
  for (const b of BOOKS) {
    if (b.id === 'product') continue;
    const d = Array.isArray(byBook[b.id]) ? byBook[b.id].map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : [];
    state.settings.orderDaysByBook[b.id] = d.length ? [...new Set(d)].sort() : [...b.orderDays];
  }
  state.ui.book = bookOr(state.ui.book);
  for (const k of ['storeName', 'senderName', 'supplierName', 'orderTitle', 'apiKey']) {
    if (typeof state.settings[k] !== 'string') state.settings[k] = SEED_SETTINGS[k];
  }
  if (state.settings.photoMode !== 'shelf') state.settings.photoMode = 'sheet';
  // 소비 모델: 없으면 내장 모델(단일 파일 빌드) 또는 null. 사용자가 지운 것(false)은 그대로 둔다.
  if (!('consumption' in raw)) state.consumption = builtinModel();
  else if (state.consumption !== false && (!isObj(state.consumption) || !isObj(state.consumption.items))) state.consumption = builtinModel();
  state.version = SCHEMA_VERSION;
  return state;
}

export function load() {
  const raw = safeGet();
  if (!raw) return defaultState();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function save(state) {
  return safeSet(JSON.stringify(state));
}

/** 백업 JSON — 화면 상태와 API 키는 제외한다(키는 이 기기에만 둔다) */
export function exportJSON(state) {
  const { ui, settings, ...rest } = state;
  const { apiKey, ...safeSettings } = settings || {};
  return JSON.stringify({ ...rest, settings: safeSettings, exportedAt: new Date().toISOString() }, null, 2);
}

/** 백업 파일처럼 생겼는지 확인한 뒤 정리한다. 아니면 throw. */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!isObj(parsed) || !Array.isArray(parsed.items) || typeof parsed.version !== 'number') {
    throw new Error('not a backup');
  }
  return migrate(parsed);
}

/** 덮어쓰기 전에 현재 상태를 한 벌 보관 (복원 실수 대비) */
export function keepSafetyCopy(state) {
  return safeSet(JSON.stringify(state), SAFETY_KEY);
}

export function loadSafetyCopy() {
  const raw = safeGet(SAFETY_KEY);
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 품목 시드로 초기화 — 기록은 유지하고 품목/그룹만 되돌린다 */
export function resetItems(state) {
  const base = defaultState();
  return { ...state, items: base.items, groups: base.groups };
}
