// Playwright 크로미움 실행 파일 찾기 (로컬/CI 공통)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export function findChromium() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* 아래에서 탐색 */
  }
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs
      .readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = path.join(base, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

export async function launch(extra = {}) {
  const executablePath = findChromium();
  return chromium.launch({ headless: true, executablePath, ...extra });
}
