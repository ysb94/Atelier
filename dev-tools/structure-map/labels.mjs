import path from 'node:path'
import ts from 'typescript'

// A reusable vocabulary, not a hand-maintained list of the project's files.
// Unrecognized words are reported in details rather than presented as verified meaning.
const vocabulary = {
  invoice: '송장', work: '작업', product: '상품', products: '상품', style: 'SKU', styles: '상품·M번호(SKU)',
  name: '이름', item: '항목', items: '항목', map: '매핑', maps: '매핑', rule: '규칙', rules: '규칙',
  accessory: '부속품', gift: '사은품', option: '옵션', prefix: '접두어', preorder: '예약 주문',
  hold: '보류', holds: '보류', discontinued: '단종', packing: '포장', size: '크기', picking: '피킹',
  route: '동선', routes: '화면 경로', preset: '프리셋', presets: '프리셋', exclusions: '제외 기준',
  exclusion: '제외 기준', tag: '태그', tags: '태그', roles: '역할', role: '역할',
  warehouse: '창고', temporary: '임시', inventory: '재고', stock: '재고', finder: '찾기', slot: '칸',
  cargo: '화물', inbound: '입고', outbound: '출고', bulk: '일괄', unload: '하차', stow: '적재', tidy: '정리',
  inspection: '검수', check: '점검', checks: '점검', resolution: '확정', unresolved: '미확정',
  barcode: '바코드', partner: '업체', partners: '업체', code: '코드', codes: '코드', sabangnet: '사방넷',
  mall: '쇼핑몰', urls: '주소', url: '주소', fields: '필드', field: '필드', info: '정보',
  usage: '사용처', targets: '대상', target: '대상', assignments: '배정', assigned: '배정',
  draft: '기획안', drafts: '기획안', release: '출시', schedule: '일정', sample: '샘플', flow: '흐름',
  empty: '초기값', company: '회사', brand: '브랜드', brands: '브랜드', department: '부서',
  approvers: '결재자', approver: '결재자', leave: '휴가', approval: '승인', attendance: '근태',
  clocks: '출퇴근 기록', clock: '출퇴근 기록', start: '시작', settings: '설정', personal: '개인',
  requests: '요청', request: '요청', accept: '수락', assign: '배정', completed: '완료', team: '팀',
  scratch: '메모', todos: '할 일', todo: '할 일', self: '내', my: '내', monthly: '월별', korean: '한국',
  holidays: '공휴일', ops: '운영지원', operations: '운영', support: '지원', stat: '통계',
  chat: '채팅', room: '대화방', rooms: '대화방', thread: '대화 내용', message: '메시지',
  attachment: '첨부 파일', composer: '메시지 작성', contact: '연락처', people: '사람', avatar: '프로필 표시',
  new: '새', sending: '전송', outgoing: '전송', send: '보내기', realtime: '실시간 갱신', window: '창',
  home: '홈', calendar: '달력', day: '날짜', events: '일정', meetings: '회의', meeting: '회의', slots: '시간대',
  org: '조직', chart: '차트', directory: '명부', members: '구성원', profiles: '프로필', profile: '프로필',
  auth: '인증', login: '로그인', access: '접근 권한', legal: '실명', confirmation: '확인', pending: '대기',
  ai: 'AI', candidates: '후보', gateway: '호출 게이트웨이', learning: '학습', recommend: '추천',
  md: 'MD', price: '가격', compare: '비교', refresh: '갱신', search: '검색', evidence: '근거', event: '행사',
  design: '디자인', styled: '착장', studio: '스튜디오', cuts: '컷', image: '이미지', images: '이미지',
  photo: '사진', library: '보관함', generation: '생성', progress: '진행 상태', processing: '가공',
  preview: '미리보기', timing: '소요 시간', batch: '묶음', job: '작업', polling: '상태 조회', director: '연출',
  file: '파일', files: '파일', manager: '관리', grid: '격자 목록', explorer: '탐색기', server: '서버',
  tree: '계층', sidebar: '사이드바', topbar: '상단 바', toolbar: '도구 모음', context: '문맥', menu: '메뉴',
  history: '이력', upload: '업로드', queue: '대기열', cleanup: '정리', extract: '추출', label: '라벨',
  from: '', firebase: '외부 재고', onhand: '보유 재고', sheet: '시트', sheets: '시트', table: '표',
  data: '데이터', import: '가져오기', export: '내보내기', workbook: '통합문서', ooxml: '엑셀 형식',
  spreadsheet: '스프레드시트', parse: '파싱', sort: '정렬', transform: '변환', normalization: '정규화',
  lookup: '조회', aliases: '별칭', match: '매칭', matching: '매칭', resolve: '해결', suggest: '추천',
  source: '기준', unified: '통합', confirm: '확정', diversity: '분산', allocations: '배정',
  criteria: '기준', order: '주문', key: '키', keys: '키', output: '출력', review: '검수', compute: '계산',
  worker: '백그라운드 처리', fixtures: '예제 데이터', cases: '사례', perf: '성능 계측', pipeline: '처리 흐름',
  thresholds: '임계값', ledger: '원장', manage: '관리', reflect: '반영', summary: '요약', paste: '붙여넣기',
  composition: '구성', components: '구성품', date: '날짜', time: '시간', list: '목록', shape: '구조', print: '인쇄', parts: '구성 요소', patterns: '패턴',
  instruction: '작업 지시', instructions: '작업 지시', row: '행', rows: '행', template: '양식',
  entry: '입력', single: '단건', form: '입력', filter: '필터', category: '분류', categories: '분류',
  season: '시즌', seasons: '시즌', select: '선택', picker: '선택', thumb: '썸네일', detail: '상세',
  load: '불러오기', set: '묶음', board: '보드', folder: '폴더', folders: '폴더', hub: '허브',
  header: '헤더', actions: '동작', nav: '메뉴', layout: '배치', tabs: '탭', tab: '탭',
  workspace: '작업 공간', activity: '활성 상태', gate: '접근 제어', scope: '범위', pick: '선택', notification: '알림',
  loading: '로딩', overlay: '화면 덮개', developer: '개발자', capabilities: '권한', person: '사람',
  permission: '권한', permissions: '권한', grant: '지정', grants: '지정 내역',
  legacy: '기존 호환', rollout: '전환', recovery: '복구',
  query: '조회', queries: '조회', cache: '캐시', paged: '페이지별', client: '연결 클라이언트',
  error: '오류', format: '형식', mock: '예제', types: '타입', type: '타입', utils: '공통 유틸리티',
  debug: '진단', flags: '스위치', watch: '감시', render: '렌더', sync: '동기화', box: '박스',
  lifecycle: '상태 관리', preferences: '환경설정', display: '표시', browser: '탐색', document: '문서',
  shops: '쇼핑몰', text: '텍스트', web: '웹', core: '핵심 로직', handler: '요청 처리', cors: '교차 출처 설정',
  ean: 'EAN 바코드', signature: '중복 판별 키', numbers: '번호', no: '번호',
  add: '추가', edit: '편집', delete: '삭제', activate: '활성화', identity: '식별 정보', unit: '단위',
  quick: '빠른', extras: '추가 항목', guarded: '확인 보호', recent: '최근', saves: '저장 이력',
  save: '저장', backed: '백업', up: '', idle: '미처리', collect: '수집',
  step: '단계', steps: '단계', panel: '패널', panels: '패널', controller: '작업 제어', page: '화면', dialog: '대화상자', modal: '대화상자', drawer: '상세창',
  popover: '팝업', bar: '바', editor: '편집', input: '입력', node: '항목', view: '보기',
  lines: '행 목록', tone: '색상', seed: '초기 기준',
  button: '버튼', badge: '상태 표시', card: '카드', ui: '화면 요소', app: '앱', main: '실행 시작',
  config: '설정', columns: '열', uses: '사용', assistant: '도우미', or: '또는', api: '공개 API',
  site: '지점', setup: '설정', combo: '복합', qr: 'QR', title: '제목', browse: '탐색',
  collection: '수집', operation: '운영', lists: '목록', diagnostics: '진단', shipment: '출고',
  index: '색인', groups: '그룹', shipments: '출고', paths: '경로',
}
const phrases = {
  'product name': '상품명', 'item name': '내품명', 'style no': 'M번호(SKU)', 'style name': 'SKU 이름',
  'work request': '작업 요청', 'work order': '작업 지시서', 'work instruction': '작업 지시',
  'file manager': '파일 관리', 'product list': '품목 리스트', 'product code': '상품 코드',
  'stock hold': '재고 보류', 'packing size': '포장 크기', 'quick entry': '빠른 입력',
  'lookup key': '조회 키', 'clock in': '출근', 'clock out': '퇴근', 'start settings': '시작 기준 설정',
  'name transform': '이름 변환', 'data entry': '데이터 입력', 'line list': '행 목록',
  'use': '', 'apply': '적용', 'form config': '입력 양식 설정', 'row key': '행 식별 키',
  'query keys': '조회 캐시 키', 'save queue': '저장 대기열', 'backed up': '백업',
  'work instructions': '작업 지시', 'quick slots': '빠른 입력 슬롯',
  'pending approval': '승인 대기',
  'overlay host': '팝업 표시 위치',
  'meeting attendance': '회의 참석 응답',
  'open conversation': '대화 열기',
}
const korean = value => /[가-힣]/.test(value ?? '')
const clean = value => value.replace(/\s+/g, ' ').trim()
function words(value) {
  return value.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[^a-zA-Z\d]+/g, ' ').toLowerCase().trim().split(/\s+/)
}
export function translateName(value) {
  const tokens = words(value), translated = [], unknown = []
  for (let i = 0; i < tokens.length;) {
    let found = false
    for (let size = Math.min(3, tokens.length - i); size >= 1; size--) {
      const key = tokens.slice(i, i + size).join(' ')
      if (Object.hasOwn(phrases, key)) { translated.push(phrases[key]); i += size; found = true; break }
    }
    if (found) continue
    const token = tokens[i++]
    if (Object.hasOwn(vocabulary, token)) translated.push(vocabulary[token])
    else unknown.push(token)
  }
  return { text: clean(translated.filter(Boolean).join(' ')), unknown }
}
function staticText(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) return clean(node.text)
  if (ts.isJsxExpression(node)) return staticText(node.expression)
  if (ts.isJsxElement(node)) {
    const parts = node.children.map(staticText)
    return parts.some(p => p === null) ? null : clean(parts.join(' '))
  }
  return null
}
function headings(sf, stem) {
  const candidates = []
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf)
      let owner = node.parent, depth = 0
      while (owner && !ts.isFunctionLike(owner)) { if (ts.isJsxElement(owner)) depth++; owner = owner.parent }
      const ownerName = owner?.name?.getText(sf) ?? (owner?.parent && ts.isVariableDeclaration(owner.parent) ? owner.parent.name.getText(sf) : null)
      // Ignore titles of helper dialogs/components defined earlier in the same module.
      if (ownerName && ownerName !== stem && !owner?.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return
      const attribute = name => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === name)?.initializer
      let label = null, description = null, rank = 99
      if (tag === 'PageHeader') { label = staticText(attribute('title')); description = staticText(attribute('description')); rank = 0 }
      if (ts.isJsxElement(node.parent) && /^(h1|h2|DialogTitle|CardTitle)$/.test(tag) && (tag !== 'DialogTitle' || /Dialog|Modal|Drawer|Popover/.test(stem))) {
        label = staticText(node.parent)
        rank = tag === 'h1' ? 2 : tag === 'h2' ? 3 : tag === 'DialogTitle' ? 4 : 5
        const siblings = node.parent.parent?.children
        const next = siblings?.slice(siblings.indexOf(node.parent) + 1).find(n => !(ts.isJsxText(n) && !clean(n.text)))
        if (next && ts.isJsxElement(next) && next.openingElement.tagName.getText(sf) === 'p') description = staticText(next)
      }
      if (korean(label) && label.length <= 60) candidates.push({ label, description: korean(description) && description.length <= 220 ? description : null, rank, depth, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return candidates.sort((a, b) => a.depth - b.depth || a.rank - b.rank || a.line - b.line)
}
function inferredRole(node) {
  const file = node.path, basename = path.basename(file)
  if (node.layer === 'store') {
    const names = node.exports.map(e => e.name)
    const operations = [
      [/^(get|fetch|list|load|search|find)/i, '조회'],
      [/^(create|insert|upsert|save|update|set|replace|add|ensure)/i, '등록·수정'],
      [/^(delete|remove|clear)/i, '삭제'],
    ].filter(([pattern]) => names.some(n => pattern.test(n))).map(([, label]) => label)
    return ['데이터 접근', operations.length ? `공개 함수 이름 기준으로 관련 데이터의 ${operations.join(', ')} 처리를 묶습니다.` : '관련 데이터를 다루는 접근 코드를 제공합니다.']
  }
  if (node.layer === 'server') return ['서버 처리', '서버에서 요청을 처리하거나 서버 공통 로직을 제공합니다.']
  if (/worker(?:\.|-)/i.test(basename)) return ['백그라운드 처리', '별도 작업 스레드에서 계산·파싱을 처리합니다.']
  if (/^use.*Criteria\./.test(basename)) return ['기준 조회', '관련 기준 데이터의 조회·활성화 조건·캐시 정책을 훅으로 묶습니다.']
  if (/^use.*Controller\./.test(basename)) return ['작업 제어', '관련 상태·계산·단계 이동·작업 실행을 훅으로 제어합니다.']
  if (/^use[-A-Z]/.test(basename)) return ['상태 관리', '관련 조회·상태·작업 흐름을 훅으로 묶습니다.']
  if (/types?\.[^.]+$/.test(basename)) return ['타입 정의', '관련 데이터의 타입과 구조를 정의합니다.']
  if (/\.tsx$/.test(basename)) {
    if (/(Dialog|Modal|Drawer|Popover)\./.test(basename)) return ['입력·확인 창', '관련 입력·확인을 위한 창을 구성합니다.']
    if (/Table\./.test(basename)) return ['표 표시', '관련 데이터를 표로 보여주는 화면 요소를 구성합니다.']
    if (/Form\./.test(basename)) return ['입력 양식', '관련 값을 입력하는 양식을 구성합니다.']
    if (/Panel\./.test(basename)) return ['기능 패널', '관련 작업을 묶어 보여주는 패널을 구성합니다.']
    if (/Page\./.test(basename)) return ['진입 화면', '해당 기능으로 들어오는 페이지를 구성합니다.']
    return ['화면 구성', '관련 화면과 사용자 조작 요소를 구성합니다.']
  }
  const tokens = words(basename.replace(/\.[^.]+$/, ''))
  for (const [pattern, roleType, description] of [
    [/parse/, '데이터 파싱', '입력 형식을 읽어 코드에서 다룰 수 있는 데이터로 해석합니다.'],
    [/transform|normalization/, '데이터 변환', '관련 입력값의 변환·정규화 로직을 제공합니다.'],
    [/import/, '가져오기 처리', '외부 데이터를 가져오는 처리를 묶습니다.'],
    [/export|print/, '내보내기·인쇄', '관련 데이터를 내보내거나 출력하는 처리를 묶습니다.'],
    [/match|matching|resolve|resolution/, '기준 대조', '관련 기준과 입력을 대조하는 로직을 제공합니다.'],
    [/perf|watch|timing/, '진단·계측', '관련 작업의 상태나 소요 시간을 관찰하는 코드를 제공합니다.'],
    [/sort/, '정렬 처리', '관련 데이터의 순서를 정하는 로직을 제공합니다.'],
    [/types|config|template/, '정의·설정', '관련 구조·설정·기본 양식을 정의합니다.'],
  ]) if (tokens.some(t => pattern.test(t))) return [roleType, description]
  return ['업무 로직', '관련 계산·변환·공통 처리 함수를 제공합니다.']
}

export function describeFile(node, sf, { routes, nav, domain }) {
  const fileName = path.basename(node.path)
  // For index.ts, the containing directory supplies the actual subject.
  let stem = fileName.replace(/\.[^.]+$/, '')
  if (stem === 'index') stem = node.path.split('/').at(-2)
  if (stem === '_shared') stem = 'server core'
  const translated = translateName(stem)
  if (node.path.includes('/invoice/') || /Invoice/.test(stem) || /^invoice-/.test(stem)) translated.text = translated.text.replaceAll('상품명', '품목명')
  const candidates = headings(sf, stem)
  const route = routes.find(r => r.targets.includes(node.id) && r.labels.length)
  const menu = route && nav.find(n => route.labels.some(label => label.endsWith(` · ${n.label}`)))
  const shallow = candidates.filter(c => c.depth === candidates[0]?.depth)
  const heading = shallow.length === 1 && (shallow[0].rank < 5 || candidates.length === 1) ? shallow[0] : null
  const primary = candidates.find(c => c.rank === 0) ?? (menu ? { label: menu.label, line: menu.line, file: menu.file, rank: 1 } : heading)
  const [roleType, template] = inferredRole(node)
  const inferredName = translated.unknown.length ? `${domain?.label ?? '미분류'} · ${translated.text || roleType}` : translated.text
  const label = primary?.label ?? inferredName
  // The title/intro is observed in source; role templates and filename translations are explicitly inferred.
  const role = primary?.description ?? `「${label}」 기능: ${template}`
  return {
    fileName, label, role, roleType, roleSummary: primary?.description ?? template,
    labelSource: primary ? primary.rank === 1 ? '메뉴명에서 자동 추출' : '화면 제목에서 자동 추출' : '코드 이름에서 추정',
    roleSource: primary?.description ? '화면 안내 문구에서 자동 추출' : '코드 이름·위치·종류·공개 함수 이름에서 추정',
    labelEvidence: primary ? { file: primary.file ?? node.path, line: primary.line } : null,
    sections: [...new Set(candidates.map(c => c.label))].slice(0, 8),
    untranslated: translated.unknown,
  }
}
