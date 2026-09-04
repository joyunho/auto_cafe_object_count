// 로컬 저장소 (localStorage) — 상태 로드/저장/백업/복원
import { SEED_ITEMS, SEED_GROUPS, SEED_SETTINGS } from './data/items.js';

export const STORAGE_KEY = 'cafe-inventory-v1';
export const SAFETY_KEY = 'cafe-inventory-v1.before-import';
export const SCHEMA_VERSION = 1;

export function uid(prefix = '') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    items: SEED_ITEMS.map((it) => ({ ...it })),
    groups: SEED_GROUPS.map((g) => ({ ...g })),
    sessions: [],
    orders: [],
    settings: { ...SEED_SETTINGS },
    ui: { tab: 'count', activeSessionId: null },
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
  state.items = objList(state.items).filter((it) => typeof it.id === 'string' && typeof it.name === 'string');
  if (!state.items.length) state.items = base.items;
  state.groups = objList(state.groups).filter((g) => typeof g.id === 'string' && typeof g.title === 'string');
  if (!state.groups.length) state.groups = base.groups;
  state.sessions = objList(state.sessions)
    .filter((s) => typeof s.id === 'string')
    .map((s) => ({
      ...s,
      date: typeof s.date === 'string' ? s.date : '',
      status: s.status === 'submitted' ? 'submitted' : 'draft',
      counts: isObj(s.counts) ? s.counts : {},
      overrides: isObj(s.overrides) ? s.overrides : {},
    }));
  state.orders = objList(state.orders)
    .filter((o) => typeof o.id === 'string')
    .map((o) => ({ ...o, lines: objList(o.lines), text: typeof o.text === 'string' ? o.text : '' }));
  const days = Array.isArray(state.settings.orderDays) ? state.settings.orderDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  state.settings.orderDays = days.length ? [...new Set(days)].sort() : [...SEED_SETTINGS.orderDays];
  for (const k of ['storeName', 'senderName', 'supplierName', 'orderTitle', 'apiKey']) {
    if (typeof state.settings[k] !== 'string') state.settings[k] = SEED_SETTINGS[k];
  }
  if (state.settings.photoMode !== 'shelf') state.settings.photoMode = 'sheet';
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
