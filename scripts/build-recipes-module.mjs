// data/recipes.json → src/data/recipes.js (브라우저에 들어가는 레시피 표)
//   node scripts/build-recipes-module.mjs
//
// 왜 필요한가: 앱이 브라우저에서 POS 보고서를 소비 모델로 바꾸려면 레시피가 있어야 하는데,
// data/ 는 저장소에 올리지 않아(.gitignore) GitHub Pages 배포본에는 들어가지 않는다.
// 그래서 레시피 표만 소스 모듈로 뽑아 둔다 (금액 자료는 들어 있지 않다 — 메뉴·재료·양뿐).
// scripts/build-recipes.mjs 가 끝에서 이 스크립트를 부르므로 보통은 따로 실행할 일이 없다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data', 'recipes.json');
if (!fs.existsSync(src)) {
  console.error(`${path.relative(root, src)} 가 없습니다 — 먼저 scripts/build-recipes.mjs 로 만드세요`);
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = path.join(root, 'src', 'data', 'recipes.js');
const body = `// 레시피 표 — data/recipes.json 에서 생성한 파일입니다. 직접 고치지 마세요.
//   node scripts/build-recipes-module.mjs
// 앱(브라우저)에서 POS 보고서 → 소비 모델을 계산할 때 쓴다 (src/logic/pos-model.js).
// 금액 자료는 들어 있지 않다: 메뉴·변형·재료·양뿐.

/** 레시피에 인쇄된 계량 기준 (1펌프 g, 1샷 ml 등) */
export const MEASURES = ${JSON.stringify(raw.measures ?? {}, null, 2)};

/** [{ menu, variant, category, ingredients: [{ name, qty, unit }], notes }] */
export const RECIPES = ${JSON.stringify(raw.recipes ?? [], null, 1)};
`;
fs.writeFileSync(out, body);
console.log(`${path.relative(root, out)}: 레시피 ${(raw.recipes || []).length}개 (${(body.length / 1024).toFixed(0)} KB)`);
