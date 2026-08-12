import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  saveInvoicePrefixRequest,
  searchStyleNames,
  type InvoicePrefixRequestInput,
} from '@/lib/api'
import { parsePrefixPaste } from '@/lib/invoice/prefix-paste'
import {
  normalizeInvoiceText,
  parseMoment,
  suggestEndOfDay,
} from '@/lib/invoice/prefix-transform'
import {
  INVOICE_PREFIX_COUNT_BASIS_LABEL,
  type InvoicePrefixCountBasis,
  type InvoicePrefixMergeBasis,
  type InvoicePrefixRequest,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type ItemDraft = {
  productName: string
  prefix: string
  outgoingProductNames: string[]
  isRandom: boolean
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0'),
)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, '0'),
)

const COUNT_BASIS_OPTIONS: InvoicePrefixCountBasis[] = [
  'per_order',
  'per_product',
  'per_quantity',
]

function emptyItem(): ItemDraft {
  return {
    productName: '',
    prefix: '',
    outgoingProductNames: [],
    isRandom: false,
  }
}

function draftsFromRequest(request: InvoicePrefixRequest): ItemDraft[] {
  return request.items.map((item) => ({
    productName: item.productName,
    prefix: item.prefix,
    outgoingProductNames: [...item.outgoingProductNames],
    isRandom: item.isRandom,
  }))
}

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

