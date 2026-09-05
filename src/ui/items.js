// 품목 탭: 품목/기준 수량/박스 규칙 관리
import { esc } from './html.js';
import { unitLabel } from '../logic/order.js';
import { resetItems, uid } from '../store.js';
import { BOOKS, bookOf } from '../data/books.js';

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  );
}

export function render(s) {
  const ungrouped = s.items.filter((it) => !s.groups.some((g) => g.id === it.group));
  return `
    <section class="card">
      <h2 style="margin:0">품목 <span class="muted small">${s.items.filter((it) => it.active !== false).length}개 사용 중</span></h2>
      <p class="tiny muted" style="margin:8px 0 0">기준 수량(시트의 빨간 숫자)과 박스 단위, 최소 발주 규칙을 여기서 고칩니다. 품목을 눌러 편집하세요. 장부(제품/자재)별로 나뉘어 있습니다.</p>
    </section>
    ${BOOKS.map((b) => bookSection(s, b)).join('')}
    ${ungrouped.length ? `<section class="group"><div class="group-head"><span>그룹 없음</span></div><div class="item-list">${ungrouped.map(itemRow).join('')}</div></section>` : ''}
    <section class="card">
      <button type="button" class="btn block danger" data-action="items-reset">품목을 기본 시트 데이터로 되돌리기</button>
      <p class="tiny muted" style="margin:8px 0 0">재고조사/발주 기록은 지워지지 않습니다.</p>
    </section>`;
}

function bookSection(s, b) {
  const groups = s.groups.filter((g) => (g.book || 'product') === b.id).map((g) => ({ g, items: s.items.filter((it) => it.group === g.id) }));
  return `
    <section class="card compact book-head">
      <div class="row between wrap">
        <h2 style="margin:0">${esc(b.title)} <span class="muted small">${esc(b.dayLabel)} 발주</span></h2>
        <div class="row">
          <button type="button" class="btn sm" data-action="group-add" data-book="${b.id}">+ 그룹</button>
          <button type="button" class="btn sm primary" data-action="item-new" data-book="${b.id}">+ 품목</button>
        </div>
      </div>
      <p class="tiny muted" style="margin:6px 0 0">${esc(b.desc)}</p>
    </section>
    ${groups
      .map(
        ({ g, items }) => `
      <section class="group">
        <div class="group-head">
          <span>${esc(g.title)} <span class="tiny">(${items.length})</span></span>
          <span class="row">
            <button type="button" class="btn sm ghost" data-action="group-up" data-id="${esc(g.id)}" aria-label="그룹 위로">↑</button>
            <button type="button" class="btn sm ghost" data-action="group-down" data-id="${esc(g.id)}" aria-label="그룹 아래로">↓</button>
            <button type="button" class="btn sm ghost" data-action="group-edit" data-id="${esc(g.id)}">이름</button>
          </span>
        </div>
        <div class="item-list">${items.map((it) => itemRow(it)).join('') || '<div class="empty small">품목 없음</div>'}</div>
      </section>`,
      )
      .join('')}`;
}

function itemRow(it) {
  const meta = [];
  meta.push(it.par != null ? `기준 ${it.par}${it.parUnit === 'box' ? '박스' : unitLabel('ea', it)}` : '기준 없음');
  if (it.boxSize) meta.push(`1박스=${it.boxSize}`);
  if (it.orderUnit === 'box') meta.push('박스 발주');
  if (it.rule?.type === 'reorderPoint') meta.push(`${it.rule.threshold}${unitLabel('ea', it)} 미만→${it.rule.orderQty}${unitLabel(it.orderUnit, it)}`);
  if (it.minOrder) meta.push(`최소 ${it.minOrder}${unitLabel(it.orderUnit, it)}`);
  if (it.active === false) meta.push('사용 안 함');
  return `
    <div class="item-row ${it.active === false ? 'inactive' : ''}" data-action="item-edit" data-id="${esc(it.id)}" role="button" tabindex="0">
      <div>
        <div class="name">${esc(it.name)}</div>
        <div class="meta">${esc(meta.join(' · '))}${it.note ? ` · <i>${esc(it.note)}</i>` : ''}</div>
      </div>
      <div class="row">
        <button type="button" class="btn sm ghost" data-action="item-up" data-id="${esc(it.id)}" aria-label="위로">↑</button>
        <button type="button" class="btn sm ghost" data-action="item-down" data-id="${esc(it.id)}" aria-label="아래로">↓</button>
      </div>
    </div>`;
}

