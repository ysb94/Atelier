import { useMemo, useState, type ClipboardEvent } from 'react'
import { Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { compareWarehouseLocationCodeNatural } from '@/lib/invoice/product-list-warehouse'
import { parseWarehouseLocation } from '@/lib/warehouse/stock'
import { roomListProductName } from './room-list-locations'
import {
  emptyRoomListRow, mergeRoomListRows, parseRoomListPaste, roomListBulkPacking, sumRoomListQuantities, type RoomListRow,
} from './room-list-paste'
import { useRoomListWarehouseLocations } from './use-room-list-warehouse-locations'
import { RoomListFolders } from './RoomListFolders'
import { RoomListRoomGroups } from './RoomListRoomGroups'
import { RoomListPickingPanel, RoomListPickingPrintPreview, type RoomPickingRoom } from './RoomListPickingPanel'
import { loadRoomGroups, roomForLocation, roomListArea, saveRoomGroups, type RoomGroup } from './room-list-rooms'

const COLUMNS = ['상품명', '수량'] as const
const MIN_ROWS = 8
const ROOM_ORDER = new Intl.Collator('ko-KR', { numeric: true })
const BULK_ROOM = { key: 'bulk', name: '대량출고' } as const
const ROOM_AREAS = [BULK_ROOM.name, '1층', '2층', '파우치', '그 외'] as const
type RoomArea = typeof ROOM_AREAS[number]

export function RoomListPage() {
  useRenderWatch('RoomListPage')
  const { session } = useAuth()
  const { selectedBrands } = useCompanyBrandScope()
  if (!session) return null
  const userId = session.user.id
  return <RoomListWorkspace key={[userId, ...selectedBrands.map(brand => brand.id)].join(':')} userId={userId} />
}

function RoomListWorkspace({ userId }: { userId: string }) {
  const [opened, setOpened] = useState<{ rows: RoomListRow[]; count: number } | null>(null)
  return opened
    ? <RoomListGrid initialRows={opened.rows} folderCount={opened.count} userId={userId} onBack={() => setOpened(null)} />
    : <RoomListFolders userId={userId} onOpen={(rows, count) => setOpened({ rows, count })} />
}

function RoomListGrid({ initialRows, folderCount, userId, onBack }: {
  initialRows: RoomListRow[]; folderCount: number; userId: string; onBack: () => void
}) {
  useRenderWatch('RoomListGrid')
  const [rows, setRows] = useState<RoomListRow[]>(() => [
    ...initialRows,
    ...Array.from({ length: Math.max(0, MIN_ROWS - initialRows.length) }, emptyRoomListRow),
  ])
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)
  const [editingName, setEditingName] = useState<{ sourceIndex: number; name: string } | null>(null)
  const [roomGroups, setRoomGroups] = useState(() => loadRoomGroups(userId))
  const [room, setRoom] = useState<string | null>(null)
  const [showGroups, setShowGroups] = useState(false)
  const [printScope, setPrintScope] = useState<'selection' | RoomArea | null>(null)
  const [roomSaveFailed, setRoomSaveFailed] = useState(false)
  const hasNames = rows.some(([name]) => Boolean(name.trim()))
  const warehouse = useRoomListWarehouseLocations(hasNames)
  const { locationCodes, latestPositions, styleNumbers } = warehouse
  const locationsReady = !warehouse.error && !warehouse.loading
  const visibleRows = useMemo(() => {
    const missing = []
    const zero = []
    const regular = []
    for (const [sourceIndex, row] of rows.entries()) {
      const name = roomListProductName(row[0])
      const matches = locationCodes.get(name)
      const item = { sourceIndex, row, name, matches }
      // 입력 중인 행은 상품명 칸에서 벗어난 뒤 위치 순서를 갱신한다.
      const sortName = editingName?.sourceIndex === sourceIndex ? editingName.name : name
      const firstLocation = locationCodes.get(sortName)?.[0]
      if (locationsReady && sortName && !firstLocation) missing.push(item)
      else if (locationsReady && sortName && firstLocation === '0-0-0') zero.push(item)
      else regular.push(item)
    }
    return [...missing, ...zero, ...regular]
  }, [rows, locationCodes, locationsReady, editingName])
  const groupsByPrefix = useMemo(() => new Map(
    roomGroups.flatMap(group => group.prefixes.map(prefix => [prefix, group] as const)),
  ), [roomGroups])
  const rooms = useMemo(() => {
    const grouped = new Map<string, RoomPickingRoom>()
    if (!locationsReady) return grouped
    for (const item of visibleRows) {
      if (!item.name) continue
      const styleNo = styleNumbers.get(item.name) ?? ''
      const latest = latestPositions.get(item.name)
      const packing = latest?.styleId && styleNo && latest.styleNo.trim() === styleNo
        ? roomListBulkPacking(item.row[1], latest.unitsPerBox)
        : undefined
      const bulkLocation = packing ? latest?.locationCode.trim() : undefined
      const location = bulkLocation ?? item.matches?.[0] ?? ''
      const { key, name } = packing ? BULK_ROOM : roomForLocation(location, groupsByPrefix)
      const bulkCode = bulkLocation && parseWarehouseLocation(bulkLocation).locationCode
      const nextLocation = bulkCode
        ? item.matches?.find(code => parseWarehouseLocation(code).locationCode !== bulkCode)
        : item.matches?.[1]
      const current = grouped.get(key)
      const line = {
        id: item.sourceIndex,
        name: item.name,
        quantity: item.row[1],
        location,
        nextLocation,
        styleNo,
        packing,
      }
      if (current) current.lines.push(line)
      else grouped.set(key, { key, name, lines: [line] })
    }
    for (const group of grouped.values()) {
      group.lines.sort((left, right) => compareWarehouseLocationCodeNatural(left.location, right.location))
    }
    return grouped
  }, [locationsReady, groupsByPrefix, latestPositions, styleNumbers, visibleRows])
  const roomTabs = useMemo(() => [...rooms.values()].sort((a, b) =>
    Number(b.key === 'missing') - Number(a.key === 'missing') || ROOM_ORDER.compare(a.name, b.name),
  ), [rooms])
  const roomTabsByArea = useMemo(() => {
    const tabs: Record<RoomArea, FilterTab<string>[]> = { [BULK_ROOM.name]: [], '1층': [], '2층': [], 파우치: [], '그 외': [] }
    for (const group of roomTabs) {
      const area = group.key === BULK_ROOM.key ? BULK_ROOM.name : roomListArea(group.lines[0]?.location, groupsByPrefix)
      const total = sumRoomListQuantities(group.lines.map(line => line.quantity))
      tabs[area].push({
        value: group.key,
        label: group.name,
        subtitle: total === null ? `${group.lines.length}종` : `${total}개`,
      })
    }
    return tabs
  }, [groupsByPrefix, roomTabs])
  const selectedRoom = room ?? roomTabs.find(item => item.key !== 'missing' && item.key !== BULK_ROOM.key)?.key
    ?? rooms.get(BULK_ROOM.key)?.key ?? roomTabs[0]?.key
  const currentRoom = selectedRoom ? rooms.get(selectedRoom) : undefined
  const selectedTab = currentRoom?.key ?? 'all'
  const selectedPrintRoom = room ? currentRoom : undefined
  const selectionPrintRooms = useMemo(
    () => selectedPrintRoom ? [selectedPrintRoom] : roomTabs.filter(group => group.key !== BULK_ROOM.key),
    [roomTabs, selectedPrintRoom],
  )
  const printRooms = useMemo(() => {
    if (!printScope) return []
    const selected = printScope === 'selection'
      ? selectionPrintRooms
      : roomTabsByArea[printScope].flatMap(tab => rooms.get(tab.value) ?? [])
    return selected.flatMap(group => {
      if (!group.key.startsWith('group:')) return [group]
      const sections = new Map<string, RoomPickingRoom>()
      for (const line of group.lines) {
        const { key, name } = roomForLocation(line.location)
        const section = sections.get(key)
        if (section) section.lines.push(line)
        else sections.set(key, { key, name, lines: [line] })
      }
      return [...sections.values()]
    })
  }, [printScope, roomTabsByArea, rooms, selectionPrintRooms])
  const locationColumnCount = visibleRows.reduce(
    (count, { matches }) => Math.max(count, matches?.length ?? 0), 1,
  )
  const locationColumns = Array.from({ length: locationColumnCount }, (_, index) => index)

  function updateRoomGroups(groups: RoomGroup[]) {
    setRoomGroups(groups)
    setRoomSaveFailed(!saveRoomGroups(userId, groups))
    setRoom(null)
  }

  function changeCell(rowIndex: number, column: number, value: string) {
    setRows(current => current.map((row, index) => {
      if (index !== rowIndex) return row
      const updated: RoomListRow = [...row]
      updated[column] = value
      return updated
    }))
  }

  function pasteCells(event: ClipboardEvent<HTMLInputElement>, rowIndex: number, column: number) {
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    event.preventDefault()

    const started = performance.now()
    const input = event.currentTarget
    const pasted = /[\t\r\n]/.test(text)
      ? parseRoomListPaste(text)
      : [[input.value.slice(0, input.selectionStart ?? 0) + text + input.value.slice(input.selectionEnd ?? input.value.length)]]
    if (!pasted.length) {
      setFeedback({ message: '붙여넣을 상품 데이터가 없습니다.', error: true })
      return
    }
    if (pasted.some(row => row.length > COLUMNS.length)) {
      setFeedback({ message: '엑셀에서 상품명과 수량 두 열만 선택해 주세요.', error: true })
      return
    }
    if (column === 1 && pasted.some(row => row.length > 1)) {
      setFeedback({ message: '두 열을 붙여넣으려면 상품명 칸을 선택해 주세요.', error: true })
      return
    }

    const updated = visibleRows.map(item => item.row)
    while (updated.length < rowIndex + pasted.length) updated.push(emptyRoomListRow())
    pasted.forEach((values, offset) => {
      const row: RoomListRow = [...updated[rowIndex + offset]]
      values.forEach((value, index) => { row[column + index] = value })
      updated[rowIndex + offset] = row
    })
    const result = mergeRoomListRows(updated)
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 200) {
      const log = elapsed >= 1000 ? console.warn : console.info
      log('[room-list] 붙여넣기 및 합계', { elapsed, rows: pasted.length })
    }
    if ('invalidRow' in result) {
      setFeedback({ message: `${result.invalidRow}행의 수량을 숫자로 입력해야 같은 상품을 합칠 수 있습니다.`, error: true })
      return
    }
    while (result.rows.length < MIN_ROWS) result.rows.push(emptyRoomListRow())
    setEditingName(null)
    setRows(result.rows)
    setFeedback({
      message: result.duplicates
        ? `중복 상품 ${result.duplicates.toLocaleString('ko-KR')}행을 합쳤습니다.`
        : `${pasted.length.toLocaleString('ko-KR')}행을 붙여넣었습니다.`,
    })
  }

  return (
    <>
      <PageHeader
        title="방별리스트"
        description={`폴더 ${folderCount.toLocaleString('ko-KR')}개의 상품과 수량을 합친 목록입니다.`}
        actions={<Button type="button" variant="outline" onClick={onBack}>폴더 목록</Button>}
      />
      {hasNames && (warehouse.error || warehouse.styleLookupError) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-danger" role="alert">
          {warehouse.error ? '일부 창고 위치를 불러오지 못했습니다.' : '고정 자리의 최신 M번호를 불러오지 못했습니다.'}
          <Button type="button" size="sm" variant="outline" onClick={() => void warehouse.refresh()}>다시 조회</Button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <FilterTabs
          ariaLabel="방별 보기"
          value={selectedTab}
          onChange={setRoom}
          tabs={[{ value: 'all', label: '전체' }]}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" aria-expanded={showGroups}
            onClick={() => setShowGroups(current => !current)}>방 묶기</Button>
          <Button type="button" variant="outline" size="sm" disabled={!selectionPrintRooms.length}
            onClick={() => setPrintScope('selection')}>
            <Printer aria-hidden="true" className="size-4" /> {selectedPrintRoom ? '미리보기 및 출력' : '전체 방 미리보기 및 출력'}
          </Button>
        </div>
      </div>
      {showGroups && <RoomListRoomGroups groups={roomGroups} onChange={updateRoomGroups} />}
      {roomSaveFailed && <p role="status" className="mb-3 text-sm text-muted-foreground">방 묶음을 이 브라우저에 저장하지 못했습니다. 현재 화면에만 적용됩니다.</p>}
      {roomTabs.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {ROOM_AREAS.map(area => {
            const tabs = roomTabsByArea[area]
            return (
              <Card key={area} className="min-w-0 space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{area}</h2>
                  <Button type="button" variant="outline" size="sm" disabled={!tabs.length}
                    aria-label={`${area} 미리보기 및 출력`} onClick={() => setPrintScope(area)}>
                    <Printer aria-hidden="true" className="size-4" /> 미리보기 및 출력
                  </Button>
                </div>
                {tabs.length ? (
                  <FilterTabs ariaLabel={`${area} 방`} value={selectedTab} onChange={setRoom} tabs={tabs}
                    tabInteraction={() => ({ className: 'max-w-full wrap-anywhere' })} />
                ) : <p className="text-sm text-muted-foreground">{area === BULK_ROOM.name ? '대량출고 상품 없음' : '해당 방 없음'}</p>}
              </Card>
            )
          })}
        </div>
      )}
      {currentRoom ? <RoomListPickingPanel room={currentRoom} /> : <Card className="overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: 352 + locationColumnCount * 112 }}>
            <caption className="sr-only">방별리스트 상품명·수량·창고 위치</caption>
            <colgroup>
              <col className="w-12" /><col /><col className="w-24 sm:w-28" />
              {locationColumns.map(index => <col key={index} className="w-28" />)}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
              <tr>
                <th scope="col" className="px-2 py-2 text-center">행</th>
                {COLUMNS.map((label, column) => <th key={label} scope="col"
                  className={column === 1 ? 'px-3 py-2 text-right' : 'px-3 py-2 text-left'}>{label}</th>)}
                {locationColumns.map(index => (
                  <th key={index} scope="col" className="px-3 py-2 text-left">위치 {index + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ row, sourceIndex, name, matches }, rowIndex) => (
                  <tr key={sourceIndex}>
                    <th scope="row" className="border-b border-r border-border bg-muted/50 px-2 text-center font-normal tabular-nums text-muted-foreground">{rowIndex + 1}</th>
                    {COLUMNS.map((label, column) => (
                      <td key={label} className="border-b border-r border-border p-0 align-top">
                        <Input
                          aria-label={`${rowIndex + 1}행 ${label}`}
                          autoComplete="off"
                          inputMode={column === 1 ? 'numeric' : undefined}
                          className={`rounded-none border-0 bg-transparent shadow-none focus-visible:bg-card focus-visible:ring-inset ${column === 1 ? 'text-right tabular-nums' : ''}`}
                          value={row[column]}
                          onBlur={column === 0 ? () => setEditingName(null) : undefined}
                          onChange={event => {
                            if (column === 0 && editingName?.sourceIndex !== sourceIndex) setEditingName({ sourceIndex, name })
                            changeCell(sourceIndex, column, event.target.value)
                          }}
                          onPaste={event => pasteCells(event, rowIndex, column)}
                          onKeyDown={event => {
                            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                            const currentRow = event.currentTarget.closest('tr')
                            const targetRow = event.shiftKey ? currentRow?.previousElementSibling : currentRow?.nextElementSibling
                            targetRow?.querySelectorAll('input')[column]?.focus()
                          }}
                        />
                      </td>
                    ))}
                    {locationColumns.map(index => (
                      <td key={index} className="break-all border-b border-r border-border px-3 py-2 align-top tabular-nums last:border-r-0">
                        {matches?.[index]}
                        {name && index === 0 && !warehouse.error && (
                          matches?.length ? null
                            : warehouse.loading ? <span className="text-xs text-muted-foreground">조회 중…</span>
                              : <span className="text-xs text-muted-foreground">위치 없음</span>
                        )}
                      </td>
                    ))}
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows(current => [...current, emptyRoomListRow()])}>행 추가</Button>
          <p role="status" className={feedback?.error ? 'text-sm text-danger' : 'text-sm text-muted-foreground'}>{feedback?.message}</p>
        </div>
      </Card>}
      {printScope && printRooms.length > 0 && (
        <RoomListPickingPrintPreview rooms={printRooms}
          title={printScope === 'selection' ? undefined : `${printScope} 피킹표 미리보기 및 출력`}
          onClose={() => setPrintScope(null)} />
      )}
    </>
  )
}