/** 데이터 시트 상품명을 검색해 나가는 제품 목록에 담는다. */
function OutgoingProductPicker({
  brandId,
  selected,
  onChange,
}: {
  brandId: string
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  const suggestionsQuery = useQuery({
    queryKey: ['invoice-prefix-outgoing-style-names', brandId, debounced],
    queryFn: () => searchStyleNames(brandId, debounced, 8),
    enabled: open && debounced.length > 0,
    staleTime: 30_000,
  })

  const selectedKeys = useMemo(
    () => new Set(selected.map((name) => normalizeInvoiceText(name))),
    [selected],
  )

  const suggestions = (suggestionsQuery.data ?? []).filter(
    (name) => !selectedKeys.has(normalizeInvoiceText(name)),
  )

  function addName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (selectedKeys.has(normalizeInvoiceText(trimmed))) return
    onChange([...selected, trimmed])
    setQuery('')
    setDebounced('')
  }

  function removeName(name: string) {
    const key = normalizeInvoiceText(name)
    onChange(selected.filter((item) => normalizeInvoiceText(item) !== key))
  }

  return (
    <div className="min-w-56 space-y-1.5">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]"
            >
              <span className="truncate">{name}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => removeName(name)}
                aria-label={`${name} 제거`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">아직 고른 제품 없음</p>
      )}
      <div className="relative">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const first = suggestions[0]
              if (first) addName(first)
              else if (query.trim()) addName(query)
            }
          }}
          className="h-8"
          placeholder="데이터 시트 상품명 검색"
        />
        {open && debounced ? (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-40 overflow-auto rounded-md border border-border bg-card shadow-sm">
            {suggestionsQuery.isFetching ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground">
                검색 중...
              </p>
            ) : suggestions.length === 0 ? (
              <button
                type="button"
                className="block w-full px-2 py-2 text-left text-[11px] hover:bg-muted/60"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addName(query)}
              >
                “{query.trim()}” 그대로 추가
              </button>
            ) : (
              suggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="block w-full truncate px-2 py-1.5 text-left text-[11px] hover:bg-muted/60"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addName(name)}
                >
                  {name}
                </button>
              ))
            )}
          </div>
        ) : null}
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
  editing?: InvoicePrefixRequest
  existingRequests?: InvoicePrefixRequest[]
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [mallName, setMallName] = useState(editing?.mallName ?? '')
  const [startsAt, setStartsAt] = useState(editing?.startsAt ?? '')
  const [endsAt, setEndsAt] = useState(editing?.endsAt ?? '')
  const [countBasis, setCountBasis] = useState<InvoicePrefixCountBasis>(
    editing?.countBasis ?? 'per_order',
  )
  const [mergeBasis, setMergeBasis] = useState<InvoicePrefixMergeBasis>(
    editing?.mergeBasis ?? 'per_order',
  )
  const [note, setNote] = useState(editing?.note ?? '')
  const [items, setItems] = useState<ItemDraft[]>(
    editing ? draftsFromRequest(editing) : [],
  )
  const [pasteText, setPasteText] = useState('')
  const [pasteMessage, setPasteMessage] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const filledItems = items.filter(
    (item) =>
      item.productName.trim() &&
      item.prefix.trim() &&
      item.outgoingProductNames.length > 0,
  )
  const canSave =
    Boolean(title.trim() && mallName.trim() && startsAt && endsAt) &&
    filledItems.length > 0

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
      saveInvoicePrefixRequest(brandId, input, editing?.id),
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
        setNote('')
        setItems([])
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
    const parsed = parsePrefixPaste(text)
    if (parsed.rows.length === 0) {
      setPasteMessage(
        '읽을 수 있는 줄이 없습니다. 상품명·접두어(또는 채널상품번호·상품명·접두어)를 복사해 주세요.',
      )
      return
    }

    setItems((current) => {
      const merged = [...current.filter((item) => item.productName.trim())]
      for (const row of parsed.rows) {
        const index = merged.findIndex(
          (item) => item.productName.trim() === row.productName,
        )
        if (index >= 0) {
          merged[index] = {
            ...merged[index]!,
            productName: row.productName,
            prefix: row.prefix,
          }
        } else {
          merged.push({
            productName: row.productName,
            prefix: row.prefix,
            outgoingProductNames: [],
            isRandom: false,
          })
        }
      }
      return merged
    })

    const notes = [`${formatNumber(parsed.rows.length)}개 항목을 읽었습니다.`]
    if (parsed.skippedHeader) notes.push('머리글 줄은 건너뛰었습니다.')
    if (parsed.invalidLines.length > 0) {
      notes.push(
        `열이 부족한 ${parsed.invalidLines.length}줄은 제외했습니다 (${parsed.invalidLines.slice(0, 5).join(', ')}번째 줄).`,
      )
    }
    notes.push('각 행에서 나가는 제품을 골라 주세요.')
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
        if (next.outgoingProductNames.length < 2) next.isRandom = false
        return next
      }),
    )
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
      note,
      isActive: editing?.isActive ?? true,
      items: filledItems,
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[2fr_1.2fr]">
        <div>
          <label
            htmlFor="invoice-prefix-title"
            className="mb-1.5 block text-xs font-medium"
          >
            제목
          </label>
          <Input
            id="invoice-prefix-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="[카카오선물하기] 5월 브랜드데이 사은품 증정 요청의 건"
          />
        </div>
        <div>
          <label
            htmlFor="invoice-prefix-mall"
            className="mb-1.5 block text-xs font-medium"
          >
            쇼핑몰명
          </label>
          <Input
            id="invoice-prefix-mall"
            value={mallName}
            onChange={(event) => setMallName(event.target.value)}
            placeholder="사방넷 쇼핑몰명 그대로"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <MomentField
          id="invoice-prefix-starts"
          label="행사 시작"
          value={startsAt}
          defaultTime="00:00"
          onChange={handleStartsChange}
        />
        <MomentField
          id="invoice-prefix-ends"
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
            htmlFor="invoice-prefix-count-basis"
            className="mb-1.5 block text-xs font-medium"
          >
            사은품 산정
          </label>
          <Select
            id="invoice-prefix-count-basis"
            value={countBasis}
            onChange={(event) =>
              setCountBasis(event.target.value as InvoicePrefixCountBasis)
            }
            className="w-52"
          >
            {COUNT_BASIS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {INVOICE_PREFIX_COUNT_BASIS_LABEL[option]}
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
          합포장은 상자당 1개만
        </label>
      </div>

      {overlapWarnings.length > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          같은 쇼핑몰에 기간이 겹치는 요청 건이 있습니다:{' '}
          {overlapWarnings.map((request) => request.title).join(' · ')}.
          저장은 가능하지만, 같은 상품이 겹치면 오늘 작업에서 골라야 합니다.
        </p>
      ) : null}

      <div>
        <label
          htmlFor="invoice-prefix-note"
          className="mb-1.5 block text-xs font-medium"
        >
          메모 <span className="font-normal text-muted-foreground">(선택)</span>
        </label>
        <Input
          id="invoice-prefix-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="선착순 한정 수량 등 요청 내용 요약"
        />
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
        <label
          htmlFor="invoice-prefix-paste"
          className="mb-1.5 block text-xs font-medium"
        >
          요청서 붙여넣기
        </label>
        <textarea
          id="invoice-prefix-paste"
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
          placeholder="엑셀에서 상품명·접두어(또는 채널상품번호·상품명·접두어)를 복사해 붙여넣으세요. 나가는 제품은 표에서 고릅니다."
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-220 text-left text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2.5 font-medium">상품명 (완전 일치)</th>
              <th className="px-3 py-2.5 font-medium">접두어</th>
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
                const canRandom = item.outgoingProductNames.length >= 2
                return (
                  <tr key={index} className="border-t border-border align-top">
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
                      <Input
                        value={item.prefix}
                        onChange={(event) =>
                          updateItem(index, { prefix: event.target.value })
                        }
                        className="h-8 w-36"
                        placeholder="[사은품 증정]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <OutgoingProductPicker
                        brandId={brandId}
                        selected={item.outgoingProductNames}
                        onChange={(outgoingProductNames) =>
                          updateItem(index, { outgoingProductNames })
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
                        onClick={() =>
                          setItems((current) =>
                            current.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
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
            ? ` · 상품명·접두어·나가는 제품이 빠진 ${formatNumber(items.length - filledItems.length)}행은 제외됩니다`
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
