import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Minus,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  getPartnerBarcodeFields,
  getProductCodes,
  getStylesByBrand,
  replacePartnerBarcodeFields,
  replacePartnerCodes,
} from '@/lib/api'
import {
  PARTNER_COMPONENT_HEADER,
  parsePartnerComponentsCell,
} from '@/lib/codes/partner-code-import'
import { outboundPartnerDisplayName } from '@/lib/codes/outbound-partner'
import { parseFile } from '@/lib/import/parse'
import type {
  CodeUsageTarget,
  ProductCodeComponent,
  Style,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type FieldType = 'text' | 'number'

export type PartnerCodeField = {
  id: string
  label: string
  type: FieldType
  order: number
}

export type PartnerCodeRow = {
  id: string
  code: string
  values: Record<string, string>
  components: ProductCodeComponent[]
}

const TYPE_LABEL: Record<FieldType, string> = {
  text: '텍스트',
  number: '숫자',
}

function fieldsKey(brandId: string, targetId: string) {
  return `atelier:partner-codes-fields:${brandId}:${targetId}`
}

function rowsKey(brandId: string, targetId: string) {
  return `atelier:partner-codes-rows:${brandId}:${targetId}`
}

/** 1열 고정 헤더. 업체명에 맞춰 바뀐다. */
export function partnerBarcodeHeader(partnerName: string) {
  return `${partnerName.trim()} 바코드`
}

export function readPartnerCodeFields(
  brandId: string,
  targetId: string,
): PartnerCodeField[] {
  try {
    const raw = localStorage.getItem(fieldsKey(brandId, targetId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is PartnerCodeField =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as PartnerCodeField).id === 'string' &&
          typeof (item as PartnerCodeField).label === 'string',
      )
      .map((item, index): PartnerCodeField => ({
        id: item.id,
        label: item.label,
        type: item.type === 'number' ? 'number' : 'text',
        order: typeof item.order === 'number' ? item.order : index,
      }))
      .sort((left, right) => left.order - right.order)
  } catch {
    return []
  }
}

function clearLocalPartnerCodes(brandId: string, targetId: string) {
  localStorage.removeItem(fieldsKey(brandId, targetId))
  localStorage.removeItem(rowsKey(brandId, targetId))
}

function partnerCodeName(row: PartnerCodeRow, fields: PartnerCodeField[]) {
  const nameField = fields.find((field) =>
    /상품명|코드명|품명/.test(field.label),
  )
  const fromField = nameField ? (row.values[nameField.id] ?? '').trim() : ''
  return fromField || row.code
}

function rowsFromCodes(
  codes: Array<{
    id: string
    code: string
    values: Record<string, string>
    components: ProductCodeComponent[]
  }>,
): PartnerCodeRow[] {
  return codes.map((code) => ({
    id: code.id,
    code: code.code,
    values: code.values,
    components: code.components,
  }))
}

function toReplaceCodes(rows: PartnerCodeRow[], fields: PartnerCodeField[]) {
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: partnerCodeName(row, fields),
    values: row.values,
    components: row.components,
  }))
}

export function readPartnerCodeRows(
  brandId: string,
  targetId: string,
): PartnerCodeRow[] {
  try {
    const raw = localStorage.getItem(rowsKey(brandId, targetId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is PartnerCodeRow =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as PartnerCodeRow).id === 'string' &&
        typeof (item as PartnerCodeRow).code === 'string' &&
        typeof (item as PartnerCodeRow).values === 'object',
    ).map((item) => ({
      ...item,
      components: Array.isArray(item.components)
        ? item.components.filter(
            (component): component is ProductCodeComponent =>
              Boolean(component) &&
              typeof component === 'object' &&
              typeof component.styleId === 'string' &&
              typeof component.styleNo === 'string' &&
              typeof component.qty === 'number',
          )
        : [],
    }))
  } catch {
    return []
  }
}

function remapRowValues(
  rows: PartnerCodeRow[],
  previous: PartnerCodeField[],
  next: PartnerCodeField[],
): PartnerCodeRow[] {
  const nextByLabel = new Map(next.map((field) => [field.label, field.id]))
  return rows.map((row) => {
    const values: Record<string, string> = {}
    for (const field of previous) {
      const nextId = nextByLabel.get(field.label)
      const value = row.values[field.id]
      if (nextId && value) values[nextId] = value
    }
    return { ...row, values }
  })
}

