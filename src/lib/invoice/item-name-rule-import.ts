import { normalizeStyleNo } from '@/lib/import/transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceItemNameRuleInput } from '@/lib/supabase/invoice-item-name-rules'
import type {
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  StyleRef,
} from '@/lib/types'

/** 조회 키 규칙은 확정 본품 + 조회 키 exact, 공통 규칙은 내품명만 본다. */
export type InvoiceItemNameRuleImportScope = 'global' | 'lookup_key'

export type InvoiceItemNameRuleImportStatus =
  | 'new'
  | 'overwrite'
  | 'unchanged'
  | 'skip'
  | 'error'

export type PreparedInvoiceItemNameRuleRow = {
  /** 그룹의 첫 엑셀 행 번호 */
  lineNo: number
  lineNos: number[]
  scope: InvoiceItemNameRuleImportScope
  productLookupKey: string
  itemName: string
  mainStyle: StyleRef | null
  mainStyleLabel: string
  action: InvoiceItemNameRuleAction
  components: { style: StyleRef; quantity: number }[]
  note: string
  status: InvoiceItemNameRuleImportStatus
  message: string
  existingRuleId: string | null
  input: InvoiceItemNameRuleInput | null
}

export type InvoiceItemNameRuleStyleLookup = {
  byStyleNo: Map<string, StyleRef>
}

const UPLOAD_SHEET_NAME = '내품명원장'
const HEADERS = [
  '확정 본품 M번호',
  '조회 키',
  '옵션명',
  '조회 키 선택',
  '지우기',
  '구성품 M번호',
  '메모',
  '대상 행',
] as const

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'brand'
}

function headerIndex(headers: string[], aliases: string[]): number {
  const compact = headers.map((header) =>
    String(header).replace(/\s+/g, '').toLocaleLowerCase('ko-KR'),
  )
  for (const alias of aliases) {
    const key = alias.replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
    const index = compact.indexOf(key)
    if (index >= 0) return index
  }
  return -1
}

function cell(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? '').trim() : ''
}

const YES_VALUES = new Set([
  'y',
  'yes',
  'o',
  'ㅇ',
  '예',
  'v',
  '1',
  'true',
  '✓',
  '√',
  'ok',
])

