import type {
  BarcodeField,
  BarcodeFieldSystemKey,
  ProductCode,
  ProductCodeComponent,
} from '@/lib/types'
import { normalizeHeader } from '@/lib/import/fields'

export const BARCODE_SYSTEM_FIELDS: ReadonlyArray<{
  systemKey: BarcodeFieldSystemKey
  label: string
  type: BarcodeField['type']
  locked: boolean
  aliases: string[]
}> = [
  {
    systemKey: 'code',
    label: '88코드',
    type: 'text',
    locked: true,
    aliases: ['88코드', '바코드', '코드', 'ean', 'barcode', 'code', 'ean13'],
  },
  {
    systemKey: 'name',
    label: '바코드 상품명',
    type: 'text',
    locked: true,
    aliases: ['바코드상품명', '바코드명', '코드명', '상품명', 'name', 'label'],
  },
  {
    systemKey: 'components',
    label: 'M번호',
    type: 'text',
    locked: false,
    aliases: [
      'm번호',
      'm번호목록',
      '품번',
      '품번목록',
      '구성',
      '구성품',
      'styleno',
      'stylenos',
      'styles',
    ],
  },
  {
    systemKey: 'weightG',
    label: '무게(g)',
    type: 'number',
    locked: false,
    aliases: ['무게', '무게g', '실측무게', '실측무게g', 'weight', 'weightg'],
  },
  {
    systemKey: 'widthCm',
    label: '가로(cm)',
    type: 'number',
    locked: false,
    // 예전 mm 헤더도 읽되 값은 cm로 해석한다(값 변환 없음).
    aliases: [
      '가로',
      '가로cm',
      '가로mm',
      '너비',
      '너비cm',
      '너비mm',
      'width',
      'widthcm',
      'widthmm',
    ],
  },
  {
    systemKey: 'depthCm',
    label: '세로(cm)',
    type: 'number',
    locked: false,
    aliases: [
      '세로',
      '세로cm',
      '세로mm',
      '깊이',
      '깊이cm',
      '깊이mm',
      'depth',
      'depthcm',
      'depthmm',
      'length',
    ],
  },
  {
    systemKey: 'heightCm',
    label: '높이(cm)',
    type: 'number',
    locked: false,
    aliases: [
      '높이',
      '높이cm',
      '높이mm',
      'height',
      'heightcm',
      'heightmm',
    ],
  },
  {
    systemKey: 'note',
    label: '비고',
    type: 'text',
    locked: false,
    aliases: ['비고', '메모', 'note', 'memo'],
  },
]

export function barcodeSystemField(systemKey: BarcodeFieldSystemKey) {
  return BARCODE_SYSTEM_FIELDS.find((field) => field.systemKey === systemKey)
}

export function barcodeFieldLabel(
  fields: BarcodeField[],
  systemKey: BarcodeFieldSystemKey,
) {
  return (
    fields.find((field) => field.systemKey === systemKey)?.label ??
    barcodeSystemField(systemKey)?.label ??
    systemKey
  )
}

export function isLockedBarcodeField(field: BarcodeField) {
  return field.systemKey === 'code' || field.systemKey === 'name'
}

export function visibleCustomBarcodeFields(fields: BarcodeField[]) {
  return fields.filter((field) => field.systemKey === null)
}

/** 표시·엑셀용. 12.0 → "12", 12.3 → "12.3" */
export function formatCm(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return ''
  }
  return String(Number(value.toFixed(1)))
}

/**
 * 규격(cm). 0보다 크고 소수 첫째 자리까지만 허용한다.
 * 예: 12, 12.3 허용 / 12.34, 0, 음수는 오류.
 */
export function parsePositiveCm(
  raw: string,
  label: string,
): { value?: number; error?: string } {
  if (!raw) return {}
  const cleaned = raw
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/cm$/i, '')
    .replace(/mm$/i, '')
  if (!/^\d+(\.\d)?$/.test(cleaned)) {
    return {
      error: `${label}은(는) 0보다 큰 수이며 소수 첫째 자리까지 입력하세요. (${raw})`,
    }
  }
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) {
    return {
      error: `${label}은(는) 0보다 큰 수이며 소수 첫째 자리까지 입력하세요. (${raw})`,
    }
  }
  return { value: Number(value.toFixed(1)) }
}

/**
 * 현재 관리 중인 이름을 우선하고, 이전에 내려받은 파일을 위해 시스템 별칭도 허용한다.
 * 사용자 추가 항목은 관리 화면에서 설정한 이름과 정확히 일치해야 한다.
 */
export function resolveBarcodeFieldColumns(
  header: string[],
  fields: BarcodeField[],
) {
  const normalized = header.map(normalizeHeader)
  const byFieldId = new Map<string, number>()
  const bySystemKey = new Map<BarcodeFieldSystemKey, number>()

  for (const field of fields) {
    const labelIndex = normalized.findIndex(
      (value) => value === normalizeHeader(field.label),
    )
    if (labelIndex >= 0) {
      byFieldId.set(field.id, labelIndex)
      if (field.systemKey) bySystemKey.set(field.systemKey, labelIndex)
    }
  }

  for (const definition of BARCODE_SYSTEM_FIELDS) {
    if (bySystemKey.has(definition.systemKey)) continue
    const aliasIndex = normalized.findIndex((value) =>
      definition.aliases.includes(value),
    )
    if (aliasIndex >= 0) bySystemKey.set(definition.systemKey, aliasIndex)
  }

  return { byFieldId, bySystemKey }
}

export function codeFieldValue(code: ProductCode, field: BarcodeField) {
  switch (field.systemKey) {
    case 'code':
      return code.code
    case 'name':
      return code.name
    case 'components':
      return componentList(code.components)
    case 'weightG':
      return code.weightG === null ? '' : String(code.weightG)
    case 'widthCm':
      return formatCm(code.widthCm)
    case 'depthCm':
      return formatCm(code.depthCm)
    case 'heightCm':
      return formatCm(code.heightCm)
    case 'note':
      return code.note
    case null:
      return code.values[field.id] ?? ''
  }
}

export function componentList(components: ProductCodeComponent[]) {
  return components.map((component) => component.styleNo).join(', ')
}
