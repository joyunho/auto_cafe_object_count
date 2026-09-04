// 사진 → 재고 수량 자동 인식 (Claude 비전)
//
// 두 가지 모드:
//   'sheet' : 손으로 적은 재고조사 시트 사진 → 적힌 숫자를 읽어 낸다
//   'shelf' : 선반/냉장고 실물 사진 → 보이는 품목 개수를 센다
//
// 브라우저에서는 @anthropic-ai/sdk를 CDN(ESM)에서 동적으로 불러오고,
// Node 스크립트(scripts/extract-from-photo.mjs)에서는 npm 패키지를 그대로 쓴다.

export const MODEL = 'claude-opus-5';
export const SDK_CDN_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.123.0/+esm';

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '인식된 품목별 수량',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '품목명 (등록 품목 목록에 있는 이름을 우선 사용)' },
          count: { type: 'integer', description: '수량 (0 이상의 정수)' },
          unit: { type: 'string', enum: ['ea', 'box'], description: '수량 단위. "1box" 처럼 적혀 있으면 box' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string', description: '판독이 애매한 이유, 대안 값 등. 없으면 빈 문자열' },
        },
        required: ['name', 'count', 'unit', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: {
      type: 'array',
      description: '수량 칸은 있지만 읽을 수 없었던 품목명',
      items: { type: 'string' },
    },
  },
  required: ['items', 'unreadable'],
  additionalProperties: false,
};

export function buildSystemPrompt() {
  return [
    '당신은 카페 재고조사 사진을 읽어 수량을 구조화하는 보조 도구입니다.',
    '정확도가 최우선입니다. 확실하지 않은 값은 confidence를 낮추고 note에 이유와 대안 값을 적으세요.',
    '숫자를 추측해서 채우지 마세요. 값이 없는 칸은 결과에 넣지 않습니다.',
  ].join('\n');
}

/**
 * @param {'sheet'|'shelf'} mode
 * @param {{name:string, boxSize?:number|null, aliases?:string[]}[]} items 등록 품목
 */
export function buildUserText(mode, items) {
  const list = items
    .map((it) => {
      const extra = [];
      if (it.boxSize) extra.push(`1박스=${it.boxSize}개`);
      if (it.aliases?.length) extra.push(`별칭: ${it.aliases.join(', ')}`);
      const group = it.groupTitle ? ` [${it.groupTitle}]` : '';
      return `- ${it.name}${group}${extra.length ? ` (${extra.join('; ')})` : ''}`;
    })
    .join('\n');

  if (mode === 'sheet') {
    return [
      '첨부한 사진은 손으로 적은 재고조사 시트입니다.',
      '표의 각 칸은 [품목명 | 값] 구조이고, 값 칸에는 다음이 섞여 있을 수 있습니다:',
      '  (1) 작은 빨간색 인쇄 숫자 = 기준 수량 (무시하세요)',
      '  (2) 검은 매직으로 손으로 쓴 숫자/글자 = 현재 수량 (이것을 읽으세요)',
      '  (3) 흰 스티커에 인쇄된 숫자 = 기준 수량 변경분 (무시하세요)',
      '  (4) 지우다 만 흐린 자국 = 지난주 값 (무시하세요)',
      '손으로 쓴 값만 읽어서 품목별 현재 수량으로 정리하세요. "1box"처럼 박스로 적혀 있으면 unit을 box로 하세요.',
      '손으로 쓴 값이 없는 품목은 결과에 포함하지 마세요.',
      '',
      '등록된 품목 목록. name에는 아래 품목명을 그대로 쓰세요(대괄호 안 분류는 참고용이며 이름에 넣지 마세요).',
      '같은 이름이 여러 분류에 있으면(예: 레몬) 시트 위치를 보고 "레몬(주스)"처럼 구분된 등록명을 고르세요.',
      list,
    ].join('\n');
  }

  return [
    '첨부한 사진은 카페 창고/선반/냉장고의 실물 재고 사진입니다.',
    '사진에서 식별 가능한 품목의 개수를 세어 품목별 수량으로 정리하세요.',
    '박스째 있으면 unit을 box로, 낱개는 ea로 표기하세요. 가려져서 정확히 셀 수 없으면 confidence를 낮추고 note에 적으세요.',
    '사진에 없는 품목은 결과에 포함하지 마세요.',
    '',
    '등록된 품목 목록. name에는 아래 품목명을 그대로 쓰세요(대괄호 안 분류는 참고용이며 이름에 넣지 마세요).',
    list,
  ].join('\n');
}

