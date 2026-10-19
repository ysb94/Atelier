import type { DraftColorSpec, DraftSpecKey, DraftSpecs } from '@/lib/types'

export type ColorSpecField = 'size' | 'fabric' | 'weight' | 'specDoc'

export function colorSpecFromProduct(
  specs: Pick<DraftSpecs, DraftSpecKey>,
): DraftColorSpec {
  return {
    size: specs.size.value,
    fabric: specs.fabric.value,
    weight: specs.weight.value,
    specDoc: specs.coating.note,
  }
}

/** 컬러에 저장된 값이 없으면 상품 공통 스펙을 초기값으로 보여 준다. */
export function resolveColorSpec(specs: DraftSpecs, colorId: string): DraftColorSpec {
  return specs.colorSpecs[colorId] ?? colorSpecFromProduct(specs)
}

export function writeColorSpec(
  specs: DraftSpecs,
  colorIds: string[],
  field: ColorSpecField,
  value: string,
): DraftSpecs {
  const colorSpecs = { ...specs.colorSpecs }
  for (const id of colorIds) {
    const current = colorSpecs[id] ?? colorSpecFromProduct(specs)
    colorSpecs[id] = { ...current, [field]: value }
  }
  return { ...specs, colorSpecs }
}

export function normalizeColorSpecs(raw: unknown): Record<string, DraftColorSpec> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const specs: Record<string, DraftColorSpec> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!id || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const item = value as Record<string, unknown>
    specs[id] = {
      size: typeof item.size === 'string' ? item.size : '',
      fabric: typeof item.fabric === 'string' ? item.fabric : '',
      weight: typeof item.weight === 'string' ? item.weight : '',
      specDoc: typeof item.specDoc === 'string' ? item.specDoc : '',
    }
  }
  return specs
}
