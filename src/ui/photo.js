// 사진 자동 입력 모달: 사진 선택 → Claude 비전 인식 → 매칭 결과 확인 → 재고조사에 적용
import { esc } from './html.js';
import { extractCounts, fileToBase64Image } from '../ai/extract.js';
import { matchRecognized } from '../logic/match.js';
import { toEach } from '../logic/order.js';

const ui = { images: [], result: null, busy: false, error: null };

function stepHtml(s) {
  const mode = s.settings.photoMode || 'sheet';
  return `
    <h2>📷 사진으로 자동 입력</h2>
    ${!s.settings.apiKey ? `<p class="small" style="color:var(--warn)">설정 탭에서 Anthropic API 키를 먼저 입력하세요.</p>` : ''}
    <div class="field"><label>무엇을 찍었나요?</label>
      <select id="photo-mode">
        <option value="sheet" ${mode === 'sheet' ? 'selected' : ''}>손글씨 재고 시트 (적힌 숫자 읽기)</option>
        <option value="shelf" ${mode === 'shelf' ? 'selected' : ''}>선반/냉장고 실물 (개수 세기)</option>
      </select></div>
    <div class="row wrap">
      <label class="btn primary">📸 촬영 <input type="file" accept="image/*" capture="environment" data-change="photo-files" class="sr-only" /></label>
      <label class="btn">🖼️ 앨범에서 선택 <input type="file" accept="image/*" multiple data-change="photo-files" class="sr-only" /></label>
    </div>
    <div class="thumbs mt" id="photo-thumbs">${ui.images.map((im, i) => `<img src="${im.previewUrl}" alt="선택한 사진 ${i + 1}" />`).join('')}</div>
    ${ui.error ? `<p class="small" style="color:var(--danger)">${esc(ui.error)}</p>` : ''}
    <div class="modal-actions">
      <button type="button" class="btn" data-action="modal-close">닫기</button>
      <button type="button" class="btn primary" data-action="photo-run" ${ui.images.length && s.settings.apiKey && !ui.busy ? '' : 'disabled'}>
        ${ui.busy ? '<span class="spinner"></span> 인식 중…' : `인식 시작 (${ui.images.length}장)`}
      </button>
    </div>`;
}

function resultHtml(s, app) {
  const { matched, unmatched, unreadable } = ui.result;
  const sess = app.activeSession();
  return `
    <h2>인식 결과 확인</h2>
    <p class="small muted">체크된 품목만 재고조사에 적용됩니다. 값이 틀리면 고친 뒤 적용하세요.</p>
    <div id="photo-results">
      ${
        matched.length === 0
          ? `<div class="empty small">등록 품목과 일치하는 결과가 없습니다.</div>`
          : matched
              .map((m, i) => {
                const it = s.items.find((x) => x.id === m.itemId);
                const conf = m.confidence === 'high' ? 'ok' : m.confidence === 'low' ? 'danger' : 'warn';
                const cur = sess.counts[m.itemId];
                return `<div class="check-row">
                  <input type="checkbox" data-idx="${i}" ${m.confidence === 'low' ? '' : 'checked'} aria-label="${esc(it?.name)} 적용" />
                  <div>
                    <div style="font-weight:600">${esc(it?.name)} <span class="pill ${conf}">${m.confidence === 'high' ? '확실' : m.confidence === 'low' ? '불확실' : '보통'}</span></div>
                    <div class="tiny muted">인식: "${esc(m.recognizedName)}" ${m.unit === 'box' ? '(박스)' : ''}${m.note ? ` · ${esc(m.note)}` : ''}${cur != null ? ` · 현재 입력값 ${cur}` : ''}</div>
                  </div>
                  <div class="row" style="gap:4px"><input type="number" min="0" inputmode="numeric" data-idx="${i}" value="${m.count}" aria-label="수량" /><span class="tiny">${m.unit === 'box' ? '박스' : '개'}</span></div>
                </div>`;
              })
              .join('')
      }
    </div>
    ${unmatched.length ? `<p class="small mt"><b>매칭 안 됨:</b> <span class="muted">${unmatched.map((u) => `${esc(u.name)} ${u.count}`).join(', ')}</span><br/><span class="tiny muted">품목 탭에서 별칭을 추가하면 다음부터 자동 매칭됩니다.</span></p>` : ''}
    ${unreadable?.length ? `<p class="small mt"><b>읽지 못함:</b> <span class="muted">${unreadable.map(esc).join(', ')}</span></p>` : ''}
    ${ui.result.usage ? `<p class="tiny muted">모델 ${esc(ui.result.model || '')} · 입력 ${ui.result.usage.input_tokens} / 출력 ${ui.result.usage.output_tokens} 토큰</p>` : ''}
    <div class="modal-actions">
      <button type="button" class="btn" data-action="photo-back">← 다시</button>
      <button type="button" class="btn primary" data-action="photo-apply" ${matched.length ? '' : 'disabled'}>선택 항목 적용</button>
    </div>`;
}

