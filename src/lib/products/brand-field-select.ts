import type {
  BrandField,
  BrandFieldOption,
  BrandFieldOptionInput,
} from '@/lib/types'

/** 문자열형 시스템 항목만 선택형으로 바꿀 수 있다. */
export const SELECTABLE_SYSTEM_KEYS = new Set([
  'category',
  'planner',
  'designer',
  'channel',
])

export function normalizeSelectOptionLabel(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ko')
}

export function canConvertFieldToSelect(field: {
  systemKey?: string | null
}): boolean {
  if (field.systemKey == null) return true
  return SELECTABLE_SYSTEM_KEYS.has(field.systemKey)
}

export function canEditFieldType(field: {
  systemKey?: string | null
}): boolean {
  return canConvertFieldToSelect(field)
}

export function listActiveSelectOptions(
  field: Pick<BrandField, 'options'>,
): BrandFieldOption[] {
  return [...(field.options ?? [])]
    .filter((option) => option.isActive)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ko'),
    )
}

export function resolveSelectOptionLabel(
  field: Pick<BrandField, 'options'>,
  raw: string,
  options?: { includeInactive?: boolean },
): string | null {
  const normalized = normalizeSelectOptionLabel(raw)
  if (!normalized) return null
  const pool = (field.options ?? []).filter(
    (option) => options?.includeInactive || option.isActive,
  )
  for (const option of pool) {
    if (normalizeSelectOptionLabel(option.label) === normalized) {
      return option.label
    }
  }
  for (const option of pool) {
    if (
      (option.aliases ?? []).some(
        (alias) => normalizeSelectOptionLabel(alias) === normalized,
      )
    ) {
      return option.label
    }
  }
  return null
}

export function applySelectDisplay(field: BrandField, raw: string): string {
  if (field.type !== 'select') return raw
  return resolveSelectOptionLabel(field, raw, { includeInactive: true }) ?? raw
}

export function formatSelectImportError(
  field: BrandField,
  value: string,
): string {
  const allowed = listActiveSelectOptions(field).map((option) => option.label)
  const allowedText = allowed.length > 0 ? allowed.join(', ') : '(없음)'
  return `${field.label} · 입력값 "${value}" · 허용값 ${allowedText}`
}

export function selectOptionsForEditor(
  field: BrandField,
  currentValue: string,
): Array<{ value: string; label: string }> {
  const options = listActiveSelectOptions(field).map((option) => ({
    value: option.label,
    label: option.label,
  }))
  const current = currentValue.trim()
  if (!current) return options
  const selected =
    resolveSelectOptionLabel(field, current, { includeInactive: true }) ??
    current
  if (!options.some((option) => option.value === selected)) {
    options.unshift({ value: selected, label: selected })
  }
  return options
}

export function prepareSelectOptionSave(
  options: BrandFieldOptionInput[],
):
  | { ok: true; options: BrandFieldOptionInput[] }
  | { ok: false; message: string } {
  const prepared: BrandFieldOptionInput[] = []
  const seen = new Set<string>()

  for (const [index, option] of options.entries()) {
    const label = option.label.trim()
    if (!label) {
      return { ok: false, message: '선택지 이름을 입력하세요.' }
    }
    const normalized = normalizeSelectOptionLabel(label)
    if (seen.has(normalized)) {
      return { ok: false, message: `같은 이름의 선택지가 있습니다. (${label})` }
    }
    seen.add(normalized)
    const aliases = [
      ...new Set(
        (option.aliases ?? [])
          .map((item) => item.trim())
          .filter(Boolean)
          .filter(
            (alias) => normalizeSelectOptionLabel(alias) !== normalized,
          ),
      ),
    ]
    prepared.push({
      id: option.id,
      label,
      aliases,
      sortOrder: option.sortOrder ?? index,
      isActive: option.isActive ?? true,
    })
  }

  return { ok: true, options: prepared }
}

export function withRenameAlias(
  previous: BrandFieldOption | undefined,
  next: BrandFieldOptionInput,
): BrandFieldOptionInput {
  if (!previous) return next
  const prevLabel = previous.label.trim()
  const nextLabel = next.label.trim()
  if (
    !prevLabel ||
    normalizeSelectOptionLabel(prevLabel) ===
      normalizeSelectOptionLabel(nextLabel)
  ) {
    return next
  }
  const aliases = new Set(
    [...(next.aliases ?? previous.aliases), prevLabel]
      .map((item) => item.trim())
      .filter(Boolean),
  )
  aliases.delete(nextLabel)
  return { ...next, aliases: [...aliases] }
}
