/**
 * 출고업체 압축 키·상태 판정·붙여넣기 파싱 검증.
 * 실행: npm run verify:outbound-partner
 */
import {
  activateFolderSelectValue,
  canActivateOutboundPartner,
  compactOutboundPartnerKey,
  isOutboundPartnerIncomplete,
  matchesOutboundPartnerSearch,
  normalizeOutboundPartnerName,
  outboundPartnerActivateGaps,
  outboundPartnerStatus,
  parseActivateFolderValue,
  parseOutboundPartnerPaste,
} from './outbound-partner'
import {
  buildFolderForest,
  canCreateChildFolder,
  descendantFolderIds,
  folderMoveOptions,
  folderPathLabel,
  wouldCreateFolderCycle,
} from './outbound-folder'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// 압축 키: 띄어쓰기·괄호·대소문자 차이를 흡수한다.
assert(
  compactOutboundPartnerKey('무신사 제주') ===
    compactOutboundPartnerKey('무신사제주'),
  '띄어쓰기만 다른 업체명은 같은 키여야 한다',
)
assert(
  compactOutboundPartnerKey('29CM') === compactOutboundPartnerKey('29cm'),
  '영문 대소문자는 같은 키여야 한다',
)
assert(
  compactOutboundPartnerKey('２９ＣＭ') === compactOutboundPartnerKey('29CM'),
  '전각 문자는 NFKC로 접어야 한다',
)
assert(
  compactOutboundPartnerKey('29CM 풀필먼트') === '29cm풀필먼트',
  'DB 백필과 같은 결과를 내야 한다',
)
assert(
  compactOutboundPartnerKey('!!!') === '',
  '글자·숫자가 없으면 빈 키여야 한다',
)
assert(
  compactOutboundPartnerKey('무신사') !== compactOutboundPartnerKey('무신사몰'),
  '다른 업체명이 같은 키로 합쳐지면 안 된다',
)

assert(
  normalizeOutboundPartnerName('  무신사   제주  ') === '무신사 제주',
  '표시용 이름은 앞뒤·연속 공백만 접는다',
)

// 상태: active와 isOneTime 조합이 세 상태를 만든다.
function target(patch: Partial<CodeUsageTarget> = {}): CodeUsageTarget {
  return {
    id: 'id-1',
    brandId: 'brand-1',
    name: '무신사',
    normalizedName: '무신사',
    active: true,
    isOneTime: false,
    channelType: 'online',
    shippingMethod: 'parcel',
    folderId: null,
    note: '',
    order: 0,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    ...patch,
  }
}

assert(
  outboundPartnerStatus(target()) === 'ongoing',
  '활성·상시 업체는 거래중이다',
)
assert(
  outboundPartnerStatus(target({ isOneTime: true })) === 'one_time',
  '활성·단발성 업체는 단발성이다',
)
assert(
  outboundPartnerStatus(target({ active: false })) === 'archived',
  '비활성 업체는 archived다',
)
assert(
  outboundPartnerStatus(target({ active: false, isOneTime: true })) ===
    'archived',
  '비활성이 단발성보다 앞선다',
)

assert(
  !canActivateOutboundPartner({
    name: '29CM',
    folderId: undefined,
    note: '선구매',
  }),
  '위치를 고르지 않으면 다시 켤 수 없다',
)
assert(
  !canActivateOutboundPartner({
    name: '29CM',
    folderId: null,
    note: '',
  }),
  '특징이 비면 다시 켤 수 없다',
)
assert(
  canActivateOutboundPartner({
    name: '29CM',
    folderId: null,
    note: '선구매',
  }),
  '이름·위치·특징이 있으면 미분류로도 다시 켤 수 있다',
)
assert(
  outboundPartnerActivateGaps({
    name: '',
    folderId: undefined,
    note: '',
  }).join('|') === '업체명|둘 위치|이 업체의 특징',
  '빠진 칸을 모두 알려 준다',
)
assert(
  parseActivateFolderValue('__unfiled') === null,
  '미분류 선택은 null이다',
)
assert(
  parseActivateFolderValue('') === undefined,
  '빈 값은 아직 고르지 않은 것이다',
)
assert(
  activateFolderSelectValue(undefined) === '',
  '아직 고르지 않으면 선택 칸이 비어 있다',
)

assert(
  isOutboundPartnerIncomplete(target({ channelType: 'unset' })),
  '판매 성격이 비면 분류 필요다',
)
assert(
  isOutboundPartnerIncomplete(target({ shippingMethod: 'unset' })),
  '출고 방식이 비면 분류 필요다',
)
assert(
  !isOutboundPartnerIncomplete(target()),
  '두 분류가 모두 있으면 분류 필요가 아니다',
)

// 검색: 정식명과 별칭 모두 걸린다.
assert(
  matchesOutboundPartnerSearch('무신사', target(), []),
  '정식명으로 검색되어야 한다',
)
assert(
  matchesOutboundPartnerSearch('mss', target(), ['MSS']),
  '별칭으로도 검색되어야 한다',
)
assert(
  matchesOutboundPartnerSearch('주 무신사', target(), ['(주)무신사']),
  '별칭 검색도 띄어쓰기를 무시한다',
)
assert(
  !matchesOutboundPartnerSearch('29cm', target(), ['MSS']),
  '관계없는 검색어는 걸리지 않는다',
)
assert(
  matchesOutboundPartnerSearch('   ', target(), []),
  '빈 검색어는 모두 통과시킨다',
)

