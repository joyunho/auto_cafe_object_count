// 단일 HTML 파일 빌드 (esbuild로 모듈을 하나로 묶고 CSS/JS를 인라인)
//   node scripts/build-single.mjs            → dist/cafe-inventory.html (독립 실행 문서)
//   node scripts/build-single.mjs --fragment → dist/artifact.html (doctype/html/head/body 없는 조각)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fragment = process.argv.includes('--fragment');
const out = path.join(root, 'dist', fragment ? 'artifact.html' : 'cafe-inventory.html');
fs.mkdirSync(path.dirname(out), { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  bundle: true,
  format: 'esm',
  minify: false,
  write: false,
  charset: 'utf8',
  target: ['es2022'],
  define: { __SINGLE_FILE__: 'true' },
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const iconSvg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');
// 판매 자료로 만든 소비 모델(data/consumption.json, 저장소에는 포함하지 않음)이 있으면 빌드에 심는다
const modelPath = path.join(root, 'data', 'consumption.json');
const modelScript = fs.existsSync(modelPath)
  ? `<script>window.__CONSUMPTION_MODEL__ = ${JSON.stringify(JSON.parse(fs.readFileSync(modelPath, 'utf8'))).replace(/<\/script/gi, '<\\/script')};</script>\n`
  : '';
if (modelScript) console.log('소비 모델 포함: data/consumption.json');
// 레시피 표(data/recipes.json, 저장소에는 포함하지 않음)도 있으면 심는다 — 단일 파일에서는
// src/data/recipes.js 를 실행 중에 찾을 수 없으므로 이 길로만 들어간다 (설정 탭 "포스 자료 넣기"에 필요)
const recipesPath = path.join(root, 'data', 'recipes.json');
const recipesScript = fs.existsSync(recipesPath)
  ? `<script>window.__RECIPES__ = ${JSON.stringify(JSON.parse(fs.readFileSync(recipesPath, 'utf8')).recipes || []).replace(/<\/script/gi, '<\\/script')};</script>\n`
  : '';
if (recipesScript) console.log('레시피 표 포함: data/recipes.json');
const iconHref = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;

const inner = `<title>씨앤비 발주 도우미</title>
<meta name="theme-color" content="#c93a3a" />
<style>
${css}
</style>
<div id="app"></div>
<noscript>이 앱은 JavaScript가 필요합니다.</noscript>
${modelScript}${recipesScript}<script type="module">
${js}
</script>`;

const html = fragment
  ? `<!-- 카페 재고관리 v${pkg.version} · 단일 파일 빌드 (아티팩트용 조각) -->\n${inner}\n`
  : `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<link rel="icon" href="${iconHref}" />
${inner}
</head>
<body></body>
</html>
`;

fs.writeFileSync(out, html);
console.log(`${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
