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
  // 빠른 버튼(0/예상/기준/지움)은 숫자 칸을 누른 줄에만 보이므로 먼저 그 줄에 포커스를 준다
  const quick = async (id, val) => {
    await count(id).focus();
    await page.locator(`[data-action="count-set"][data-id="${id}"][data-val="${val}"]`).click();
  };
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__cafeApp.state)));

  // 1. 첫 화면
  await page.goto(BASE);
  await page.waitForSelector('.tabbar');
  assert.match(await page.locator('.topbar h1').textContent(), /재고관리/);
  const st0 = await state();
  const activeCount = st0.items.filter((it) => it.active !== false && (it.book || 'product') === 'product').length;
  assert.equal(await page.locator('.seg button.on').textContent().then((t) => t.trim().replace(/\s+/g, ' ')), '제품 월·목', '장부 전환 기본값은 제품');
  assert.equal(await page.locator('.item-row').count(), activeCount, '활성 품목 수만큼 행이 있어야 함');
  assert.equal(await page.locator('.tabbar button.active').textContent().then((t) => t.trim()), '📋재고조사');
  await shot(page, 'count-empty');
  log(`첫 화면: 품목 ${activeCount}개 표시`);

  // 2. 수량 입력 (타이핑, +/-, 빠른 버튼)
  await count('sparkling-water').fill('3');
  await page.locator('[data-action="count-inc"][data-id="ice-cream"]').click();
  await page.locator('[data-action="count-inc"][data-id="ice-cream"]').click();
  await quick('ice-tea', '0');
  await quick('cafe-syrup', '8');
  await page.locator('[data-action="count-dec"][data-id="yuja-cheong"]').click(); // 미입력 → 0
  await page.locator('[data-action="count-inc"][data-id="yuja-cheong"]').click();
  await page.locator('[data-action="count-inc"][data-id="yuja-cheong"]').click(); // 2
  assert.equal(await count('ice-cream').inputValue(), '2');
  assert.equal(await count('yuja-cheong').inputValue(), '2');
  assert.equal(await count('cafe-syrup').inputValue(), '8');
  assert.match(await page.locator('#progress-text').textContent(), new RegExp(`^5/${activeCount} `));
  // 세는 즉시 줄에 발주 수량이, 위에는 발주 예정 개수가, 그룹 칩에는 진행이 보인다
  assert.match(await page.locator('.item-row[data-row="sparkling-water"] .order-pill').textContent(), /발주 5개/);
  assert.match(await page.locator('.item-row[data-row="cafe-syrup"] .order-pill').textContent(), /충분/);
  assert.match(await page.locator('#pending-pill').textContent(), /발주 예정 4/);
  assert.match(await page.locator('.chip[data-id="cheong"]').textContent(), /2\/5/);
  assert.ok((await page.locator('.chips .chip').count()) >= 5, '그룹 칩');
  // 촘촘히(기본)에서는 부가 정보가 숨고, 넓게 보기로 바꾸면 보인다
  assert.ok(await page.locator('#count-list').evaluate((el) => el.classList.contains('dense')), '기본은 촘촘히');
  assert.ok(!(await page.locator('.item-row[data-row="cheonggyul-cheong"] .meta').isVisible()), '촘촘히에서는 메타 숨김');
  await page.locator('[data-action="count-dense-toggle"]').click();
  await page.waitForFunction(() => window.__cafeApp.state.ui.countDense === false);
  assert.ok(await page.locator('.item-row[data-row="cheonggyul-cheong"] .meta').isVisible(), '넓게 보기에서는 메타 표시');
  await shot(page, 'count-wide');
  await page.locator('[data-action="count-dense-toggle"]').click();
  await page.waitForFunction(() => window.__cafeApp.state.ui.countDense !== false);
  await shot(page, 'count-filled');
  log('수량 입력 · 진행률 · 줄별 발주 표시 · 그룹 칩 · 촘촘히/넓게');

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
  assert.match(await page.locator('main').textContent(), /기준 없음 \d+/, '기준 없는 품목 안내');
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

  // 5b. 박스 단위로 세는 품목(배도라지차 2BOX): 1박스 남음 → 1박스 발주
  await page.locator('.tabbar [data-tab="count"]').click();
  await count('pear-bellflower-tea').fill('1');
  // 재고조사에서 수량을 고치면 직접 수정한 발주 수량(탄산수 6)은 무효
  await count('sparkling-water').fill('4');
  await page.locator('.tabbar [data-tab="order"]').click();
  await page.waitForSelector('#order-text');
  const orderText2 = await page.locator('#order-text').textContent();
  assert.match(orderText2, /- 배도라지차 1박스/, '배도라지차 기준 2박스 − 현재 1박스');
  assert.match(orderText2, /- 탄산수 4개/, '재입력 후 자동 계산(8−4)으로 복귀');
  assert.equal(await page.locator('.order-line.overridden').count(), 0);
  log('박스 단위 품목 계산 · 재입력 시 수동 수정 해제');

  // 5c. 자재 장부: 전환 → 따로 세고 따로 발주 (수요일)
  await page.locator('.tabbar [data-tab="count"]').click();
  await page.locator('[data-action="book-switch"][data-book="supply"]').click();
  await page.waitForFunction(() => window.__cafeApp.state.ui.book === 'supply');
  assert.match(await page.locator('.topbar .sub').textContent(), /자재/, '헤더에 장부 표시');
  const supplyRows = await page.locator('.item-row').count();
  assert.ok(supplyRows >= 30 && supplyRows < activeCount, `자재 품목만 표시 (${supplyRows})`);
  assert.match(await page.locator('.item-row[data-row="trash-100l"] .name').textContent(), /기준.*2묶음/, '묶음 단위 기준 표시');
  // 빠른 버튼은 숫자 칸을 누른 줄에만
  assert.ok(!(await page.locator('.item-row[data-row="trash-100l"] .quick').isVisible()), '기본은 빠른 버튼 숨김');
  await count('trash-100l').focus();
  assert.ok(await page.locator('.item-row[data-row="trash-100l"] .quick').isVisible(), '포커스한 줄은 빠른 버튼 표시');
  await count('trash-100l').fill('1');
  await count('knock-box-bag').fill('1');
  await page.waitForFunction(() => window.__cafeApp.activeSession().counts['trash-100l'] === 1);
  assert.equal(await page.evaluate(() => window.__cafeApp.activeSession().book), 'supply');
  await page.locator('.tabbar [data-tab="order"]').click();
  await page.waitForSelector('#order-text');
  const supplyOrder = await page.locator('#order-text').textContent();
  assert.match(supplyOrder, /씨앤비 발주 \(자재\)/, '자재 발주 제목');
  assert.match(supplyOrder, /- 100L 쓰레기봉투\(일쓰\) 1묶음/, '묶음 단위 발주');
  assert.match(supplyOrder, /- 넉박스 봉투 1묶음/, '기준 1.5묶음 − 1 = 0.5 → 1묶음');
  assert.ok(!/유자청|탄산수/.test(supplyOrder), '자재 발주서에 제품이 섞이지 않음');
  // 제품 장부로 돌아오면 입력값이 그대로
  await page.locator('[data-action="book-switch"][data-book="product"]').click();
  await page.waitForFunction(() => window.__cafeApp.state.ui.book === 'product');
  await page.waitForSelector('#order-text');
  assert.match(await page.locator('#order-text').textContent(), /- 배도라지차 1박스/, '제품 초안 유지');
  log('자재 장부 전환 · 묶음 단위 · 장부별 발주서');

  // 6. 복사
  await page.locator('[data-action="order-copy"]').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /씨앤비 발주/);
  log('발주 문자 클립보드 복사');

  // 7. 발주 확정 → 기록
  await page.locator('[data-action="order-submit"]').click();
  await page.waitForSelector('main[data-tab="history"]');
  assert.match(await page.locator('main').textContent(), /발주가 기록되었습니다/);
  assert.match(await page.locator('main').textContent(), /발주 5품목/);
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
  assert.equal(await count('sparkling-water').inputValue(), '4');
  assert.equal(await count('pear-bellflower-tea').inputValue(), '1');
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
  await page.locator('[data-action="item-new"][data-book="product"]').click();
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
  assert.ok(!('apiKey' in backup.settings), '백업에 API 키가 없어야 함');
  // 초기화 후 복원
  await page.locator('[data-action="data-wipe"]').click();
  await page.waitForFunction(() => window.__cafeApp.state.orders.length === 0);
  // 백업이 아닌 파일은 거부
  const junkPath = path.join(OUT, 'junk.json');
  fs.writeFileSync(junkPath, '{"foo":"bar"}');
  await page.locator('input[data-change="backup-import"]').setInputFiles(junkPath);
  // 초기화 토스트("초기화했습니다")가 아직 떠 있을 수 있으므로 거부 메시지가 나올 때까지 기다린다
  await page.locator('.toast', { hasText: '백업 파일이 아니거나' }).waitFor({ timeout: 5000 });
  assert.equal((await state()).orders.length, 0);
  await page.locator('input[data-change="backup-import"]').setInputFiles(backupPath);
  await page.waitForFunction(() => window.__cafeApp.state.orders.length === 1);
  assert.equal((await state()).settings.storeName, '테스트점');
  assert.ok(await page.locator('[data-action="backup-undo"]').count() === 1, '되돌리기 버튼 표시');
  log('백업 내보내기 · 초기화 · 잘못된 파일 거부 · 불러오기');

  // 13b. 소비 모델 불러오기 → 예상 재고와 확인 필요 표시
  const modelPath = path.join(OUT, 'model.json');
  fs.writeFileSync(modelPath, JSON.stringify({ version: 1, source: 'e2e 모델', months: ['2026-01'], items: { 'sparkling-water': { perDay: { '2026-01': 1 }, avgPerDay: 1 }, 'yuja-cheong': { perDay: {}, avgPerDay: 0.01 } } }));
  await page.locator('input[data-change="model-import"]').setInputFiles(modelPath);
  await page.waitForFunction(() => !!window.__cafeApp.state.consumption);
  assert.match(await page.locator('main').textContent(), /사용 중/);
  await page.locator('.tabbar [data-tab="count"]').click();
  await page.waitForSelector('#progress-text');
  // 백업 복원으로 오늘 확정한 기록(탄산수 4개)과 그 발주(4개 입고)가 있으므로 예상값 = 4 + 4 = 8
  assert.match(await page.locator('.item-row[data-row="sparkling-water"] .meta').textContent(), /예상 8개/);
  assert.ok((await page.locator('[data-action="count-set"][data-id="sparkling-water"][data-val]').count()) >= 3, '예상(N) 버튼');
  // 지난 수량으로 시작한 초안이라 이미 값이 있음 → 지운 뒤 "예상값 채우기"
  await quick('sparkling-water', '');
  await page.waitForFunction(() => window.__cafeApp.activeSession().counts['sparkling-water'] == null);
  await page.locator('[data-action="count-fill-forecast"]').click();
  await page.locator('.toast', { hasText: '예상값으로 채웠습니다' }).waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__cafeApp.activeSession().counts['sparkling-water']), 8);
  assert.equal(await page.evaluate(() => window.__cafeApp.activeSession().filled['sparkling-water']), true, '채운 값은 실측 아님으로 표시');
  // 직접 고치면 실측으로 바뀐다
  await quick('sparkling-water', '0');
  await page.waitForFunction(() => window.__cafeApp.activeSession().counts['sparkling-water'] === 0);
  assert.equal(await page.evaluate(() => !!window.__cafeApp.activeSession().filled['sparkling-water']), false);
  assert.match(await page.locator('.item-row[data-row="yuja-cheong"] .name').textContent(), /예상 OK|확인 필요/);
  // 모델을 지우면 "확인 필요만 보기"가 켜져 있어도 품목이 사라지지 않는다
  await page.locator('input[data-change="count-only-check"]').check();
  await page.locator('.tabbar [data-tab="settings"]').click();
  await page.locator('[data-action="model-clear"]').click(); // confirm은 위의 전역 dialog 핸들러가 수락
  await page.waitForFunction(() => window.__cafeApp.state.consumption === false);
  await page.reload();
  await page.waitForSelector('main');
  assert.equal(await page.evaluate(() => window.__cafeApp.state.consumption), false, '새로고침해도 지운 상태 유지');
  await page.locator('.tabbar [data-tab="count"]').click();
  await page.waitForSelector('#progress-text');
  assert.ok((await page.locator('.item-row').count()) >= 60, '모델 없을 때 전체 품목 표시');
  // 다시 불러오기 (뒤 단계에서 예상값 화면을 찍기 위해)
  await page.locator('.tabbar [data-tab="settings"]').click();
  await page.locator('input[data-change="model-import"]').setInputFiles(modelPath);
  await page.waitForFunction(() => !!window.__cafeApp.state.consumption);
  await page.locator('.tabbar [data-tab="count"]').click();
  await page.waitForSelector('#progress-text');
  await shot(page, 'count-forecast');
  log('소비 모델 불러오기 · 예상 재고 · 예상값 채우기');

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
