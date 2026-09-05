// 설정 탭: 매장 정보, 발주 요일, API 키, 백업/복원
import { esc } from './html.js';
import { exportJSON, importJSON, defaultState, keepSafetyCopy, loadSafetyCopy, builtinModel } from '../store.js';
import { validateModel } from '../logic/forecast.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function render(s) {
  const st = s.settings;
  const hasSafety = !!loadSafetyCopy();
  return `
    <section class="card">
      <h2>매장 · 발주</h2>
      <div class="field"><label>매장 이름</label><input type="text" data-change="setting" data-key="storeName" value="${esc(st.storeName)}" placeholder="예: OO점" /></div>
      <div class="field"><label>담당자 이름 (발주 문자 끝에 표시)</label><input type="text" data-change="setting" data-key="senderName" value="${esc(st.senderName)}" /></div>
      <div class="field"><label>거래처</label><input type="text" data-change="setting" data-key="supplierName" value="${esc(st.supplierName)}" /></div>
      <div class="field"><label>발주 문자 제목</label><input type="text" data-change="setting" data-key="orderTitle" value="${esc(st.orderTitle)}" /></div>
      <div class="field"><label>제품(재료) 발주 요일</label>
        <div class="row wrap">${DAYS.map((d, i) => `<label class="row small" style="gap:4px"><input type="checkbox" data-change="order-day" data-day="${i}" ${st.orderDays.includes(i) ? 'checked' : ''}/>${d}</label>`).join('')}</div></div>
      <div class="field"><label>자재(소모품) 발주 요일</label>
        <div class="row wrap">${DAYS.map((d, i) => `<label class="row small" style="gap:4px"><input type="checkbox" data-change="order-day" data-book="supply" data-day="${i}" ${(st.orderDaysByBook?.supply || [3]).includes(i) ? 'checked' : ''}/>${d}</label>`).join('')}</div>
        <div class="hint">장부별로 새 재고조사의 기본 발주일을 계산할 때 씁니다.</div></div>
    </section>

    <section class="card">
      <h2>사진 자동 입력 (AI)</h2>
      <div class="field"><label>Anthropic API 키</label>
        <div class="row"><input type="password" id="api-key-input" data-change="setting" data-key="apiKey" value="${esc(st.apiKey)}" placeholder="sk-ant-..." autocomplete="off" style="flex:1" />
        <button type="button" class="btn sm" data-action="apikey-toggle">보기</button></div>
        <div class="hint">키는 이 기기의 브라우저에만 저장되고 백업 파일에는 들어가지 않습니다. Anthropic API 호출에만 사용됩니다. 사진 인식 모델: claude-opus-5 (거절 시 자동 대체 모델). claude.ai 아티팩트로 열었다면 키 없이도 됩니다.</div></div>
      <div class="field"><label>기본 인식 방식</label>
        <select data-change="setting" data-key="photoMode">
          <option value="sheet" ${st.photoMode === 'sheet' ? 'selected' : ''}>손글씨 재고 시트 사진 읽기</option>
          <option value="shelf" ${st.photoMode === 'shelf' ? 'selected' : ''}>선반/냉장고 실물 사진에서 개수 세기</option>
        </select></div>
    </section>

    <section class="card">
      <h2>판매 자료 소비 모델 (예상 재고)</h2>
      ${
        s.consumption
          ? `<p class="small" style="margin-bottom:6px"><span class="pill ok">사용 중</span> ${esc(s.consumption.source || '소비 모델')} · 품목 ${Object.keys(s.consumption.items).length}개${s.consumption.months?.length ? ` · ${esc(s.consumption.months[0])}~${esc(s.consumption.months.at(-1))}` : ''}</p>
             <p class="tiny muted">재고조사 탭에 품목별 예상 재고와 "확인 필요" 표시가 나옵니다. 확정한 재고조사가 최소 1회 있어야 계산됩니다.</p>`
          : `<p class="small muted">POS 판매 자료 × 레시피로 만든 소비 모델(JSON)을 넣으면 재고조사 탭에 "지금쯤 몇 개"가 미리 채워집니다. 만드는 방법은 README의 "판매 자료 분석" 참고.</p>`
      }
      <div class="row wrap">
        <label class="btn">📈 소비 모델 불러오기 <input type="file" accept="application/json,.json" data-change="model-import" class="sr-only" /></label>
        ${s.consumption ? `<button type="button" class="btn ghost" data-action="model-clear">모델 지우기</button>` : ''}
        ${!s.consumption && builtinModel() ? `<button type="button" class="btn ghost" data-action="model-restore">내장 모델 다시 쓰기</button>` : ''}
      </div>
    </section>

    <section class="card">
      <h2>백업 · 복원</h2>
      <p class="small muted">품목·기록·설정은 이 기기의 브라우저에만 저장됩니다. 기기를 바꾸거나 다른 직원과 공유하려면 백업 파일을 내보내 옮기세요. (API 키는 백업에 포함되지 않습니다)</p>
      <div class="row wrap">
        <button type="button" class="btn" data-action="backup-export">⬇️ 백업 내보내기 (JSON)</button>
        <label class="btn">⬆️ 백업 불러오기 <input type="file" accept="application/json,.json" data-change="backup-import" class="sr-only" /></label>
        ${hasSafety ? `<button type="button" class="btn ghost" data-action="backup-undo">↩ 불러오기 전 상태로</button>` : ''}
      </div>
      <div class="row wrap mt">
        <button type="button" class="btn danger" data-action="data-wipe">모든 데이터 초기화</button>
      </div>
    </section>

    <section class="card">
      <h2>정보</h2>
      <p class="small muted" style="margin:0">
        씨앤비 재고조사 시트(월·목 발주) 3장을 기준으로 만든 카페 재고관리 앱입니다.<br/>
        홈 화면에 추가하면 앱처럼 쓸 수 있고, 오프라인에서도 열립니다 (사진 인식 제외).<br/>
        버전 0.1.0
      </p>
    </section>`;
}

