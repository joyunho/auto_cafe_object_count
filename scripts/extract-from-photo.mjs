#!/usr/bin/env node
// 사진 → 재고 수량 인식 CLI (앱과 같은 프롬프트/스키마 사용)
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/extract-from-photo.mjs [--mode sheet|shelf] photo1.jpg [photo2.jpg ...]
//
// 결과: 인식된 품목/수량 JSON + 등록 품목과의 매칭 결과를 표준 출력에 찍는다.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { extractWithClient } from '../src/ai/extract.js';
import { matchRecognized } from '../src/logic/match.js';
import { SEED_ITEMS } from '../src/data/items.js';

const args = process.argv.slice(2);
let mode = 'sheet';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode') mode = args[++i];
  else files.push(args[i]);
}
if (!files.length) {
  console.error('사용법: node scripts/extract-from-photo.mjs [--mode sheet|shelf] <사진 파일...>');
  process.exit(1);
}

const mediaTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const images = files.map((f) => {
  const ext = path.extname(f).toLowerCase();
  const mediaType = mediaTypes[ext];
  if (!mediaType) throw new Error(`지원하지 않는 이미지 형식: ${f}`);
  return { data: fs.readFileSync(f).toString('base64'), mediaType };
});

const client = new Anthropic(); // ANTHROPIC_API_KEY 또는 `ant auth login` 프로필 사용
const items = SEED_ITEMS.filter((it) => it.active !== false);

try {
  const res = await extractWithClient(client, { mode, items, images });
  const { matched, unmatched } = matchRecognized(res.items, items);
  console.log(JSON.stringify({ model: res.model, usage: res.usage, recognized: res.items, unreadable: res.unreadable, matched, unmatched }, null, 2));
} catch (err) {
  if (err instanceof Anthropic.AuthenticationError) console.error('API 키가 올바르지 않습니다.');
  else if (err instanceof Anthropic.RateLimitError) console.error('요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.');
  else if (err instanceof Anthropic.APIError) console.error(`API 오류 ${err.status}: ${err.message}`);
  else console.error(err.message || err);
  process.exit(2);
}
