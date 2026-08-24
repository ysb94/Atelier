import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import { StyleMultiPicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getInvoiceGiftSourceAllocations,
  saveInvoiceGiftSourceMap,
} from '@/lib/api'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  InvoiceGiftSourceAssignmentMode,
  InvoiceGiftSourceMap,
  StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'

export function InvoiceGiftSourceMapForm({
  brandId,
  editing,
  existingMaps = [],
  onDone,
}: {
  brandId: string
  editing?: InvoiceGiftSourceMap
  existingMaps?: InvoiceGiftSourceMap[]
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [mallName, setMallName] = useState(editing?.mallName ?? '')
  const [productName, setProductName] = useState(editing?.productName ?? '')
  const [selected, setSelected] = useState<StyleRef[]>(
    editing?.poolStyles ?? [],
  )
  const [mode, setMode] = useState<InvoiceGiftSourceAssignmentMode>(
    editing?.assignmentMode ??
      ((editing?.poolStyles.length ?? 0) > 1 ? 'balanced_random' : 'fixed'),
  )
  const [isActive, setIsActive] = useState(editing?.isActive ?? true)
  const [note, setNote] = useState(editing?.note ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  const effectiveMode: InvoiceGiftSourceAssignmentMode =
    selected.length <= 1 ? 'fixed' : mode

  const allocationsQuery = useQuery({
    queryKey: ['invoice-gift-source-allocations', brandId, editing?.id ?? ''],
    queryFn: () =>
      getInvoiceGiftSourceAllocations(brandId, {
        mapIds: editing ? [editing.id] : [],
      }),
    enabled: Boolean(editing?.id),
  })
  const allocations = allocationsQuery.data ?? []
  const allocatedByStyle = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of allocations) {
      counts.set(row.styleId, (counts.get(row.styleId) ?? 0) + 1)
    }
    return counts
  }, [allocations])

  const duplicate = useMemo(() => {
    const mall = normalizeInvoiceText(mallName)
    const product = normalizeInvoiceText(productName)
    if (!mall || !product) return null
    return (
      existingMaps.find(
        (map) =>
          map.id !== editing?.id &&
          map.normalizedMallName === mall &&
          map.normalizedProductName === product,
      ) ?? null
    )
  }, [editing?.id, existingMaps, mallName, productName])

  const canSave =
    mallName.trim().length > 0 &&
    productName.trim().length > 0 &&
    selected.length > 0 &&
    !duplicate

  const mutation = useMutation({
    mutationFn: () =>
      saveInvoiceGiftSourceMap(
        brandId,
        {
          mallName,
          productName,
          assignmentMode: effectiveMode,
          styleIds: selected.map((style) => style.styleId),
          uniquePerRecipient: true,
          isActive,
          note,
        },
        editing?.id,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['invoice-gift-source-maps', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['invoice-gift-source-allocations', brandId],
        }),
      ])
      setFormError(null)
      onDone?.()
    },
    onError: (reason) => {
      setFormError(
        reason instanceof Error ? reason.message : '매핑을 저장하지 못했습니다.',
      )
    },
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label
            htmlFor="gift-source-mall"
            className="mb-1.5 block text-xs font-medium"
          >
            쇼핑몰명
          </label>
          <Input
            id="gift-source-mall"
            value={mallName}
            onChange={(event) => setMallName(event.target.value)}
            placeholder="사방넷 엑셀의 쇼핑몰명 열 그대로"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            제목의 [카카오선물하기]가 아니라, 올린 엑셀 쇼핑몰명 열 값입니다.
            예: Cafe24(신) 유튜브쇼핑
          </p>
        </div>
        <div>
          <label
            htmlFor="gift-source-product"
            className="mb-1.5 block text-xs font-medium"
          >
            원본 품목명
          </label>
          <Input
            id="gift-source-product"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="[사은품] 헤이트 브로콜리 크롭티셔츠 (컬러랜덤)"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            엑셀 품목명 열을 그대로 넣습니다. 공백·대소문자만 정리해서 같은
            값이면 제자리에서 M번호로 바꿉니다.
          </p>
        </div>
      </div>

      {duplicate ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          같은 쇼핑몰·품목명 매핑이 이미 있습니다. 기존 매핑을 고치거나 품목명을
          바꿔 주세요.
        </p>
      ) : null}

      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        사용중
      </label>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-medium">배정 방식</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          원본 행을 지우고 새 행을 붙이는 게 아니라, 그 행의 품목명만 선택한
          M번호로 바꿉니다. 행사 기간·선착순·합포장 산정은 위 요청 건에서
          설정합니다.
        </p>
        <div
          className="mt-3 flex flex-wrap gap-x-5 gap-y-2"
          role="radiogroup"
          aria-label="배정 방식"
        >
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="radio"
              name={`gift-source-map-mode-${editing?.id ?? 'new'}`}
              className="size-3.5 accent-primary"
              checked={effectiveMode === 'fixed'}
              disabled={selected.length > 1}
              onChange={() => setMode('fixed')}
            />
            고정 1종
          </label>
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="radio"
              name={`gift-source-map-mode-${editing?.id ?? 'new'}`}
              className="size-3.5 accent-primary"
              checked={effectiveMode === 'balanced_random'}
              disabled={selected.length <= 1}
              onChange={() => setMode('balanced_random')}
            />
            균등 랜덤
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {selected.length <= 1
            ? 'M번호가 1개면 고정 1종만 쓸 수 있습니다. 2개 이상이면 균등 랜덤을 고를 수 있습니다.'
            : '균등 랜덤은 지금까지 적게 나간 후보 중에서 고릅니다. 같은 파일의 받는분은 가능한 한 서로 다른 M번호를 받습니다. 같은 주문 슬롯은 다시 추첨하지 않습니다.'}
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium">나가는 제품</p>
        <p className="mb-2 text-[11px] text-muted-foreground">
          실제 출고할 M번호를 고릅니다. 고정 1종이면 1개, 균등 랜덤이면 2개
          이상입니다.
        </p>
        <StyleMultiPicker
          brandId={brandId}
          selected={selected}
          onChange={setSelected}
          placeholder="Gift box, M번호 일부 검색"
        />
        {selected.length > 0 ? (
          <div className="mt-3 space-y-1 rounded-md border border-border bg-muted/20 p-3">
            {selected.map((style) => {
              const used = allocatedByStyle.get(style.styleId) ?? 0
              return (
                <p key={style.styleId} className="text-xs">
                  <span className="font-medium">{style.styleNo}</span>
                  <span className="text-muted-foreground"> · {style.name}</span>
                  {used > 0 ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · 배정 {formatNumber(used)}
                    </span>
                  ) : null}
                </p>
              )
            })}
          </div>
        ) : null}
        {editing && allocations.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            이미 배정된 주문 {formatNumber(allocations.length)}건은 후보 풀을
            바꿔도 재추첨하지 않습니다. 새로 들어오는 주문만 새 풀을 씁니다.
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="gift-source-note"
          className="mb-1.5 block text-xs font-medium"
        >
          메모 <span className="font-normal text-muted-foreground">(선택)</span>
        </label>
        <Input
          id="gift-source-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="컬러랜덤 2종, 유튜브쇼핑 전용 등"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={mutation.isPending}
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
          onClick={() => {
            if (!canSave) return
            setFormError(null)
            mutation.mutate()
          }}
        >
          <Save className="size-4" />
          {mutation.isPending
            ? '저장 중...'
            : editing
              ? '매핑 수정'
              : '매핑 저장'}
        </Button>
      </div>

      {formError ? <p className="text-xs text-danger">{formError}</p> : null}
    </div>
  )
}
