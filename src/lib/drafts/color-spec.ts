import type { DraftColorSpec, DraftSpecKey, DraftSpecs } from '@/lib/types'
import { parseSizeSpecInput } from './spec-format'

export type ColorSpecField = Exclude<keyof DraftColorSpec, 'sizeConfirmed' | 'fabricConfirmed'>
export type DraftInformationField = 'size' | 'fabric' | 'specDoc'
export type ReopenDraftInformation = (field: DraftInformationField, colorId?: string) => Promise<void>
export type ColorInformationField = Exclude<DraftInformationField, 'specDoc'>
export type ResolvedDraftColorSpec = DraftColorSpec & { coating: string }
export type ColorSpecValues = Partial<Pick<DraftColorSpec, ColorSpecField>>
export type SaveColorSpec = (colorId: string, changes: ColorSpecValues, applyAll: boolean, field: ColorInformationField, temporaryRevision?: string) => Promise<void>

export type InformationEdits = Partial<Record<ColorSpecField, { source: string; text: string }>>
export type InformationDrafts = Partial<Record<string, InformationEdits>>
export type UpdateInformationEdits = (current: InformationEdits | undefined) => InformationEdits | undefined
export const documentEditKey = 'specDoc'

export function colorInformationEditKey(colorId: string, field: ColorInformationField) {
  return `${field}:${colorId}`
}

export function informationEditText(source: string, edit: InformationEdits[ColorSpecField]) {
  return edit?.source === source && typeof edit.text === 'string' ? edit.text : source
}

export function hasInformationEdits(source: ResolvedDraftColorSpec, edits: InformationEdits | undefined) {
  return (Object.keys(edits ?? {}) as ColorSpecField[]).some(
    key => informationEditText(source[key], edits?.[key]).trim() !== source[key].trim(),
  )
}

export const DRAFT_INFORMATION_LABELS = {
  size: 'size',
  fabric: 'Fabric',
  specDoc: '스펙 문서',
} satisfies Record<DraftInformationField, string>

function colorSpecFromProduct(
  specs: Pick<DraftSpecs, DraftSpecKey>,
): DraftColorSpec {
  return {
    size: specs.size.value,
    sizeNote: '',
    fabric: specs.fabric.value,
    weight: specs.weight.value,
    specDoc: specs.coating.note,
  }
}

/** 컬러에 저장된 값이 없으면 상품 공통 스펙을 초기값으로 보여 준다. */
export function resolveColorSpec(specs: DraftSpecs, colorId: string): ResolvedDraftColorSpec {
  const color = specs.colorSpecs[colorId] ?? colorSpecFromProduct(specs)
  return { ...color, coating: color.coating ?? specs.coating.value }
}

export function isColorInformationConfirmed(specs: DraftSpecs, spec: ResolvedDraftColorSpec, field: ColorInformationField) {
  return field === 'size'
    ? spec.sizeConfirmed ?? ((!spec.size.trim() || specs.size.confirmed) && (!spec.weight.trim() || specs.weight.confirmed) &&
        Boolean(spec.size.trim() || spec.weight.trim()))
    : spec.fabricConfirmed ?? ((!spec.fabric.trim() || specs.fabric.confirmed) &&
        (!spec.coating.trim() || specs.coating.confirmed) && Boolean(spec.fabric.trim() || spec.coating.trim()))
}

export function isSpecDocumentConfirmed(specs: DraftSpecs) {
  return specs.specDocumentConfirmed ?? (specs.size.confirmed && specs.fabric.confirmed && specs.weight.confirmed)
}

export function reopenDraftInformation(specs: DraftSpecs, field: DraftInformationField, colorId?: string): DraftSpecs {
  if (field === 'specDoc') return { ...specs, specDocumentConfirmed: false }
  if (!colorId) throw new Error('컬러를 찾지 못했습니다.')
  const current = specs.colorSpecs[colorId] ?? colorSpecFromProduct(specs)
  const confirmation = field === 'size' ? 'sizeConfirmed' : 'fabricConfirmed'
  return { ...specs, colorSpecs: { ...specs.colorSpecs, [colorId]: { ...current, [confirmation]: false } } }
}

export function writeColorSpec(
  specs: DraftSpecs,
  colorIds: string[],
  changes: ColorSpecValues,
  field: ColorInformationField,
  confirm: boolean,
): DraftSpecs {
  const patch: ColorSpecValues = {}
  for (const field of Object.keys(changes) as ColorSpecField[]) {
    const value = changes[field]
    if (value !== undefined) patch[field] = field === 'size' ? parseSizeSpecInput(value) : value.trim()
  }
  const colorSpecs = { ...specs.colorSpecs }
  const confirmationKey = field === 'size' ? 'sizeConfirmed' : 'fabricConfirmed'
  for (const id of colorIds) {
    const current = colorSpecs[id] ?? colorSpecFromProduct(specs)
    const next = { ...current, ...patch }
    if (confirm && field === 'fabric') next.coating ??= specs.coating.value
    const previous = { ...current, coating: current.coating ?? specs.coating.value }
    if (confirm || Object.entries(patch).some(([key, value]) => previous[key as ColorSpecField] !== value)) {
      next[confirmationKey] = confirm
    }
    colorSpecs[id] = next
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
      sizeNote: typeof item.sizeNote === 'string' ? item.sizeNote : '',
      fabric: typeof item.fabric === 'string' ? item.fabric : '',
      ...(typeof item.coating === 'string' ? { coating: item.coating } : {}),
      weight: typeof item.weight === 'string' ? item.weight : '',
      specDoc: typeof item.specDoc === 'string' ? item.specDoc : '',
      ...(typeof item.sizeConfirmed === 'boolean' ? { sizeConfirmed: item.sizeConfirmed } : {}),
      ...(typeof item.fabricConfirmed === 'boolean' ? { fabricConfirmed: item.fabricConfirmed } : {}),
    }
  }
  return specs
}
