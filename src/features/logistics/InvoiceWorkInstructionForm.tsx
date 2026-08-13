import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { StyleMultiPicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { saveInvoiceWorkInstruction } from '@/lib/api'
import { parseGiftTargetPaste } from '@/lib/invoice/prefix-paste'
import { parseMoment, suggestEndOfDay } from '@/lib/invoice/prefix-transform'
import {
  INVOICE_WORK_INSTRUCTION_COUNT_BASIS_LABEL,
  type InvoiceWorkInstruction,
  type InvoiceWorkInstructionCountBasis,
  type StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'

const COUNT_BASIS_OPTIONS: InvoiceWorkInstructionCountBasis[] = [
  'per_shipment',
  'per_order',
  'per_row',
  'per_quantity',
]

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0'),
)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, '0'),
)

function periodsOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return true
  return aStart <= bEnd && bStart <= aEnd
}

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

function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function itemsFromInstruction(instruction: InvoiceWorkInstruction): string[] {
  return instruction.items.map((item) => item.productName)
}

/**
 * 작업 지시 등록·수정 폼.
 * 원본 품목명 exact-match로 최종 품목명 앞에 표시 문구를 붙인다.
 * 적용 기간은 선택이다.
 */
export function InvoiceWorkInstructionForm({
  brandId,
  editing,
  existingInstructions = [],
  onDone,
}: {
  brandId: string
  editing?: InvoiceWorkInstruction
  existingInstructions?: InvoiceWorkInstruction[]
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [labelText, setLabelText] = useState(editing?.labelText ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [startsAt, setStartsAt] = useState(editing?.startsAt ?? '')
  const [endsAt, setEndsAt] = useState(editing?.endsAt ?? '')
  const [countBasis, setCountBasis] = useState<InvoiceWorkInstructionCountBasis>(
    editing?.countBasis ?? 'per_shipment',
  )
  const [outgoingProducts, setOutgoingProducts] = useState<StyleRef[]>(
    editing?.outgoingProducts ?? [],
  )
  const [items, setItems] = useState<string[]>(
    editing ? itemsFromInstruction(editing) : [],
  )
  const [pasteText, setPasteText] = useState('')
  const [pasteMessage, setPasteMessage] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const filledItems = items.filter((item) => item.trim())
  const periodReady = (!startsAt && !endsAt) || Boolean(startsAt && endsAt)
  const canSave =
    Boolean(title.trim() && labelText.trim()) &&
    filledItems.length > 0 &&
    periodReady

  const duplicateWarnings = useMemo(() => {
    const start = parseMoment(startsAt)
    const end = parseMoment(endsAt)
    const conflicts: { productName: string; instructionTitle: string }[] = []
    for (const productName of filledItems) {
      const key = normalizeProductName(productName)
      for (const instruction of existingInstructions) {
        if (editing && instruction.id === editing.id) continue
        const overlaps = periodsOverlap(
          start,
          end,
          instruction.startsAt,
          instruction.endsAt,
        )
        if (!overlaps) continue
        if (
          instruction.items.some((item) => item.normalizedProductName === key)
        ) {
          conflicts.push({
            productName,
            instructionTitle: instruction.title,
          })
          break
        }
      }
    }
    return conflicts
  }, [existingInstructions, editing, filledItems, startsAt, endsAt])

  const mutation = useMutation({
    mutationFn: () =>
      saveInvoiceWorkInstruction(
        brandId,
        {
          title,
          labelText,
          note,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          countBasis,
          outgoingStyleIds: outgoingProducts.map((ref) => ref.styleId),
          isActive: editing?.isActive ?? true,
          items: filledItems.map((productName) => ({ productName })),
        },
        editing?.id,
      ),
    onSuccess: async (instruction) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-work-instructions', brandId],
      })
      setFormError(null)
      setSavedMessage(
        `${instruction.title} · 대상 ${formatNumber(instruction.items.length)}건을 저장했습니다.`,
      )
      if (!editing) {
        setTitle('')
        setLabelText('')
        setNote('')
        setStartsAt('')
        setEndsAt('')
        setCountBasis('per_shipment')
        setOutgoingProducts([])
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
    const parsed = parseGiftTargetPaste(text)
    if (parsed.rows.length === 0) {
      setPasteMessage(
        '읽을 수 있는 줄이 없습니다. 원본 품목명을 복사해 주세요. 내품명은 대상이 아닙니다.',
      )
      return
    }

    setItems((current) => {
      const merged = [...current.filter((item) => item.trim())]
      const seen = new Set(merged.map(normalizeProductName))
      for (const row of parsed.rows) {
        const key = normalizeProductName(row.productName)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(row.productName)
      }
      return merged
    })

    const notes = [`${formatNumber(parsed.rows.length)}개 품목명을 읽었습니다.`]
    if (parsed.skippedHeader) notes.push('머리글 줄은 건너뛰었습니다.')
    if (parsed.invalidLines.length > 0) {
      notes.push(
        `열이 부족한 ${parsed.invalidLines.length}줄은 제외했습니다 (${parsed.invalidLines.slice(0, 5).join(', ')}번째 줄).`,
      )
    }
    setPasteMessage(notes.join(' '))
    setPasteText('')
  }

  function updateItem(index: number, value: string) {
    setItems((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? value : row)),
    )
  }

  function submit() {
    if (!canSave) return
    setSavedMessage('')
    setFormError(null)
    mutation.mutate()
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label
            htmlFor="work-instruction-title"
            className="mb-1.5 block text-xs font-medium"
          >
            지시명
          </label>
          <Input
            id="work-instruction-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="전체 선물포장 지시"
          />
        </div>
        <div>
          <label
            htmlFor="work-instruction-label"
            className="mb-1.5 block text-xs font-medium"
          >
            표시 문구
          </label>
          <Input
            id="work-instruction-label"
            value={labelText}
            onChange={(event) => setLabelText(event.target.value)}
            placeholder="[전체 선물포장]"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            최종 품목명 앞에 붙는 문구입니다.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <MomentField
          id="work-instruction-starts"
          label="적용 시작 (선택)"
          value={startsAt}
          defaultTime="00:00"
          onChange={(next) => {
            setStartsAt(next)
            if (next && !endsAt) setEndsAt(suggestEndOfDay(next))
          }}
        />
        <MomentField
          id="work-instruction-ends"
          label="적용 종료 (선택)"
          value={endsAt}
          defaultTime="23:59"
          onChange={setEndsAt}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        비워 두면 중지하기 전까지 항상 적용합니다. 기간을 넣으면 주문일시가 그
        안인 행에만 붙습니다. 날짜만 고르면 시작 00:00 · 종료 23:59로
        채워집니다.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label
            htmlFor="work-instruction-count-basis"
            className="mb-1.5 block text-xs font-medium"
          >
            포장재 산정
          </label>
          <Select
            id="work-instruction-count-basis"
            value={countBasis}
            onChange={(event) =>
              setCountBasis(
                event.target.value as InvoiceWorkInstructionCountBasis,
              )
            }
          >
            {COUNT_BASIS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {INVOICE_WORK_INSTRUCTION_COUNT_BASIS_LABEL[option]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Gift box처럼 실제로 나가는 수량을 이렇게 셉니다. 기본은
            합포장당 1개입니다.
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium">
            나가는 제품{' '}
            <span className="font-normal text-muted-foreground">(선택)</span>
          </p>
          <StyleMultiPicker
            brandId={brandId}
            selected={outgoingProducts}
            onChange={setOutgoingProducts}
            placeholder="Gift box L 등 M번호·상품명 검색"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            오늘 작업에서 집계되고, 이후 재고 예약에 이 수량을 씁니다.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="work-instruction-note"
          className="mb-1.5 block text-xs font-medium"
        >
          메모 <span className="font-normal text-muted-foreground">(선택)</span>
        </label>
        <Input
          id="work-instruction-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="포장 방법·주의사항 등"
        />
      </div>

      {duplicateWarnings.length > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          다른 작업 지시에 이미 등록된 품목명이 있습니다:{' '}
          {duplicateWarnings
            .slice(0, 5)
            .map((conflict) => `${conflict.productName} (${conflict.instructionTitle})`)
            .join(' · ')}
          {duplicateWarnings.length > 5
            ? ` 외 ${duplicateWarnings.length - 5}건`
            : ''}
          . 저장은 가능하지만, 오늘 작업에서 기간이 겹치면 확인이 필요합니다.
        </p>
      ) : null}

      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
        <label
          htmlFor="work-instruction-paste"
          className="mb-1.5 block text-xs font-medium"
        >
          대상 품목명 붙여넣기
        </label>
        <textarea
          id="work-instruction-paste"
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
          placeholder="엑셀에서 원본 품목명을 복사해 붙여넣으세요. 내품명은 쓰지 않습니다."
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {pasteMessage || '붙여넣으면 아래 목록이 채워집니다.'}
          </p>
          <div className="flex gap-2">
            {pasteText.trim() ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyPaste(pasteText)}
              >
                목록으로 읽기
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setItems((current) => [...current, ''])}
            >
              <Plus className="size-3.5" />
              행 추가
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-120 text-left text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2.5 font-medium">원본 품목명</th>
              <th className="w-16 px-3 py-2.5 font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="border-t border-border">
                <td
                  colSpan={2}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  위에 품목명을 붙여넣거나 행 추가로 직접 입력하세요.
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={index} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <Input
                      value={item}
                      onChange={(event) => updateItem(index, event.target.value)}
                      className="h-8 w-full min-w-56"
                    />
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
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          저장 가능한 대상 {formatNumber(filledItems.length)}건
          {items.length !== filledItems.length
            ? ` · 빈 ${formatNumber(items.length - filledItems.length)}행은 제외됩니다`
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
                ? '작업 지시 수정'
                : '작업 지시 저장'}
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