/** 파일 저장: 아티팩트 안에서는 downloads 기능으로, 아니면 브라우저 다운로드로 */
export async function downloadBackup(app, text) {
  const d = new Date();
  const filename = `cafe-inventory-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  if (typeof window !== 'undefined' && window.claude?.use) {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        await downloads.save({ filename, data: text });
        app.toast('백업 파일을 저장했습니다');
        return;
      }
    } catch (e) {
      if (e?.code === 'declined') return;
    }
    // 아티팩트인데 저장 기능이 없으면 클립보드로
    try {
      await navigator.clipboard.writeText(text);
      app.toast('이 화면에서는 파일 저장이 안 되어 백업 내용을 클립보드에 복사했습니다. 메모장 등에 붙여 넣어 보관하세요.', 5000);
    } catch {
      app.toast('백업을 저장할 수 없습니다');
    }
    return;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const changes = {
  'model-import'(el, e, app) {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      let model;
      try {
        model = validateModel(JSON.parse(text));
      } catch (err) {
        app.toast(err?.message || '소비 모델 파일을 읽을 수 없습니다', 3000);
        el.value = '';
        return;
      }
      app.update((s) => {
        s.consumption = model;
      });
      app.toast(`소비 모델을 불러왔습니다 (품목 ${Object.keys(model.items).length}개)`);
    });
  },
  setting(el, e, app) {
    app.set((s) => {
      s.settings[el.dataset.key] = el.value.trim();
    });
    app.toast('저장됨', 900);
  },
  'order-day'(el, e, app) {
    app.update((s) => {
      const d = Number(el.dataset.day);
      const book = el.dataset.book;
      if (book) {
        s.settings.orderDaysByBook ||= {};
        const set = new Set(s.settings.orderDaysByBook[book] || []);
        if (el.checked) set.add(d);
        else set.delete(d);
        s.settings.orderDaysByBook[book] = [...set].sort();
        if (!s.settings.orderDaysByBook[book].length) s.settings.orderDaysByBook[book] = [3];
        return;
      }
      const set = new Set(s.settings.orderDays);
      if (el.checked) set.add(d);
      else set.delete(d);
      s.settings.orderDays = [...set].sort();
      if (!s.settings.orderDays.length) s.settings.orderDays = [1, 4];
    });
  },
  'backup-import'(el, e, app) {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      let st;
      try {
        st = importJSON(text);
      } catch {
        app.toast('백업 파일이 아니거나 읽을 수 없습니다', 3000);
        el.value = '';
        return;
      }
      const submitted = st.sessions.filter((x) => x.status === 'submitted').length;
      if (!confirm(`백업을 불러올까요?\n품목 ${st.items.length}개, 확정 기록 ${submitted}회.\n현재 품목·기록·설정은 덮어써집니다. (API 키는 유지)`)) {
        el.value = '';
        return;
      }
      keepSafetyCopy(app.state);
      app.update((s) => {
        const apiKey = s.settings.apiKey;
        // 백업에 소비 모델이 없으면(예전 백업) 지금 쓰는 모델을 유지
        const consumption = st.consumption && st.consumption.items ? st.consumption : s.consumption;
        Object.assign(s, st, { ui: s.ui, settings: { ...st.settings, apiKey }, consumption });
      });
      app.toast('백업을 불러왔습니다');
    });
  },
};

export const actions = {
  'model-clear'(el, e, app) {
    if (!confirm('소비 모델을 지울까요? 예상 재고 표시가 사라집니다.')) return;
    app.update((s) => {
      s.consumption = false; // null이 아니라 false: 다시 열어도 내장 모델로 되돌아가지 않게
      s.ui.countOnlyCheck = false;
    });
  },
  'model-restore'(el, e, app) {
    const m = builtinModel();
    if (!m) return app.toast('내장 소비 모델이 없습니다');
    app.update((s) => {
      s.consumption = m;
    });
    app.toast('내장 소비 모델을 다시 사용합니다');
  },
  'apikey-toggle'(el) {
    const input = document.getElementById('api-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
    el.textContent = input.type === 'password' ? '보기' : '숨김';
  },
  'backup-export'(el, e, app) {
    downloadBackup(app, exportJSON(app.state));
  },
  'backup-undo'(el, e, app) {
    const prev = loadSafetyCopy();
    if (!prev) return app.toast('되돌릴 상태가 없습니다');
    if (!confirm('마지막 백업 불러오기 전 상태로 되돌릴까요?')) return;
    app.update((s) => Object.assign(s, prev, { ui: s.ui }));
    app.toast('되돌렸습니다');
  },
  'data-wipe'(el, e, app) {
    if (!confirm('모든 품목·기록·설정을 지우고 처음 상태로 돌릴까요? 되돌릴 수 없습니다.')) return;
    if (!confirm('정말로 초기화합니다. 계속할까요?')) return;
    app.update((s) => {
      const fresh = defaultState();
      fresh.ui.tab = 'settings';
      Object.assign(s, fresh);
    });
    app.toast('초기화했습니다');
  },
};
