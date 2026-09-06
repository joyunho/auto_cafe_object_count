// 두 기기 실시간 공유 e2e (로컬 백엔드) — 크로미움 컨텍스트 하나에 페이지 두 개(A·B = 기기 두 대).
//   A: window.__SHARED_BACKEND__='local'
//   B: 같은 설정 + window.__STORAGE_KEY__='cafe-inventory-v1-b'
//      → 앱 저장소(localStorage 키)는 따로 쓰고, 공유 저장소 키('cafe-inventory-shared')만 같이 쓴다.
//   실행: npm run e2e:sync   → e2e-out/sync-*.png
//   환경: E2E_PORT(기본 8095)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 8095);
const BASE = `http://localhost:${PORT}/`;
const OUT = path.join(root, 'e2e-out');
const WAIT = 5_000; // 다른 기기의 변경이 도착하기를 기다리는 최대 시간
const SHARED_KEY = 'cafe-inventory-shared';
const B_STORAGE_KEY = 'cafe-inventory-v1-b';
const BASELINE_KEY = 'cafe-inventory-v1.synced'; // A 의 기준선 (앱 저장소 키 + '.synced')
fs.mkdirSync(OUT, { recursive: true });

// ── 정적 서버 ─────────────────────────────────────────────
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
  await page.screenshot({ path: path.join(OUT, `sync-${String(step).padStart(2, '0')}-${name}.png`), fullPage: false });
};
const log = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (dev, id) => dev.page.locator(`input[data-input="count"][data-id="${id}"]`);
/** 조건이 참이 될 때까지 (최대 WAIT) 기다린다 — 실패하면 어느 기기의 무엇이 안 됐는지 남긴다 */
async function waitFor(dev, fn, arg, label) {
  try {
    await dev.page.waitForFunction(fn, arg, { timeout: WAIT, polling: 100 });
  } catch (e) {
    throw new Error(`${dev.name}: ${label} (${WAIT / 1000}s 안에 안 됨): ${e.message.split('\n')[0]}`);
  }
}
const pill = (dev) => dev.page.evaluate(() => document.querySelector('#sync-pill')?.textContent.trim());
const sessionId = (dev) => dev.page.evaluate(() => window.__cafeApp.activeSession().id);
const counts = (dev) => dev.page.evaluate(() => JSON.parse(JSON.stringify(window.__cafeApp.activeSession().counts)));
const drafts = (dev) => dev.page.evaluate(() => window.__cafeApp.state.sessions.filter((s) => s.status === 'draft').map((s) => `${s.book || 'product'}:${s.id}`));
/** 아직 안 보낸 로컬 변경을 지금 보낸다 (디바운스 기다리지 않게) */
const settle = (dev) => dev.page.evaluate(() => window.__cafeApp.sync?.flush());
/** 공유 저장소(localStorage 의 공유 키)에 실제로 들어 있는 내용 — 어느 페이지에서 읽어도 같다 */
const shared = (dev) => dev.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), SHARED_KEY);
const tab = async (dev, id, sel) => {
  await dev.page.locator(`.tabbar [data-tab="${id}"]`).click();
  await dev.page.waitForSelector(sel || `main[data-tab="${id}"]`);
};

// ── 본문 ──────────────────────────────────────────────────
const browser = await launch();
const devices = [];
let context = null;