/** `조회 키 선택`·`지우기` 열은 Y 한 글자만 보고 비어 있으면 아니라고 읽는다. */
function isYes(value: string): boolean {
  return YES_VALUES.has(value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR'))
}

/** `M1999,M1999,M2000`처럼 반복한 횟수가 그 M번호의 수량이 된다. */
export function splitComponentStyleNos(value: string): string[] {
  return value
    .split(/[,\n\r+/;·]+|\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const MAIN_ALIASES = ['확정 본품 M번호', '확정 본품', '본품 M번호', '본품', 'M번호']
const COMPONENT_ALIASES = ['구성품 M번호', '구성품', '구성 M번호']

export function collectInvoiceItemNameRuleStyleNos(rows: string[][]): string[] {
  if (rows.length === 0) return []
  const headers = (rows[0] ?? []).map((item) => String(item))
  const mainIdx = headerIndex(headers, MAIN_ALIASES)
  const componentIdx = headerIndex(headers, COMPONENT_ALIASES)
  const styleNos = new Set<string>()
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const main = cell(row, mainIdx)
    if (main) styleNos.add(main)
    for (const styleNo of splitComponentStyleNos(cell(row, componentIdx))) {
      styleNos.add(styleNo)
    }
  }
  return [...styleNos]
}

function resolveStyleNo(
  styleNo: string,
  lookup: InvoiceItemNameRuleStyleLookup,
): StyleRef | null {
  return (
    lookup.byStyleNo.get(normalizeStyleNo(styleNo)) ??
    lookup.byStyleNo.get(styleNo.trim().toLocaleLowerCase('ko-KR')) ??
    null
  )
}

function groupKeyOf(
  scope: InvoiceItemNameRuleImportScope,
  mainStyleNo: string,
  productLookupKey: string,
  itemName: string,
) {
  return [
    scope,
    normalizeStyleNo(mainStyleNo),
    normalizeInvoiceText(productLookupKey),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
}

function findExistingRule(
  rules: InvoiceItemNameRule[],
  scope: InvoiceItemNameRuleImportScope,
  itemName: string,
  styleId: string | null,
  productLookupKey: string,
): InvoiceItemNameRule | null {
  const item = normalizeInvoiceText(itemName)
  if (!item) return null
  if (scope === 'global') {
    return (
      rules.find(
        (rule) =>
          rule.isActive &&
          rule.scope === 'global' &&
          rule.normalizedItemName === item,
      ) ?? null
    )
  }
  const lookup = normalizeInvoiceText(productLookupKey)
  if (!styleId || !lookup) return null
  return (
    rules.find(
      (rule) =>
        rule.isActive &&
        rule.scope === 'lookup_key' &&
        rule.normalizedItemName === item &&
        rule.mainStyle?.styleId === styleId &&
        rule.normalizedProductLookupKey === lookup,
    ) ?? null
  )
}

function sameComponents(
  rule: InvoiceItemNameRule,
  components: { style: StyleRef; quantity: number }[],
) {
  if (rule.components.length !== components.length) return false
  const left = [...rule.components]
    .map((item) => `${item.style.styleId}:${item.quantity}`)
    .sort()
  const right = [...components]
    .map((item) => `${item.style.styleId}:${item.quantity}`)
    .sort()
  return left.every((value, index) => value === right[index])
}

type DraftGroup = {
  lineNos: number[]
  scope: InvoiceItemNameRuleImportScope
  mainStyleNo: string
  productLookupKey: string
  itemName: string
  actions: Set<InvoiceItemNameRuleAction>
  componentStyleNos: string[]
  note: string
}

function errorRow(
  lineNo: number,
  message: string,
  partial: Partial<PreparedInvoiceItemNameRuleRow> = {},
): PreparedInvoiceItemNameRuleRow {
  return {
    lineNo,
    lineNos: [lineNo],
    scope: 'lookup_key',
    productLookupKey: '',
    itemName: '',
    mainStyle: null,
    mainStyleLabel: '',
    action: 'delete',
    components: [],
    note: '',
    status: 'error',
    message,
    existingRuleId: null,
    input: null,
    ...partial,
  }
}

/**
 * 내품명 원장 시트를 읽어 저장 가능한 규칙과 오류를 가른다.
 * 같은 `확정 본품 + 조회 키 + 옵션명 + 조회 키 선택`은 한 규칙으로 합치고,
 * 구성품 칸에서 같은 M번호를 반복한 횟수를 수량으로 본다.
 */
export function prepareInvoiceItemNameRuleRows(
  rows: string[][],
  lookup: InvoiceItemNameRuleStyleLookup,
  existingRules: InvoiceItemNameRule[] = [],
): PreparedInvoiceItemNameRuleRow[] {
  if (rows.length === 0) return []
  const headers = (rows[0] ?? []).map((item) => String(item))
  const mainIdx = headerIndex(headers, MAIN_ALIASES)
  const lookupIdx = headerIndex(headers, ['조회 키', '조회키', '조회 문자열'])
  const itemIdx = headerIndex(headers, ['옵션명', '내품명', '원본 내품명'])
  const lookupFlagIdx = headerIndex(headers, ['조회 키 선택', '조회키선택'])
  const deleteFlagIdx = headerIndex(headers, ['지우기', '내품명 지우기'])
  const componentIdx = headerIndex(headers, COMPONENT_ALIASES)
  const noteIdx = headerIndex(headers, ['메모', '비고'])

  if (itemIdx < 0 || deleteFlagIdx < 0 || componentIdx < 0) {
    return [
      errorRow(
        1,
        '`옵션명`·`지우기`·`구성품 M번호` 열을 찾지 못했습니다. 양식을 내려받아 헤더를 그대로 쓰세요.',
      ),
    ]
  }

  const groups = new Map<string, DraftGroup>()
  const order: string[] = []
  const failures: PreparedInvoiceItemNameRuleRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const lineNo = i + 1
    if (row.every((value) => !String(value ?? '').trim())) continue

    const itemName = cell(row, itemIdx)
    const componentRaw = cell(row, componentIdx)
    const note = cell(row, noteIdx)
    const deleteFlag = isYes(cell(row, deleteFlagIdx))
    const scope: InvoiceItemNameRuleImportScope = isYes(
      cell(row, lookupFlagIdx),
    )
      ? 'lookup_key'
      : 'global'
    // 공통 규칙은 본품·조회 키를 보지 않는다. 검토 목록에서 내려온 값이 남아 있어도
    // 오류로 막지 않고 무시한다.
    const mainStyleNo = scope === 'lookup_key' ? cell(row, mainIdx) : ''
    const productLookupKey = scope === 'lookup_key' ? cell(row, lookupIdx) : ''

    // 검토 목록은 한 번에 수백 행이 내려오므로, 지우기와 구성품을 모두 비운 행은
    // 아직 정하지 않은 것으로 보고 오류 없이 건너뛴다.
    if (!deleteFlag && !componentRaw) {
      failures.push(
        errorRow(lineNo, '아직 정하지 않았습니다', {
          scope,
          itemName,
          productLookupKey,
          status: 'skip',
        }),
      )
      continue
    }
    if (!itemName) {
      failures.push(
        errorRow(lineNo, '`옵션명`이 비어 있습니다.', {
          scope,
          productLookupKey,
        }),
      )
      continue
    }
    const action: InvoiceItemNameRuleAction = deleteFlag
      ? 'delete'
      : 'components'
    if (scope === 'lookup_key' && !cell(row, mainIdx)) {
      failures.push(
        errorRow(
          lineNo,
          '`조회 키 선택`이 Y면 `확정 본품 M번호`가 필요합니다.',
          { scope, itemName, productLookupKey },
        ),
      )
      continue
    }
    if (scope === 'lookup_key' && !cell(row, lookupIdx)) {
      failures.push(
        errorRow(lineNo, '`조회 키 선택`이 Y면 `조회 키`가 필요합니다.', {
          scope,
          itemName,
        }),
      )
      continue
    }
    if (deleteFlag && componentRaw) {
      failures.push(
        errorRow(
          lineNo,
          '`지우기`가 Y면 구성품을 비우세요. 둘 중 하나만 씁니다.',
          { scope, itemName, productLookupKey },
        ),
      )
      continue
    }

    const key = groupKeyOf(scope, mainStyleNo, productLookupKey, itemName)
    const group = groups.get(key) ?? {
      lineNos: [],
      scope,
      mainStyleNo,
      productLookupKey,
      itemName,
      actions: new Set<InvoiceItemNameRuleAction>(),
      componentStyleNos: [],
      note: '',
    }
    if (!groups.has(key)) order.push(key)
    group.lineNos.push(lineNo)
    group.actions.add(action)
    group.componentStyleNos.push(...splitComponentStyleNos(componentRaw))
    if (!group.note && note) group.note = note
    groups.set(key, group)
  }

  const prepared: PreparedInvoiceItemNameRuleRow[] = []

  for (const key of order) {
    const group = groups.get(key)
    if (!group) continue
    const lineNo = group.lineNos[0] ?? 1
    const base = {
      lineNo,
      lineNos: group.lineNos,
      scope: group.scope,
      productLookupKey: group.productLookupKey,
      itemName: group.itemName,
      note: group.note,
    }

    if (group.actions.size > 1) {
      prepared.push(
        errorRow(
          lineNo,
          `같은 규칙에 지우기와 구성품이 섞였습니다 (${group.lineNos.join(', ')}행)`,
          base,
        ),
      )
      continue
    }
    const action = [...group.actions][0] ?? 'delete'

    let mainStyle: StyleRef | null = null
    if (group.scope === 'lookup_key') {
      mainStyle = resolveStyleNo(group.mainStyleNo, lookup)
      if (!mainStyle) {
        prepared.push(
          errorRow(
            lineNo,
            `본품 M번호를 찾을 수 없습니다: ${group.mainStyleNo}`,
            { ...base, action, mainStyleLabel: group.mainStyleNo },
          ),
        )
        continue
      }
    }

    const quantityByStyleId = new Map<string, number>()
    const styleById = new Map<string, StyleRef>()
    let componentError: string | null = null
    for (const styleNo of group.componentStyleNos) {
      const style = resolveStyleNo(styleNo, lookup)
      if (!style) {
        componentError = `구성품 M번호를 찾을 수 없습니다: ${styleNo}`
        break
      }
      styleById.set(style.styleId, style)
      quantityByStyleId.set(
        style.styleId,
        (quantityByStyleId.get(style.styleId) ?? 0) + 1,
      )
    }
    if (componentError) {
      prepared.push(
        errorRow(lineNo, componentError, {
          ...base,
          action,
          mainStyle,
          mainStyleLabel: mainStyle ? mainStyle.styleNo : group.mainStyleNo,
        }),
      )
      continue
    }

    const components = [...quantityByStyleId.entries()].map(
      ([styleId, quantity]) => ({
        style: styleById.get(styleId)!,
        quantity,
      }),
    )

    if (action === 'components' && components.length === 0) {
      prepared.push(
        errorRow(lineNo, '`구성품`인데 구성품 M번호가 없습니다.', {
          ...base,
          action,
          mainStyle,
          mainStyleLabel: mainStyle ? mainStyle.styleNo : group.mainStyleNo,
        }),
      )
      continue
    }

    const existing = findExistingRule(
      existingRules,
      group.scope,
      group.itemName,
      mainStyle?.styleId ?? null,
      group.productLookupKey,
    )
    const unchanged =
      Boolean(existing) &&
      existing!.action === action &&
      sameComponents(existing!, components)
    const status: InvoiceItemNameRuleImportStatus = unchanged
      ? 'unchanged'
      : existing
        ? 'overwrite'
        : 'new'

    prepared.push({
      ...base,
      mainStyle,
      mainStyleLabel: mainStyle ? mainStyle.styleNo : '',
      action,
      components,
      status,
      message: unchanged
        ? '이미 같은 내용으로 저장돼 있습니다'
        : existing
          ? '기존 규칙을 덮어씁니다'
          : '새로 등록합니다',
      existingRuleId: existing?.id ?? null,
      input: unchanged
        ? null
        : {
            scope: group.scope,
            mainStyleId: mainStyle?.styleId ?? null,
            productLookupKey:
              group.scope === 'lookup_key' ? group.productLookupKey : null,
            itemName: group.itemName,
            action,
            note: group.note,
            components: components.map((item) => ({
              styleId: item.style.styleId,
              role: 'included' as const,
              quantity: item.quantity,
            })),
          },
    })
  }

  // 아직 정하지 않은 행은 뒤로 밀어 미리보기에서 실제 처리 대상이 먼저 보이게 한다.
  return [...prepared, ...failures].sort(
    (left, right) =>
      Number(left.status === 'skip') - Number(right.status === 'skip') ||
      left.lineNo - right.lineNo,
  )
}

const GUIDE_ROWS: string[][] = [
  ['열', '항목명', '필수', '설명'],
  [
    '1',
    '확정 본품 M번호',
    '조회 키 선택이 Y일 때',
    '품목명 단계에서 확정된 본품. 검토 목록 내려받기로 받으면 이미 채워져 있다',
  ],
  [
    '2',
    '조회 키',
    '조회 키 선택이 Y일 때',
    '품목명 단계가 본품을 맞춘 조회 키 원문. 검토 목록 내려받기로 받으면 이미 채워져 있다',
  ],
  [
    '3',
    '옵션명',
    'Y',
    '변환 대상 내품명. 품목명 단계가 남긴 유효 내품명을 쓴다',
  ],
  [
    '4',
    '조회 키 선택',
    'N',
    'Y면 이 조회 키와 그때의 확정 본품에만 적용한다. 비우면 공통 규칙이 되어 품목명을 보지 않고 브랜드의 같은 옵션명 전체에 적용한다. 공통으로 바꿀 때 1·2열은 지우지 않아도 무시된다',
  ],
  [
    '5',
    '지우기',
    'N',
    'Y면 최종 내품명을 빈칸으로 둔다. 이때 6열은 비운다',
  ],
  [
    '6',
    '구성품 M번호',
    '지우기가 비었을 때',
    '같이 나가는 M번호를 쉼표로 나열한다. 같은 M번호를 반복한 횟수가 수량이다',
  ],
  ['7', '메모', 'N', '참고용. 변환에는 쓰지 않는다'],
  ['8', '대상 행', 'N', '참고용. 이 조회 키가 걸린 주문 행 수. 올릴 때는 무시한다'],
  [
    '-',
    '수량',
    '-',
    '`M1999,M1999,M2000`이면 M1999는 2개, M2000은 1개로 저장한다. 행을 복사하지 않는다',
  ],
  [
    '-',
    '안 정한 행',
    '-',
    '5열과 6열을 모두 비운 행은 아직 정하지 않은 것으로 보고 건너뛴다. 오류가 아니다. 필요한 행만 채워 올리면 된다',
  ],
  [
    '-',
    '여러 행',
    '-',
    '1·2·3·4열이 같은 행은 한 규칙으로 합쳐 구성품을 누적한다. 그 안에서 지우기와 구성품이 섞이면 오류다',
  ],
  [
    '-',
    '덮어쓰기',
    '-',
    '이미 같은 규칙이 있으면 올릴 때 `덮어쓰기`로 표시하고, 확인 후 반영하면 새 내용으로 바꾼다. 내용까지 같으면 `변화없음`으로 두고 저장하지 않는다',
  ],
  [
    '-',
    '대소문자·공백',
    '-',
    '앞뒤·연속 공백과 영문 대소문자, 전각·반각 차이는 무시하고 맞춘다',
  ],
]

const UPLOAD_COL_WIDTHS = [
  { wch: 16 },
  { wch: 56 },
  { wch: 40 },
  { wch: 12 },
  { wch: 9 },
  { wch: 28 },
  { wch: 20 },
  { wch: 9 },
]

function appendGuideSheet(
  XLSX: typeof import('xlsx'),
  workbook: import('xlsx').WorkBook,
) {
  const guideSheet = XLSX.utils.aoa_to_sheet(GUIDE_ROWS)
  guideSheet['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 18 }, { wch: 84 }]
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')
}

/** 빈 양식. 헤더와 예시 2줄만 넣는다. */
export async function downloadInvoiceItemNameRuleTemplate(brandName: string) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    [...HEADERS],
    [
      'M0885',
      '[단독] 마스마룰즈 래빗 에코백_32타입 택1 Color: 하트 레오파드 모브블루',
      'Color: 하트 레오파드 모브블루_RB',
      'Y',
      '',
      'M1999,M1999,M2000',
      '',
      '',
    ],
    ['', '', 'KEYRING 추가=선택안함', '', 'Y', '', '', ''],
  ])
  uploadSheet['!cols'] = UPLOAD_COL_WIDTHS
  XLSX.utils.book_append_sheet(workbook, uploadSheet, UPLOAD_SHEET_NAME)
  appendGuideSheet(XLSX, workbook)
  XLSX.writeFile(
    workbook,
    `${safeFilePart(brandName)}_내품명원장_${todayStamp()}.xlsx`,
  )
}

