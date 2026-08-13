import type {
  InvoiceWorkInstruction,
  InvoiceWorkInstructionCountBasis,
  InvoiceWorkInstructionItem,
  StyleRef,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const INSTRUCTION_COLUMNS =
  'id, brand_id, title, label_text, is_active, note, starts_at, ends_at, count_basis, created_at, updated_at'
const ITEM_COLUMNS =
  'id, instruction_id, product_name, normalized_product_name'
const PRODUCT_EMBED =
  'invoice_work_instruction_products(style_id, sort_order, styles!invoice_work_instruction_products_style_fkey(id, style_no, name))'
const INSTRUCTION_SELECT = `${INSTRUCTION_COLUMNS}, invoice_work_instruction_items(${ITEM_COLUMNS}), ${PRODUCT_EMBED}`

type InstructionRow = {
  id: string
  brand_id: string
  title: string
  label_text: string
  is_active: boolean
  note: string
  starts_at: string | null
  ends_at: string | null
  count_basis: string | null
  created_at: string
  updated_at: string
  invoice_work_instruction_items?: ItemRow[] | null
  invoice_work_instruction_products?: ProductRow[] | null
}

type ItemRow = {
  id: string
  instruction_id: string
  product_name: string
  normalized_product_name: string
}

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type ProductRow = {
  style_id: string
  sort_order: number
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceWorkInstructionStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceWorkInstructionStoreError'
  }
}

function parseCountBasis(
  value: string | null | undefined,
): InvoiceWorkInstructionCountBasis {
  if (
    value === 'per_shipment' ||
    value === 'per_order' ||
    value === 'per_row' ||
    value === 'per_quantity'
  ) {
    return value
  }
  return 'per_shipment'
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): StyleEmbed | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function toOutgoingProducts(rows: ProductRow[] | null | undefined): StyleRef[] {
  return [...(rows ?? [])]
    .sort((left, right) => left.sort_order - right.sort_order)
    .flatMap((row) => {
      const style = styleFromEmbed(row.styles)
      if (!style) return []
      return [
        {
          styleId: style.id,
          styleNo: style.style_no,
          name: style.name,
        },
      ]
    })
}

function toItem(row: ItemRow): InvoiceWorkInstructionItem {
  return {
    id: row.id,
    instructionId: row.instruction_id,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
  }
}

function toAppMoment(value: string): string {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!match) {
    throw new InvoiceWorkInstructionStoreError(
      `적용 기간 형식을 읽을 수 없습니다: ${value}`,
    )
  }
  const [, year, month, day, hour, minute] = match
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function toDbTimestamp(value: string): string {
  return `${toAppMoment(value)}:00`
}

function toOptionalMoment(value: string | null | undefined): string | null {
  if (!value) return null
  return toAppMoment(value)
}

function toInstruction(row: InstructionRow): InvoiceWorkInstruction {
  return {
    id: row.id,
    brandId: row.brand_id,
    title: row.title,
    labelText: row.label_text,
    isActive: row.is_active,
    note: row.note,
    startsAt: toOptionalMoment(row.starts_at),
    endsAt: toOptionalMoment(row.ends_at),
    countBasis: parseCountBasis(row.count_basis),
    outgoingProducts: toOutgoingProducts(row.invoice_work_instruction_products),
    items: (row.invoice_work_instruction_items ?? [])
      .map(toItem)
      .sort((left, right) =>
        left.productName.localeCompare(right.productName, 'ko-KR'),
      ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listInvoiceWorkInstructions(
  brandId: string,
): Promise<InvoiceWorkInstruction[]> {
  const { data, error } = await getSupabase()
    .from('invoice_work_instructions')
    .select(
      INSTRUCTION_SELECT,
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(error, '작업 지시를 불러오지 못했습니다.'),
    )
  }
  return ((data as InstructionRow[]) ?? []).map(toInstruction)
}

export type InvoiceWorkInstructionItemInput = {
  productName: string
}

export type InvoiceWorkInstructionInput = {
  title: string
  labelText: string
  isActive?: boolean
  note?: string
  startsAt?: string | null
  endsAt?: string | null
  countBasis?: InvoiceWorkInstructionCountBasis
  outgoingStyleIds?: string[]
  items: InvoiceWorkInstructionItemInput[]
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function validate(input: InvoiceWorkInstructionInput) {
  const title = input.title.trim()
  const labelText = input.labelText.trim()
  if (!title) {
    throw new InvoiceWorkInstructionStoreError('지시명을 입력하세요.')
  }
  if (!labelText) {
    throw new InvoiceWorkInstructionStoreError('표시 문구를 입력하세요.')
  }

  const startsRaw = input.startsAt?.trim() ?? ''
  const endsRaw = input.endsAt?.trim() ?? ''
  if (Boolean(startsRaw) !== Boolean(endsRaw)) {
    throw new InvoiceWorkInstructionStoreError(
      '적용 기간은 시작과 종료를 함께 넣거나, 둘 다 비워 항상 적용하세요.',
    )
  }
  let startsAt: string | null = null
  let endsAt: string | null = null
  if (startsRaw && endsRaw) {
    startsAt = toAppMoment(startsRaw)
    endsAt = toAppMoment(endsRaw)
    if (endsAt < startsAt) {
      throw new InvoiceWorkInstructionStoreError(
        '종료 시각이 시작 시각보다 앞설 수 없습니다.',
      )
    }
  }

  const items: { productName: string }[] = []
  const seen = new Set<string>()
  for (const raw of input.items ?? []) {
    const productName = raw.productName.trim()
    if (!productName) continue
    const key = normalizeText(productName)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ productName })
  }

  if (items.length === 0) {
    throw new InvoiceWorkInstructionStoreError(
      '원본 품목명을 한 개 이상 넣으세요.',
    )
  }

  const countBasis = parseCountBasis(input.countBasis)
  const outgoingStyleIds: string[] = []
  const seenStyle = new Set<string>()
  for (const raw of input.outgoingStyleIds ?? []) {
    const styleId = raw.trim()
    if (!styleId || seenStyle.has(styleId)) continue
    seenStyle.add(styleId)
    outgoingStyleIds.push(styleId)
  }

  return { title, labelText, startsAt, endsAt, countBasis, outgoingStyleIds, items }
}

async function replaceItems(
  brandId: string,
  instructionId: string,
  items: { productName: string }[],
) {
  const supabase = getSupabase()
  const { error: deleteError } = await supabase
    .from('invoice_work_instruction_items')
    .delete()
    .eq('instruction_id', instructionId)

  if (deleteError) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(deleteError, '기존 작업 지시 대상을 정리하지 못했습니다.'),
    )
  }

  if (items.length === 0) return

  const { error: insertError } = await supabase
    .from('invoice_work_instruction_items')
    .insert(
      items.map((item) => ({
        brand_id: brandId,
        instruction_id: instructionId,
        product_name: item.productName,
      })),
    )

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      throw new InvoiceWorkInstructionStoreError(
        '같은 작업 지시에 같은 원본 품목명이 있습니다.',
      )
    }
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(insertError, '작업 지시 대상을 저장하지 못했습니다.'),
    )
  }
}

