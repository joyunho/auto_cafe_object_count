import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseResponse, buildUserText, extractWithClient, MODEL, OUTPUT_SCHEMA } from '../src/ai/extract.js';

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

test('buildUserText: 품목 목록과 박스 정보, 모드별 지시 포함', () => {
  const sheet = buildUserText('sheet', items);
  assert.match(sheet, /아이스티\(1box>6\) \(1박스=6개; 별칭: 아이스티\)/);
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
  assert.deepEqual(out.items[0], { name: '유자청', count: 2, unit: 'ea', confidence: 'high', note: '' });
  assert.deepEqual(out.items[1], { name: '아이스티', count: 0, unit: 'box', confidence: 'low', note: 'x' });
  assert.deepEqual(out.unreadable, ['잣']);
  assert.equal(out.model, 'claude-opus-5');
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