// 붙여넣기: 한 줄 = 업체 하나, 첫 구분자 뒤는 별칭이다.
const basic = parseOutboundPartnerPaste(
  ['무신사 / MSS, (주)무신사', '29CM', '', '면세점\t듀프리'].join('\n'),
)
assert(basic.rows.length === 3, '빈 줄은 건너뛰고 3곳을 읽어야 한다')
assert(basic.rows[0]?.name === '무신사', '첫 업체명은 무신사다')
assert(
  basic.rows[0]?.aliases.join('|') === 'MSS|(주)무신사',
  '슬래시 뒤 쉼표 목록을 별칭으로 읽는다',
)
assert(basic.rows[1]?.aliases.length === 0, '별칭이 없으면 빈 배열이다')
assert(
  basic.rows[2]?.name === '면세점' && basic.rows[2]?.aliases[0] === '듀프리',
  '엑셀 탭 구분도 이름과 별칭으로 나눈다',
)
assert(basic.issues.length === 0, '정상 목록에는 문제가 없다')

const dupInPaste = parseOutboundPartnerPaste(['무신사', '무 신사'].join('\n'))
assert(dupInPaste.rows.length === 1, '붙여넣기 안 중복은 한 번만 등록한다')
assert(
  dupInPaste.issues[0]?.reason === 'duplicate_in_paste',
  '중복 줄은 사유와 함께 남긴다',
)

const dupExisting = parseOutboundPartnerPaste('29CM', ['29cm'])
assert(dupExisting.rows.length === 0, '이미 등록된 업체는 건너뛴다')
assert(
  dupExisting.issues[0]?.reason === 'duplicate_existing',
  '기존 중복도 사유를 남긴다',
)

const emptyName = parseOutboundPartnerPaste('!!! / 별칭')
assert(emptyName.rows.length === 0, '읽을 수 없는 업체명은 등록하지 않는다')
assert(
  emptyName.issues[0]?.reason === 'empty_name',
  '업체명을 읽지 못한 줄은 사유를 남긴다',
)

const selfAlias = parseOutboundPartnerPaste('무신사 / 무 신사, MSS')
assert(
  selfAlias.rows[0]?.aliases.join('|') === 'MSS',
  '정식명과 같은 별칭은 넣지 않는다',
)

const dupAlias = parseOutboundPartnerPaste('무신사 / MSS, m s s')
assert(
  dupAlias.rows[0]?.aliases.length === 1,
  '같은 키의 별칭은 한 번만 남긴다',
)

function folder(
  patch: Partial<CodeUsageTargetFolder> & Pick<CodeUsageTargetFolder, 'id' | 'name' | 'parentId'>,
): CodeUsageTargetFolder {
  return {
    brandId: 'brand-1',
    normalizedName: patch.name.replace(/\s+/g, ''),
    order: 0,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
    ...patch,
  }
}

const online = folder({ id: 'f-online', name: '온라인', parentId: null })
const direct = folder({ id: 'f-direct', name: '직접배송', parentId: 'f-online' })
const sabang = folder({ id: 'f-sabang', name: '사방넷', parentId: 'f-direct' })
const extra = folder({ id: 'f-extra', name: '추가', parentId: 'f-sabang' })
const tree = [online, direct, sabang, extra]

const forest = buildFolderForest(tree)
assert(forest.length === 1 && forest[0]?.name === '온라인', '루트는 온라인 하나다')
assert(
  forest[0]?.children[0]?.children[0]?.name === '사방넷',
  '온라인 > 직접배송 > 사방넷 순이어야 한다',
)
assert(
  folderPathLabel(tree, 'f-sabang') === '온라인 / 직접배송 / 사방넷',
  '경로 표시는 슬래시로 잇는다',
)
assert(
  folderPathLabel(tree, null) === '미분류',
  '폴더가 없으면 미분류다',
)
assert(
  wouldCreateFolderCycle(tree, 'f-online', 'f-sabang'),
  '하위로 옮기면 순환이다',
)
assert(
  !wouldCreateFolderCycle(tree, 'f-sabang', null),
  '루트로 올리는 것은 순환이 아니다',
)
assert(
  descendantFolderIds(tree, 'f-online').size === 3,
  '온라인 아래 폴더는 세 개다',
)
assert(
  canCreateChildFolder(tree, 'f-sabang'),
  '3단 아래에는 한 단 더 만들 수 있다',
)
assert(
  !canCreateChildFolder(tree, 'f-extra'),
  '4단 아래에는 더 만들지 못한다',
)
assert(
  folderMoveOptions(tree).some(
    (option) => option.label === '온라인 / 직접배송 / 사방넷',
  ),
  '이동 목록은 경로로 보여 준다',
)

console.log('outbound-partner: 모든 검증을 통과했습니다.')
