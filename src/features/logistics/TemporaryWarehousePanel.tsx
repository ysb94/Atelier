import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FlaskConical,
  History,
  Package,
  Plus,
  Search,
  Truck,
} from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  completeWarehouseBoxOutbound,
  createWarehouseBox,
  getActiveWarehouseInventorySet,
  getWarehouseBoxMovements,
  getWarehouseBoxes,
  getWarehouseRegisteredSlots,
  moveWarehouseBox,
  updateWarehouseBox,
} from '@/lib/api'
import { useRenderWatch } from '@/lib/diagnostics'
import { compareWarehouseLocationCodeNatural } from '@/lib/invoice/product-list-warehouse'
import type {
  StyleRef,
  WarehouseBox,
  WarehouseBoxAction,
  WarehouseBoxMovement,
  WarehouseUsagePriority,
  WarehouseZone,
} from '@/lib/types'
import {
  canCompleteWarehouseBoxOutbound,
  isClosedWarehouseBox,
  warehouseBoxClosedAt,
  warehouseBoxClosedKind,
  warehouseBoxClosedKindLabel,
  warehouseBoxOutboundConfirmText,
} from '@/lib/warehouse/warehouse-box-lifecycle'
import { cn, emptyList, formatNumber } from '@/lib/utils'

type TemporaryWarehouseTab = 'input' | 'box_slots' | 'picking_slots' | 'history'
type TemporaryWarehousePriority = Extract<
  WarehouseUsagePriority,
  'fifo' | 'first' | 'last'
>

const ZONES: Array<{
  value: WarehouseZone
  label: string
  description: string
}> = [
  {
    value: 'box_storage',
    label: '박스창고',
    description: '밀봉 박스만 둘 수 있음 · 개봉 불가',
  },
  {
    value: 'picking',
    label: '출고창고',
    description: '택배 포장·대량 출고 · 개봉 가능',
  },
]

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function zoneLabel(zone: WarehouseZone) {
  return zone === 'box_storage' ? '박스창고' : '출고창고'
}

function priorityLabel(priority: WarehouseUsagePriority) {
  if (priority === 'first') return '최우선'
  if (priority === 'second') return '차순위'
  if (priority === 'last') return '마지막'
  return '입고순'
}

function boxStatusLabel(status: WarehouseBox['status']) {
  if (status === 'depleted') return '소진'
  if (status === 'opened') return '개봉'
  return '밀봉'
}

function boxActionLabel(action: WarehouseBoxAction) {
  if (action === 'create') return '등록'
  if (action === 'update') return '수량 수정'
  if (action === 'move') return '자리 이동'
  if (action === 'open') return '개봉'
  if (action === 'deplete') return '낱개 소진'
  if (action === 'box_outbound') return '박스 단위 출고'
  return '기존 보관'
}

function movementReasonText(movement: WarehouseBoxMovement) {
  if (movement.action === 'archive') return '기존 보관·확인 필요'
  return movement.reason
}

function locationChanged(movement: WarehouseBoxMovement) {
  return (
    locationText(movement.fromZone, movement.fromLocationCode) !==
    locationText(movement.toZone, movement.toLocationCode)
  )
}

function qtyChanged(movement: WarehouseBoxMovement) {
  return movement.fromQty !== movement.toQty
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function locationText(zone: WarehouseZone | null, code: string | null) {
  const parts = [zone ? zoneLabel(zone) : null, code?.trim() || null].filter(
    Boolean,
  )
  return parts.length > 0 ? parts.join(' ') : '—'
}

function mutationErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}

