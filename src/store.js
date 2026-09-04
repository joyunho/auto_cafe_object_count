// 로컬 저장소 (localStorage) — 상태 로드/저장/백업/복원
import { SEED_ITEMS, SEED_GROUPS, SEED_SETTINGS } from './data/items.js';

export const STORAGE_KEY = 'cafe-inventory-v1';
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

function safeGet() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSet(v) {
  try {
    localStorage.setItem(STORAGE_KEY, v);
    return true;
  } catch {
    return false;
  }
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  const base = defaultState();
  const state = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    ui: { ...base.ui, ...(raw.ui || {}) },
  };
  if (!Array.isArray(state.items) || !state.items.length) state.items = base.items;
  if (!Array.isArray(state.groups) || !state.groups.length) state.groups = base.groups;
  if (!Array.isArray(state.sessions)) state.sessions = [];
  if (!Array.isArray(state.orders)) state.orders = [];
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

export function exportJSON(state) {
  const { ui, ...rest } = state;
  return JSON.stringify({ ...rest, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  return migrate(parsed);
}

/** 품목 시드로 초기화 — 기록은 유지하고 품목/그룹만 되돌린다 */
export function resetItems(state) {
  const base = defaultState();
  return { ...state, items: base.items, groups: base.groups };
}
