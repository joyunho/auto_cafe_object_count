// PDF → 텍스트 (브라우저 전용)
//
// POS 는 "그룹별 매출분석"을 PDF 로 인쇄한다. 그 PDF 를 앱에 그대로 넣을 수 있게 pdf.js 를
// 필요할 때만 CDN 에서 받아 쓴다 (앱 번들에도, 오프라인 캐시에도 넣지 않는다 — 평소에는 받지 않는다).
//
// ⚠ 이 길은 실제 POS PDF 로 확인하지 못했다. PDF 안의 글자 조각이 어떤 순서로 들어 있는지는
//   만든 프로그램마다 다르고, 우리에게는 원본 PDF 가 없다. 그래서
//     · 줄을 y 좌표로 묶고 x 좌표로 이어 붙여 "인쇄된 모양"을 되살리고,
//     · 그렇게 만든 텍스트가 보고서로 읽히지 않으면 (기간이 없거나 상품 줄이 0개)
//       "PDF 를 열어 전체 선택·복사한 뒤 붙여넣기 칸에 넣어 주세요"라고 안내한다.
//   붙여넣기 길이 확실한 길이고, PDF 는 편의 기능이다.

export const PDFJS_VERSION = '4.10.38';
export const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;
export const PDF_LOAD_ERROR = 'PDF 읽기 도구를 내려받지 못했습니다 (인터넷 연결 확인). PDF 를 열어 전체 선택·복사한 뒤 붙여넣기 칸에 넣어 주세요.';

let pending = null;

/** pdf.js 를 한 번만 받아 온다 (실패하면 다음에 다시 시도할 수 있게 기억하지 않는다) */
export async function loadPdfJs(base = PDFJS_BASE) {
  if (pending) return pending;
  const url = `${base}pdf.min.mjs`; // 변수로 두어야 번들러가 미리 끌어오지 않는다
  pending = (async () => {
    const mod = await import(/* @vite-ignore */ url);
    try {
      mod.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
    } catch {
      /* 워커 주소를 못 정하면 메인 스레드로 읽는다 (느릴 뿐) */
    }
    return mod;
  })().catch((e) => {
    pending = null;
    throw Object.assign(new Error(PDF_LOAD_ERROR), { cause: e });
  });
  return pending;
}

/**
 * pdf.js 의 글자 조각 → 인쇄된 줄. 같은 높이(y)에 있는 조각을 한 줄로 묶고 x 순으로 이어 붙인다.
 * 사이가 벌어져 있으면 공백을 넣는다 (표의 칸 사이). 붙어 있으면 그대로 이어 붙인다
 * (예: "ice" + "아메리카노" → "ice아메리카노" — 연결표의 상품명과 같아야 한다).
 */
export function itemsToLines(items, { yTol = 3 } = {}) {
  const rows = [];
  for (const it of items || []) {
    const str = typeof it.str === 'string' ? it.str : '';
    if (!str) continue;
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    const h = Math.abs(it.transform?.[3] ?? it.height ?? 10) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= yTol);
    if (!row) rows.push((row = { y, cells: [] }));
    row.cells.push({ x, str, w: it.width || 0, h });
  }
  rows.sort((a, b) => b.y - a.y); // 위에서 아래로
  const lines = [];
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    let line = '';
    let end = null;
    for (const c of row.cells) {
      if (end != null && c.x - end > Math.max(1, c.h * 0.25)) line += ' ';
      line += c.str;
      end = c.x + c.w;
    }
    line = line.replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

/**
 * PDF 바이트 → 텍스트 (쪽마다 줄바꿈)
 * @param {ArrayBuffer|Uint8Array} data
 * @throws {Error} pdf.js 를 못 받거나 PDF 를 못 열면 (한국어 안내 문구)
 */
export async function pdfToText(data, opts = {}) {
  const pdfjs = await loadPdfJs(opts.base);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false }).promise;
  } catch (e) {
    throw Object.assign(new Error('PDF 를 열지 못했습니다 (암호가 걸렸거나 손상된 파일일 수 있습니다). PDF 를 열어 전체 선택·복사한 뒤 붙여넣기 칸에 넣어 주세요.'), { cause: e });
  }
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      pages.push(itemsToLines(tc.items, opts));
      page.cleanup?.();
    }
  } finally {
    try {
      await doc.destroy?.();
    } catch {
      /* 정리 실패는 무시 */
    }
  }
  return pages.join('\n');
}
