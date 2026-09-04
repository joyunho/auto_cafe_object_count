// 사진/텍스트에서 인식된 품목명을 등록 품목에 매칭
// 한글은 자모 분해 없이 정규화(공백/괄호/특수문자 제거) + 부분일치 + 편집거리로 처리한다.

export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\]{}<>,.·\-_/]/g, '')
    .replace(/1box>?\d*/g, '')
    .replace(/box/g, '박스');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * 유사도 0~1. 1이면 동일.
 */
export function similarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return 0.8 + 0.2 * (shorter / longer);
  }
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * 하나의 이름을 품목 목록에서 찾는다.
 * 서로 다른 품목이 같은 최고 점수로 겹치면(예: 두 "레몬") 임의로 고르지 않고
 * ambiguous로 표시한다.
 * @returns {{item, score, ambiguous?:boolean, candidates?:object[]}|null}
 */
export function matchItem(name, items, { threshold = 0.6 } = {}) {
  let best = null;
  let tied = [];
  for (const it of items) {
    const candidates = [it.name, ...(it.aliases || [])];
    let itemScore = 0;
    for (const c of candidates) itemScore = Math.max(itemScore, similarity(name, c));
    if (!best || itemScore > best.score) {
      best = { item: it, score: itemScore };
      tied = [];
    } else if (best && itemScore === best.score && itemScore > 0) {
      tied.push(it);
    }
  }
  if (!best || best.score < threshold) return null;
  if (tied.length) return { ...best, ambiguous: true, candidates: [best.item, ...tied] };
  return best;
}

/**
 * 인식 결과 배열 [{name, count}] → { matched: [{itemId, name, recognizedName, count, score}], unmatched: [{name,count,reason?}] }
 * 같은 품목에 여러 인식이 몰리면 점수가 높은 것을 택한다.
 * 후보가 여럿인 이름(ambiguous)은 unmatched에 후보 목록과 함께 넣는다.
 */
export function matchRecognized(recognized, items, opts) {
  const byItem = new Map();
  const unmatched = [];
  for (const r of recognized) {
    const m = matchItem(r.name, items, opts);
    if (!m) {
      unmatched.push(r);
      continue;
    }
    if (m.ambiguous) {
      unmatched.push({ ...r, reason: `후보 여러 개: ${m.candidates.map((c) => c.name).join(', ')}` });
      continue;
    }
    const prev = byItem.get(m.item.id);
    if (!prev || m.score > prev.score) {
      if (prev) unmatched.push({ name: prev.recognizedName, count: prev.count });
      byItem.set(m.item.id, { itemId: m.item.id, name: m.item.name, recognizedName: r.name, count: r.count, score: m.score });
    } else {
      unmatched.push(r);
    }
  }
  return { matched: [...byItem.values()], unmatched };
}
