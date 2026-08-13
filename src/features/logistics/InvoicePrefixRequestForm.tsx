import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { StyleMultiPicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  saveInvoiceGiftRequest,
  type InvoicePrefixRequestInput,
} from '@/lib/api'
import { parseGiftTargetPaste } from '@/lib/invoice/prefix-paste'
import {
  normalizeInvoiceText,
  parseMoment,
  suggestEndOfDay,
} from '@/lib/invoice/prefix-transform'
import {
  INVOICE_GIFT_COUNT_BASIS_LABEL,
  type InvoiceGiftCountBasis,
  type InvoiceGiftLimitMode,
  type InvoiceGiftMergeBasis,
  type InvoiceGiftRequest,
  type StyleRef,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type ItemDraft = {
  key: string
  productName: string
  outgoingProducts: StyleRef[]
  isRandom: boolean
}

function newItemKey() {
  return crypto.randomUUID()
}

function emptyItem(): ItemDraft {
  return {
    key: newItemKey(),
    productName: '',
    outgoingProducts: [],
    isRandom: false,
  }
}

function draftsFromRequest(request: InvoiceGiftRequest): ItemDraft[] {
  return request.items.map((item) => ({
    key: item.id || newItemKey(),
    productName: item.productName,
    outgoingProducts: [...item.outgoingProducts],
    isRandom: item.isRandom,
  }))
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0'),
)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, '0'),
)

const COUNT_BASIS_OPTIONS: InvoiceGiftCountBasis[] = [
  'per_order',
  'per_product',
  'per_quantity',
]

function periodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/** 브라우저 로케일의 오전/오후 없이 날짜 + 24시간제 시·분을 고른다. */
function MomentField({
  id,
  label,
  value,
  defaultTime,
  onChange,
}: {
  id: string
  label: string
  value: string
  defaultTime: string
  onChange: (next: string) => void
}) {
  const date = value.slice(0, 10)
  const time = value.length >= 16 ? value.slice(11, 16) : defaultTime
  const [hour = '00', minute = '00'] = time.split(':')

  function commit(nextDate: string, nextHour: string, nextMinute: string) {
    if (!nextDate) {
      onChange('')
      return
    }
    onChange(`${nextDate} ${nextHour}:${nextMinute}`)
  }

  return (
    <div className="w-fit">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium">
        {label}
      </label>
      <div className="flex w-fit items-center gap-1">
        <Input
          id={id}
          type="date"
          value={date}
          onChange={(event) => commit(event.target.value, hour, minute)}
          className="w-[9.75rem] shrink-0 px-2"
        />
        <Select
          aria-label={`${label} 시`}
          value={hour}
          disabled={!date}
          onChange={(event) => commit(date, event.target.value, minute)}
          className="w-[3.25rem] shrink-0 px-1"
        >
          {HOUR_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground" aria-hidden>
          :
        </span>
        <Select
          aria-label={`${label} 분`}
          value={minute}
          disabled={!date}
          onChange={(event) => commit(date, hour, event.target.value)}
          className="w-[3.25rem] shrink-0 px-1"
        >
          {MINUTE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

/**
 * 사은품 증정 요청서를 그대로 옮기는 폼.
 * 제목·쇼핑몰·기간(분 단위)을 위에 두고 항목은 엑셀 붙여넣기 + 나가는 제품 선택으로 채운다.
 */
export function InvoicePrefixRequestForm({
  brandId,
  editing,
  existingRequests = [],
  onDone,
}: {
  brandId: string
  editing?: InvoiceGiftRequest
  existingRequests?: InvoiceGiftRequest[]
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [mallName, setMallName] = useState(editing?.mallName ?? '')
  const [startsAt, setStartsAt] = useState(editing?.startsAt ?? '')
  const [endsAt, setEndsAt] = useState(editing?.endsAt ?? '')
  const [countBasis, setCountBasis] = useState<InvoiceGiftCountBasis>(
    editing?.countBasis ?? 'per_order',
  )
  const [mergeBasis, setMergeBasis] = useState<InvoiceGiftMergeBasis>(
    editing?.mergeBasis ?? 'per_order',
  )
  const [usesFirstCome, setUsesFirstCome] = useState(
    editing?.usesFirstCome ?? false,
  )
  const [firstComeLimitMode, setFirstComeLimitMode] =
    useState<InvoiceGiftLimitMode>(
      editing?.firstComeLimitMode ?? 'per_style',
    )
  const [firstComeTotalLimit, setFirstComeTotalLimit] = useState(
    editing?.firstComeTotalLimit === null ||
      editing?.firstComeTotalLimit === undefined
      ? ''
      : String(editing.firstComeTotalLimit),
  )
  const [quotaLimits, setQuotaLimits] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const quota of editing?.quotas ?? []) {
      initial[quota.styleId] = String(quota.quantityLimit)
    }
    return initial
  })
  const [note, setNote] = useState(editing?.note ?? '')
  const [items, setItems] = useState<ItemDraft[]>(
    editing ? draftsFromRequest(editing) : [],
  )
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [bulkOutgoing, setBulkOutgoing] = useState<StyleRef[]>([])
  const [pasteText, setPasteText] = useState('')
  const [pasteMessage, setPasteMessage] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const filledItems = items.filter(
    (item) => item.productName.trim() && item.outgoingProducts.length > 0,
  )
  const uniqueOutgoing = useMemo(() => {
    const byId = new Map<string, StyleRef>()
    for (const item of filledItems) {
      for (const ref of item.outgoingProducts) {
        if (!byId.has(ref.styleId)) byId.set(ref.styleId, ref)
      }
    }
    return [...byId.values()].sort(
      (left, right) =>
        left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
        left.name.localeCompare(right.name, 'ko-KR'),
    )
  }, [filledItems])
  const hasAllocationHistory = Boolean(editing?.hasAllocationHistory)
  const canSave =
    Boolean(title.trim() && mallName.trim() && startsAt && endsAt) &&
    filledItems.length > 0 &&
    (!usesFirstCome ||
      (firstComeLimitMode === 'shared_total'
        ? Number.isFinite(Number(firstComeTotalLimit)) &&
          Number(firstComeTotalLimit) >= 1
        : uniqueOutgoing.every((ref) => {
            const value = Number(quotaLimits[ref.styleId])
            return Number.isFinite(value) && value >= 1
          })))

  const overlapWarnings = useMemo(() => {
    const start = parseMoment(startsAt)
    const end = parseMoment(endsAt)
    if (!start || !end || !mallName.trim()) return []

    const mallKey = normalizeInvoiceText(mallName)
    return existingRequests.filter((request) => {
      if (editing && request.id === editing.id) return false
      if (!request.isActive) return false
      if (
        (request.normalizedMallName || normalizeInvoiceText(request.mallName)) !==
        mallKey
      ) {
        return false
      }
      return periodsOverlap(start, end, request.startsAt, request.endsAt)
    })
  }, [startsAt, endsAt, mallName, existingRequests, editing])

  const mutation = useMutation({
    mutationFn: (input: InvoicePrefixRequestInput) =>
      saveInvoiceGiftRequest(brandId, input, editing?.id),
    onSuccess: async (request) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-prefix-requests', brandId],
      })
      setFormError(null)
      setSavedMessage(
        `${request.title} · 항목 ${formatNumber(request.items.length)}건을 저장했습니다.`,
      )
      if (!editing) {
        setTitle('')
        setMallName('')
        setStartsAt('')
        setEndsAt('')
        setCountBasis('per_order')
        setMergeBasis('per_order')
        setUsesFirstCome(false)
        setFirstComeLimitMode('per_style')
        setFirstComeTotalLimit('')
        setQuotaLimits({})
        setNote('')
        setItems([])
        setSelectedItemKeys(new Set())
        setBulkOutgoing([])
        setPasteText('')
        setPasteMessage('')
      }
      onDone?.()
    },
    onError: (reason) => {
      setFormError(
        reason instanceof Error ? reason.message : '저장하지 못했습니다.',
      )
    },
  })

  function applyPaste(text: string) {
    const parsed = parseGiftTargetPaste(text)
    if (parsed.rows.length === 0) {
      setPasteMessage(
        '읽을 수 있는 줄이 없습니다. 원본 품목명을 복사해 주세요. 내품명은 대상이 아닙니다.',
      )
      return
    }

    const merged = [...items.filter((item) => item.productName.trim())]
    for (const row of parsed.rows) {
      const index = merged.findIndex(
        (item) => item.productName.trim() === row.productName,
      )
      if (index >= 0) {
        merged[index] = {
          ...merged[index]!,
          productName: row.productName,
        }
      } else {
        merged.push({
          key: newItemKey(),
          productName: row.productName,
          outgoingProducts: [],
          isRandom: false,
        })
      }
    }
    setItems(merged)
    setSelectedItemKeys(
      new Set(
        merged
          .filter((item) => item.outgoingProducts.length === 0)
          .map((item) => item.key),
      ),
    )

    const notes = [`${formatNumber(parsed.rows.length)}개 항목을 읽었습니다.`]
    if (parsed.skippedHeader) notes.push('머리글 줄은 건너뛰었습니다.')
    if (parsed.invalidLines.length > 0) {
      notes.push(
        `열이 부족한 ${parsed.invalidLines.length}줄은 제외했습니다 (${parsed.invalidLines.slice(0, 5).join(', ')}번째 줄).`,
      )
    }
    notes.push('행을 체크하고 위에서 나가는 제품을 일괄 적용하세요.')
    setPasteMessage(notes.join(' '))
    setPasteText('')
  }

  function handleStartsChange(next: string) {
    setStartsAt(next)
    if (next && !endsAt) {
      setEndsAt(suggestEndOfDay(next))
    }
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row
        const next = { ...row, ...patch }
        if (next.outgoingProducts.length < 2) next.isRandom = false
        return next
      }),
    )
  }

  function toggleItemKey(key: string, checked: boolean) {
    setSelectedItemKeys((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function toggleAllItems(checked: boolean) {
    setSelectedItemKeys(checked ? new Set(items.map((item) => item.key)) : new Set())
  }

  function applyOutgoingToChecked() {
    if (bulkOutgoing.length === 0 || selectedItemKeys.size === 0) return
    setItems((current) =>
      current.map((row) => {
        if (!selectedItemKeys.has(row.key)) return row
        const next = { ...row, outgoingProducts: [...bulkOutgoing] }
        if (next.outgoingProducts.length < 2) next.isRandom = false
        return next
      }),
    )
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((row) => row.key !== key))
    setSelectedItemKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }

  function submit() {
    if (!canSave) return
    setSavedMessage('')
    setFormError(null)
    mutation.mutate({
      title,
      mallName,
      startsAt,
      endsAt,
      countBasis,
      mergeBasis,
      usesFirstCome,
      firstComeLimitMode,
      firstComeTotalLimit:
        usesFirstCome && firstComeLimitMode === 'shared_total'
          ? Math.floor(Number(firstComeTotalLimit))
          : null,
      note,
      isActive: editing?.isActive ?? true,
      items: filledItems.map((item) => ({
        productName: item.productName,
        prefix: '',
        outgoingStyleIds: item.outgoingProducts.map((ref) => ref.styleId),
        isRandom: item.isRandom,
      })),
      quotas: usesFirstCome && firstComeLimitMode === 'per_style'
        ? uniqueOutgoing.map((ref) => ({
            styleId: ref.styleId,
            quantityLimit: Math.floor(Number(quotaLimits[ref.styleId])),
          }))
        : [],
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[2fr_1.2fr]">
        <div>
          <label
            htmlFor="invoice-gift-title"
            className="mb-1.5 block text-xs font-medium"
          >
            제목
          </label>
          <Input
            id="invoice-gift-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="[카카오선물하기] 5월 브랜드데이 사은품 증정 요청의 건"
          />
        </div>
        <div>
          <label
            htmlFor="invoice-gift-mall"
            className="mb-1.5 block text-xs font-medium"
          >
            쇼핑몰명
          </label>
          <Input
            id="invoice-gift-mall"
            value={mallName}
            onChange={(event) => setMallName(event.target.value)}
            placeholder="사방넷 엑셀의 쇼핑몰명 열 그대로"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            제목의 [카카오선물하기]가 아니라, 올린 엑셀 쇼핑몰명 열 값입니다.
            예: 카카오톡선물하기
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <MomentField
          id="invoice-gift-starts"
          label="행사 시작"
          value={startsAt}
          defaultTime="00:00"
          onChange={handleStartsChange}
        />
        <MomentField
          id="invoice-gift-ends"
          label="행사 종료"
          value={endsAt}
          defaultTime="23:59"
          onChange={setEndsAt}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        시각은 24시간제입니다. 날짜만 고르면 시작 00:00 · 종료 23:59로
        채워집니다.
      </p>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <label
            htmlFor="invoice-gift-count-basis"
            className="mb-1.5 block text-xs font-medium"
          >
            사은품 산정
          </label>
          <Select
            id="invoice-gift-count-basis"
            value={countBasis}
            onChange={(event) =>
              setCountBasis(event.target.value as InvoiceGiftCountBasis)
            }
            className="w-52"
          >
            {COUNT_BASIS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {INVOICE_GIFT_COUNT_BASIS_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>
        <label className="mb-1 inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={mergeBasis === 'per_shipment'}
            onChange={(event) =>
              setMergeBasis(event.target.checked ? 'per_shipment' : 'per_order')
            }
          />
          합포장당 1개만
        </label>
      </div>

      {overlapWarnings.length > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          같은 쇼핑몰에 기간이 겹치는 요청 건이 있습니다:{' '}
          {overlapWarnings.map((request) => request.title).join(' · ')}.
          저장은 가능하지만, 같은 상품이 겹치면 오늘 작업에서 골라야 합니다.
        </p>
      ) : null}

      <div className="rounded-lg border border-border p-3">
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={usesFirstCome}
            disabled={hasAllocationHistory && editing?.usesFirstCome}
            onChange={(event) => setUsesFirstCome(event.target.checked)}
          />
          선착순 수량 사용
        </label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          켜면 선택한 한도만큼만 주문일시 순으로 나갑니다. 여러 날에 걸쳐
          처리해도 원장에 누적됩니다.
        </p>
        {usesFirstCome ? (
          <div className="mt-3 space-y-3">
            <div
              className="flex flex-wrap gap-x-5 gap-y-2"
              role="radiogroup"
              aria-label="선착순 한도 방식"
            >
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="invoice-gift-limit-mode"
                  className="size-3.5 accent-primary"
                  value="per_style"
                  checked={firstComeLimitMode === 'per_style'}
                  disabled={hasAllocationHistory}
                  onChange={() => setFirstComeLimitMode('per_style')}
                />
                M번호별 각각 한도
              </label>
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="invoice-gift-limit-mode"
                  className="size-3.5 accent-primary"
                  value="shared_total"
                  checked={firstComeLimitMode === 'shared_total'}
                  disabled={hasAllocationHistory}
                  onChange={() => setFirstComeLimitMode('shared_total')}
                />
                여러 사은품 전체 합계 한도
              </label>
            </div>

            {firstComeLimitMode === 'shared_total' ? (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-64 flex-1 text-xs">
                    <span className="font-medium">전체 사은품 합계</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · 선택한 M번호 {formatNumber(uniqueOutgoing.length)}종에서
                      나가는 실제 사은품 수를 합산
                    </span>
                    {editing && editing.firstComeUsedCount > 0 ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · 확정 {formatNumber(editing.firstComeUsedCount)}
                      </span>
                    ) : null}
                  </p>
                  <Input
                    type="number"
                    min={Math.max(
                      1,
                      hasAllocationHistory
                        ? (editing?.firstComeTotalLimit ?? 0)
                        : 0,
                    )}
                    step={1}
                    value={firstComeTotalLimit}
                    onChange={(event) =>
                      setFirstComeTotalLimit(event.target.value)
                    }
                    placeholder="총 수량"
                    className="h-8 w-28"
                  />
                  <span className="text-[11px] text-muted-foreground">개</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  예: 전체 100개이면 M번호 종류와 관계없이 실제 사은품
                  100개가 확정되는 순간 종료됩니다. 고정 세트는 남은 수량으로
                  전부 구성할 수 있을 때만 지급합니다.
                </p>
              </div>
            ) : uniqueOutgoing.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                아래에서 나가는 제품을 고르면 수량 입력칸이 생깁니다.
              </p>
            ) : (
              uniqueOutgoing.map((ref) => {
                const used =
                  editing?.quotas.find((quota) => quota.styleId === ref.styleId)
                    ?.usedCount ?? 0
                const previousLimit =
                  editing?.quotas.find((quota) => quota.styleId === ref.styleId)
                    ?.quantityLimit ?? 0
                return (
                  <div
                    key={ref.styleId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <p className="min-w-48 flex-1 text-xs">
                      <span className="font-medium">{ref.styleNo}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {ref.name}
                      </span>
                      {used > 0 ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · 확정 {formatNumber(used)}
                        </span>
                      ) : null}
                    </p>
                    <Input
                      type="number"
                      min={Math.max(
                        1,
                        hasAllocationHistory ? previousLimit : 0,
                      )}
                      step={1}
                      value={quotaLimits[ref.styleId] ?? ''}
                      onChange={(event) =>
                        setQuotaLimits((current) => ({
                          ...current,
                          [ref.styleId]: event.target.value,
                        }))
                      }
                      placeholder="수량"
                      className="h-8 w-28"
                    />
                    <span className="text-[11px] text-muted-foreground">개</span>
                  </div>
                )
              })
            )}
          </div>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="invoice-gift-note"
          className="mb-1.5 block text-xs font-medium"
        >
          메모 <span className="font-normal text-muted-foreground">(선택)</span>
        </label>
        <Input
          id="invoice-gift-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="요청 내용 요약"
        />
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
        <label
          htmlFor="invoice-gift-paste"
          className="mb-1.5 block text-xs font-medium"
        >
          요청서 붙여넣기
        </label>
        <textarea
          id="invoice-gift-paste"
          value={pasteText}
          rows={3}
          onChange={(event) => setPasteText(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (!text) return
            event.preventDefault()
            applyPaste(text)
          }}
          className="w-full rounded-md border border-border bg-card px-2.5 py-2 text-xs"
          placeholder="엑셀에서 원본 품목명을 복사해 붙여넣으세요. 내품명은 쓰지 않습니다. 나가는 제품은 아래에서 일괄 적용합니다."
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {pasteMessage || '붙여넣으면 아래 항목 표가 채워집니다.'}
          </p>
          <div className="flex gap-2">
            {pasteText.trim() ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyPaste(pasteText)}
              >
                표로 읽기
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setItems((current) => [...current, emptyItem()])}
            >
              <Plus className="size-3.5" />
              행 추가
            </Button>
          </div>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium">나가는 제품 일괄 적용</p>
          <p className="text-[11px] text-muted-foreground">
            검색어에 맞는 제품을 여러 개 체크한 뒤, 왼쪽에서 고른 행에 한 번에
            넣습니다.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <StyleMultiPicker
              className="min-w-72 flex-1"
              brandId={brandId}
              selected={bulkOutgoing}
              onChange={setBulkOutgoing}
              placeholder="Gift box, M번호 일부 검색"
            />
            <Button
              type="button"
              size="sm"
              disabled={
                selectedItemKeys.size === 0 || bulkOutgoing.length === 0
              }
              onClick={applyOutgoingToChecked}
            >
              체크한 {formatNumber(selectedItemKeys.size)}행에 적용
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-200 text-left text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={
                    items.length > 0 && selectedItemKeys.size === items.length
                  }
                  ref={(element) => {
                    if (element) {
                      element.indeterminate =
                        selectedItemKeys.size > 0 &&
                        selectedItemKeys.size < items.length
                    }
                  }}
                  onChange={(event) => toggleAllItems(event.target.checked)}
                  aria-label="모든 행 선택"
                />
              </th>
              <th className="px-3 py-2.5 font-medium">원본 품목명</th>
              <th className="px-3 py-2.5 font-medium">나가는 제품</th>
              <th className="w-20 px-3 py-2.5 font-medium">랜덤</th>
              <th className="w-16 px-3 py-2.5 font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="border-t border-border">
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  위에 요청서를 붙여넣거나 행 추가로 직접 입력하세요.
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const canRandom = item.outgoingProducts.length >= 2
                const rowChecked = selectedItemKeys.has(item.key)
                return (
                  <tr
                    key={item.key}
                    className={cn(
                      'border-t border-border align-top',
                      rowChecked && 'bg-primary/5',
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        checked={rowChecked}
                        onChange={(event) =>
                          toggleItemKey(item.key, event.target.checked)
                        }
                        aria-label={`${item.productName || '빈 행'} 선택`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={item.productName}
                        onChange={(event) =>
                          updateItem(index, {
                            productName: event.target.value,
                          })
                        }
                        className="h-8 w-full min-w-56"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <StyleMultiPicker
                        brandId={brandId}
                        selected={item.outgoingProducts}
                        onChange={(outgoingProducts) =>
                          updateItem(index, { outgoingProducts })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <label
                        className={cn(
                          'inline-flex items-center gap-1.5 text-[11px]',
                          !canRandom && 'text-muted-foreground',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={item.isRandom}
                          disabled={!canRandom}
                          onChange={(event) =>
                            updateItem(index, {
                              isRandom: event.target.checked,
                            })
                          }
                        />
                        랜덤
                      </label>
                      {!canRandom ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          2개 이상
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => removeItem(item.key)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          저장 가능한 항목 {formatNumber(filledItems.length)}건
          {items.length !== filledItems.length
            ? ` · 품목명·나가는 제품이 빠진 ${formatNumber(items.length - filledItems.length)}행은 제외됩니다`
            : ''}
        </p>
        <div className="flex gap-2">
          {editing ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onDone?.()}
            >
              <X className="size-3.5" />
              취소
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!canSave || mutation.isPending}
            onClick={submit}
          >
            <Save className="size-4" />
            {mutation.isPending
              ? '저장 중...'
              : editing
                ? '요청 건 수정'
                : '요청 건 저장'}
          </Button>
        </div>
      </div>

      {formError ? (
        <p className="text-xs text-danger">{formError}</p>
      ) : savedMessage ? (
        <p className="text-xs text-success">{savedMessage}</p>
      ) : null}
    </div>
  )
}
