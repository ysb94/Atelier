import type { DraftColorSpec, DraftSpecKey, DraftSpecs } from '@/lib/types'
import { parseSizeSpecInput } from './spec-format'

export type ColorSpecField = keyof DraftColorSpec
export type DraftInformationField = Exclude<ColorSpecField, 'weight'>
export type SaveColorSpec = (colorId: string, changes: Partial<DraftColorSpec>, applyAll: boolean) => Promise<void>

export const DRAFT_INFORMATION_LABELS = {
  size: 'size',
  fabric: 'Fabric',
  specDoc: '스펙 문서',
} satisfies Record<DraftInformationField, string>

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
  changes: Partial<DraftColorSpec>,
): DraftSpecs {
  const patch: Partial<DraftColorSpec> = {}
  for (const field of Object.keys(changes) as ColorSpecField[]) {
    const value = changes[field]
    if (value !== undefined) patch[field] = field === 'size' ? parseSizeSpecInput(value) : value.trim()
  }
  const colorSpecs = { ...specs.colorSpecs }
  for (const id of colorIds) {
    const current = colorSpecs[id] ?? colorSpecFromProduct(specs)
    colorSpecs[id] = { ...current, ...patch }
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
