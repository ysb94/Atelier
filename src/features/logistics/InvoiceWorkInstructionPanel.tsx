import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InvoiceWorkInstructionForm } from '@/features/logistics/InvoiceWorkInstructionForm'
import {
  invoiceWorkInstructionStatus,
} from '@/lib/invoice/work-instruction-transform'
import {
  deleteInvoiceWorkInstruction,
  setInvoiceWorkInstructionActive,
} from '@/lib/api'
import {
  INVOICE_GIFT_REQUEST_STATUS_LABEL,
  INVOICE_WORK_INSTRUCTION_COUNT_BASIS_LABEL,
  INVOICE_WORK_INSTRUCTION_MATCH_MODE_LABEL,
  type InvoiceWorkInstruction,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

function formatPeriod(startsAt: string, endsAt: string): string {
  const shortDate = (value: string) =>
    value.slice(0, 10).replaceAll('-', '.').slice(2)
  const time = (value: string) => value.slice(11, 16)
  const startDate = startsAt.slice(0, 10)
  const endDate = endsAt.slice(0, 10)
  if (startDate === endDate) {
    return `${shortDate(startsAt)} ${time(startsAt)} ~ ${time(endsAt)}`
  }
  return `${shortDate(startsAt)} ${time(startsAt)} ~ ${shortDate(endsAt)} ${time(endsAt)}`
}

function statusLabel(instruction: InvoiceWorkInstruction): string {
  const status = invoiceWorkInstructionStatus(instruction)
  if (status === 'running' && !instruction.startsAt) return '사용중'
  return INVOICE_GIFT_REQUEST_STATUS_LABEL[status]
}

function statusVariant(
  instruction: InvoiceWorkInstruction,
): 'success' | 'warning' | 'muted' {
  const status = invoiceWorkInstructionStatus(instruction)
  if (status === 'running') return 'success'
  if (status === 'scheduled') return 'warning'
  return 'muted'
}

export function InvoiceWorkInstructionPanel({
  brandId,
  instructions,
  loading,
  error,
}: {
  brandId: string
  instructions: InvoiceWorkInstruction[]
  loading: boolean
  error: string | null
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    if (!query) return instructions
    return instructions.filter((instruction) =>
      [
        instruction.title,
        instruction.labelText,
        instruction.note,
        INVOICE_WORK_INSTRUCTION_MATCH_MODE_LABEL[instruction.matchMode ?? 'exact'],
        instruction.startsAt && instruction.endsAt ? '기간' : '항상',
        ...instruction.items.map((item) => item.productName),
        ...(instruction.outgoingProducts ?? []).flatMap((ref) => [
          ref.styleNo,
          ref.name,
        ]),
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(query),
    )
  }, [instructions, search])

  const activeCount = instructions.filter(
    (instruction) => instruction.isActive,
  ).length

  function invalidate() {
    return queryClient.invalidateQueries({
      queryKey: ['invoice-work-instructions', brandId],
    })
  }

  const activeMutation = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      setInvoiceWorkInstructionActive(input.id, input.isActive),
    onSuccess: async () => {
      await invalidate()
      setRowError(null)
    },
    onError: (reason) => {
      setRowError(
        reason instanceof Error ? reason.message : '상태를 바꾸지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceWorkInstruction(id),
    onSuccess: async () => {
      await invalidate()
      setPendingDeleteId(null)
      setRowError(null)
    },
    onError: (reason) => {
      setRowError(
        reason instanceof Error ? reason.message : '삭제하지 못했습니다.',
      )
    },
  })

  const editingInstruction = editingId
    ? instructions.find((instruction) => instruction.id === editingId)
    : undefined

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>작업 지시</CardTitle>
          <CardDescription className="mt-1">
            완전일치 또는 시작어로 원본 품목명을 찾아 최종 품목명 앞에 표시
            문구를 붙입니다. 적용은 항상 또는 기간입니다. Gift box 같은
            나가는 제품을 고르면 오늘 작업에서 수량을 셉니다.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="muted">{formatNumber(instructions.length)}건</Badge>
          {activeCount > 0 ? (
            <Badge variant="success">사용중 {activeCount}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="지시명·표시 문구·품목명 검색"
              className="pl-8"
            />
          </div>
          {search ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearch('')}
            >
              <X className="size-3.5" />
              검색 지우기
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={creating ? 'outline' : 'default'}
            onClick={() => {
              setEditingId(null)
              setCreating((current) => !current)
            }}
          >
            {creating ? (
              <>
                <X className="size-3.5" />
                등록 닫기
              </>
            ) : (
              <>
                <Plus className="size-4" />
                작업 지시 등록
              </>
            )}
          </Button>
        </div>

        {creating ? (
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">새 작업 지시</p>
            <InvoiceWorkInstructionForm
              brandId={brandId}
              existingInstructions={instructions}
              onDone={() => setCreating(false)}
            />
          </div>
        ) : null}

        {editingInstruction ? (
          <div className="rounded-lg border border-primary/40 bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">
              작업 지시 수정 · {editingInstruction.title}
            </p>
            <InvoiceWorkInstructionForm
              key={editingInstruction.id}
              brandId={brandId}
              editing={editingInstruction}
              existingInstructions={instructions}
              onDone={() => setEditingId(null)}
            />
          </div>
        ) : null}

        {loading ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-muted-foreground">
            Supabase에서 작업 지시를 불러오고 있습니다.
          </p>
        ) : error ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-danger">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-muted-foreground">
            {instructions.length === 0
              ? '등록된 작업 지시가 없습니다. 작업 지시 등록으로 추가하세요.'
              : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((instruction) => {
              const expanded = expandedId === instruction.id

              return (
                <div
                  key={instruction.id}
                  className={cn(
                    'rounded-lg border border-border',
                    instruction.isActive &&
                      invoiceWorkInstructionStatus(instruction) === 'running' &&
                      'border-success/40',
                    (!instruction.isActive ||
                      invoiceWorkInstructionStatus(instruction) === 'ended') &&
                      'bg-muted/20',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() =>
                        setExpandedId(expanded ? null : instruction.id)
                      }
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {instruction.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {instruction.labelText}
                          {` · ${INVOICE_WORK_INSTRUCTION_MATCH_MODE_LABEL[instruction.matchMode ?? 'exact']}`}
                          {instruction.startsAt && instruction.endsAt
                            ? ` · 기간 ${formatPeriod(instruction.startsAt, instruction.endsAt)}`
                            : ' · 항상'}
                          {instruction.outgoingProducts?.length
                            ? ` · ${INVOICE_WORK_INSTRUCTION_COUNT_BASIS_LABEL[instruction.countBasis]} · ${instruction.outgoingProducts.map((ref) => ref.name).join(', ')}`
                            : ''}
                          {` · 대상 ${formatNumber(instruction.items.length)}건`}
                        </span>
                      </span>
                    </button>
                    <Badge variant={statusVariant(instruction)}>
                      {statusLabel(instruction)}
                    </Badge>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({
                            id: instruction.id,
                            isActive: !instruction.isActive,
                          })
                        }
                      >
                        {instruction.isActive ? '중지' : '다시 사용'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCreating(false)
                          setEditingId(instruction.id)
                        }}
                      >
                        <Pencil className="size-3.5" />
                        수정
                      </Button>
                      {pendingDeleteId === instruction.id ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(instruction.id)}
                          >
                            정말 삭제
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setPendingDeleteId(null)}
                          >
                            취소
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingDeleteId(instruction.id)}
                        >
                          <Trash2 className="size-3.5" />
                          삭제
                        </Button>
                      )}
                    </div>
                  </div>

                  {expanded ? (
                    <div className="border-t border-border px-3 py-3">
                      {instruction.note ? (
                        <p className="mb-2 text-xs text-muted-foreground">
                          {instruction.note}
                        </p>
                      ) : null}
                      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {instruction.items.map((item) => (
                          <li
                            key={item.id}
                            className="rounded-md border border-border bg-muted/10 px-2.5 py-1.5 text-xs"
                          >
                            {item.productName}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {rowError ? <p className="text-xs text-danger">{rowError}</p> : null}
      </CardContent>
    </Card>
  )
}
