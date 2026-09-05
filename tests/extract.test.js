import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequest,
  parseResponse,
  buildUserText,
  buildPlainPrompt,
  sanitizeParsed,
  extractWithClient,
  extractWithSample,
  extractCounts,
  describeSdkError,
  MODEL,
  OUTPUT_SCHEMA,
} from '../src/ai/extract.js';

const items = [
  { id: 'ice-tea', name: '아이스티(1box>6)', boxSize: 6, aliases: ['아이스티'] },
  { id: 'yuja', name: '유자청' },
];
const images = [{ data: 'AAAA', mediaType: 'image/jpeg' }];

test('buildRequest: 이미지 블록 다음에 텍스트, 구조화 출력, fallback 설정', () => {
  const req = buildRequest({ mode: 'sheet', items, images });
  assert.equal(req.model, MODEL);
  assert.equal(req.messages.length, 1);
  const content = req.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[0].source.data, 'AAAA');
  assert.equal(content[1].type, 'text');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.format.schema, OUTPUT_SCHEMA);
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.ok(req.max_tokens >= 4096);
});

test('buildUserText: 품목 목록과 박스 정보, 그룹, 모드별 지시 포함', () => {
  const sheet = buildUserText('sheet', items);
  assert.match(sheet, /아이스티\(1box>6\) \(1박스=6개; 별칭: 아이스티\)/);
  assert.match(buildUserText('sheet', [{ name: '레몬(주스)', groupTitle: '주스 · 생수' }]), /- 레몬\(주스\) \[주스 · 생수\]/);
  assert.match(sheet, /손으로 쓴 값만/);
  const shelf = buildUserText('shelf', items);
  assert.match(shelf, /실물 재고 사진/);
  assert.match(shelf, /유자청/);
});

test('parseResponse: JSON 텍스트를 정리해서 돌려준다', () => {
  const res = {
    stop_reason: 'end_turn',
    model: 'claude-opus-5',
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify({ items: [{ name: ' 유자청 ', count: 2.4, unit: 'weird', confidence: 'high', note: '' }, { name: '아이스티', count: -1, unit: 'box', confidence: 'low', note: 'x' }, { name: 3, count: 1 }], unreadable: ['잣'] }) },
    ],
  };
  const out = parseResponse(res);
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items[0], { name: '유자청', count: 2.5, unit: 'ea', confidence: 'high', note: '' }); // 0.5 단위로 반올림
  assert.deepEqual(out.items[1], { name: '아이스티', count: 0, unit: 'box', confidence: 'low', note: 'x' });
  assert.deepEqual(out.unreadable, ['잣']);
  assert.equal(out.model, 'claude-opus-5');
});