/** JSON만 답하라는 지시 (구조화 출력을 쓸 수 없는 경로용 — 예: 아티팩트의 claude.use("sample")) */
export function buildJsonInstruction() {
  return [
    '',
    '답은 아래 형태의 JSON 하나만 출력하세요. 설명 문장, 코드펜스 없이 JSON만.',
    '{"items":[{"name":"품목명","count":정수,"unit":"ea"|"box","confidence":"high"|"medium"|"low","note":"애매한 이유 또는 빈 문자열"}],"unreadable":["읽지 못한 품목명"]}',
  ].join('\n');
}

/** 시스템 프롬프트 + 사용자 지시 + JSON 형식 지시를 하나의 문자열로 (sample 경로용) */
export function buildPlainPrompt(mode, items) {
  return `${buildSystemPrompt()}\n\n${buildUserText(mode, items)}\n${buildJsonInstruction()}`;
}

/** 모델이 준 JSON 객체를 앱이 쓰는 형태로 정리 */
export function sanitizeParsed(parsed) {
  const items = (parsed?.items || [])
    .filter((it) => it && typeof it.name === 'string' && Number.isFinite(Number(it.count)))
    .map((it) => ({
      name: it.name.trim(),
      count: Math.max(0, Math.round(Number(it.count))),
      unit: it.unit === 'box' ? 'box' : 'ea',
      confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium',
      note: typeof it.note === 'string' ? it.note : '',
    }));
  const unreadable = Array.isArray(parsed?.unreadable) ? parsed.unreadable.filter((x) => typeof x === 'string') : [];
  return { items, unreadable };
}

/**
 * Messages API 요청 본문 생성 (순수 함수 — 테스트 가능)
 * @param {{data:string, mediaType:string}[]} images base64 이미지
 */
export function buildRequest({ mode, items, images }) {
  const content = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.data },
  }));
  content.push({ type: 'text', text: buildUserText(mode, items) });
  return {
    model: MODEL,
    max_tokens: 16000,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    // 안전 분류기가 요청을 거절하면 서버가 자동으로 대체 모델로 재시도한다.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** 응답 → {items, unreadable, usage, model} */
export function parseResponse(response) {
  if (response.stop_reason === 'refusal') {
    const why = response.stop_details?.explanation || '';
    throw new Error(`모델이 요청을 거절했습니다. ${why}`.trim());
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('모델 응답이 잘렸습니다. 사진 수를 줄여 다시 시도하세요.');
  }
  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('모델 응답에 텍스트가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('모델 응답을 JSON으로 해석할 수 없습니다.');
  }
  return { ...sanitizeParsed(parsed), usage: response.usage, model: response.model };
}

/** SDK 오류 → 직원이 이해할 수 있는 한국어 메시지 */
export function describeSdkError(err, Anthropic) {
  const is = (name) => Anthropic?.[name] && err instanceof Anthropic[name];
  if (is('APIUserAbortError')) return '취소했습니다.';
  if (is('AuthenticationError')) return 'API 키가 올바르지 않습니다. 설정 탭에서 다시 확인하세요.';
  if (is('PermissionDeniedError')) return '이 API 키로는 사용할 수 없는 기능입니다.';
  if (is('RateLimitError')) return '요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.';
  if (is('APIConnectionTimeoutError')) return '응답이 너무 오래 걸려 중단했습니다. 다시 시도하세요.';
  if (is('APIConnectionError')) return '인터넷 연결을 확인하세요.';
  if (is('BadRequestError')) return '요청을 처리할 수 없습니다. 사진 크기나 수를 줄여 보세요.';
  if (is('APIError')) return `API 오류 (${err.status ?? '알 수 없음'}). 잠시 후 다시 시도하세요.`;
  if (err?.name === 'AbortError') return '취소했습니다.';
  return null;
}

let sdkPromise = null;
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import(/* @vite-ignore */ SDK_CDN_URL).then((m) => m.default || m.Anthropic || m);
  }
  return sdkPromise;
}

