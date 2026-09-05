// 확인 목록: 자료에 없어 비워 둔 값들. 분석 보고서 3장과 별도 PDF(scripts/checklist-pdf.mjs)가 같이 쓴다.
// a = data/analysis.json 내용. 숫자는 "지금 집계된 양(참고)"로만 쓰고, 값 자체는 사용자가 채운다.

const n0 = (x) => (x == null || Number.isNaN(x) ? '' : Math.round(x).toLocaleString('ko-KR'));

export function buildChecklist(a) {
  const item = (id) => (a.items || []).find((r) => r.itemId === id);
  const raw = (id, unit) => (item(id) ? `${n0(item(id).totalRaw)}${unit}/년` : '');
  const unmapped = a.unmapped || [];
  const cups = (re) => n0(unmapped.filter((u) => re.test(u.product)).reduce((x, u) => x + u.total, 0));
  const kids = n0(Object.values(a.brunchKids || {}).reduce((x, y) => x + y, 0));
  const beans = item('beans');
  const beansNow = beans ? `${n0(beans.totalRaw)}샷/년${beans.totalDecafRaw ? ` (디카페인 ${n0(beans.totalDecafRaw)}샷 포함)` : ''}` : '';

  return [
    {
      key: 'package',
      title: '가. 포장 1개에 든 양 (이 값이 있어야 "몇 개 남았나"로 바꿀 수 있습니다)',
      head: ['품목', '알려 주실 값', '지금 집계된 양 (참고)'],
      rows: [
        ['원두 / 디카페인 원두', '에스프레소 1샷(40ml)에 드는 원두 g, 1봉 무게', beansNow],
        ['바닐라시럽', '모닌 1L 병이 몇 g인지 (또는 1펌프가 몇 ml인지)', raw('vanilla-syrup', 'g')],
        ['카페시럽', '1.5L 병이 몇 g인지', raw('cafe-syrup', 'g')],
        ['카라멜시럽', '750ml 병이 몇 g인지', raw('caramel-syrup', 'g')],
        ['카라멜소스', '1.89L 병이 몇 g인지', raw('caramel-sauce', 'g')],
        ['보성그린티 베이스', '1L 병이 몇 g인지', raw('boseong-green-tea', 'g')],
        ['헤이즐넛 시럽', '병 용량, 1펌프가 몇 ml인지', raw('hazelnut-syrup', '펌프')],
        ['딸기청', '1단지 무게', raw('strawberry-cheong', 'g')],
        ['블루베리청', '1단지 무게', raw('blueberry-cheong', 'g')],
        ['배도라지차', '470g 병이 맞는지, 1박스에 몇 병인지 (시트 기준 "2BOX")', raw('pear-bellflower-tea', 'g')],
        ['디카페인 콜드브루', '1봉 무게', raw('decaf-coldbrew', 'g')],
        ['미숫가루', '1봉 무게', raw('misugaru', 'g')],
        ['탄산수', '1병 용량, 발주 단위(병/박스), 박스당 병 수', item('sparkling-water') ? `${n0(item('sparkling-water').totalRaw / 1000)}L/년` : ''],
        ['시나몬가루', '1잔에 뿌리는 양(g)', raw('cinnamon-powder', '잔')],
        ['오렌지가니쉬', '1포장에 몇 조각', raw('orange-garnish', '개')],
        ['대추', '1포장 개수 또는 무게', raw('jujube', '개')],
        ['잣', '1포장 개수 또는 무게', raw('pine-nut', '개')],
        ['아이스크림', '1통에서 몇 스쿱', raw('ice-cream', '스쿱')],
        ['토마토', '1박스 무게', raw('tomato', 'g')],
        ['키위', '1박스 무게 (또는 개수와 1개 무게)', raw('kiwi', 'g')],
        ['크림우유', '크림우유 1잔(180g)에 우유가 몇 ml 들어가는지', ''],
      ],
    },
    {
      key: 'mapping',
      title: '나. 상품·재료 연결 (어느 품목인지 몰라 비워 둔 것)',
      head: ['POS 상품 / 재료', '알려 주실 것', '지금 집계된 양 (참고)'],
      rows: [
        ['노아주스', '오렌지·당근·망고·키위 중 무엇이 팔리는지 (대략 비율)', `${cups(/^노아주스$/)}병/년`],
        ['어린이 사과주스', '재고 시트의 어느 품목인지 (달콤사과?)', `${cups(/어린이 사과주스/)}병/년`],
        ['브런치어린이', '1인분의 몇 분의 몇인지', `${kids}건/년`],
        ['에스프레소 싱글 / 더블', '싱글 1샷·더블 2샷이 맞는지', ''],
        ['유자차', '레시피 (유자청 몇 g, 가니쉬)', `${cups(/유자차/)}잔/년`],
        ['설국차', '레시피', `${cups(/설국차/)}잔/년`],
        ['애플피치 · 레몬블랙티 · 대추차(ICE)', '레시피', `${cups(/애플피치|레몬블랙티|대추차 ice/)}잔/년`],
        ['레몬 가니쉬 (건조레몬)', '시트 1 "레몬"(주스 칸)과 시트 2 "레몬"(시럽 칸) 중 어느 것인지, 1봉에 몇 조각', ''],
        ['"가니쉬"라고만 적힌 레시피', '어떤 가니쉬인지 (오렌지? 레몬?)', ''],
        ['병음료 기준 "1"', '골든메달·노아·에비앙·달콤사과·착즙포도의 시트 기준이 병인지 박스인지, 박스당 병 수', item('golden-apple-juice') ? `골든메달 ${n0(item('golden-apple-juice').totalUnits)}병/년` : ''],
        ['쏘스윗업 레몬·자몽·청포도 시럽, 배도라지 액상차', '구매표에 ◇(제품명·가격 확인) 표시 — 실제 쓰는 제품과 용량', ''],
      ],
    },
    {
      key: 'sheet',
      title: '다. 재고 시트에서 불분명했던 것',
      head: ['항목', '알려 주실 것', ''],
      rows: [
        ['레몬 2종', '시트 1 "레몬"(주스 칸)과 시트 2 "레몬"(시럽 칸)이 같은 품목인지 (앱에는 따로 넣어 둠)', ''],
        ['각주 "유자·청귤 최소발주 6○○"', '6 뒤의 단위 (개? 박스?)', ''],
        ['원두 / 디카페인 원두', '시트처럼 한 줄로 세는지, 따로 세는지', ''],
        ['발주 단위 표기', '"(1box>6)" 표기가 없는 품목 중 박스로 발주하는 것이 더 있는지', ''],
      ],
    },
    {
      key: 'decision',
      title: '라. 결정해 주실 것 (기획안에서 남은 항목)',
      head: ['항목', '선택지', ''],
      rows: [
        ['직원들이 같은 데이터를 쓰는 방식', '각자 휴대폰 + 백업 파일로 옮기기 / 공유 저장소(계정 필요)', ''],
        ['재발주 카드', '전 품목 / 자주 떨어지는 품목만 / 안 함', ''],
        ['POS 자료 내보내기 주기', '월 1회 / 주 1회', ''],
      ],
    },
  ];
}
