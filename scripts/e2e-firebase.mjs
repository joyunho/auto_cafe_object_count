// 두 기기 실시간 공유 e2e — Firebase Firestore 에뮬레이터 + 크로미움 컨텍스트 두 개(A·B = 기기 두 대).
//   준비: firebase-tools 의 Firestore 에뮬레이터가 127.0.0.1:8085 에 떠 있어야 한다
//         (예: firebase emulators:start --only firestore --project demo-cafe)
//   실행: npm run e2e:firebase   → e2e-out/fb-*.png
//   환경: E2E_PORT(기본 8094) · FIRESTORE_EMULATOR_HOST(기본 127.0.0.1:8085) · HTTPS_PROXY(있으면 크로미움도 그 프록시를 쓴다)
//
// SDK(gstatic CDN)를 크로미움이 직접 못 받는 환경(TLS 를 가로채는 프록시가 크로미움의 ClientHello 를 끊는 샌드박스 등)에서는
// 같은 주소를 Playwright 의 Node 쪽 HTTP 클라이언트(HTTPS_PROXY · NODE_EXTRA_CA_CERTS 적용)로 받아 그대로 넘겨 준다.
// 먼저 직접 받기를 시도하고 안 될 때만 그렇게 한다. 크로미움에는 proxy 옵션을 주지 않는다 — Playwright 는 proxy 를 주면
// localhost 까지 프록시로 보내고(<-loopback>), 리눅스 크로미움은 어차피 환경변수 프록시를 스스로 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from 'playwright-core';
import { launch } from './browser.mjs';
import { SDK_VERSION } from '../src/sync/firebase.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 8094);
const BASE = `http://localhost:${PORT}/`;
const [EMU_HOST, EMU_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
const PROJECT = 'demo-cafe';
const OUT = path.join(root, 'e2e-out');
const WAIT = 10_000; // 원격 반영을 기다리는 최대 시간
const WAIT_PUSH = 60_000; // 첫 기기가 로컬 전체(품목 100여 개)를 문서 하나씩 올리는 데 걸리는 최대 시간 — 그동안은 "연결 중"
fs.mkdirSync(OUT, { recursive: true });

const storeCode = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const SHARE_CONFIG = { firebase: { apiKey: 'demo', projectId: PROJECT, appId: '1:demo:web:demo' }, storeCode, emulator: { host: EMU_HOST, port: Number(EMU_PORT) } };
const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
const EMU_REST = `http://${EMU_HOST}:${EMU_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/stores/${storeCode}`;

// ── 에뮬레이터 · 정적 서버 ─────────────────────────────────
async function checkEmulator() {
  try {
    const r = await fetch(`http://${EMU_HOST}:${EMU_PORT}/`);
    if (r.ok) return;
  } catch {
    /* 아래에서 안내 */
  }
  throw new Error(`Firestore 에뮬레이터가 ${EMU_HOST}:${EMU_PORT} 에 없습니다. 먼저 실행하세요: firebase emulators:start --only firestore --project ${PROJECT}`);
}
/** 에뮬레이터 REST 로 컬렉션의 문서 id 목록 (브라우저와 무관하게 원격에 실제로 있는지 확인용) */
async function remoteIds(coll) {
  const ids = [];
  let token = '';
  do {
    const r = await fetch(`${EMU_REST}/${coll}?pageSize=300&mask.fieldPaths=id${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    if (!r.ok) throw new Error(`emulator REST ${r.status} (${coll})`);
    const j = await r.json();
    for (const d of j.documents || []) ids.push(d.name.split('/').pop());
    token = j.nextPageToken || '';
  } while (token);
  return ids;
}
async function remoteDoc(coll, id) {
  const r = await fetch(`${EMU_REST}/${coll}/${encodeURIComponent(id)}`);
  return r.ok ? r.json() : null;
}

const server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* 재시도 */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('서버가 뜨지 않았습니다');
}

// ── 도우미 ────────────────────────────────────────────────
const problems = [];
let collecting = true;
let step = 0;
const shot = async (page, name) => {
  step++;
  await page.screenshot({ path: path.join(OUT, `fb-${String(step).padStart(2, '0')}-${name}.png`), fullPage: false });
};
const log = (m) => console.log(`✓ ${m}`);
const count = (page, id) => page.locator(`input[data-input="count"][data-id="${id}"]`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 조건이 참이 될 때까지 (최대 WAIT) 기다린다 — 실패하면 어느 기기의 무엇이 안 됐는지 남긴다 */
async function waitFor(dev, fn, arg, label, timeout = WAIT) {
  try {
    await dev.page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (e) {
    throw new Error(`${dev.name}: ${label} (${timeout / 1000}s 안에 안 됨): ${e.message.split('\n')[0]}`);
  }
}
const pill = (dev) => dev.page.evaluate(() => document.querySelector('#sync-pill')?.textContent.trim());
const sessionId = (dev) => dev.page.evaluate(() => window.__cafeApp.activeSession().id);
const counts = (dev) => dev.page.evaluate(() => JSON.parse(JSON.stringify(window.__cafeApp.activeSession().counts)));
const drafts = (dev) => dev.page.evaluate(() => window.__cafeApp.state.sessions.filter((s) => s.status === 'draft').map((s) => `${s.book || 'product'}:${s.id}`));
/** 아직 안 보낸 로컬 변경을 지금 보낸다 (디바운스 기다리지 않게) */
const settle = (dev) => dev.page.evaluate(() => window.__cafeApp.sync?.flush());
async function fillAll(dev, map) {
  for (const [id, v] of Object.entries(map)) await count(dev.page, id).fill(String(v));
}
/** 원격(에뮬레이터 REST)이 조건을 만족할 때까지 (최대 WAIT) 기다린다 */
async function waitForRemote(fetchFn, ok, label) {
  let last;
  for (let i = 0; i < WAIT / 250; i++) {
    last = await fetchFn();
    if (ok(last)) return last;
    await sleep(250);
  }
  throw new Error(`${label} (${WAIT / 1000}s 안에 안 됨): ${JSON.stringify(last)?.slice(0, 300)}`);
}
const remoteCount = (doc, id) => doc?.fields?.counts?.mapValue?.fields?.[id]?.integerValue;
/** 이 기기에서 전체 화면을 다시 그린 횟수를 세기 시작한다 (자기 쓰기의 메아리로 다시 그리는지 보는 용도) */
const countRenders = (dev) =>
  dev.page.evaluate(() => {
    const app = window.__cafeApp;
    window.__renders = 0;
    const orig = app.render;
    app.render = function (...a) {
      window.__renders++;
      return orig.apply(this, a);
    };
  });
const renders = (dev) => dev.page.evaluate(() => window.__renders);

// ── SDK 를 크로미움이 직접 받을 수 있는지 ─────────────────
async function detectSdkMode(browser) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const err = await page.evaluate((u) => import(u).then(() => null, (e) => String(e?.message || e)), `${SDK_BASE}firebase-app.js`);
  await ctx.close();
  return err;
}
const sdkCache = new Map();
let sdkFetcher = null; // Node 쪽 HTTP 클라이언트 (프록시 뒤에서도 CDN 을 받는다)
async function fetchSdk(url) {
  let hit = sdkCache.get(url);
  if (hit) return hit;
  sdkFetcher ||= await request.newContext({ proxy: proxy ? { server: proxy } : undefined, ignoreHTTPSErrors: true });
  const res = await sdkFetcher.get(url, { timeout: 30_000 });
  if (!res.ok()) throw new Error(`${res.status()} ${res.statusText()}`);
  hit = { status: res.status(), body: await res.body() };
  sdkCache.set(url, hit);
  return hit;
}
async function routeSdk(context) {
  await context.route(`${SDK_BASE}**`, async (route) => {
    const url = route.request().url();
    try {
      const hit = await fetchSdk(url);
      await route.fulfill({ status: hit.status, body: hit.body, headers: { 'content-type': 'text/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
    } catch (e) {
      problems.push(`SDK route ${url}: ${e.message}`);
      await route.abort();
    }
  });
}

// ── 본문 ──────────────────────────────────────────────────
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const browser = await launch();
const devices = [];
let sdkMode = 'native';

async function device(name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    ignoreHTTPSErrors: true,
  });
  if (sdkMode === 'route') await routeSdk(context);
  await context.addInitScript((cfg) => {
    window.__SHARE_CONFIG__ = cfg;
  }, SHARE_CONFIG);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (collecting && msg.type() === 'error') problems.push(`${name} console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    if (collecting) problems.push(`${name} pageerror: ${err.message}`);
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('.tabbar');
  const dev = { name, context, page };
  devices.push(dev);
  return dev;
}

try {
  await Promise.all([checkEmulator(), waitForServer()]);
  const nativeErr = await detectSdkMode(browser);
  if (nativeErr) {
    sdkMode = 'route';
    console.log(`· 크로미움이 ${SDK_BASE} 를 직접 받지 못해(${nativeErr.split('\n')[0]}) Node 쪽에서 받아 넘겨 줍니다${proxy ? ` (프록시 ${proxy})` : ''}`);
  } else console.log(`· 크로미움이 ${SDK_BASE} 를 직접 받습니다`);
  console.log(`· storeCode ${storeCode} · emulator ${EMU_HOST}:${EMU_PORT} · SDK ${SDK_VERSION}`);

  // 1. 기기 A: 공유 연결 → 원격이 비어 있으므로 로컬(품목·분류·설정·초안)이 문서 하나씩 차례로 올라간다 (그동안 "연결 중").
  //    올리는 도중에 초안에 입력해도 살아남아 뒤따라 올라가야 한다 — 뒤늦게 나가는 초안 set 은 flush 를 시작할 때의(빈) 문서이고,
  //    그 메아리(확인 전 스냅샷)가 원격 변경으로 오해되면 그 사이의 입력을 덮어쓴다
  const A = await device('A');
  await waitFor(A, () => window.__cafeApp.sync?.ready === true, null, '부트스트랩(첫 대조) 완료');
  const pushStart = Date.now();
  const pillDuringPush = await pill(A);
  await count(A.page, 'milk').fill('3'); // 첫 push 가 진행 중일 때 입력
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().counts.milk), 3);
  assert.equal(pillDuringPush, '연결 중', '로컬을 다 올리기 전에는 아직 연결 중');
  await waitFor(A, () => document.querySelector('#sync-pill')?.textContent.trim() === '공유 중', null, '#sync-pill 공유 중 (첫 push 완료)', WAIT_PUSH);
  const pushSec = ((Date.now() - pushStart) / 1000).toFixed(1);
  assert.equal(await A.page.evaluate(() => window.__cafeApp.syncStatus.backend), 'firebase');
  await settle(A);
  const stA = await A.page.evaluate(() => JSON.parse(JSON.stringify(window.__cafeApp.state)));
  const remoteItems = await remoteIds('items');
  assert.equal(remoteItems.length, stA.items.length, '에뮬레이터에 품목 문서가 전부 올라감');
  assert.equal((await remoteIds('groups')).length, stA.groups.length, '분류 문서');
  const remoteSettings = await remoteDoc('meta', 'settings');
  assert.ok(remoteSettings && !('apiKey' in remoteSettings.fields) && !('shareConfig' in remoteSettings.fields), '설정 문서에 API 키·공유 설정은 없음');
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().counts.milk), 3, '첫 push 중에 입력한 우유 3 이 남아 있음');
  const sid0 = await sessionId(A);
  await waitForRemote(() => remoteDoc('sessions', sid0), (d) => remoteCount(d, 'milk') === '3', '에뮬레이터 세션 문서 counts.milk = 3');
  await shot(A.page, 'a-shared');
  log(`A 공유 중 (firebase · stores/${storeCode}) — 첫 push ${pushSec}초 (그동안 연결 중) · 에뮬레이터에 품목 ${remoteItems.length}개·분류 ${stA.groups.length}개·설정 문서 확인 · push 중 입력한 우유 3 유지·반영`);

  // 2. A 가 유자청 2 → 나중에 연 B 도 같은 재고조사(세션)를 본다
  await count(A.page, 'yuja-cheong').fill('2');
  await settle(A);
  const B = await device('B');
  await waitFor(B, () => document.querySelector('#sync-pill')?.textContent.trim() === '공유 중', null, '#sync-pill 공유 중');
  await waitFor(B, () => document.querySelector('input[data-input="count"][data-id="yuja-cheong"]')?.value === '2', null, '유자청 2 표시');
  const sidA = await sessionId(A);
  assert.equal(await sessionId(B), sidA, '두 기기의 활성 세션 id 가 같음');
  const remoteSess = await remoteDoc('sessions', sidA);
  assert.equal(remoteSess?.fields?.counts?.mapValue?.fields?.['yuja-cheong']?.integerValue, '2', '에뮬레이터 세션 문서의 counts.yuja-cheong = 2');
  await shot(B.page, 'b-joined');
  log(`B 합류: 유자청 2 · 같은 세션 ${sidA}`);

  // 3. B 가 청귤청 5 → A 에 새로고침 없이 반영, A 의 유자청은 그대로 2
  await count(B.page, 'cheonggyul-cheong').fill('5');
  await waitFor(A, () => document.querySelector('input[data-input="count"][data-id="cheonggyul-cheong"]')?.value === '5', null, '청귤청 5 표시');
  assert.equal(await count(A.page, 'yuja-cheong').inputValue(), '2');
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().counts['yuja-cheong']), 2);
  await shot(A.page, 'a-remote-count');
  log('B → A 실시간 반영 (청귤청 5), A 의 유자청 2 유지');

  // 4. 동시에 서로 다른 품목 3개씩 → 양쪽 모두 같은 counts 로 수렴 (세션은 필드 단위 병합)
  const aSet = { 'strawberry-cheong': 1, 'blueberry-cheong': 2, 'ice-cream': 3 };
  const bSet = { 'grape-juice': 4, kiwi: 6, tomato: 7 };
  await Promise.all([fillAll(A, aSet), fillAll(B, bSet)]);
  const expected = { milk: 3, 'yuja-cheong': 2, 'cheonggyul-cheong': 5, ...aSet, ...bSet };
  const hasAll = (exp) => Object.entries(exp).every(([k, v]) => window.__cafeApp.activeSession().counts[k] === v);
  await waitFor(A, hasAll, expected, '동시 입력 8개 수렴');
  await waitFor(B, hasAll, expected, '동시 입력 8개 수렴');
  const [cA, cB] = await Promise.all([counts(A), counts(B)]);
  assert.deepEqual(cA, cB, '두 기기의 counts 가 같음');
  assert.deepEqual(cA, expected);
  assert.equal(await sessionId(B), sidA);
  await shot(B.page, 'converged');
  log('동시 입력 3+3 → 양쪽 8개 수량 동일하게 수렴');

  // 5. A 가 발주 확정 → B 의 기록 탭에 보임 → 둘 다 재고조사 탭을 다시 열면 빈 초안은 장부당 하나만 남는다
  await B.page.locator('.tabbar [data-tab="history"]').click();
  await B.page.waitForSelector('main[data-tab="history"]');
  await A.page.locator('.tabbar [data-tab="order"]').click();
  await A.page.waitForSelector('#order-text');
  await A.page.locator('[data-action="order-submit"]').click(); // confirm() 은 dialog 핸들러가 수락
  await A.page.waitForSelector('main[data-tab="history"]');
  await settle(A);
  await waitFor(B, (sid) => window.__cafeApp.state.orders.length === 1 && window.__cafeApp.state.sessions.some((s) => s.id === sid && s.status === 'submitted'), sidA, '확정 기록 도착');
  assert.match(await B.page.locator('main').textContent(), /발주 \d+품목/, 'B 기록 탭에 발주 기록');
  await shot(B.page, 'b-history');
  await Promise.all([A.page.locator('.tabbar [data-tab="count"]').click(), B.page.locator('.tabbar [data-tab="count"]').click()]);
  await Promise.all([A.page.waitForSelector('#progress-text'), B.page.waitForSelector('#progress-text')]);
  // 두 기기가 동시에 빈 초안을 하나씩 만들었다 → 엔진이 같은 초안 하나만 남겨야 한다 (양쪽 모두, 같은 id 로)
  let dA = [];
  let dB = [];
  for (let i = 0; i < WAIT / 250; i++) {
    [dA, dB] = await Promise.all([drafts(A), drafts(B)]);
    if (dA.length === 1 && dB.length === 1 && dA[0] === dB[0]) break;
    await sleep(250);
  }
  assert.deepEqual(dA, dB, '두 기기에 남은 초안이 같은 문서');
  assert.equal(dA.length, 1, '초안은 장부당 하나');
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().status), 'draft');
  await Promise.all([settle(A), settle(B)]);
  assert.equal(await count(A.page, 'yuja-cheong').inputValue(), '', '새 초안은 비어 있음');
  // 원격에도 세션은 확정 1 + 초안 1 만 남아야 한다 (중복 초안은 flush 때 지워짐)
  let remoteSessions = [];
  for (let i = 0; i < WAIT / 250; i++) {
    remoteSessions = await remoteIds('sessions');
    if (remoteSessions.length === 2) break;
    await sleep(250);
  }
  assert.deepEqual(remoteSessions.sort(), [sidA, dA[0].split(':')[1]].sort(), '에뮬레이터 sessions = 확정 1 + 초안 1');
  log(`발주 확정 → B 기록 반영 · 빈 초안 중복 제거 (남은 초안 ${dA[0]})`);

  // 6. A 가 품목 이름 변경 → B 의 재고조사 줄 이름이 바뀐다
  await A.page.locator('.tabbar [data-tab="items"]').click();
  await A.page.locator('.item-row[data-id="sparkling-water"]').click();
  await A.page.waitForSelector('#item-form');
  await A.page.locator('#item-form input[name="name"]').fill('탄산수(공유)');
  await A.page.locator('#item-form button[type="submit"]').click();
  await A.page.waitForSelector('#item-form', { state: 'detached' });
  await waitFor(B, () => window.__cafeApp.state.items.find((i) => i.id === 'sparkling-water')?.name === '탄산수(공유)', null, '품목 이름 변경 도착');
  assert.equal((await B.page.locator('.item-row[data-row="sparkling-water"] .name').textContent()).trim(), '탄산수(공유)');
  assert.equal((await remoteDoc('items', 'sparkling-water'))?.fields?.name?.stringValue, '탄산수(공유)', '에뮬레이터 품목 문서');
  await shot(B.page, 'b-renamed');
  log('품목 이름 변경 A → B');

  // 7. A 가 기록 삭제 → B 에서도 사라진다
  await A.page.locator('.tabbar [data-tab="history"]').click();
  await A.page.locator('details summary').first().click();
  await A.page.locator(`[data-action="history-delete"][data-id="${sidA}"]`).click(); // confirm 수락
  await waitFor(A, () => window.__cafeApp.state.orders.length === 0, null, '기록 삭제');
  await waitFor(B, (sid) => window.__cafeApp.state.orders.length === 0 && !window.__cafeApp.state.sessions.some((s) => s.id === sid), sidA, '기록 삭제 도착');
  await B.page.locator('.tabbar [data-tab="history"]').click();
  await B.page.waitForSelector('main[data-tab="history"]');
  assert.match(await B.page.locator('main').textContent(), /아직 확정한 재고조사가 없습니다/);
  assert.equal(await remoteDoc('sessions', sidA), null, '에뮬레이터에서도 세션 삭제');
  assert.deepEqual(await remoteIds('orders'), [], '에뮬레이터 orders 비어 있음');
  await shot(B.page, 'b-history-empty');
  log('기록 삭제 A → B');

  // 8. A 가 매장 이름 변경 → B 상단 제목
  await A.page.locator('.tabbar [data-tab="settings"]').click();
  const storeInput = A.page.locator('input[data-key="storeName"]');
  await storeInput.fill('공유테스트점');
  await storeInput.dispatchEvent('change');
  await waitFor(B, () => /공유테스트점 재고관리/.test(document.querySelector('.topbar h1')?.textContent || ''), null, '매장 이름 도착');
  assert.equal((await remoteDoc('meta', 'settings'))?.fields?.storeName?.stringValue, '공유테스트점');
  await shot(B.page, 'b-storename');
  log('설정(매장 이름) A → B');

  // 9. B 가 입력 중일 때 A 의 변경이 도착해도 B 의 포커스·입력값은 유지되고, 이어서 친 숫자는 뒤에 붙는다 (1 → 12)
  await B.page.locator('.tabbar [data-tab="count"]').click();
  await B.page.waitForSelector('#progress-text');
  await A.page.locator('.tabbar [data-tab="count"]').click();
  await A.page.waitForSelector('#progress-text');
  await count(B.page, 'milk').focus();
  await B.page.keyboard.type('1');
  await count(A.page, 'evian').fill('3');
  await waitFor(B, () => document.querySelector('input[data-input="count"][data-id="evian"]')?.value === '3', null, 'A 의 에비앙 3 도착');
  const focus = await B.page.evaluate(() => ({ id: document.activeElement?.dataset?.id, input: document.activeElement?.dataset?.input, value: document.activeElement?.value }));
  assert.deepEqual(focus, { id: 'milk', input: 'count', value: '1' }, '원격 변경 뒤에도 B 의 포커스와 입력값 유지');
  // 이어서 타이핑하면 같은 칸의 뒤에 붙고(다시 그린 숫자 칸은 커서를 끝으로) A 에 도착한다
  await B.page.keyboard.type('2');
  assert.equal(await count(B.page, 'milk').inputValue(), '12', '원격 변경으로 다시 그린 뒤에도 이어서 친 숫자가 뒤에 붙는다');
  await waitFor(A, () => window.__cafeApp.activeSession().counts.milk === 12, null, 'B 가 이어 입력한 우유 12 도착');
  assert.equal(await B.page.evaluate(() => document.activeElement?.dataset?.id), 'milk');
  await shot(B.page, 'b-focus-kept');
  log('입력 중 포커스 유지 (B 우유 1→12 타이핑 중 A 의 에비앙 3 도착)');

  // 10. 한 기기만 입력할 때: 1 을 치고 그 쓰기가 원격에 닿아 메아리가 돌아온 뒤에 2 를 쳐도 12 — 자기 쓰기의 메아리로는 화면을 다시 그리지 않는다
  //     (다시 그리면 숫자 칸이 새로 만들어져 커서가 앞으로 가 21 이 되고, 입력마다 전체 화면을 다시 그리게 된다)
  await countRenders(B);
  await count(B.page, 'kiwi').focus();
  await B.page.keyboard.type('1');
  const sidB = await sessionId(B);
  await waitForRemote(() => remoteDoc('sessions', sidB), (d) => remoteCount(d, 'kiwi') === '1', '에뮬레이터 세션 문서 counts.kiwi = 1');
  await sleep(500); // 확인 스냅샷(hasPendingWrites=false)까지 돌아올 시간
  assert.equal(await renders(B), 0, '자기 쓰기의 메아리로는 다시 그리지 않는다');
  await B.page.keyboard.type('2');
  assert.equal(await count(B.page, 'kiwi').inputValue(), '12', '메아리 뒤에 이어서 친 숫자가 뒤에 붙는다');
  await waitFor(A, () => window.__cafeApp.activeSession().counts.kiwi === 12, null, 'B 의 키위 12 도착');
  assert.equal(await B.page.evaluate(() => document.activeElement?.dataset?.id), 'kiwi');
  assert.equal(await renders(B), 0);
  await shot(B.page, 'b-own-echo');
  log('한 기기 입력 1 → (원격 확인) → 2 = 12 · 자기 쓰기의 메아리로 다시 그리지 않음');

  collecting = false;
  for (const d of devices) await d.context.close();
} catch (err) {
  collecting = false;
  for (const d of devices) {
    try {
      await d.page.screenshot({ path: path.join(OUT, `fb-fail-${d.name}.png`) });
    } catch {
      /* 이미 닫힘 */
    }
  }
  problems.unshift(`실패: ${err.message}`);
  // 진단: 각 기기의 동기화 상태와 원격에 실제로 남은 문서
  for (const d of devices) {
    try {
      problems.push(`${d.name} syncStatus: ${await d.page.evaluate(() => JSON.stringify(window.__cafeApp.syncStatus))}`);
    } catch {
      /* 닫힘 */
    }
  }
  try {
    problems.push(`emulator sessions: ${JSON.stringify(await remoteIds('sessions'))} orders: ${JSON.stringify(await remoteIds('orders'))}`);
  } catch {
    /* 에뮬레이터 없음 */
  }
} finally {
  await browser.close();
  await sdkFetcher?.dispose();
  server.kill();
}

if (problems.length) {
  console.error('\n실패 · 브라우저 오류:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`\n두 기기 공유 e2e 통과 (${step} 스크린샷). 스크린샷: ${OUT}/fb-*.png`);