function formHtml(s, it, isNew) {
  const rule = it.rule?.type === 'reorderPoint' ? it.rule : null;
  return `
    <h2>${isNew ? '품목 추가' : '품목 편집'}</h2>
    <form id="item-form">
      <div class="field"><label>품목명</label><input type="text" name="name" value="${esc(it.name)}" required /></div>
      <div class="field"><label>그룹 <span class="muted">(장부는 그룹을 따릅니다: 제품 / 자재)</span></label>
        <select name="group">${s.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === it.group ? 'selected' : ''}>${esc(bookOf(g.book).short)} · ${esc(g.title)}</option>`).join('')}</select></div>
      <div class="grid-2">
        <div class="field"><label>기준 수량 (빨간 숫자)</label><input type="number" name="par" min="0" step="0.5" inputmode="decimal" value="${it.par ?? ''}" placeholder="없음" /><div class="hint">1.5처럼 0.5 단위도 됩니다</div></div>
        <div class="field"><label>기준 수량 단위</label>
          <select name="parUnit"><option value="ea" ${it.parUnit !== 'box' ? 'selected' : ''}>개</option><option value="box" ${it.parUnit === 'box' ? 'selected' : ''}>박스</option></select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>1박스 개수</label><input type="number" name="boxSize" min="1" inputmode="numeric" value="${it.boxSize ?? ''}" placeholder="예: 6" /><div class="hint">"(1box>6)" 표기면 6</div></div>
        <div class="field"><label>발주 단위</label>
          <select name="orderUnit"><option value="ea" ${it.orderUnit !== 'box' ? 'selected' : ''}>개</option><option value="box" ${it.orderUnit === 'box' ? 'selected' : ''}>박스</option></select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>세는 단위</label>
          <select name="countUnit"><option value="ea" ${it.countUnit !== 'box' ? 'selected' : ''}>개</option><option value="box" ${it.countUnit === 'box' ? 'selected' : ''}>박스</option></select>
          <div class="hint">재고조사 때 입력하는 단위</div></div>
        <div class="field"><label>최소 발주 수량</label><input type="number" name="minOrder" min="0" inputmode="numeric" value="${it.minOrder ?? ''}" placeholder="없음" /></div>
      </div>
      <div class="field">
        <label class="row"><input type="checkbox" name="useRule" ${rule ? 'checked' : ''} /> 재발주점 규칙 사용 (예: 유자청 — 3개 미만이면 1박스)</label>
        <div class="grid-2">
          <input type="number" name="threshold" min="0" inputmode="numeric" placeholder="재발주점 — 이 개수 미만이면 (예: 3)" aria-label="재발주점" value="${rule?.threshold ?? ''}" style="border:1px solid var(--line);border-radius:10px;padding:10px;min-height:44px;background:var(--surface)" />
          <input type="number" name="orderQty" min="1" inputmode="numeric" placeholder="그때 발주 수량 (예: 1)" aria-label="재발주 수량" value="${rule?.orderQty ?? ''}" style="border:1px solid var(--line);border-radius:10px;padding:10px;min-height:44px;background:var(--surface)" />
        </div>
        <div class="hint">기준 수량과는 별개입니다. 규칙이 켜지면 기준 수량 대신 이 규칙으로 발주량을 정합니다.</div>
      </div>
      <div class="field"><label>낱개 단위 이름 <span class="muted">(비우면 "개" · 예: 묶음, 롤, 봉)</span></label><input type="text" name="unitName" value="${esc(it.unitName || '')}" placeholder="개" /></div>
      <div class="field"><label>별칭 (쉼표로 구분 · 사진 인식 매칭용)</label><input type="text" name="aliases" value="${esc((it.aliases || []).join(', '))}" /></div>
      <div class="field"><label>메모</label><input type="text" name="note" value="${esc(it.note || '')}" /></div>
      <div class="field"><label class="row"><input type="checkbox" name="active" ${it.active !== false ? 'checked' : ''} /> 사용 중 (끄면 재고조사/발주에서 숨김)</label></div>
      <div class="modal-actions">
        ${!isNew ? `<button type="button" class="btn danger" data-action="item-delete" data-id="${esc(it.id)}">삭제</button>` : ''}
        <button type="button" class="btn" data-action="modal-close">취소</button>
        <button type="submit" class="btn primary">저장</button>
      </div>
    </form>`;
}

function readForm(form) {
  const fd = new FormData(form);
  const num = (k) => {
    const v = fd.get(k);
    return v === '' || v == null ? null : Number(v);
  };
  const useRule = fd.get('useRule') === 'on';
  const threshold = num('threshold');
  const orderQty = num('orderQty');
  return {
    name: String(fd.get('name') || '').trim(),
    group: String(fd.get('group') || ''),
    unitName: String(fd.get('unitName') || '').trim() || null,
    par: num('par') == null ? null : Math.max(0, Math.round(num('par') * 2) / 2),
    parUnit: fd.get('parUnit') === 'box' ? 'box' : 'ea',
    boxSize: num('boxSize') || null,
    orderUnit: fd.get('orderUnit') === 'box' ? 'box' : 'ea',
    countUnit: fd.get('countUnit') === 'box' ? 'box' : 'ea',
    minOrder: num('minOrder') || null,
    rule: useRule && threshold != null && orderQty ? { type: 'reorderPoint', threshold, orderQty } : null,
    aliases: String(fd.get('aliases') || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    note: String(fd.get('note') || '').trim(),
    active: fd.get('active') === 'on',
  };
}

function openForm(app, it, isNew) {
  app.openModal(formHtml(app.state, it, isNew), (modal) => {
    const form = modal.querySelector('#item-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = readForm(form);
      if (!data.name) return;
      const grp = app.state.groups.find((g) => g.id === data.group);
      data.book = grp ? grp.book || 'product' : it.book || 'product'; // 장부는 그룹을 따른다
      const units = new Set([data.parUnit, data.orderUnit, data.countUnit]);
      if (units.size > 1 && !data.boxSize) {
        app.toast('기준·세는·발주 단위가 다르면 "1박스 개수"를 입력해야 계산할 수 있습니다', 3500);
        form.querySelector('input[name=boxSize]').focus();
        return;
      }
      if (app.state.items.some((x) => x.id !== it.id && x.name === data.name)) {
        app.toast('같은 이름의 품목이 이미 있습니다. 이름을 구분해 주세요', 3000);
        form.querySelector('input[name=name]').focus();
        return;
      }
      app.update((s) => {
        if (isNew) {
          let id = slugify(data.name);
          if (s.items.some((x) => x.id === id)) id = `${id}-${uid()}`;
          s.items.push({ id, ...data });
        } else {
          const target = s.items.find((x) => x.id === it.id);
          Object.assign(target, data);
        }
      });
      app.closeModal();
      app.toast(isNew ? '품목을 추가했습니다' : '저장했습니다');
    });
    form.querySelector('input[name=name]').focus();
  });
}

/** 같은 장부 안에서만 그룹 순서를 바꾼다 */
function moveGroup(s, id, dir) {
  const g = s.groups.find((x) => x.id === id);
  if (!g) return;
  const same = s.groups.filter((x) => (x.book || 'product') === (g.book || 'product'));
  const i = same.indexOf(g);
  const j = i + dir;
  if (j < 0 || j >= same.length) return;
  const a = s.groups.indexOf(same[i]);
  const b = s.groups.indexOf(same[j]);
  [s.groups[a], s.groups[b]] = [s.groups[b], s.groups[a]];
}

function move(arr, idx, dir) {
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= arr.length) return;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
}

export const actions = {
  'modal-close'(el, e, app) {
    app.closeModal();
  },
  'item-new'(el, e, app) {
    const book = bookOf(el.dataset.book || app.book()).id;
    const group = app.state.groups.find((g) => (g.book || 'product') === book)?.id || app.state.groups[0]?.id || '';
    openForm(
      app,
      { name: '', book, group, par: null, parUnit: 'ea', boxSize: null, orderUnit: 'ea', countUnit: 'ea', minOrder: null, rule: null, aliases: [], unitName: null, note: '', active: true },
      true,
    );
  },
  'item-edit'(el, e, app) {
    if (e.target.closest('button')) return; // 위/아래 버튼 클릭은 제외
    const it = app.state.items.find((x) => x.id === el.dataset.id);
    if (it) openForm(app, it, false);
  },
  'item-delete'(el, e, app) {
    if (!confirm('이 품목을 삭제할까요? 지난 기록의 수량은 유지되지만 이름이 표시되지 않을 수 있습니다.\n숨기기만 하려면 "사용 중"을 끄세요.')) return;
    app.update((s) => {
      s.items = s.items.filter((x) => x.id !== el.dataset.id);
    });
    app.closeModal();
  },
  'item-up'(el, e, app) {
    e.stopPropagation();
    app.update((s) => {
      const it = s.items.find((x) => x.id === el.dataset.id);
      const siblings = s.items.filter((x) => x.group === it.group);
      const i = siblings.indexOf(it);
      if (i <= 0) return;
      const a = s.items.indexOf(siblings[i - 1]);
      const b = s.items.indexOf(it);
      [s.items[a], s.items[b]] = [s.items[b], s.items[a]];
    });
  },
  'item-down'(el, e, app) {
    e.stopPropagation();
    app.update((s) => {
      const it = s.items.find((x) => x.id === el.dataset.id);
      const siblings = s.items.filter((x) => x.group === it.group);
      const i = siblings.indexOf(it);
      if (i < 0 || i >= siblings.length - 1) return;
      const a = s.items.indexOf(siblings[i + 1]);
      const b = s.items.indexOf(it);
      [s.items[a], s.items[b]] = [s.items[b], s.items[a]];
    });
  },
  'group-add'(el, e, app) {
    const book = bookOf(el.dataset.book || app.book()).id;
    const title = prompt(`새 그룹 이름 (${bookOf(book).short})`);
    if (!title?.trim()) return;
    app.update((s) => {
      let id = slugify(title);
      if (s.groups.some((g) => g.id === id)) id = `${id}-${uid()}`;
      s.groups.push({ id, title: title.trim(), book });
    });
  },
  'group-edit'(el, e, app) {
    const g = app.state.groups.find((x) => x.id === el.dataset.id);
    if (!g) return;
    const title = prompt('그룹 이름', g.title);
    if (title === null) return;
    if (!title.trim()) {
      const items = app.state.items.filter((it) => it.group === g.id).length;
      if (items) return app.toast('품목이 있는 그룹은 삭제할 수 없습니다');
      if (!confirm('빈 그룹을 삭제할까요?')) return;
      app.update((s) => {
        s.groups = s.groups.filter((x) => x.id !== g.id);
      });
      return;
    }
    app.update(() => {
      g.title = title.trim();
    });
  },
  'group-up'(el, e, app) {
    app.update((s) => moveGroup(s, el.dataset.id, -1));
  },
  'group-down'(el, e, app) {
    app.update((s) => moveGroup(s, el.dataset.id, 1));
  },
  'items-reset'(el, e, app) {
    if (!confirm('품목과 그룹을 기본 시트 데이터로 되돌릴까요? 직접 수정한 품목 정보는 사라집니다.')) return;
    app.update((s) => Object.assign(s, resetItems(s)));
    app.toast('기본 품목으로 되돌렸습니다');
  },
};
