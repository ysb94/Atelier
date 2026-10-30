import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Textarea } from '@/components/ui/input'
import {
  getActiveWarehouseInventorySet,
  getWarehouseRegisteredSlots,
  saveWarehouseRegisteredSlots,
} from '@/lib/api'
import { compareWarehouseLocationCodeNatural } from '@/lib/invoice/product-list-warehouse'
import { useRenderWatch } from '@/lib/diagnostics'
import type { WarehouseZone } from '@/lib/types'
import { emptyList, formatNumber } from '@/lib/utils'
import { classifyWarehouseSheetZone } from '@/lib/warehouse/sheet-sync'
import { OutboundSlotGenerator } from './OutboundSlotGenerator'

const MAX_ADD_ROWS = 200
const TABLE_PAGE_SIZE = 50

type SlotMode = 'range' | 'list'

function normalizeLocationCode(raw: string) {
  return raw.trim().replace(/\s+/g, '').replace(/\/+$/, '')
}

function buildRangeCodes(prefix: string, startText: string, endText: string) {
  const base = prefix.trim().replace(/-+$/, '')
  const start = Number(startText)
  const end = Number(endText)
  if (!base || !Number.isInteger(start) || !Number.isInteger(end)) return []
  if (start < 1 || end < start) return []
  const count = end - start + 1
  if (count > MAX_ADD_ROWS) return []
  return Array.from({ length: count }, (_, index) => `${base}-${start + index}`)
}

function parseListCodes(text: string, preserveInput = false) {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const code = preserveInput ? line.trim() : normalizeLocationCode(line)
    if (!code || seen.has(code)) continue
    seen.add(code)
    codes.push(code)
  }
  return codes
}