async function replaceOutgoingProducts(
  brandId: string,
  instructionId: string,
  styleIds: string[],
) {
  const supabase = getSupabase()
  const { error: deleteError } = await supabase
    .from('invoice_work_instruction_products')
    .delete()
    .eq('instruction_id', instructionId)

  if (deleteError) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(deleteError, '기존 나가는 제품을 정리하지 못했습니다.'),
    )
  }

  if (styleIds.length === 0) return

  const { error: insertError } = await supabase
    .from('invoice_work_instruction_products')
    .insert(
      styleIds.map((styleId, index) => ({
        brand_id: brandId,
        instruction_id: instructionId,
        style_id: styleId,
        sort_order: index,
      })),
    )

  if (insertError) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(insertError, '나가는 제품을 저장하지 못했습니다.'),
    )
  }
}

export async function saveInvoiceWorkInstruction(
  brandId: string,
  input: InvoiceWorkInstructionInput,
  instructionId?: string,
): Promise<InvoiceWorkInstruction> {
  const {
    title,
    labelText,
    startsAt,
    endsAt,
    countBasis,
    outgoingStyleIds,
    items,
  } = validate(input)
  const supabase = getSupabase()

  const payload = {
    brand_id: brandId,
    title,
    label_text: labelText,
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
    starts_at: startsAt ? toDbTimestamp(startsAt) : null,
    ends_at: endsAt ? toDbTimestamp(endsAt) : null,
    count_basis: countBasis,
  }

  const query = instructionId
    ? supabase
        .from('invoice_work_instructions')
        .update(payload)
        .eq('id', instructionId)
    : supabase.from('invoice_work_instructions').insert(payload)

  const { data, error } = await query.select(INSTRUCTION_COLUMNS).single()
  if (error) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(error, '작업 지시를 저장하지 못했습니다.'),
    )
  }

  const saved = data as InstructionRow
  await replaceItems(brandId, saved.id, items)
  await replaceOutgoingProducts(brandId, saved.id, outgoingStyleIds)

  const { data: reloaded, error: reloadError } = await supabase
    .from('invoice_work_instructions')
    .select(
      INSTRUCTION_SELECT,
    )
    .eq('id', saved.id)
    .single()

  if (reloadError) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(reloadError, '저장한 작업 지시를 다시 읽지 못했습니다.'),
    )
  }
  return toInstruction(reloaded as InstructionRow)
}

export async function setInvoiceWorkInstructionActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_work_instructions')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(error, '작업 지시 상태를 바꾸지 못했습니다.'),
    )
  }
}

export async function deleteInvoiceWorkInstruction(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_work_instructions')
    .delete()
    .eq('id', id)

  if (error) {
    throw new InvoiceWorkInstructionStoreError(
      errorMessage(error, '작업 지시를 삭제하지 못했습니다.'),
    )
  }
}