function rerender(app) {
  const modal = app.modal?.querySelector('.modal');
  if (!modal) return;
  modal.innerHTML = ui.result ? resultHtml(app.state, app) : stepHtml(app.state);
}

export const changes = {
  async 'photo-files'(el, e, app) {
    const files = [...(el.files || [])];
    if (!files.length) return;
    ui.error = null;
    try {
      for (const f of files) ui.images.push(await fileToBase64Image(f));
    } catch {
      ui.error = '사진을 읽을 수 없습니다.';
    }
    rerender(app);
  },
};

export const actions = {
  'photo-open'(el, e, app) {
    ui.images = [];
    ui.result = null;
    ui.error = null;
    ui.busy = false;
    app.openModal(stepHtml(app.state));
  },
  async 'photo-run'(el, e, app) {
    const s = app.state;
    const modeSel = document.getElementById('photo-mode');
    const mode = modeSel?.value || s.settings.photoMode || 'sheet';
    app.set((st) => {
      st.settings.photoMode = mode;
    });
    ui.busy = true;
    ui.error = null;
    rerender(app);
    try {
      const items = s.items.filter((it) => it.active !== false);
      const res = await extractCounts({ apiKey: s.settings.apiKey, mode, items, images: ui.images });
      const { matched, unmatched } = matchRecognized(res.items, items);
      // 인식 결과의 confidence/unit/note를 매칭 결과에 붙인다
      for (const m of matched) {
        const src = res.items.find((r) => r.name === m.recognizedName);
        Object.assign(m, { unit: src?.unit || 'ea', confidence: src?.confidence || 'medium', note: src?.note || '' });
      }
      ui.result = { matched, unmatched, unreadable: res.unreadable, usage: res.usage, model: res.model };
    } catch (err) {
      ui.error = err?.message || String(err);
    } finally {
      ui.busy = false;
    }
    rerender(app);
  },
  'photo-back'(el, e, app) {
    ui.result = null;
    rerender(app);
  },
  'photo-apply'(el, e, app) {
    const modal = app.modal?.querySelector('.modal');
    if (!modal || !ui.result) return;
    const checks = [...modal.querySelectorAll('#photo-results input[type=checkbox]')];
    const nums = [...modal.querySelectorAll('#photo-results input[type=number]')];
    let applied = 0;
    app.update((s) => {
      const sess = app.activeSession();
      for (const c of checks) {
        if (!c.checked) continue;
        const i = Number(c.dataset.idx);
        const m = ui.result.matched[i];
        const it = s.items.find((x) => x.id === m.itemId);
        const raw = Number(nums.find((n) => Number(n.dataset.idx) === i)?.value ?? m.count);
        if (!Number.isFinite(raw)) continue;
        // 인식 단위(box/ea) → 품목의 세는 단위로 환산
        let v = raw;
        if (m.unit === 'box' && it?.countUnit !== 'box') v = toEach(it, raw, 'box');
        sess.counts[m.itemId] = Math.max(0, Math.round(v));
        applied++;
      }
      sess.updatedAt = new Date().toISOString();
      s.ui.tab = 'count';
    });
    app.closeModal();
    app.toast(`${applied}개 품목 수량을 입력했습니다`);
  },
};