export function WarehouseSlotSettingsPanel({
  brandId,
  warehouseLabel,
  zone,
}: {
  brandId: string
  warehouseLabel: string
  zone: WarehouseZone
}) {
  useRenderWatch('WarehouseSlotSettingsPanel')
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<SlotMode>('range')
  const [pickingInputMode, setPickingInputMode] = useState<'list' | 'rack'>('list')
  const [checkCode, setCheckCode] = useState('')
  const [prefix, setPrefix] = useState('2-1')
  const [startNo, setStartNo] = useState('1')
  const [endNo, setEndNo] = useState('12')
  const [listText, setListText] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [tablePage, setTablePage] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [hydratedKey, setHydratedKey] = useState('')

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
  const registeredSlots = slotsQuery.data ?? emptyList()
  const savedCodes = useMemo(
    () =>
      new Set(
        registeredSlots
          .filter((slot) => slot.zone === zone)
          .map((slot) => slot.code),
      ),
    [registeredSlots, zone],
  )
  const seedCodes = useMemo(
    () => [...savedCodes].sort(compareWarehouseLocationCodeNatural),
    [savedCodes],
  )

  useEffect(() => {
    if (setQuery.isLoading || slotsQuery.isLoading) return
    const key = `${warehouseId}:${zone}`
    if (key === hydratedKey) return
    setCodes(seedCodes)
    setSearch('')
    setTablePage(0)
    setHydratedKey(key)
  }, [hydratedKey, seedCodes, setQuery.isLoading, slotsQuery.isLoading, warehouseId, zone])

  const addedCount = useMemo(
    () => codes.filter((code) => !savedCodes.has(code)).length,
    [codes, savedCodes],
  )
  const removedCount = useMemo(
    () => [...savedCodes].filter((code) => !codes.includes(code)).length,
    [codes, savedCodes],
  )
  const dirty = addedCount > 0 || removedCount > 0

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko-KR')
    if (!keyword) return codes
    return codes.filter((code) =>
      code.toLocaleLowerCase('ko-KR').includes(keyword),
    )
  }, [codes, search])

  const tablePageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE))
  const currentTablePage = Math.min(tablePage, tablePageCount - 1)
  const pageRows = filtered.slice(
    currentTablePage * TABLE_PAGE_SIZE,
    currentTablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE,
  )

  const saveMutation = useMutation({
    mutationFn: () => saveWarehouseRegisteredSlots(warehouseId, zone, codes, brandId),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['warehouse-registered-slots', warehouseId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-stock-positions', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-inventory-set', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-inventory-sets', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-finder', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-finder-inbounds', brandId] }),
      ])
      setStatus('자리 설정을 저장했습니다. 현재 재고 ' + formatNumber(result.reclassifiedCount) + '행의 창고 분류를 갱신했습니다.')
    },
    onError: (error) => {
      console.warn('[warehouse-slots] 자리 저장 실패', { warehouseId, zone, error })
      setStatus(
        error instanceof Error ? error.message : '자리 설정을 저장하지 못했습니다.',
      )
    },
  })

  const listCodes = useMemo(() => parseListCodes(listText, zone === 'picking'), [listText, zone])
  const usingList = zone === 'picking' || mode === 'list'
  const listTooBig = usingList && listCodes.length > MAX_ADD_ROWS
  const addCodes = listTooBig ? [] :
    !usingList
      ? buildRangeCodes(prefix, startNo, endNo)
      : listCodes
  const rangeCount = Number(endNo) - Number(startNo) + 1
  const rangeTooBig =
    mode === 'range' && Number.isFinite(rangeCount) && rangeCount > MAX_ADD_ROWS

  function appendCodes(incomingCodes: readonly string[]) {
    if (incomingCodes.length === 0) {
      setStatus('추가할 자리가 없습니다.')
      return
    }
    setCodes((prev) => {
      const started = performance.now()
      const next = new Set(prev)
      for (const code of incomingCodes) next.add(code)
      const sorted = [...next].sort(compareWarehouseLocationCodeNatural)
      const elapsedMs = performance.now() - started
      if (elapsedMs >= 200) console[elapsedMs >= 1000 ? 'warn' : 'info']('[warehouse-slots] 자리 목록 정렬', { path: location.pathname, elapsedMs, slots: sorted.length })
      return sorted
    })
    setSearch('')
    setTablePage(0)
    setStatus(zone === 'picking' ? '목록에 추가했습니다. ‘자리 저장’을 누르면 출고창고로 등록됩니다.' : null)
  }

  function removeCode(code: string) {
    setCodes((prev) => prev.filter((item) => item !== code))
    setStatus(null)
  }

  const loading = setQuery.isLoading || slotsQuery.isLoading || hydratedKey !== `${warehouseId}:${zone}`

  return (
    <div className="space-y-4">
      {zone === 'picking' && <>
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">여기에 저장한 자리번호와 <strong>정확히 일치하면 출고창고</strong>, 나머지는 <strong>박스창고</strong>로 분류합니다. <span className="text-muted-foreground">3-1-1_C1과 3-1-1-C-1은 서로 다른 자리입니다. ‘자리 저장’을 누르면 현재 재고도 바로 다시 분류합니다.</span></p>
        <FilterTabs ariaLabel="출고창고 자리 추가 방식" value={pickingInputMode} onChange={setPickingInputMode} tabs={[{ value: 'list', label: '직접 입력' }, { value: 'rack', label: '렉별 16자리 생성 · 선택' }]} />
      </>}
      <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {zone === 'picking' && pickingInputMode === 'rack' ? <OutboundSlotGenerator onAdd={appendCodes} disabled={loading || setQuery.isError || slotsQuery.isError || saveMutation.isPending} /> : <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-4">
          {zone !== 'picking' && <div>
            <p className="text-xs font-medium text-muted-foreground">추가 방법</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'range' ? 'default' : 'outline'}
                onClick={() => setMode('range')}
              >
                자리 범위
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'list' ? 'default' : 'outline'}
                onClick={() => setMode('list')}
              >
                직접 입력
              </Button>
            </div>
          </div>}

          {!usingList ? (
            <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">앞자리</span>
                <Input
                  value={prefix}
                  placeholder="2-1"
                  onChange={(event) => setPrefix(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">시작</span>
                <Input
                  inputMode="numeric"
                  value={startNo}
                  onChange={(event) => setStartNo(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">끝</span>
                <Input
                  inputMode="numeric"
                  value={endNo}
                  onChange={(event) => setEndNo(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                자리번호 · 한 줄에 하나
              </span>
              <Textarea
                aria-label={zone === 'picking' ? '출고창고 자리번호' : '자리번호 목록'}
                rows={8}
                value={listText}
                placeholder={zone === 'picking' ? '3-1-1_C1\n3-1-1-C-1\n직접 정한 다른 자리번호' : '2-1-1\n2-1-2\n6-1-10'}
                onChange={(event) => setListText(event.target.value)}
              />
            </label>
          )}
          {zone === 'picking' && <p className="text-xs leading-relaxed text-muted-foreground">입력한 기호와 문자를 그대로 사용합니다. 앞뒤 공백과 중복 행만 정리합니다. 한 렉 번호를 저장해도 그 안의 다른 자리가 자동으로 출고창고가 되지는 않습니다.</p>}

          {rangeTooBig && !usingList || listTooBig ? (
            <p className="text-xs text-danger">
              한 번에 {formatNumber(MAX_ADD_ROWS)}개까지 넣을 수 있습니다.
            </p>
          ) : null}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={addCodes.length === 0 || loading || setQuery.isError || slotsQuery.isError || saveMutation.isPending}
            onClick={() => appendCodes(addCodes)}
          >
            <Plus className="size-3.5" />
            {addCodes.length > 0
              ? `${formatNumber(addCodes.length)}개 추가`
              : '자리 추가'}
          </Button>
        </div>}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{warehouseLabel}</Badge>
              <Badge variant={savedCodes.size > 0 ? 'success' : 'muted'}>
                저장됨 {formatNumber(savedCodes.size)}
              </Badge>
              {addedCount > 0 ? (
                <Badge variant="warning">추가 {formatNumber(addedCount)}</Badge>
              ) : null}
              {removedCount > 0 ? (
                <Badge variant="warning">삭제 {formatNumber(removedCount)}</Badge>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!warehouseId || (!dirty && zone !== 'picking') || loading || setQuery.isError || slotsQuery.isError || saveMutation.isPending}
              onClick={() => {
                setStatus(null)
                saveMutation.mutate()
              }}
            >
              {saveMutation.isPending ? '저장 중...' : '자리 저장'}
            </Button>
          </div>

          <Input
            value={search}
            placeholder="자리번호 검색..."
            onChange={(event) => {
              setSearch(event.target.value)
              setTablePage(0)
            }}
          />
          {zone === 'picking' && <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-xs font-medium">저장된 번호로 창고 분류 확인</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2"><Input aria-label="분류 확인할 자리번호" className="min-w-40 flex-1" placeholder="예: 3-1-1_C1" value={checkCode} onChange={(event) => setCheckCode(event.target.value)} />{checkCode.trim() && <Badge variant={loading || setQuery.isError || slotsQuery.isError ? 'muted' : classifyWarehouseSheetZone(checkCode, savedCodes) === 'picking' ? 'success' : 'outline'}>{loading ? '조회 중' : setQuery.isError || slotsQuery.isError ? '확인 불가' : classifyWarehouseSheetZone(checkCode, savedCodes) === 'picking' ? '출고창고' : '박스창고'}</Badge>}</div>
            <p className="mt-2 text-xs text-muted-foreground">현재 저장된 자리번호로 확인합니다. 목록에 추가만 하고 저장하지 않은 번호는 아직 박스창고로 표시됩니다.</p>
          </details>}

          {status ? (
            <p className="text-xs text-muted-foreground" role="status">
              {status}
            </p>
          ) : null}
          {setQuery.isError || slotsQuery.isError ? (
            <p className="text-xs text-danger">
              자리 목록을 불러오지 못했습니다.
            </p>
          ) : null}
          {!warehouseId && !setQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              연습 창고 세트가 있어야 자리를 저장할 수 있습니다.
            </p>
          ) : null}

          {loading ? (
            <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
              자리 목록을 불러오는 중...
            </p>
          ) : codes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              왼쪽에서 자리 범위를 넣어 {warehouseLabel} 자리를 만드세요.
            </p>
          ) : filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              검색한 자리가 없습니다.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table aria-label={warehouseLabel + ' 등록 자리'} className="w-full min-w-[20rem] text-left text-sm">
                  <thead className="bg-primary text-xs text-primary-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">자리번호</th>
                      <th className="w-24 px-3 py-2 font-medium">상태</th>
                      <th className="w-20 px-3 py-2 text-right font-medium">
                        관리
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((code) => {
                      const saved = savedCodes.has(code)
                      return (
                        <tr key={code} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{code}</td>
                          <td className="px-3 py-2">
                            <Badge variant={saved ? 'success' : 'warning'}>
                              {saved ? '저장됨' : '추가됨'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => removeCode(code)}
                            >
                              빼기
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length > TABLE_PAGE_SIZE ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {formatNumber(currentTablePage * TABLE_PAGE_SIZE + 1)}–
                    {formatNumber(
                      Math.min(
                        filtered.length,
                        currentTablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE,
                      ),
                    )}
                    / {formatNumber(filtered.length)}자리
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={currentTablePage === 0}
                      onClick={() =>
                        setTablePage((page) => Math.max(0, page - 1))
                      }
                    >
                      이전
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={currentTablePage >= tablePageCount - 1}
                      onClick={() =>
                        setTablePage((page) =>
                          Math.min(tablePageCount - 1, page + 1),
                        )
                      }
                    >
                      다음
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