/**
 * 이미 만든 SDK 클라이언트로 호출 (Node 스크립트/테스트용).
 * @param {object} client Anthropic 클라이언트
 * @param {{mode:'sheet'|'shelf', items:object[], images:{data:string, mediaType:string}[]}} p
 */
export async function extractWithClient(client, { mode, items, images, signal }) {
  if (!images?.length) throw new Error('사진을 선택하세요.');
  const req = buildRequest({ mode, items, images });
  const response = await client.beta.messages.create(req, signal ? { signal } : undefined);
  return parseResponse(response);
}

/**
 * 브라우저에서 호출. API 키는 사용자의 브라우저에만 저장된다.
 * @param {{apiKey:string, mode:'sheet'|'shelf', items:object[], images:{data:string, mediaType:string}[], signal?:AbortSignal, AnthropicClass?:Function}} p
 */
export async function extractCounts({ apiKey, mode, items, images, signal, AnthropicClass }) {
  if (!apiKey) throw new Error('API 키가 설정되지 않았습니다. 설정 탭에서 입력하세요.');
  if (!images?.length) throw new Error('사진을 선택하세요.');
  let Anthropic;
  try {
    Anthropic = AnthropicClass || (await loadSdk());
  } catch {
    sdkPromise = null;
    throw new Error('AI 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    return await extractWithClient(client, { mode, items, images, signal });
  } catch (err) {
    const friendly = describeSdkError(err, Anthropic);
    if (friendly) throw new Error(friendly);
    throw err;
  }
}

/**
 * claude.ai 아티팩트 안에서는 API 키 없이 뷰어의 Claude 계정으로 인식할 수 있다
 * (`claude.use("sample")`). 사용할 수 있으면 sample 함수를, 아니면 null을 돌려준다.
 */
export async function detectSample() {
  try {
    if (typeof window === 'undefined' || !window.claude?.use) return null;
    const sample = await window.claude.use('sample');
    if (!sample) return null;
    const limits = await sample.limits().catch(() => null);
    if (!limits?.images) return null;
    return { sample, limits: limits.images };
  } catch {
    return null;
  }
}

/**
 * 아티팩트 경로: 뷰어의 Claude로 사진 인식.
 * @param {Function} sample claude.use("sample") 결과
 * @param {{mode:'sheet'|'shelf', items:object[], files:Blob[], signal?:AbortSignal}} p
 */
export async function extractWithSample(sample, { mode, items, files, signal }) {
  if (!files?.length) throw new Error('사진을 선택하세요.');
  const prompt = buildPlainPrompt(mode, items);
  try {
    const parsed = await sample.json(prompt, { images: files, modelTier: 'default', cache: false, signal });
    return { ...sanitizeParsed(parsed), usage: null, model: 'claude (artifact)' };
  } catch (e) {
    const code = e?.code || 'upstream_error';
    const msgs = {
      not_granted: '이 페이지에서 Claude 사용이 허용되지 않았습니다.',
      sampling_disabled: '이 계정에서는 Claude 인식을 쓸 수 없습니다.',
      rate_limited: '요청이 많습니다. 잠시 후 다시 시도하세요.',
      image_rejected: '사진 파일을 처리할 수 없습니다. 다른 사진으로 시도하세요.',
      images_unavailable: '이 화면에서는 사진을 보낼 수 없습니다.',
      refused: '모델이 이 사진의 처리를 거절했습니다.',
      invalid_json: '인식 결과를 해석하지 못했습니다. 다시 시도하세요.',
      cancelled: '취소했습니다.',
      prompt_too_large: '품목 목록이 너무 깁니다. 사용하지 않는 품목을 끄고 다시 시도하세요.',
    };
    throw new Error(msgs[code] || `인식에 실패했습니다 (${code}).`);
  }
}

/** 브라우저: File → 리사이즈된 JPEG base64 */
export async function fileToBase64Image(file, { maxSide = 1600, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg', width: w, height: h, previewUrl: dataUrl, file };
}