/** 같은 컨텍스트에 페이지를 하나 더 연다 = 기기 한 대 */
async function device(name, init) {
  const page = await context.newPage();
  await page.addInitScript(init.fn, init.arg);
  page.on('console', (msg) => {
    if (collecting && msg.type() === 'error') problems.push(`${name} console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    if (collecting) problems.push(`${name} pageerror: ${err.message}`);
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('.tabbar');
  const dev = { name, page };
  devices.push(dev);
  await waitFor(dev, () => document.querySelector('#sync-pill')?.textContent.trim() === '공유 중', null, '#sync-pill 공유 중');
  assert.equal(await dev.page.evaluate(() => window.__cafeApp.syncStatus.backend), 'local');
  return dev;
}

try {
  await waitForServer();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });

  // 1. 기기 A: 공유 연결 → 원격(공유 키)이 비어 있으므로 로컬(품목·분류·설정·초안)이 올라간다
  const A = await device('A', {
    fn: () => {
      window.__SHARED_BACKEND__ = 'local';
    },
  });
  await settle(A);
  const stA = await A.page.evaluate(() => JSON.parse(JSON.stringify(window.__cafeApp.state)));
  const remote0 = await shared(A);
  assert.equal(Object.keys(remote0.items || {}).length, stA.items.length, '공유 저장소에 품목 문서가 전부 올라감');
  assert.equal(Object.keys(remote0.groups || {}).length, stA.groups.length, '분류 문서');
  assert.ok(remote0.meta?.settings && !('apiKey' in remote0.meta.settings) && !('shareConfig' in remote0.meta.settings), '설정 문서에 API 키·공유 설정은 없음');
  assert.equal(Object.keys(remote0.sessions || {}).length, 1, 'A 의 초안 하나');
  assert.equal(await A.page.evaluate((k) => localStorage.getItem(k), B_STORAGE_KEY), null, 'B 의 앱 저장소는 아직 없음');
  await shot(A.page, 'a-shared');
  log(`A 공유 중 (local) — 공유 저장소에 품목 ${stA.items.length}개·분류 ${stA.groups.length}개·설정·초안 확인`);

  // 2. 기기 B: 다른 앱 저장소 키로 같은 공유 저장소에 합류 → 둘 다 "공유 중"
  const B = await device('B', {
    fn: (key) => {
      window.__SHARED_BACKEND__ = 'local';
      window.__STORAGE_KEY__ = key;
    },
    arg: B_STORAGE_KEY,
  });
  assert.equal(await pill(A), '공유 중');
  assert.equal(await pill(B), '공유 중');
  assert.ok(await B.page.evaluate((k) => !!localStorage.getItem(k), B_STORAGE_KEY), 'B 는 자기 앱 저장소 키를 쓴다');
  await shot(B.page, 'b-joined');
  log('A·B 모두 #sync-pill 공유 중 (B 는 별도 앱 저장소 키)');

  // 3. A 가 유자청 2 → B 에 새로고침 없이 보이고, 두 기기의 활성 세션이 같다
  await count(A, 'yuja-cheong').fill('2');
  await waitFor(B, () => document.querySelector('input[data-input="count"][data-id="yuja-cheong"]')?.value === '2', null, '유자청 2 표시');
  const sidA = await sessionId(A);
  assert.equal(await sessionId(B), sidA, '두 기기의 활성 세션 id 가 같음');
  assert.equal((await shared(B)).sessions?.[sidA]?.counts?.['yuja-cheong'], 2, '공유 저장소 세션 문서의 counts.yuja-cheong = 2');
  await shot(B.page, 'b-remote-count');
  log(`A → B 유자청 2 · 같은 세션 ${sidA}`);

  // 4. B 가 아이스크림 1 → A 에 반영, A 의 유자청은 그대로 2
  await count(B, 'ice-cream').fill('1');
  await waitFor(A, () => document.querySelector('input[data-input="count"][data-id="ice-cream"]')?.value === '1', null, '아이스크림 1 표시');
  assert.equal(await count(A, 'yuja-cheong').inputValue(), '2');
  assert.deepEqual(await counts(A), { 'yuja-cheong': 2, 'ice-cream': 1 });
  assert.deepEqual(await counts(B), { 'yuja-cheong': 2, 'ice-cream': 1 });
  await shot(A.page, 'a-remote-count');
  log('B → A 아이스크림 1, A 의 유자청 2 유지');

  // 5. A 가 품목 탭에서 이름 변경 → B 의 재고조사 줄 이름이 바뀐다
  await tab(A, 'items');
  await A.page.locator('.item-row[data-id="sparkling-water"]').click();
  await A.page.waitForSelector('#item-form');
  await A.page.locator('#item-form input[name="name"]').fill('탄산수(공유)');
  await A.page.locator('#item-form button[type="submit"]').click();
  await A.page.waitForSelector('#item-form', { state: 'detached' });
  await waitFor(B, () => window.__cafeApp.state.items.find((i) => i.id === 'sparkling-water')?.name === '탄산수(공유)', null, '품목 이름 변경 도착');
  assert.equal((await B.page.locator('.item-row[data-row="sparkling-water"] .name').textContent()).trim(), '탄산수(공유)');
  assert.equal((await shared(B)).items?.['sparkling-water']?.name, '탄산수(공유)', '공유 저장소 품목 문서');
  await shot(B.page, 'b-renamed');
  log('품목 이름 변경 A → B');

  // 6. A 가 발주 확정 → B 의 기록 탭에 보임 → 둘 다 재고조사 탭으로 돌아오면 초안은 장부당 하나만 남고, 그 사이 입력한 수량은 잃지 않는다
  await tab(B, 'history');
  await tab(A, 'order', '#order-text');
  await A.page.locator('[data-action="order-submit"]').click(); // confirm() 은 dialog 핸들러가 수락
  await A.page.waitForSelector('main[data-tab="history"]');
  assert.match(await A.page.locator('main').textContent(), /발주가 기록되었습니다/);
  await waitFor(B, (sid) => window.__cafeApp.state.orders.length === 1 && window.__cafeApp.state.sessions.some((s) => s.id === sid && s.status === 'submitted'), sidA, '확정 기록 도착');
  await tab(B, 'history'); // 이미 기록 탭이지만 다시 그려진 화면을 확실히
  assert.match(await B.page.locator('main').textContent(), /발주 \d+품목/, 'B 기록 탭에 발주 기록');
  await shot(B.page, 'b-history');
  // B 가 먼저 재고조사 탭으로 돌아와 빈 초안을 만들지만, B 의 공유 저장소 쓰기는 잠시 붙잡아 둔다(전송 중 상태) →
  // A 는 B 의 초안을 모른 채 돌아와 자기 초안(더 늦게 만들어져 정리 대상)을 만들고 곧바로 자몽시럽 5 를 입력한다.
  // 그 뒤 B 의 쓰기를 풀어 주면 초안은 B 의 것 하나만 남고, A 의 입력은 거기로 옮겨져야 한다 (양쪽 모두, 공유 저장소에도)
  await B.page.evaluate(() => {
    window.__heldWrites = [];
    window.__SHARED_WRITE_GATE__ = (op, coll, id) => new Promise((open) => window.__heldWrites.push({ op, coll, id, open }));
  });
  await tab(B, 'count', '#progress-text');
  const draftB0 = await sessionId(B);
  await tab(A, 'count', '#progress-text');
  const draftA0 = await sessionId(A);
  assert.notEqual(draftA0, draftB0, 'B 의 초안이 붙잡혀 있는 동안 A 는 자기 초안을 만든다');
  await count(A, 'grapefruit').fill('5');
  await settle(A);
  assert.equal((await shared(A)).sessions?.[draftA0]?.counts?.grapefruit, 5, 'A 의 입력이 정리될 초안에 실려 공유 저장소에 오른다');
  assert.deepEqual(await drafts(B), [`product:${draftB0}`], 'B 는 A 의 초안을 받아 자기 초안에 합치고 버린다');
  assert.equal((await counts(B)).grapefruit, 5, 'B 의 초안에 A 의 자몽시럽 5');
  const held = await B.page.evaluate(() => {
    window.__SHARED_WRITE_GATE__ = null;
    const h = window.__heldWrites.splice(0);
    for (const w of h) w.open();
    return h.map((w) => `${w.op} ${w.coll}/${w.id}`);
  });
  assert.deepEqual(held, [`set sessions/${draftB0}`], '붙잡혀 있던 B 의 쓰기 = 자기 초안 올리기');
  // 이제 두 기기 모두 B 의 초안 하나만 남기고, 입력은 거기로 옮겨진다 (양쪽 모두, 같은 id 로)
  let dA = [];
  let dB = [];
  let cA = {};
  let cB = {};
  for (let i = 0; i < WAIT / 250; i++) {
    [dA, dB, cA, cB] = await Promise.all([drafts(A), drafts(B), counts(A), counts(B)]);
    if (dA.length === 1 && dB.length === 1 && dA[0] === dB[0] && cA.grapefruit === 5 && cB.grapefruit === 5) break;
    await sleep(250);
  }
  assert.deepEqual(dA, dB, '두 기기에 남은 초안이 같은 문서');
  assert.deepEqual(dA, [`product:${draftB0}`], '먼저 만든 B 의 초안이 남는다');
  const perBook = {};
  for (const d of dA) perBook[d.split(':')[0]] = (perBook[d.split(':')[0]] || 0) + 1;
  assert.ok(Object.values(perBook).every((n) => n === 1) && dA.length === 1, `초안은 장부당 하나 (${dA.join(', ')})`);
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().status), 'draft');
  assert.equal(await sessionId(A), await sessionId(B), '두 기기의 활성 세션이 같은 초안');
  assert.deepEqual(cA, { grapefruit: 5 }, 'A 가 입력한 자몽시럽 5 는 남은 초안에 있다 (A)');
  assert.deepEqual(cB, { grapefruit: 5 }, 'A 가 입력한 자몽시럽 5 는 남은 초안에 있다 (B)');
  assert.equal(await count(A, 'grapefruit').inputValue(), '5');
  assert.equal(await count(B, 'grapefruit').inputValue(), '5');
  assert.equal(await count(A, 'yuja-cheong').inputValue(), '', '새 초안은 확정한 세션의 수량을 이어받지 않는다');
  assert.equal(await count(B, 'yuja-cheong').inputValue(), '');
  await Promise.all([settle(A), settle(B)]);
  // 공유 저장소에도 세션은 확정 1 + 초안 1 만 남고, 그 초안에 자몽시럽 5 가 들어 있어야 한다 (중복 초안은 flush 때 지워짐)
  const draftId = dA[0].split(':')[1];
  let remoteSessions = {};
  for (let i = 0; i < WAIT / 250; i++) {
    remoteSessions = (await shared(A)).sessions || {};
    if (Object.keys(remoteSessions).length === 2 && remoteSessions[draftId]?.counts?.grapefruit === 5) break;
    await sleep(250);
  }
  assert.deepEqual(Object.keys(remoteSessions).sort(), [sidA, draftId].sort(), '공유 저장소 sessions = 확정 1 + 초안 1');
  assert.deepEqual(remoteSessions[draftId].counts, { grapefruit: 5 }, '공유 저장소의 초안에 A 의 입력이 있다');
  assert.equal(Object.keys((await shared(A)).orders || {}).length, 1);
  await shot(A.page, 'a-new-draft');
  log(`발주 확정 A → B 기록 반영 · 초안 중복 제거 (남은 초안 ${dA[0]}) · A 가 정리될 자기 초안(${draftA0})에 입력한 자몽시럽 5 는 양쪽과 공유 저장소에 유지`);

  // 7. B 가 청귤청 칸을 누르고 있을 때 A 의 딸기청 변경이 도착해도 B 의 포커스는 그대로
  await count(B, 'cheonggyul-cheong').focus();
  assert.equal(await B.page.evaluate(() => document.activeElement?.dataset?.id), 'cheonggyul-cheong');
  await count(A, 'strawberry-cheong').fill('3');
  await waitFor(B, () => document.querySelector('input[data-input="count"][data-id="strawberry-cheong"]')?.value === '3', null, 'A 의 딸기청 3 도착');
  const focus = await B.page.evaluate(() => ({ id: document.activeElement?.dataset?.id, input: document.activeElement?.dataset?.input }));
  assert.deepEqual(focus, { id: 'cheonggyul-cheong', input: 'count' }, '원격 변경 뒤에도 B 의 포커스 유지');
  assert.ok(await B.page.locator('.item-row[data-row="cheonggyul-cheong"]').evaluate((el) => el.classList.contains('active')), '누르고 있던 줄 표시 유지');
  // 이어서 입력해도 같은 칸에 들어가고 A 에 도착한다
  await B.page.keyboard.type('4');
  assert.equal(await count(B, 'cheonggyul-cheong').inputValue(), '4');
  await waitFor(A, () => window.__cafeApp.activeSession().counts['cheonggyul-cheong'] === 4, null, 'B 가 이어 입력한 청귤청 4 도착');
  assert.equal(await B.page.evaluate(() => document.activeElement?.dataset?.id), 'cheonggyul-cheong');
  await shot(B.page, 'b-focus-kept');
  log('입력 중 포커스 유지 (B 청귤청 포커스 중 A 의 딸기청 3 도착) · 이어 입력 B → A');

  // 8. 사장님 폰에서 센 수량이 아직 안 나간 채로 앱이 다시 뜨는 경우 (실제로 신고된 증상)
  //    A 의 공유 저장소 쓰기를 붙잡아 둔 채 레몬 6 을 센 뒤 페이지를 새로 연다 = 홈 화면 앱 재실행.
  //    다시 뜬 A 는 저장해 둔 기준선으로 "아직 안 보낸 내 입력"을 알아보고, 원격 문서에 덮이지 않게 지킨 뒤 올려야 한다.
  await Promise.all([settle(A), settle(B)]);
  const draftNow = await sessionId(A);
  assert.ok(await A.page.evaluate((k) => !!localStorage.getItem(k), BASELINE_KEY), 'A 가 기준선을 저장해 두었다');
  await A.page.evaluate(() => {
    window.__SHARED_WRITE_GATE__ = () => new Promise(() => {}); // 이 페이지가 사는 동안 쓰기는 영영 끝나지 않는다
  });
  await count(A, 'lemon-juice').fill('6');
  await sleep(600); // 디바운스(0.2초)가 지나 flush 가 붙잡힌 쓰기에 걸릴 만큼
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().counts['lemon-juice']), 6, 'A 의 화면·로컬에는 레몬 6');
  assert.equal((await shared(A)).sessions?.[draftNow]?.counts?.['lemon-juice'], undefined, '아직 공유 저장소에는 안 갔다');
  await shot(A.page, 'a-unsent-count');

  await A.page.reload();
  await A.page.waitForSelector('.tabbar');
  await waitFor(A, () => document.querySelector('#sync-pill')?.textContent.trim() === '공유 중', null, '다시 연 뒤 공유 중');
  await settle(A);
  assert.equal(await count(A, 'lemon-juice').inputValue(), '6', '다시 열어도 방금 센 레몬 6 이 화면에 남아 있다');
  assert.equal(await A.page.evaluate(() => window.__cafeApp.activeSession().counts['lemon-juice']), 6);
  await waitFor(B, () => window.__cafeApp.activeSession().counts['lemon-juice'] === 6, null, '다른 기기 B 에 레몬 6 도착');
  assert.equal((await shared(B)).sessions?.[draftNow]?.counts?.['lemon-juice'], 6, '공유 저장소에도 올라갔다');
  assert.equal(await sessionId(A), draftNow, '초안은 그대로 하나');
  assert.equal(await count(A, 'cheonggyul-cheong').inputValue(), '4', '다른 기기가 센 값도 그대로');
  await shot(B.page, 'b-recovered-count');
  log('보내기 전에 앱이 다시 떠도 센 수량이 살아남아 다른 기기까지 간다 (기준선 저장)');

  collecting = false;
  await context.close();
} catch (err) {
  collecting = false;
  for (const d of devices) {
    try {
      await d.page.screenshot({ path: path.join(OUT, `sync-fail-${d.name}.png`) });
    } catch {
      /* 이미 닫힘 */
    }
  }
  problems.unshift(`실패: ${err.message}`);
  for (const d of devices) {
    try {
      problems.push(`${d.name} syncStatus: ${await d.page.evaluate(() => JSON.stringify(window.__cafeApp.syncStatus))}`);
      problems.push(`${d.name} drafts: ${JSON.stringify(await drafts(d))}`);
    } catch {
      /* 닫힘 */
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (problems.length) {
  console.error('\n실패 · 브라우저 오류:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`\n두 기기 공유 e2e(로컬 백엔드) 통과 (${step} 스크린샷). 스크린샷: ${OUT}/sync-*.png`);