export type InvoiceItemNameReviewEntry = {
  itemName: string
  productLookupKey: string
  styleNo: string
  rowCount: number
}

/**
 * 검토 중인 조회 키 목록을 양식 그대로 내린다.
 * 확정 본품·조회 키·옵션명과 `조회 키 선택` Y까지 채워 두고
 * `지우기`·`구성품 M번호`만 비운다.
 */
export async function downloadInvoiceItemNameReviewList(
  brandName: string,
  entries: InvoiceItemNameReviewEntry[],
) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    [...HEADERS],
    ...entries.map((entry) => [
      entry.styleNo,
      entry.productLookupKey,
      entry.itemName,
      'Y',
      '',
      '',
      '',
      String(entry.rowCount),
    ]),
  ])
  uploadSheet['!cols'] = UPLOAD_COL_WIDTHS
  uploadSheet['!autofilter'] = {
    ref: `A1:H${Math.max(entries.length + 1, 1)}`,
  }
  XLSX.utils.book_append_sheet(workbook, uploadSheet, UPLOAD_SHEET_NAME)
  appendGuideSheet(XLSX, workbook)
  XLSX.writeFile(
    workbook,
    `${safeFilePart(brandName)}_내품명검토목록_${todayStamp()}.xlsx`,
  )
}