export function TemporaryWarehousePanel({ brandId }: { brandId: string }) {
  useRenderWatch('TemporaryWarehousePanel')
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TemporaryWarehouseTab>('input')
  const [zone, setZone] = useState<WarehouseZone>('box_storage')
  const [boxCode, setBoxCode] = useState('')
  const [style, setStyle] = useState<StyleRef | null>(null)
  const [locationCode, setLocationCode] = useState('')
  const [receivedOn, setReceivedOn] = useState(today)
  const [initialUnits, setInitialUnits] = useState('20')
  const [currentUnits, setCurrentUnits] = useState('20')
  const [priority, setPriority] =
    useState<TemporaryWarehousePriority>('fifo')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const setQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
  })
  const warehouseId = setQuery.data?.warehouseId ?? ''
  const slotsQuery = useQuery({
    queryKey: ['warehouse-registered-slots', warehouseId],
    queryFn: () => getWarehouseRegisteredSlots(warehouseId),
    enabled: Boolean(warehouseId),
  })
  const boxesQuery = useQuery({
    queryKey: ['warehouse-boxes', brandId],
    queryFn: () => getWarehouseBoxes(brandId),
  })
  const registeredSlots = slotsQuery.data ?? emptyList()
  const boxes = boxesQuery.data ?? emptyList()

  useEffect(() => {
    if (!slotsQuery.error) return
    console.warn('[임시창고] 자리 등록표를 불러오지 못함', {
      brandId,
      warehouseId,
      error: slotsQuery.error,
    })
  }, [brandId, slotsQuery.error, warehouseId])

  useEffect(() => {
    if (!boxesQuery.error) return
    console.warn('[임시창고] 개별 박스를 불러오지 못함', {
      brandId,
      error: boxesQuery.error,
    })
  }, [boxesQuery.error, brandId])

  const registeredCodesByZone = useMemo(() => {
    const box: string[] = []
    const picking: string[] = []
    for (const slot of registeredSlots) {
      if (slot.zone === 'picking') picking.push(slot.code)
      else box.push(slot.code)
    }
    box.sort(compareWarehouseLocationCodeNatural)
    picking.sort(compareWarehouseLocationCodeNatural)
    return { box_storage: box, picking }
  }, [registeredSlots])
  const registeredCodes = useMemo(
    () =>
      [
        ...new Set([
          ...registeredCodesByZone.box_storage,
          ...registeredCodesByZone.picking,
        ]),
      ].sort(compareWarehouseLocationCodeNatural),
    [registeredCodesByZone],
  )

  const visibleBoxes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    if (!query) return boxes
    return boxes.filter((box) =>
      [
        box.displayCode,
        box.styleNo,
        box.styleName,
        box.locationCode,
        zoneLabel(box.zone),
      ].some((value) => value.toLocaleLowerCase('ko-KR').includes(query)),
    )
  }, [boxes, search])

  const sharedLocationCodes = useMemo(
    () =>
      [
        ...new Set([
          ...registeredCodes,
          ...boxes.map((box) => box.locationCode),
        ]),
      ].sort(compareWarehouseLocationCodeNatural),
    [boxes, registeredCodes],
  )

  const summary = useMemo(
    () => ({
      box: boxes.filter((box) => box.zone === 'box_storage').length,
      picking: boxes.filter((box) => box.zone === 'picking').length,
      units: boxes.reduce((sum, box) => sum + box.currentQty, 0),
    }),
    [boxes],
  )

  function invalidateBoxes() {
    void queryClient.invalidateQueries({ queryKey: ['warehouse-boxes', brandId] })
    void queryClient.invalidateQueries({
      queryKey: ['warehouse-box-movements', brandId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['warehouse-registered-slots', warehouseId],
    })
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const normalizedBoxCode = boxCode.trim().toUpperCase()
      const normalizedLocation = locationCode.trim()
      const initial = Number(initialUnits)
      const currentQty = Number(currentUnits)
      if (!normalizedBoxCode) {
        throw new Error('박스 고유번호를 입력하세요.')
      }
      if (!style) {
        throw new Error('데이터 시트에서 M번호를 선택하세요.')
      }
      if (!normalizedLocation) {
        throw new Error('자리번호를 입력하세요.')
      }
      if (!receivedOn) {
        throw new Error('입고일을 입력하세요.')
      }
      if (!Number.isInteger(initial) || initial < 1) {
        throw new Error('최초 입수는 1 이상의 정수로 입력하세요.')
      }
      if (!Number.isInteger(currentQty) || currentQty < 0) {
        throw new Error('현재 수량은 0 이상의 정수로 입력하세요.')
      }
      if (currentQty > initial) {
        throw new Error('현재 수량은 최초 입수보다 많을 수 없습니다.')
      }
      if (zone === 'box_storage' && currentQty !== initial) {
        throw new Error(
          '박스창고에서는 개봉할 수 없습니다. 현재 수량을 최초 입수와 같게 저장하거나 출고창고를 선택하세요.',
        )
      }
      return createWarehouseBox(brandId, {
        displayCode: normalizedBoxCode,
        styleId: style.styleId,
        locationCode: normalizedLocation,
        zone,
        receivedOn,
        initialQty: initial,
        currentQty,
        usagePriority: priority,
        note: note.trim(),
      })
    },
    onSuccess: () => {
      setBoxCode('')
      setStyle(null)
      setLocationCode('')
      setCurrentUnits(initialUnits)
      setNote('')
      setFormError(null)
      setFormSuccess('박스를 저장했습니다.')
      invalidateBoxes()
    },
    onError: (error) => {
      const message = mutationErrorMessage(error, '박스를 저장하지 못했습니다.')
      setFormSuccess(null)
      setFormError(message)
      console.warn('[임시창고] 박스 등록 실패', { brandId, error })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: { boxId: string; currentQty: number }) =>
      updateWarehouseBox(brandId, input.boxId, {
        currentQty: input.currentQty,
      }),
    onSuccess: (box) => {
      setFormError(null)
      setFormSuccess(
        box.completionKind === 'depleted'
          ? '수량을 0으로 소진해 박스를 종료했습니다.'
          : '수량을 수정했습니다.',
      )
      invalidateBoxes()
    },
    onError: (error) => {
      const message = mutationErrorMessage(error, '수량을 수정하지 못했습니다.')
      setFormSuccess(null)
      setFormError(message)
      console.warn('[임시창고] 박스 수량 수정 실패', { brandId, error })
    },
  })

  const moveMutation = useMutation({
    mutationFn: (input: {
      boxId: string
      locationCode: string
      zone: WarehouseZone
    }) =>
      moveWarehouseBox(brandId, input.boxId, {
        locationCode: input.locationCode,
        zone: input.zone,
      }),
    onSuccess: () => {
      setFormError(null)
      setFormSuccess('자리를 이동했습니다.')
      invalidateBoxes()
    },
    onError: (error) => {
      const message = mutationErrorMessage(error, '자리를 이동하지 못했습니다.')
      setFormSuccess(null)
      setFormError(message)
      console.warn('[임시창고] 박스 이동 실패', { brandId, error })
    },
  })

  const outboundMutation = useMutation({
    mutationFn: (boxId: string) =>
      completeWarehouseBoxOutbound(brandId, boxId, '밀봉 박스 단위 출고'),
    onSuccess: () => {
      setFormError(null)
      setFormSuccess('박스를 통째로 출고해 종료했습니다. 박스 이력에서 다시 볼 수 있습니다.')
      invalidateBoxes()
    },
    onError: (error) => {
      const message = mutationErrorMessage(error, '박스를 출고하지 못했습니다.')
      setFormSuccess(null)
      setFormError(message)
      console.warn('[임시창고] 박스 출고 실패', { brandId, error })
    },
  })

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    moveMutation.isPending ||
    outboundMutation.isPending
  const listError = boxesQuery.error
    ? mutationErrorMessage(boxesQuery.error, '개별 박스를 불러오지 못했습니다.')
    : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-emerald-300/60 bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
        <div className="flex min-w-0 gap-3">
          <FlaskConical className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-medium">리모델링 후 개별 박스 테스트</p>
            <p className="mt-1 text-xs text-muted-foreground">
              자리 리스트는 창고관리 자리 설정과 같은 등록표를 씁니다. 제품
              입력은 개별 박스 원장에 저장되며 기존 묶음 재고는 건드리지
              않습니다. 한 행은 고유번호가 붙은 실제 박스 하나입니다.
            </p>
          </div>
        </div>
        <Badge variant="success">DB 저장</Badge>
      </div>

      <div
        role="tablist"
        aria-label="임시 창고관리 작업"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {[
          { value: 'input' as const, label: '제품 입력', icon: Plus },
          {
            value: 'box_slots' as const,
            label: '박스창고 자리 리스트',
            icon: Package,
          },
          {
            value: 'picking_slots' as const,
            label: '출고창고 자리 리스트',
            icon: Truck,
          },
          { value: 'history' as const, label: '박스 이력', icon: History },
        ].map((tab) => {
          const Icon = tab.icon
          const selected = tab.value === activeTab
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
                selected
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'input' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Summary
              label="등록 박스"
              value={`${formatNumber(boxes.length)}개`}
            />
            <Summary
              label="박스창고"
              value={`${formatNumber(summary.box)}박스`}
            />
            <Summary
              label="출고창고"
              value={`${formatNumber(summary.picking)}박스`}
            />
            <Summary
              label="현재 수량"
              value={`${formatNumber(summary.units)}개`}
            />
          </div>

          <section className="space-y-4 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-semibold">제품 입력</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                실제 M번호를 고르고 저장하면 새로고침 뒤에도 유지됩니다.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {ZONES.map((item) => {
                const selected = item.value === zone
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setZone(item.value)
                      if (item.value === 'box_storage') {
                        setCurrentUnits(initialUnits)
                      }
                    }}
                    className={cn(
                      'rounded-md border px-3 py-2.5 text-left transition-colors',
                      selected
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              박스창고에서는 박스를 개봉하지 않습니다. 개봉하거나 수량을
              차감하려면 먼저 출고창고의 택배 포장 또는 대량 출고 자리로
              이동해야 합니다.
            </p>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Field label="박스 고유번호" required>
                <Input
                  value={boxCode}
                  onChange={(event) => setBoxCode(event.target.value)}
                  placeholder="예: BOX-000001"
                  className="font-mono font-semibold"
                />
              </Field>
              <Field label="M번호" required>
                <StylePicker
                  brandId={brandId}
                  value={style}
                  onChange={setStyle}
                  placeholder="M번호 또는 상품명 검색"
                  inputClassName="h-9"
                />
              </Field>
              <Field label="상품명">
                <Input
                  value={style?.name ?? ''}
                  readOnly
                  placeholder="M번호를 선택하면 채워집니다"
                />
              </Field>
              <Field label="공용 자리번호" required>
                <>
                  <Input
                    list="temporary-shared-locations"
                    value={locationCode}
                    onChange={(event) => setLocationCode(event.target.value)}
                    placeholder="입력하거나 공용 자리 선택"
                  />
                  <datalist id="temporary-shared-locations">
                    {sharedLocationCodes.map((code) => (
                      <option key={code} value={code} />
                    ))}
                  </datalist>
                </>
              </Field>
              <Field label="입고일" required>
                <Input
                  type="date"
                  value={receivedOn}
                  onChange={(event) => setReceivedOn(event.target.value)}
                />
              </Field>
              <Field label="최초 입수" required>
                <Input
                  type="number"
                  min="1"
                  value={initialUnits}
                  onChange={(event) => {
                    const next = event.target.value
                    setCurrentUnits((current) =>
                      zone === 'box_storage' || current === initialUnits
                        ? next
                        : current,
                    )
                    setInitialUnits(next)
                  }}
                />
              </Field>
              <Field
                label={
                  zone === 'box_storage'
                    ? '현재 수량 (밀봉 고정)'
                    : '현재 수량 (개봉 후)'
                }
                required
              >
                <Input
                  type="number"
                  min="0"
                  value={currentUnits}
                  disabled={zone === 'box_storage'}
                  onChange={(event) => setCurrentUnits(event.target.value)}
                />
              </Field>
              <Field label="사용 순서">
                <select
                  value={priority}
                  onChange={(event) =>
                    setPriority(
                      event.target.value as TemporaryWarehousePriority,
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="fifo">입고일 순서</option>
                  <option value="first">최우선</option>
                  <option value="last">마지막</option>
                </select>
              </Field>
            </div>

            <p className="text-xs text-muted-foreground">
              등록된 자리 {formatNumber(registeredCodes.length)}개 · 자리
              리스트 탭이나 입력창에서 고르세요.
              {slotsQuery.isError
                ? ' 자리 등록표를 불러오지 못했습니다.'
                : setQuery.isLoading || slotsQuery.isLoading
                  ? ' 자리 등록표를 불러오는 중...'
                  : ''}
            </p>

            <Field label="비고">
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="검수 내용이나 특이사항"
              />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 text-xs">
                {formError || listError ? (
                  <p className="text-destructive">{formError ?? listError}</p>
                ) : formSuccess ? (
                  <p className="text-emerald-700 dark:text-emerald-400">
                    {formSuccess}
                  </p>
                ) : createMutation.isPending ? (
                  <p className="text-muted-foreground">저장하는 중...</p>
                ) : boxesQuery.isLoading ? (
                  <p className="text-muted-foreground">박스 목록을 불러오는 중...</p>
                ) : null}
              </div>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFormError(null)
                  setFormSuccess(null)
                  createMutation.mutate()
                }}
              >
                <Plus className="size-4" />
                박스 저장
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">등록 박스 목록</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  박스창고의 밀봉 박스를 출고창고로 이동한 뒤 수량을 수정해
                  개봉합니다. 잔여가 있는 박스는 목록에서 임의로 내릴 수
                  없습니다. 밀봉 박스는 박스 출고, 개봉 박스는 수량을 0으로
                  소진해야 종료됩니다.
                </p>
              </div>
              <label className="relative block w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="박스번호·M번호·상품명·자리 검색"
                  className="pl-8"
                />
              </label>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1280px] text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-semibold text-foreground">
                      박스 고유번호
                    </th>
                    <th className="px-3 py-2 font-medium">창고</th>
                    <th className="px-3 py-2 font-medium">M번호</th>
                    <th className="px-3 py-2 font-medium">상품명</th>
                    <th className="px-3 py-2 font-medium">자리</th>
                    <th className="px-3 py-2 font-medium">입고일</th>
                    <th className="px-3 py-2 text-right font-medium">최초 입수</th>
                    <th className="px-3 py-2 font-medium">현재 수량</th>
                    <th className="px-3 py-2 font-medium">상태</th>
                    <th className="px-3 py-2 font-medium">순서</th>
                    <th className="px-3 py-2 font-medium">자리 이동</th>
                    <th className="px-3 py-2 font-medium">종료</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBoxes.map((box) => (
                    <TemporaryWarehouseBoxRow
                      key={box.id}
                      box={box}
                      sharedLocationCodes={sharedLocationCodes}
                      disabled={busy}
                      onUpdateQty={(currentQty) =>
                        updateMutation.mutate({ boxId: box.id, currentQty })
                      }
                      onMove={(next) =>
                        moveMutation.mutate({
                          boxId: box.id,
                          locationCode: next.locationCode,
                          zone: next.zone,
                        })
                      }
                      onOutbound={() => {
                        if (!window.confirm(warehouseBoxOutboundConfirmText(box))) {
                          return
                        }
                        outboundMutation.mutate(box.id)
                      }}
                    />
                  ))}
                  {visibleBoxes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={12}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        {boxesQuery.isLoading
                          ? '박스 목록을 불러오는 중...'
                          : listError
                            ? listError
                            : boxes.length === 0
                              ? '위 입력란에서 고유번호가 있는 박스를 저장하세요.'
                              : '검색 조건에 맞는 박스가 없습니다.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : activeTab === 'history' ? (
        <TemporaryWarehouseHistoryList brandId={brandId} />
      ) : (
        <TemporaryWarehouseSlotList
          zone={activeTab === 'box_slots' ? 'box_storage' : 'picking'}
          boxes={boxes}
          registeredCodes={
            registeredCodesByZone[
              activeTab === 'box_slots' ? 'box_storage' : 'picking'
            ]
          }
          loading={
            setQuery.isLoading ||
            slotsQuery.isLoading ||
            boxesQuery.isLoading
          }
          error={
            slotsQuery.error instanceof Error
              ? slotsQuery.error.message
              : slotsQuery.isError
                ? '자리 등록표를 불러오지 못했습니다.'
                : listError
          }
          onUseLocation={(code, nextZone) => {
            setZone(nextZone)
            if (nextZone === 'box_storage') {
              setCurrentUnits(initialUnits)
            }
            setLocationCode(code)
            setActiveTab('input')
          }}
        />
      )}
    </div>
  )
}

function TemporaryWarehouseHistoryList({ brandId }: { brandId: string }) {
  const [style, setStyle] = useState<StyleRef | null>(null)
  const [search, setSearch] = useState('')
  const [openBoxId, setOpenBoxId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const pageSize = 50

  const boxesQuery = useQuery({
    queryKey: ['warehouse-boxes', brandId, { includeClosed: true }],
    queryFn: () => getWarehouseBoxes(brandId, { includeClosed: true }),
  })
  const movementsQuery = useQuery({
    queryKey: ['warehouse-box-movements', brandId],
    queryFn: () => getWarehouseBoxMovements(brandId),
  })

  useEffect(() => {
    if (!boxesQuery.error) return
    console.warn('[임시창고] 종료 박스를 불러오지 못함', {
      brandId,
      error: boxesQuery.error,
    })
  }, [boxesQuery.error, brandId])

  useEffect(() => {
    if (!movementsQuery.error) return
    console.warn('[임시창고] 박스 이력을 불러오지 못함', {
      brandId,
      error: movementsQuery.error,
    })
  }, [brandId, movementsQuery.error])

  const closedBoxes = useMemo(
    () =>
      (boxesQuery.data ?? emptyList())
        .filter(isClosedWarehouseBox)
        .slice()
        .sort((left, right) => {
          const leftAt = warehouseBoxClosedAt(left) ?? left.updatedAt
          const rightAt = warehouseBoxClosedAt(right) ?? right.updatedAt
          return rightAt.localeCompare(leftAt)
        }),
    [boxesQuery.data],
  )
  const movementsByBoxId = useMemo(() => {
    const grouped = new Map<string, WarehouseBoxMovement[]>()
    for (const movement of movementsQuery.data ?? emptyList()) {
      const rows = grouped.get(movement.boxId)
      if (rows) rows.push(movement)
      else grouped.set(movement.boxId, [movement])
    }
    return grouped
  }, [movementsQuery.data])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    return closedBoxes.filter((box) => {
      if (style && box.styleId !== style.styleId) return false
      if (!query) return true
      return [
        box.displayCode,
        box.styleNo,
        box.styleName,
        box.locationCode,
        zoneLabel(box.zone),
        box.note,
      ].some((value) => value.toLocaleLowerCase('ko-KR').includes(query))
    })
  }, [closedBoxes, search, style])

  useEffect(() => {
    setPage(0)
  }, [search, style?.styleId])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  )
  const error = boxesQuery.error
    ? mutationErrorMessage(boxesQuery.error, '박스 이력을 불러오지 못했습니다.')
    : movementsQuery.error
      ? mutationErrorMessage(
          movementsQuery.error,
          '박스 이력을 불러오지 못했습니다.',
        )
      : null
  const loading = boxesQuery.isLoading || movementsQuery.isLoading

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="종료 박스"
          value={`${formatNumber(closedBoxes.length)}개`}
        />
        <Summary
          label="확인 필요"
          value={`${formatNumber(
            closedBoxes.filter(
              (box) => warehouseBoxClosedKind(box) === 'legacy_archive',
            ).length,
          )}개`}
        />
        <Summary
          label="선택 제품"
          value={style ? style.styleNo : '전체'}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">박스 이력</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            낱개 소진·박스 단위 출고로 종료된 박스와, 예전 보관으로 남은 확인
            필요 건을 구분해서 봅니다. 기존 보관 4건은 실제 처분을 알 수 없어
            자동으로 바꾸지 않습니다.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <div className="w-full sm:w-72">
            <StylePicker
              brandId={brandId}
              value={style}
              onChange={setStyle}
              placeholder="M번호 또는 상품명 검색"
              inputClassName="h-9"
            />
          </div>
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="M번호·상품명·박스번호 검색"
              className="pl-8"
            />
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1080px] text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold text-foreground">
                박스 고유번호
              </th>
              <th className="px-3 py-2 font-medium">M번호</th>
              <th className="px-3 py-2 font-medium">상품명</th>
              <th className="px-3 py-2 font-medium">마지막 자리</th>
              <th className="px-3 py-2 font-medium">입고일</th>
              <th className="px-3 py-2 text-right font-medium">최초 입수</th>
              <th className="px-3 py-2 text-right font-medium">잔여 수량</th>
              <th className="px-3 py-2 font-medium">종료일</th>
              <th className="px-3 py-2 font-medium">종료 종류</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((box) => {
              const movements = movementsByBoxId.get(box.id) ?? emptyList()
              const open = openBoxId === box.id
              return (
                <TemporaryWarehouseHistoryRow
                  key={box.id}
                  box={box}
                  movements={movements}
                  open={open}
                  onToggle={() =>
                    setOpenBoxId((current) =>
                      current === box.id ? null : box.id,
                    )
                  }
                />
              )
            })}
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {error
                    ? error
                    : loading
                      ? '박스 이력을 불러오는 중...'
                      : closedBoxes.length === 0
                        ? '아직 종료된 박스가 없습니다. 수량을 0으로 소진하거나 밀봉 박스를 출고하면 여기에 남습니다.'
                        : '검색 조건에 맞는 박스 이력이 없습니다.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {filtered.length > pageSize ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {formatNumber(safePage * pageSize + 1)}–
            {formatNumber(Math.min((safePage + 1) * pageSize, filtered.length))}
            /{formatNumber(filtered.length)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            이전
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safePage >= pageCount - 1}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            다음
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function TemporaryWarehouseHistoryRow({
  box,
  movements,
  open,
  onToggle,
}: {
  box: WarehouseBox
  movements: WarehouseBoxMovement[]
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className="border-t border-border">
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="inline-flex items-center gap-2 text-left"
          >
            <Badge variant="outline" className="font-mono font-semibold">
              {box.displayCode}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {open ? '이력 접기' : `이력 ${formatNumber(movements.length)}건`}
            </span>
          </button>
        </td>
        <td className="px-3 py-2 font-medium">{box.styleNo || '—'}</td>
        <td className="max-w-52 truncate px-3 py-2">{box.styleName || '—'}</td>
        <td className="px-3 py-2">
          {locationText(box.zone, box.locationCode)}
        </td>
        <td className="px-3 py-2 tabular-nums">{box.receivedOn || '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {formatNumber(box.initialQty)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {formatNumber(box.currentQty)}
        </td>
        <td className="px-3 py-2 tabular-nums">
          {formatDateTime(warehouseBoxClosedAt(box))}
        </td>
        <td className="px-3 py-2">
          <Badge
            variant={
              warehouseBoxClosedKind(box) === 'legacy_archive'
                ? 'outline'
                : 'muted'
            }
          >
            {warehouseBoxClosedKindLabel(warehouseBoxClosedKind(box))}
          </Badge>
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={9} className="px-3 py-3">
            {movements.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                이 박스의 상세 이력이 없습니다.
              </p>
            ) : (
              <ol className="space-y-2">
                {movements.map((movement) => {
                  const reason = movementReasonText(movement)
                  const showLocation =
                    movement.action !== 'archive' || locationChanged(movement)
                  const showQty =
                    (movement.fromQty != null || movement.toQty != null) &&
                    (movement.action !== 'archive' || qtyChanged(movement))
                  return (
                  <li
                    key={movement.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {formatDateTime(movement.createdAt)}
                    </span>
                    <Badge
                      variant={
                        movement.action === 'archive' ||
                        movement.action === 'box_outbound' ||
                        movement.action === 'deplete'
                          ? 'outline'
                          : 'muted'
                      }
                    >
                      {boxActionLabel(movement.action)}
                    </Badge>
                    {showLocation ? (
                      <span>
                        {locationText(
                          movement.fromZone,
                          movement.fromLocationCode,
                        )}
                        {' → '}
                        {locationText(movement.toZone, movement.toLocationCode)}
                      </span>
                    ) : null}
                    {showQty ? (
                      <span className="tabular-nums text-muted-foreground">
                        {movement.fromQty == null
                          ? '—'
                          : formatNumber(movement.fromQty)}
                        {' → '}
                        {movement.toQty == null
                          ? '—'
                          : formatNumber(movement.toQty)}
                      </span>
                    ) : null}
                    {reason ? (
                      <span className="text-muted-foreground">{reason}</span>
                    ) : null}
                  </li>
                  )
                })}
              </ol>
            )}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function TemporaryWarehouseBoxRow({
  box,
  sharedLocationCodes,
  disabled,
  onUpdateQty,
  onMove,
  onOutbound,
}: {
  box: WarehouseBox
  sharedLocationCodes: string[]
  disabled: boolean
  onUpdateQty: (currentQty: number) => void
  onMove: (input: { locationCode: string; zone: WarehouseZone }) => void
  onOutbound: () => void
}) {
  const [qty, setQty] = useState(String(box.currentQty))
  const [moveZone, setMoveZone] = useState<WarehouseZone>(box.zone)
  const [moveLocation, setMoveLocation] = useState(box.locationCode)
  const canChangeQuantity = box.zone === 'picking'
  const canMoveToBoxStorage = box.status === 'sealed'
  const canOutbound = canCompleteWarehouseBoxOutbound(box)

  useEffect(() => {
    setQty(String(box.currentQty))
    setMoveZone(box.zone)
    setMoveLocation(box.locationCode)
  }, [box.currentQty, box.locationCode, box.zone])

  return (
    <tr className="border-t border-border">
      <td className="sticky left-0 z-[1] bg-card px-3 py-2">
        <Badge variant="outline" className="font-mono font-semibold">
          {box.displayCode}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <Badge variant={box.zone === 'picking' ? 'default' : 'muted'}>
          {zoneLabel(box.zone)}
        </Badge>
      </td>
      <td className="px-3 py-2 font-medium">{box.styleNo}</td>
      <td className="max-w-52 truncate px-3 py-2">{box.styleName || '—'}</td>
      <td className="px-3 py-2">{box.locationCode}</td>
      <td className="px-3 py-2 tabular-nums">{box.receivedOn || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatNumber(box.initialQty)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min="0"
            max={box.initialQty}
            value={qty}
            disabled={disabled || !canChangeQuantity}
            onChange={(event) => setQty(event.target.value)}
            className="h-8 w-20"
            title={
              canChangeQuantity
                ? '출고창고에서 개봉 수량을 입력합니다.'
                : '박스창고에서는 개봉할 수 없습니다.'
            }
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !canChangeQuantity}
            onClick={() => {
              const next = Number(qty)
              if (!Number.isInteger(next) || next < 0) return
              onUpdateQty(next)
            }}
          >
            {canChangeQuantity ? '저장' : '이동 후 개봉'}
          </Button>
        </div>
      </td>
      <td className="px-3 py-2">{boxStatusLabel(box.status)}</td>
      <td className="px-3 py-2">{priorityLabel(box.usagePriority)}</td>
      <td className="px-3 py-2">
        <div className="flex min-w-72 items-center gap-1">
          <select
            value={moveZone}
            disabled={disabled}
            onChange={(event) =>
              setMoveZone(event.target.value as WarehouseZone)
            }
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none"
          >
            <option value="box_storage" disabled={!canMoveToBoxStorage}>
              박스창고
            </option>
            <option value="picking">출고창고(택배·대량)</option>
          </select>
          <Input
            list={`temporary-move-locations-${box.id}`}
            value={moveLocation}
            disabled={disabled}
            onChange={(event) => setMoveLocation(event.target.value)}
            className="h-8 w-28"
          />
          <datalist id={`temporary-move-locations-${box.id}`}>
            {sharedLocationCodes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              const next = moveLocation.trim()
              if (!next) return
              onMove({ locationCode: next, zone: moveZone })
            }}
          >
            이동
          </Button>
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !canOutbound}
          title={
            canOutbound
              ? '밀봉 박스를 통째로 출고하고 종료합니다.'
              : '개봉 박스는 남은 수량을 0으로 소진하세요.'
          }
          aria-label={`${box.displayCode} 박스 출고`}
          onClick={onOutbound}
        >
          박스 출고
        </Button>
      </td>
    </tr>
  )
}

function TemporaryWarehouseSlotList({
  zone,
  boxes,
  registeredCodes,
  loading,
  error,
  onUseLocation,
}: {
  zone: WarehouseZone
  boxes: WarehouseBox[]
  registeredCodes: string[]
  loading: boolean
  error: string | null
  onUseLocation: (code: string, zone: WarehouseZone) => void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 50
  const label = zoneLabel(zone)

  const slots = useMemo(() => {
    const grouped = new Map<
      string,
      {
        code: string
        registered: boolean
        boxCodes: string[]
        styleNos: Set<string>
        currentUnits: number
      }
    >()
    for (const code of registeredCodes) {
      grouped.set(code, {
        code,
        registered: true,
        boxCodes: [],
        styleNos: new Set(),
        currentUnits: 0,
      })
    }
    for (const box of boxes) {
      if (box.zone !== zone) continue
      const slot = grouped.get(box.locationCode) ?? {
        code: box.locationCode,
        registered: false,
        boxCodes: [],
        styleNos: new Set<string>(),
        currentUnits: 0,
      }
      slot.boxCodes.push(box.displayCode)
      slot.styleNos.add(box.styleNo)
      slot.currentUnits += box.currentQty
      grouped.set(box.locationCode, slot)
    }
    return [...grouped.values()].sort((left, right) =>
      compareWarehouseLocationCodeNatural(left.code, right.code),
    )
  }, [boxes, registeredCodes, zone])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    if (!query) return slots
    return slots.filter((slot) =>
      [slot.code, ...slot.boxCodes, ...slot.styleNos].some((value) =>
        value.toLocaleLowerCase('ko-KR').includes(query),
      ),
    )
  }, [search, slots])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const occupied = slots.filter((slot) => slot.boxCodes.length > 0).length
  const boxTotal = slots.reduce((sum, slot) => sum + slot.boxCodes.length, 0)

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="등록 자리"
          value={`${formatNumber(registeredCodes.length)}개`}
        />
        <Summary
          label={`${label} 사용 자리`}
          value={`${formatNumber(occupied)}개`}
        />
        <Summary
          label={`${label} 박스`}
          value={`${formatNumber(boxTotal)}개`}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{label} 자리 리스트</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            창고관리 {label} 자리 설정과 같은 등록표입니다. 이 목록의 박스
            점유는 저장된 개별 박스입니다.
          </p>
        </div>
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
            placeholder="자리·박스번호·M번호 검색"
            className="pl-8"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold text-foreground">
                자리번호
              </th>
              <th className="px-3 py-2 font-medium">등록</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 text-right font-medium">박스</th>
              <th className="px-3 py-2 font-medium">M번호</th>
              <th className="px-3 py-2 text-right font-medium">현재 수량</th>
              <th className="px-3 py-2 font-medium">박스 고유번호</th>
              <th className="w-28 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {paged.map((slot) => (
              <tr key={slot.code} className="border-t border-border">
                <td className="px-3 py-2 font-mono font-semibold">
                  {slot.code}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={slot.registered ? 'success' : 'warning'}>
                    {slot.registered ? '저장됨' : '미등록'}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={slot.boxCodes.length > 0 ? 'default' : 'muted'}>
                    {slot.boxCodes.length > 0 ? '사용 중' : '비어 있음'}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(slot.boxCodes.length)}
                </td>
                <td className="max-w-52 truncate px-3 py-2">
                  {[...slot.styleNos].join(', ') || '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(slot.currentUnits)}
                </td>
                <td className="max-w-64 px-3 py-2 font-mono">
                  {slot.boxCodes.join(', ') || '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onUseLocation(slot.code, zone)}
                  >
                    이 자리로 입력
                  </Button>
                </td>
              </tr>
            ))}
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {error
                    ? error
                    : loading
                      ? '자리 등록표를 불러오는 중...'
                      : slots.length === 0
                        ? `창고관리 ${label} 자리 설정에 등록된 자리가 없습니다.`
                        : '검색 조건에 맞는 자리가 없습니다.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {filtered.length > pageSize ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {formatNumber(safePage * pageSize + 1)}–
            {formatNumber(Math.min((safePage + 1) * pageSize, filtered.length))}
            /{formatNumber(filtered.length)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            이전
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safePage >= pageCount - 1}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            다음
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="block space-y-1.5 text-xs">
      <span className="text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
    </div>
  )
}
