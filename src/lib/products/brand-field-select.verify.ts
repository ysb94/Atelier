/**
 * 선택형 항목 정규화·별칭·업로드 검증.
 * 실행: npm run verify:brand-field-select
 */
import { getStyleFieldDisplay } from '@/lib/products/style-fields'
import {
  applySelectDisplay,
  formatSelectImportError,
  listActiveSelectOptions,
  normalizeSelectOptionLabel,
  prepareSelectOptionSave,
  resolveSelectOptionLabel,
  withRenameAlias,
} from '@/lib/products/brand-field-select'
import { prepareRows } from '@/lib/import/transform'
import type { BrandField, BrandFieldOption, Season, Style } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function option(
  partial: Partial<BrandFieldOption> & Pick<BrandFieldOption, 'id' | 'label'>,
): BrandFieldOption {
  return {
    brandId: 'brand',
    fieldId: 'field-pack',
    aliases: [],
    sortOrder: 0,
    isActive: true,
    ...partial,
  }
}

const packField: BrandField = {
  id: 'field-pack',
  brandId: 'brand',
  label: '포장 유형',
  systemKey: null,
  type: 'select',
  owner: 'logistics',
  required: false,
  order: 1,
  level: 'style',
  options: [
    option({
      id: 'opt-box',
      label: '상자',
      aliases: ['박스', 'Box'],
      sortOrder: 0,
    }),
    option({
      id: 'opt-bag',
      label: '폴리백',
      sortOrder: 1,
    }),
    option({
      id: 'opt-old',
      label: '예전포장',
      sortOrder: 2,
      isActive: false,
    }),
  ],
}

const categoryField: BrandField = {
  id: 'field-cat',
  brandId: 'brand',
  label: '카테고리',
  systemKey: 'category',
  type: 'select',
  owner: 'planning',
  required: false,
  order: 0,
  level: 'style',
  options: [
    option({
      id: 'opt-outer',
      fieldId: 'field-cat',
      label: '아우터',
      aliases: ['outer'],
    }),
  ],
}

const styleNoField: BrandField = {
  id: 'field-style',
  brandId: 'brand',
  label: '품번',
  systemKey: 'styleNo',
  type: 'text',
  owner: 'common',
  required: true,
  order: 0,
  level: 'style',
  options: [],
}

const season: Season = {
  id: 'season-1',
  brandId: 'brand',
  code: '26SS',
  name: '26 봄여름',
  releaseTiming: '',
  year: 2026,
  status: 'active',
}

const emptyStyle: Style = {
  id: 'style-1',
  brandId: 'brand',
  seasonId: season.id,
  styleNo: 'AT-001',
  name: '테스트',
  category: '미분류',
  gender: 'U',
  colors: [],
  targetCost: null,
  plannedQty: null,
  retailPrice: null,
  status: 'draft',
  thumbnailColor: '',
  values: {},
  customFields: { '포장 유형': '박스' },
}

assert(
  normalizeSelectOptionLabel('  박  스  ') === '박 스',
  '공백을 줄이고 소문자로 맞춘다',
)
assert(
  resolveSelectOptionLabel(packField, 'box') === '상자',
  '별칭은 현재 선택명으로 해석한다',
)
assert(
  resolveSelectOptionLabel(packField, '예전포장') === null,
  '사용 중지된 선택지는 새 입력에서 거부한다',
)
assert(
  resolveSelectOptionLabel(packField, '예전포장', { includeInactive: true }) ===
    '예전포장',
  '표시는 사용 중지된 기존값도 유지한다',
)
assert(
  listActiveSelectOptions(packField).map((item) => item.label).join(',') ===
    '상자,폴리백',
  '활성 선택지만 입력 목록에 쓴다',
)
assert(
  applySelectDisplay(packField, 'Box') === '상자',
  '표시는 별칭을 현재 이름으로 보여 준다',
)

const prepared = prepareSelectOptionSave([
  { label: '상자', sortOrder: 0, isActive: true },
  { label: ' 상자 ', sortOrder: 1, isActive: true },
])
assert(!prepared.ok, '같은 선택지 이름은 저장 전에 막는다')

const renamed = withRenameAlias(packField.options[0], {
  id: 'opt-box',
  label: '하드박스',
  sortOrder: 0,
  isActive: true,
  aliases: [],
})
assert(
  renamed.aliases?.includes('상자'),
  '이름 변경 시 이전 이름을 별칭으로 남긴다',
)

const okRows = prepareRows({
  rows: [
    ['품번', '포장 유형', '카테고리'],
    ['AT-NEW-1', '박스', 'outer'],
  ],
  fields: [styleNoField, packField, categoryField],
  existingStyles: [],
  seasons: [season],
})
assert(okRows[0]?.status === 'new', '별칭 선택값은 신규 행으로 통과한다')
assert(okRows[0]?.applied[packField.id] === '상자', '사용자 선택값은 field.id에 저장한다')
assert(okRows[0]?.applied.category === '아우터', '시스템 선택값은 기존 키에 저장한다')
assert(
  Object.keys(okRows[0]?.customFields ?? {}).length === 0,
  '알려진 사용자 필드는 custom_fields에 넣지 않는다',
)

const badRows = prepareRows({
  rows: [
    ['품번', '포장 유형'],
    ['AT-NEW-2', '오탈자'],
  ],
  fields: [styleNoField, packField],
  existingStyles: [],
  seasons: [season],
})
assert(badRows[0]?.status === 'error', '목록 밖 값은 행 오류다')
assert(
  badRows[0]?.errors[0] === formatSelectImportError(packField, '오탈자'),
  '오류에 항목명·입력값·허용값을 보여 준다',
)

assert(
  getStyleFieldDisplay(emptyStyle, packField) === '상자',
  '레거시 custom_fields 값은 읽기 폴백으로 현재 선택명을 보여 준다',
)

const unknownStyle: Style = {
  ...emptyStyle,
  values: { 'field-pack': '창고재고값' },
  customFields: {},
}
assert(
  getStyleFieldDisplay(unknownStyle, packField) === '창고재고값',
  '목록에 없는 기존값은 지우지 않고 그대로 보여 준다',
)

console.log('verify:brand-field-select ok')
