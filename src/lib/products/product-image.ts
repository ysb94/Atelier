import type { BrandField, Style } from '@/lib/types'

/** 대표 이미지 주소를 담는 시스템 항목 키 */
export const PRODUCT_IMAGE_KEY = 'imageUrl'

/** 물류 이미지 주소를 담는 시스템 항목 키 */
export const LOGISTICS_IMAGE_KEY = 'logisticsImageUrl'

/**
 * 파일 이름을 품번으로 맞춰 두면 주소를 계산할 수 있다는 전제의 규칙.
 * 상품마다 주소를 따로 저장하지 않으려고 둔다.
 */
export type ProductImageRule = {
  /** 끝 슬래시 없는 폴더 주소 */
  folderUrl: string
  /** 품번 뒤, 확장자 앞에 붙는 꼬리말. 예: `_code` */
  suffix?: string
  /**
   * 점 없는 확장자 후보. 앞에서부터 시도하고 실패하면 다음으로 넘어간다.
   * 같은 폴더에 jpg와 png가 섞여 있어서 하나로 고정할 수 없다.
   */
  extensions: string[]
  /** 파일 이름에 쓸 품번 표기 */
  letterCase: 'upper' | 'lower' | 'asis'
}

/**
 * 이미지 항목마다 폴더가 달라서 시스템 키별로 규칙을 둔다.
 * 규칙이 없는 항목(사용자가 추가한 이미지 열 등)은 직접 넣은 주소만 쓴다.
 * 폴더나 도메인이 바뀌면 여기만 고치면 전체 상품에 반영된다.
 */
export const IMAGE_RULES: Record<string, ProductImageRule> = {
  [PRODUCT_IMAGE_KEY]: {
    folderUrl: 'https://cdn2.auchee.com/Prod_Images/Clean',
    extensions: ['jpg', 'png'],
    letterCase: 'upper',
  },
  [LOGISTICS_IMAGE_KEY]: {
    folderUrl: 'https://cdn2.auchee.com/Prod_Images/M_code',
    suffix: '_code',
    extensions: ['jpg', 'png'],
    letterCase: 'upper',
  },
}

function baseName(styleNo: string, rule: ProductImageRule): string {
  const trimmed = styleNo.trim()
  if (!trimmed) return ''
  const cased =
    rule.letterCase === 'upper'
      ? trimmed.toUpperCase()
      : rule.letterCase === 'lower'
        ? trimmed.toLowerCase()
        : trimmed
  return encodeURIComponent(`${cased}${rule.suffix ?? ''}`)
}

/**
 * 품번으로 규칙상 나올 수 있는 주소들을 만든다.
 * 어느 확장자로 올렸는지 알 수 없어서 후보를 순서대로 돌려준다.
 */
export function ruleImageUrls(styleNo: string, fieldKey: string): string[] {
  const rule = IMAGE_RULES[fieldKey]
  if (!rule) return []
  const name = baseName(styleNo, rule)
  if (!name) return []
  const folder = rule.folderUrl.replace(/\/+$/, '')
  return rule.extensions.map((ext) => `${folder}/${name}.${ext}`)
}

/**
 * 칸에 적힌 값과 품번으로 시도할 주소 목록을 만든다.
 * 직접 넣은 주소가 있으면 그것만 쓰고 규칙은 건너뛴다.
 * 주소 형태가 아닌 값은 깨진 이미지를 띄우지 않도록 버린다.
 */
export function pickImageSources(
  rawValue: string | undefined,
  styleNo: string,
  fieldKey: string,
): string[] {
  const raw = rawValue?.trim()
  if (raw && /^https?:\/\//i.test(raw)) return [raw]
  return ruleImageUrls(styleNo, fieldKey)
}

/** 상품 목록 썸네일에 쓸 대표 이미지 주소 후보 */
export function resolveProductImageSources(style: Style): string[] {
  return pickImageSources(
    style.values?.[PRODUCT_IMAGE_KEY],
    style.styleNo,
    PRODUCT_IMAGE_KEY,
  )
}

export function isImageField(field: BrandField): boolean {
  return (
    field.type === 'image' ||
    field.systemKey === PRODUCT_IMAGE_KEY ||
    field.systemKey === LOGISTICS_IMAGE_KEY
  )
}