async function downloadPartnerCodeTemplate(
  partnerName: string,
  fields: PartnerCodeField[],
  rows: PartnerCodeRow[],
) {
  const XLSX = await import('xlsx')
  const codeHeader = partnerBarcodeHeader(partnerName)
  const headers = [
    codeHeader,
    ...fields.map((field) => field.label),
    PARTNER_COMPONENT_HEADER,
  ]
  const body = rows.map((row) => [
    row.code,
    ...fields.map((field) => row.values[field.id] ?? ''),
    row.components.map((item) => item.styleNo).join(', '),
  ])
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '거래처코드')
  const safeName = partnerName.replace(/[\\/:*?"<>|]+/g, '_').trim() || '업체'
  XLSX.writeFile(workbook, `거래처코드_${safeName}.xlsx`)
}

function HeaderManagerDialog({
  partnerName,
  fields,
  onClose,
  onSave,
}: {
  partnerName: string
  fields: PartnerCodeField[]
  onClose: () => void
  onSave: (fields: PartnerCodeField[]) => void
}) {
  const [draft, setDraft] = useState(() =>
    fields.map((field, index) => ({ ...field, order: index })),
  )
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editType, setEditType] = useState<FieldType>('text')
  const [error, setError] = useState<string | null>(null)
  const codeHeader = partnerBarcodeHeader(partnerName)

  function addField() {
    const label = newLabel.trim()
    if (!label) {
      setError('헤더 이름을 입력하세요.')
      return
    }
    if (label === codeHeader || label === PARTNER_COMPONENT_HEADER) {
      setError(`「${label}」은 고정 열이라 추가할 수 없습니다.`)
      return
    }
    if (draft.some((field) => field.label === label)) {
      setError('같은 이름의 헤더가 이미 있습니다.')
      return
    }
    setDraft((current) => [
      ...current,
      {
        id: `field-${Date.now()}`,
        label,
        type: newType,
        order: current.length,
      },
    ])
    setNewLabel('')
    setNewType('text')
    setError(null)
  }

  function move(id: string, direction: 'up' | 'down') {
    setDraft((current) => {
      const index = current.findIndex((field) => field.id === id)
      if (index < 0) return current
      const swapWith = direction === 'up' ? index - 1 : index + 1
      if (swapWith < 0 || swapWith >= current.length) return current
      const next = [...current]
      const temp = next[index]!
      next[index] = next[swapWith]!
      next[swapWith] = temp
      return next.map((field, order) => ({ ...field, order }))
    })
  }

  function saveEdit(id: string) {
    const label = editLabel.trim()
    if (!label) {
      setError('헤더 이름을 입력하세요.')
      return
    }
    if (label === codeHeader || label === PARTNER_COMPONENT_HEADER) {
      setError(`「${label}」은 고정 열이라 쓸 수 없습니다.`)
      return
    }
    if (draft.some((field) => field.id !== id && field.label === label)) {
      setError('같은 이름의 헤더가 이미 있습니다.')
      return
    }
    setDraft((current) =>
      current.map((field) =>
        field.id === id ? { ...field, label, type: editType } : field,
      ),
    )
    setEditingId(null)
    setError(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">엑셀 헤더 설정</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            1열 「{codeHeader}」과 마지막 「{PARTNER_COMPONENT_HEADER}」은
            고정입니다. 나머지 열만 추가·수정·삭제합니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <Badge variant="outline">고정</Badge>
            <span className="font-medium">{codeHeader}</span>
            <span className="ml-auto text-xs text-muted-foreground">1열</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <Badge variant="outline">고정</Badge>
            <span className="font-medium">{PARTNER_COMPONENT_HEADER}</span>
            <span className="ml-auto text-xs text-muted-foreground">마지막 열</span>
          </div>

          {draft.map((field, index) => {
            const editing = editingId === field.id
            return (
              <div
                key={field.id}
                className="rounded-lg border border-border px-3 py-2"
              >
                {editing ? (
                  <div className="space-y-2">
                    <Input
                      value={editLabel}
                      onChange={(event) => setEditLabel(event.target.value)}
                      placeholder="헤더 이름"
                    />
                    <Select
                      value={editType}
                      onChange={(event) =>
                        setEditType(event.target.value as FieldType)
                      }
                    >
                      <option value="text">텍스트</option>
                      <option value="number">숫자</option>
                    </Select>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        취소
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveEdit(field.id)}
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {field.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {TYPE_LABEL[field.type]} · {index + 2}열
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => move(field.id, 'up')}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === draft.length - 1}
                      onClick={() => move(field.id, 'down')}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(field.id)
                        setEditLabel(field.label)
                        setEditType(field.type)
                        setError(null)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            .filter((item) => item.id !== field.id)
                            .map((item, order) => ({ ...item, order })),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}

          <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-3">
            <p className="text-xs font-medium text-muted-foreground">열 추가</p>
            <Input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="예: 상품명"
            />
            <Select
              value={newType}
              onChange={(event) => setNewType(event.target.value as FieldType)}
            >
              <option value="text">텍스트</option>
              <option value="number">숫자</option>
            </Select>
            <Button type="button" size="sm" variant="outline" onClick={addField}>
              <Plus className="size-3.5" />
              추가
            </Button>
          </div>

          {error ? (
            <p className="px-1 text-xs text-danger">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onSave(draft.map((field, order) => ({ ...field, order })))
              onClose()
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

type PartnerCodeListPanelProps = {
  brandId: string
  partner: CodeUsageTarget
}

function ComponentsCell({
  components,
  onEdit,
}: {
  components: ProductCodeComponent[]
  onEdit: () => void
}) {
  const totalQty = components.reduce((sum, item) => sum + item.qty, 0)
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group w-full min-w-[8rem] rounded-md px-1 py-0.5 text-left hover:bg-muted/50"
    >
      {components.length === 0 ? (
        <Badge variant="warning">M번호 미지정</Badge>
      ) : (
        <div className="space-y-0.5">
          <Badge variant="muted">
            {components.length}종 · {formatNumber(totalQty)}개
          </Badge>
          <div className="text-xs text-muted-foreground group-hover:text-foreground">
            {components
              .map(
                (item) =>
                  `${item.styleNo}${item.qty > 1 ? `×${item.qty}` : ''}`,
              )
              .join(', ')}
          </div>
        </div>
      )}
    </button>
  )
}

function ComponentsDialog({
  row,
  styles,
  onClose,
  onSave,
}: {
  row: PartnerCodeRow
  styles: Style[]
  onClose: () => void
  onSave: (components: ProductCodeComponent[]) => void
}) {
  const [draft, setDraft] = useState(() => [...row.components])
  const [search, setSearch] = useState('')
  const styleMap = useMemo(
    () => new Map(styles.map((style) => [style.id, style])),
    [styles],
  )
  const searchResults = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return []
    return styles
      .filter(
        (style) =>
          style.styleNo.toLowerCase().includes(keyword) ||
          style.name.toLowerCase().includes(keyword),
      )
      .slice(0, 6)
  }, [search, styles])

  function addComponent(style: Style) {
    setDraft((current) => {
      const existing = current.find((item) => item.styleId === style.id)
      if (existing) {
        return current.map((item) =>
          item.styleId === style.id
            ? { ...item, qty: item.qty + 1 }
            : item,
        )
      }
      return [
        ...current,
        { styleId: style.id, styleNo: style.styleNo, qty: 1 },
      ]
    })
    setSearch('')
  }

  function changeQty(styleId: string, qty: number) {
    const next = Math.max(1, Math.floor(qty))
    setDraft((current) =>
      current.map((item) =>
        item.styleId === styleId ? { ...item, qty: next } : item,
      ),
    )
  }

  function removeComponent(styleId: string) {
    setDraft((current) => current.filter((item) => item.styleId !== styleId))
  }

  const totalQty = draft.reduce((sum, item) => sum + item.qty, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(85vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">구성</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {row.code}
            {draft.length > 0
              ? ` · ${draft.length}종 · 총 ${formatNumber(totalQty)}개`
              : ''}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
          {styles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              등록된 상품이 없습니다. 상품을 먼저 추가한 뒤 구성품을 담으세요.
            </p>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                placeholder="품번 또는 상품명으로 검색해서 담기"
                onChange={(event) => setSearch(event.target.value)}
              />
              {searchResults.length > 0 ? (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                  {searchResults.map((style) => (
                    <li key={style.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => addComponent(style)}
                      >
                        <span className="min-w-0">
                          <span className="font-medium tabular-nums">
                            {style.styleNo}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {style.name}
                          </span>
                        </span>
                        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          {draft.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              담은 구성품이 없습니다. M번호 미지정으로 남습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {draft.map((component) => {
                const style = styleMap.get(component.styleId)
                return (
                  <li
                    key={component.styleId}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium tabular-nums">
                        {component.styleNo}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {style ? style.name : '삭제된 단품'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="수량 줄이기"
                        disabled={component.qty <= 1}
                        onClick={() =>
                          changeQty(component.styleId, component.qty - 1)
                        }
                      >
                        <Minus className="size-3.5" />
                      </Button>
                      <Input
                        className="h-8 w-14 text-center tabular-nums"
                        inputMode="numeric"
                        value={String(component.qty)}
                        onChange={(event) => {
                          const parsed = Number(
                            event.target.value.replace(/\D/g, ''),
                          )
                          changeQty(
                            component.styleId,
                            Number.isFinite(parsed) ? parsed : 1,
                          )
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="수량 늘리기"
                        onClick={() =>
                          changeQty(component.styleId, component.qty + 1)
                        }
                      >
                        <Plus className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="구성품 제거"
                        onClick={() => removeComponent(component.styleId)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PartnerCodeListPanel({
  brandId,
  partner,
}: PartnerCodeListPanelProps) {
  const queryClient = useQueryClient()
  const [fields, setFields] = useState<PartnerCodeField[]>([])
  const [rows, setRows] = useState<PartnerCodeRow[]>([])
  const [headerOpen, setHeaderOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const migratedKeyRef = useRef('')

  const stylesQuery = useQuery({
    queryKey: ['styles', brandId, 'partner-codes'],
    queryFn: () => getStylesByBrand(brandId),
  })
  const styles = stylesQuery.data ?? []

  const fieldsQuery = useQuery({
    queryKey: ['partnerBarcodeFields', brandId, partner.id],
    queryFn: () => getPartnerBarcodeFields(brandId, partner.id),
  })
  const codesQuery = useQuery({
    queryKey: ['productCodes', brandId, 'partner', partner.id],
    queryFn: () => getProductCodes(brandId, 'partner', partner.id),
  })

  useEffect(() => {
    setSearch('')
    setError(null)
    setEditingRowId(null)
  }, [brandId, partner.id])

  useEffect(() => {
    if (!fieldsQuery.isSuccess || !codesQuery.isSuccess) return

    const dbFields = fieldsQuery.data
    const dbRows = rowsFromCodes(codesQuery.data)
    if (dbFields.length > 0 || dbRows.length > 0) {
      setFields(dbFields)
      setRows(dbRows)
      migratedKeyRef.current = `${brandId}:${partner.id}`
      return
    }

    const migrateKey = `${brandId}:${partner.id}`
    if (migratedKeyRef.current === migrateKey) {
      setFields(dbFields)
      setRows(dbRows)
      return
    }

    const localFields = readPartnerCodeFields(brandId, partner.id)
    const localRows = readPartnerCodeRows(brandId, partner.id)
    if (localFields.length === 0 && localRows.length === 0) {
      setFields([])
      setRows([])
      migratedKeyRef.current = migrateKey
      return
    }
    migratedKeyRef.current = migrateKey

    let cancelled = false
    void (async () => {
      try {
        const savedFields =
          localFields.length > 0
            ? await replacePartnerBarcodeFields(
                brandId,
                partner.id,
                localFields,
              )
            : []
        const remapped = remapRowValues(localRows, localFields, savedFields)
        if (remapped.length > 0) {
          await replacePartnerCodes(
            brandId,
            partner.id,
            toReplaceCodes(remapped, savedFields),
          )
        }
        clearLocalPartnerCodes(brandId, partner.id)
        if (cancelled) return
        setFields(savedFields)
        await queryClient.invalidateQueries({
          queryKey: ['partnerBarcodeFields', brandId, partner.id],
        })
        await queryClient.invalidateQueries({
          queryKey: ['productCodes', brandId, 'partner', partner.id],
        })
      } catch (err) {
        if (cancelled) return
        setFields(localFields)
        setRows(localRows)
        setError(
          err instanceof Error
            ? err.message
            : '브라우저에 있던 거래처 코드를 옮기지 못했습니다.',
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    brandId,
    partner.id,
    fieldsQuery.isSuccess,
    codesQuery.isSuccess,
    fieldsQuery.data,
    codesQuery.data,
    queryClient,
  ])

  const partnerLabel = outboundPartnerDisplayName(partner)
  const codeHeader = partnerBarcodeHeader(partnerLabel)

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter((row) => {
      if (row.code.toLowerCase().includes(keyword)) return true
      if (
        row.components.some((item) =>
          item.styleNo.toLowerCase().includes(keyword),
        )
      ) {
        return true
      }
      return fields.some((field) =>
        (row.values[field.id] ?? '').toLowerCase().includes(keyword),
      )
    })
  }, [rows, fields, search])

  async function persistFields(next: PartnerCodeField[]) {
    setSaving(true)
    setError(null)
    try {
      const saved = await replacePartnerBarcodeFields(
        brandId,
        partner.id,
        next,
      )
      const remapped = remapRowValues(rows, fields, saved)
      setFields(saved)
      setRows(remapped)
      await replacePartnerCodes(
        brandId,
        partner.id,
        toReplaceCodes(remapped, saved),
      )
      await queryClient.invalidateQueries({
        queryKey: ['partnerBarcodeFields', brandId, partner.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['productCodes', brandId, 'partner', partner.id],
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '헤더를 저장하지 못했습니다.',
      )
    } finally {
      setSaving(false)
    }
  }

  const editingRow = rows.find((row) => row.id === editingRowId) ?? null

  async function persistRows(next: PartnerCodeRow[]) {
    setRows(next)
    setSaving(true)
    setError(null)
    try {
      await replacePartnerCodes(
        brandId,
        partner.id,
        toReplaceCodes(next, fields),
      )
      await queryClient.invalidateQueries({
        queryKey: ['productCodes', brandId, 'partner', partner.id],
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '거래처 코드를 저장하지 못했습니다.',
      )
    } finally {
      setSaving(false)
    }
  }

  function applyBulkComponents(
    updates: { rowId: string; components: ProductCodeComponent[] }[],
  ) {
    const byId = new Map(updates.map((item) => [item.rowId, item.components]))
    persistRows(
      rows.map((row) =>
        byId.has(row.id)
          ? { ...row, components: byId.get(row.id)! }
          : row,
      ),
    )
  }

  function updateRowComponents(
    rowId: string,
    components: ProductCodeComponent[],
  ) {
    applyBulkComponents([{ rowId, components }])
  }

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    setError(null)
    try {
      await downloadPartnerCodeTemplate(partnerLabel, fields, rows)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '양식을 내려받지 못했습니다.',
      )
    } finally {
      setDownloading(false)
    }
  }

  async function handleUpload(file: File) {
    setError(null)
    try {
      const sheets = await parseFile(file)
      const sheet = sheets[0]
      if (!sheet || sheet.rows.length === 0) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const [headerRow, ...dataRows] = sheet.rows
      if (!headerRow?.length) {
        setError('헤더 행이 없습니다.')
        return
      }
      const headers = headerRow.map((cell) => cell.trim())
      const codeIndex = headers.findIndex((header) => header === codeHeader)
      if (codeIndex < 0) {
        setError(
          `1열 기준으로 「${codeHeader}」 헤더가 필요합니다. 양식을 다시 받아 주세요.`,
        )
        return
      }

      const componentIndex = headers.findIndex(
        (header) => header === PARTNER_COMPONENT_HEADER,
      )
      if (componentIndex < 0) {
        setError(
          `마지막 열에 「${PARTNER_COMPONENT_HEADER}」 헤더가 필요합니다. 양식을 다시 받아 주세요.`,
        )
        return
      }

      const fieldIndexes = fields.map((field) => ({
        field,
        index: headers.findIndex((header) => header === field.label),
      }))
      const missing = fieldIndexes.filter((item) => item.index < 0)
      if (missing.length > 0) {
        setError(
          `헤더가 맞지 않습니다: ${missing
            .map((item) => item.field.label)
            .join(', ')}`,
        )
        return
      }

      const existingByCode = new Map(rows.map((row) => [row.code, row]))
      const nextRows: PartnerCodeRow[] = []
      const seen = new Set<string>()
      for (const [rowIndex, cells] of dataRows.entries()) {
        const code = (cells[codeIndex] ?? '').trim()
        if (!code) continue
        if (seen.has(code)) {
          setError(`${rowIndex + 2}행: 바코드 「${code}」가 중복입니다.`)
          return
        }
        seen.add(code)
        const values: Record<string, string> = {}
        for (const { field, index } of fieldIndexes) {
          values[field.id] = (cells[index] ?? '').trim()
        }
        const existing = existingByCode.get(code)
        const rawComponents = (cells[componentIndex] ?? '').trim()
        let components = existing?.components ?? []
        if (rawComponents) {
          const parsed = parsePartnerComponentsCell(rawComponents, styles)
          if (parsed.error) {
            setError(`${rowIndex + 2}행: ${parsed.error}`)
            return
          }
          components = parsed.components
        }
        nextRows.push({
          id: existing?.id ?? `row-${partner.id}-${code}`,
          code,
          values,
          components,
        })
      }

      await persistRows(nextRows)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{partnerLabel}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                「{codeHeader}」·추가 헤더·「{PARTNER_COMPONENT_HEADER}」을
                한 양식으로 내려받고 올립니다.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                등록 {formatNumber(rows.length)}건
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setHeaderOpen(true)}
              >
                헤더 설정
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={downloading}
                onClick={() => void handleDownload()}
              >
                <Download className="size-3.5" />
                양식 다운로드
              </Button>
              <label className="inline-flex">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleUpload(file)
                    event.target.value = ''
                  }}
                />
                <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted/50">
                  <Upload className="size-3.5" />
                  엑셀 올리기
                </span>
              </label>
              {rows.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        '이 업체의 바코드 목록을 모두 지울까요?',
                      )
                    ) {
                      void persistRows([])
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                  목록 비우기
                </Button>
              ) : null}
            </div>
          </div>

          {error ? (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder="바코드·항목 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSearch('')}
              >
                <X className="size-3.5" />
                지우기
              </Button>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">
                    {codeHeader}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      고정
                    </span>
                  </th>
                  {fields.map((field) => (
                    <th
                      key={field.id}
                      className="whitespace-nowrap px-4 py-3 font-medium"
                    >
                      {field.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-4 py-3 font-medium">
                    {PARTNER_COMPONENT_HEADER}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      고정
                    </span>
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(2, fields.length + 3)}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      {rows.length === 0
                        ? '아직 데이터가 없습니다. 헤더를 정한 뒤 양식을 받아 올려 주세요.'
                        : '검색 결과가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">
                        {row.code}
                      </td>
                      {fields.map((field) => (
                        <td
                          key={field.id}
                          className={cn(
                            'px-4 py-3',
                            field.type === 'number' && 'tabular-nums',
                          )}
                        >
                          {row.values[field.id] || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <ComponentsCell
                          components={row.components}
                          onEdit={() => setEditingRowId(row.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="구성 수정"
                          onClick={() => setEditingRowId(row.id)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {headerOpen ? (
        <HeaderManagerDialog
          partnerName={partnerLabel}
          fields={fields}
          onClose={() => setHeaderOpen(false)}
          onSave={(next) => {
            void persistFields(next)
          }}
        />
      ) : null}

      {editingRow ? (
        <ComponentsDialog
          row={editingRow}
          styles={styles}
          onClose={() => setEditingRowId(null)}
          onSave={(components) =>
            updateRowComponents(editingRow.id, components)
          }
        />
      ) : null}
    </>
  )
}
