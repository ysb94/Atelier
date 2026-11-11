import { useMemo, useState, type ClipboardEvent } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { roomListProductName } from './room-list-locations'
import { emptyRoomListRow, mergeRoomListRows, parseRoomListPaste, type RoomListRow } from './room-list-paste'
import { useRoomListWarehouseLocations } from './use-room-list-warehouse-locations'

const COLUMNS = ['상품명', '수량'] as const
const MIN_ROWS = 8

export function RoomListPage() {
  useRenderWatch('RoomListPage')
  const [rows, setRows] = useState<RoomListRow[]>(() => Array.from({ length: MIN_ROWS }, emptyRoomListRow))
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)
  const hasNames = rows.some(([name]) => Boolean(name.trim()))
  const warehouse = useRoomListWarehouseLocations(hasNames)
  const locationCodes = useMemo(() => new Map(Array.from(warehouse.locations, ([name, positions]) =>
    [name, [...new Set(positions.map(position => position.locationCode.trim()))]])), [warehouse.locations])
  const locationColumnCount = warehouse.error || warehouse.loading ? 1 : rows.reduce(
    (count, [name]) => Math.max(count, locationCodes.get(roomListProductName(name))?.length ?? 0), 1,
  )
  const locationColumns = Array.from({ length: locationColumnCount }, (_, index) => index)

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

    const updated = rows.slice()
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
        description="엑셀의 상품명과 수량을 붙여넣으면 같은 상품의 수량을 자동으로 합칩니다."
      />
      {hasNames && warehouse.error && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-danger" role="alert">
          창고 위치를 불러오지 못했습니다.
          <Button type="button" size="sm" variant="outline" onClick={() => void warehouse.refresh()}>다시 조회</Button>
        </div>
      )}
      <Card className="overflow-hidden">
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
              {rows.map((row, rowIndex) => {
                const name = roomListProductName(row[0])
                const matches = locationCodes.get(name)
                return (
                  <tr key={rowIndex}>
                    <th scope="row" className="border-b border-r border-border bg-muted/50 px-2 text-center font-normal tabular-nums text-muted-foreground">{rowIndex + 1}</th>
                    {COLUMNS.map((label, column) => (
                      <td key={label} className="border-b border-r border-border p-0 align-top">
                        <Input
                          aria-label={`${rowIndex + 1}행 ${label}`}
                          autoComplete="off"
                          inputMode={column === 1 ? 'numeric' : undefined}
                          className={`rounded-none border-0 bg-transparent shadow-none focus-visible:bg-card focus-visible:ring-inset ${column === 1 ? 'text-right tabular-nums' : ''}`}
                          value={row[column]}
                          onChange={event => changeCell(rowIndex, column, event.target.value)}
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
                        {warehouse.error || warehouse.loading ? '' : matches?.[index]}
                        {name && index === 0 && !warehouse.error && (
                          warehouse.loading ? <span className="text-xs text-muted-foreground">조회 중…</span>
                            : !matches?.length ? <span className="text-xs text-muted-foreground">위치 없음</span> : null
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows(current => [...current, emptyRoomListRow()])}>행 추가</Button>
          <p role="status" className={feedback?.error ? 'text-sm text-danger' : 'text-sm text-muted-foreground'}>{feedback?.message}</p>
        </div>
      </Card>
    </>
  )
}