test('parseResponse: max_tokens로 잘리면 (JSON이 깨졌어도) 잘림 오류', () => {
  assert.throws(() => parseResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"items":[]}' }] }), /잘렸/);
  assert.throws(() => parseResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"items":[{"na' }] }), /잘렸/);
});

test('extractCounts: signal을 SDK 호출에 넘기고 SDK 오류를 한국어로 바꾼다', async () => {
  class APIError extends Error {
    constructor(status) {
      super('401 {"type":"error"}');
      this.status = status;
    }
  }
  class AuthenticationError extends APIError {}
  class APIUserAbortError extends Error {}
  let captured;
  let mode = 'ok';
  class FakeAnthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static APIUserAbortError = APIUserAbortError;
    constructor(opts) {
      this.opts = opts;
      this.beta = {
        messages: {
          async create(req, options) {
            captured = { req, options };
            if (mode === 'auth') throw new AuthenticationError(401);
            if (mode === 'abort') throw new APIUserAbortError('aborted');
            if (mode === 'other') throw new APIError(500);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"items":[],"unreadable":[]}' }] };
          },
        },
      };
    }
  }
  const ctl = new AbortController();
  const out = await extractCounts({ apiKey: 'k', mode: 'sheet', items, images, signal: ctl.signal, AnthropicClass: FakeAnthropic });
  assert.equal(captured.options.signal, ctl.signal);
  assert.deepEqual(out.items, []);
  mode = 'auth';
  await assert.rejects(() => extractCounts({ apiKey: 'k', mode: 'sheet', items, images, AnthropicClass: FakeAnthropic }), /API 키가 올바르지 않습니다/);
  mode = 'abort';
  await assert.rejects(() => extractCounts({ apiKey: 'k', mode: 'sheet', items, images, AnthropicClass: FakeAnthropic }), /취소/);
  mode = 'other';
  await assert.rejects(() => extractCounts({ apiKey: 'k', mode: 'sheet', items, images, AnthropicClass: FakeAnthropic }), /API 오류 \(500\)/);
  assert.equal(describeSdkError(new Error('x'), FakeAnthropic), null);
  await assert.rejects(() => extractCounts({ apiKey: '', mode: 'sheet', items, images, AnthropicClass: FakeAnthropic }), /API 키가 설정되지/);
});

test('sanitizeParsed: 이상한 값을 걸러낸다', () => {
  const out = sanitizeParsed({ items: [{ name: 'a', count: '3', unit: 'box', confidence: 'nope', note: 5 }, { name: 'b' }, null], unreadable: ['x', 1] });
  assert.deepEqual(out, { items: [{ name: 'a', count: 3, unit: 'box', confidence: 'medium', note: '' }], unreadable: ['x'] });
  assert.deepEqual(sanitizeParsed(null), { items: [], unreadable: [] });
});

test('buildPlainPrompt: 시스템 지시 + 사용자 지시 + JSON 형식', () => {
  const p = buildPlainPrompt('sheet', items);
  assert.match(p, /정확도가 최우선/);
  assert.match(p, /손으로 쓴 값만/);
  assert.match(p, /JSON 하나만/);
});

test('extractWithSample: sample.json에 프롬프트와 이미지를 넘긴다', async () => {
  let captured;
  const sample = {
    async json(prompt, opts) {
      captured = { prompt, opts };
      return { items: [{ name: '유자청', count: 2, unit: 'ea', confidence: 'high', note: '' }], unreadable: [] };
    },
  };
  const files = [new Blob(['x'])];
  const out = await extractWithSample(sample, { mode: 'shelf', items, files });
  assert.equal(captured.opts.images, files);
  assert.equal(captured.opts.cache, false);
  assert.match(captured.prompt, /실물 재고 사진/);
  assert.equal(out.items[0].count, 2);
  // 오류 코드는 한국어 메시지로
  const failing = { async json() { throw { code: 'rate_limited', message: 'x' }; } };
  await assert.rejects(() => extractWithSample(failing, { mode: 'sheet', items, files }), /잠시 후/);
  await assert.rejects(() => extractWithSample(sample, { mode: 'sheet', items, files: [] }), /사진/);
});

test('parseResponse: refusal이면 오류', () => {
  assert.throws(() => parseResponse({ stop_reason: 'refusal', stop_details: { explanation: 'nope' }, content: [] }), /거절/);
});

test('parseResponse: JSON이 아니면 오류', () => {
  assert.throws(() => parseResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] }), /JSON/);
  assert.throws(() => parseResponse({ stop_reason: 'end_turn', content: [] }), /텍스트/);
});

test('extractWithClient: beta.messages.create에 요청을 넘기고 결과를 파싱', async () => {
  let captured;
  const client = {
    beta: {
      messages: {
        async create(req) {
          captured = req;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"items":[{"name":"유자청","count":3,"unit":"ea","confidence":"high","note":""}],"unreadable":[]}' }] };
        },
      },
    },
  };
  const out = await extractWithClient(client, { mode: 'sheet', items, images });
  assert.equal(captured.model, MODEL);
  assert.equal(out.items[0].count, 3);
  await assert.rejects(() => extractWithClient(client, { mode: 'sheet', items, images: [] }), /사진/);
});
