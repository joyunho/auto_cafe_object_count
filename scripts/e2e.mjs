// 브라우저 스모크 테스트: 실제 크로미움에서 앱 전체 흐름을 돌려 보고 스크린샷을 남긴다.
//   npm run e2e   → e2e-out/*.png
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 8091);
const BASE = `http://localhost:${PORT}/`;
const OUT = path.join(root, 'e2e-out');
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

const problems = [];
let step = 0;
const shot = async (page, name) => {
  step++;
  await page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`), fullPage: false });
};
const log = (m) => console.log(`✓ ${m}`);

const browser = await launch();
try {
  await waitForServer();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('dialog', (d) => d.accept());

  const count = (id) => page.locator(`input[data-input="count"][data-id="${id}"]`);
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__cafeApp.state)));

  // 1. 첫 화면
  await page.goto(BASE);
  await page.waitForSelector('.tabbar');
  assert.match(await page.locator('.topbar h1').textContent(), /재고관리/);
  const st0 = await state();
  const activeCount = st0.items.filter((it) => it.active !== false).length;
  assert.equal(await page.locator('.item-row').count(), activeCount, '활성 품목 수만큼 행이 있어야 함');
  assert.equal(await page.locator('.tabbar button.active').textContent().then((t) => t.trim()), '📋재고조사');
  await shot(page, 'count-empty');
  log(`첫 화면: 품목 ${activeCount}개 표시`);

  // 2. 수량 입력 (타이핑, +/-, 빠른 버튼)
  await count('sparkling-water').fill('3');
  await page.locator('[data-action="count-inc"][data-id="ice-cream"]').click();
  await page.locator('[data-action="count-inc"][data-id="ice-cream"]').click();
  await page.locator('[data-action="count-set"][data-id="ice-tea"][data-val="0"]').click();
  await page.locator('[data-action="count-set"][data-id="cafe-syrup"][data-val="8"]').click();
  await page.locator('[data-action="count-dec"][data-id="yuja-cheong"]').click(); // 미입력 → 0
  await page.locator('[data-action="count-inc"][data-id="yuja-cheong"]').click();
  await page.locator('[data-action="count-inc"][data-id="yuja-cheong"]').click(); // 2
  assert.equal(await count('ice-cream').inputValue(), '2');
  assert.equal(await count('yuja-cheong').inputValue(), '2');
  assert.equal(await count('cafe-syrup').inputValue(), '8');
  assert.match(await page.locator('#progress-text').textContent(), new RegExp(`^5/${activeCount} `));
  await shot(page, 'count-filled');
  log('수량 입력 및 진행률 갱신');

  // 3. 새로고침 후에도 유지
  await page.reload();
  await page.waitForSelector('.tabbar');
  assert.equal(await count('sparkling-water').inputValue(), '3');
  assert.equal(await count('ice-tea').inputValue(), '0');
  log('새로고침 후 입력값 유지 (localStorage)');

  // 4. 발주 탭: 자동 계산
  await page.locator('.tabbar [data-tab="order"]').click();
  await page.waitForSelector('#order-text');
  const orderText = await page.locator('#order-text').textContent();
  assert.match(orderText, /- 탄산수 5개/, '탄산수 기준8-현재3=5');
  assert.match(orderText, /- 아이스크림 1개/, '아이스크림 기준3-현재2=1');
  assert.match(orderText, /- 아이스티\(1box>6\) 1박스/, '아이스티 0개 → 1박스');
  assert.match(orderText, /- 유자청 1박스/, '유자청 2개(<3) → 1박스');
  assert.doesNotMatch(orderText, /카페시럽/, '카페시럽은 기준과 같아 발주 없음');
  assert.match(orderText, /총 4개 품목/);
  assert.equal(await page.locator('.tabbar [data-tab="order"] .badge').textContent(), '4');
  await shot(page, 'order');
  log('발주 수량 자동 계산 (낱개/박스/재발주점 규칙)');

  // 5. 수량 직접 수정 → 되돌리기
  const qtyInput = page.locator('input[data-change="order-qty"][data-id="sparkling-water"]');
  await qtyInput.fill('6');
  await qtyInput.dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#order-text')?.textContent.includes('탄산수 6개'));
  assert.ok(await page.locator('.order-line.overridden').count() === 1);
  await page.locator('[data-action="order-reset"][data-id="sparkling-water"]').click();
  await page.waitForFunction(() => document.querySelector('#order-text')?.textContent.includes('탄산수 5개'));
  log('발주 수량 수동 수정과 되돌리기');

  // 6. 복사
  await page.locator('[data-action="order-copy"]').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /씨앤비 발주/);
  log('발주 문자 클립보드 복사');

  // 7. 발주 확정 → 기록
  await page.locator('[data-action="order-submit"]').click();
  await page.waitForSelector('main[data-tab="history"]');
  assert.match(await page.locator('main').textContent(), /발주가 기록되었습니다/);
  assert.match(await page.locator('main').textContent(), /발주 4품목/);
  await page.locator('details summary').first().click();
  await shot(page, 'history');
  const st1 = await state();
  assert.equal(st1.orders.length, 1);
  assert.equal(st1.sessions.filter((s) => s.status === 'submitted').length, 1);
  log('발주 확정 → 기록 저장');

  // 8. 새 재고조사는 비어 있어야 함
  await page.locator('.tabbar [data-tab="count"]').click();
  await page.waitForSelector('#progress-text');
  assert.equal(await count('sparkling-water').inputValue(), '');
  assert.match(await page.locator('#progress-text').textContent(), new RegExp(`^0/${activeCount} `));
  log('확정 후 새 재고조사 시작');

  // 9. 기록에서 지난 수량 재사용
  await page.locator('.tabbar [data-tab="history"]').click();
  await page.locator('details summary').first().click(); // 접힌 기록 펼치기
  await page.locator('[data-action="history-reuse"]').first().click();
  await page.waitForSelector('main[data-tab="count"]');
  assert.equal(await count('sparkling-water').inputValue(), '3');
  log('지난 수량으로 새 조사 시작');

  // 10. 품목 편집
  await page.locator('.tabbar [data-tab="items"]').click();
  await page.locator('.item-row[data-id="sparkling-water"]').click();
  await page.waitForSelector('#item-form');
  await shot(page, 'item-edit');
  await page.locator('#item-form input[name="par"]').fill('10');
  await page.locator('#item-form button[type="submit"]').click();
  await page.waitForSelector('#item-form', { state: 'detached' });
  assert.match(await page.locator('.item-row[data-id="sparkling-water"] .meta').textContent(), /기준 10개/);
  await shot(page, 'items');
  // 새 품목 추가
  await page.locator('[data-action="item-new"]').click();
  await page.locator('#item-form input[name="name"]').fill('테스트 우유');
  await page.locator('#item-form input[name="par"]').fill('4');
  await page.locator('#item-form button[type="submit"]').click();
  await page.waitForSelector('#item-form', { state: 'detached' });
  assert.ok((await state()).items.some((it) => it.name === '테스트 우유' && it.par === 4));
  log('품목 기준 수량 편집 · 품목 추가');

  // 11. 설정: 매장 이름 → 헤더 반영
  await page.locator('.tabbar [data-tab="settings"]').click();
  const storeInput = page.locator('input[data-key="storeName"]');
  await storeInput.fill('테스트점');
  await storeInput.dispatchEvent('change');
  await page.locator('.tabbar [data-tab="count"]').click();
  assert.match(await page.locator('.topbar h1').textContent(), /테스트점 재고관리/);
  log('설정 저장 · 헤더 반영');

  // 12. 사진 모달 (API 키 없음 안내)
  await page.locator('[data-action="photo-open"]').click();
  await page.waitForSelector('.modal');
  assert.match(await page.locator('.modal').textContent(), /API 키를 먼저 입력/);
  assert.ok(await page.locator('[data-action="photo-run"]').isDisabled());
  await shot(page, 'photo-modal');
  await page.locator('.modal [data-action="modal-close"]').click();
  await page.waitForSelector('.modal', { state: 'detached' });
  log('사진 자동 입력 모달');

  // 13. 백업 내보내기 → 불러오기
  await page.locator('.tabbar [data-tab="settings"]').click();
  await shot(page, 'settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="backup-export"]').click()]);
  assert.match(download.suggestedFilename(), /^cafe-inventory-\d{8}\.json$/);
  const backupPath = path.join(OUT, 'backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.orders.length, 1);
  assert.equal(backup.settings.storeName, '테스트점');
  // 초기화 후 복원
  await page.locator('[data-action="data-wipe"]').click();
  await page.waitForFunction(() => window.__cafeApp.state.orders.length === 0);
  await page.locator('input[data-change="backup-import"]').setInputFiles(backupPath);
  await page.waitForFunction(() => window.__cafeApp.state.orders.length === 1);
  assert.equal((await state()).settings.storeName, '테스트점');
  log('백업 내보내기 · 초기화 · 불러오기');

  // 14. 다크 모드 · 데스크톱
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.tabbar [data-tab="count"]').click();
  await shot(page, 'count-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.locator('.tabbar [data-tab="order"]').click();
  await shot(page, 'order-desktop');

  // 15. 오프라인 캐시(서비스 워커) 등록 확인
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? 'registered' : 'none';
  });
  log(`서비스 워커: ${swReady}`);

  await context.close();

  // 16. 단일 파일 빌드도 같은 화면을 띄우는지 (dist/cafe-inventory.html)
  const single = path.join(root, 'dist', 'cafe-inventory.html');
  if (fs.existsSync(single)) {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const p2 = await ctx2.newPage();
    p2.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`single-file console.error: ${msg.text()}`);
    });
    p2.on('pageerror', (err) => problems.push(`single-file pageerror: ${err.message}`));
    await p2.goto(`${BASE}dist/cafe-inventory.html`);
    await p2.waitForSelector('.tabbar');
    assert.equal(await p2.locator('.item-row').count(), activeCount);
    await p2.locator('input[data-input="count"][data-id="sparkling-water"]').fill('2');
    await p2.locator('.tabbar [data-tab="order"]').click();
    assert.match(await p2.locator('#order-text').textContent(), /- 탄산수 6개/);
    await shot(p2, 'single-file-order');
    await ctx2.close();
    log('단일 파일 빌드 동작');
  } else {
    log('단일 파일 빌드 없음 (npm run build 후 검사됨)');
  }
} finally {
  await browser.close();
  server.kill();
}

if (problems.length) {
  console.error('\n브라우저 오류:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`\n모든 스모크 테스트 통과. 스크린샷: ${OUT}/`);
