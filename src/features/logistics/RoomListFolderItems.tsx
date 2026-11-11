import type { ClipboardEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyRoomListRow, parseRoomListPaste, type RoomListRow } from './room-list-paste'

const COLUMNS = ['상품명', '수량'] as const

export function RoomListFolderItems({
  rows,
  disabled,
  allowRemove = false,
  onChange,
  onError,
}: {
  rows: RoomListRow[]
  disabled: boolean
  allowRemove?: boolean
  onChange: (rows: RoomListRow[]) => void
  onError: (message: string) => void
}) {
  useRenderWatch('RoomListFolderItems')

  function pasteCells(event: ClipboardEvent<HTMLInputElement>, rowIndex: number, column: number) {
    const text = event.clipboardData.getData('text/plain')
    if (!/[\t\r\n]/.test(text)) return
    event.preventDefault()

    const started = performance.now()
    const pasted = parseRoomListPaste(text)
    if (!pasted.some(row => row.some(cell => cell.trim()))) {
      onError('붙여넣을 상품 데이터가 없습니다.')
      return
    }
    if (pasted.some(row => row.length > COLUMNS.length)) {
      onError('엑셀에서 상품명과 수량 두 열만 선택해 주세요.')
      return
    }
    if (column === 1 && pasted.some(row => row.length > 1)) {
      onError('두 열을 붙여넣으려면 상품명 칸을 선택해 주세요.')
      return
    }

    const nextRows = [...rows]
    while (nextRows.length < rowIndex + pasted.length) nextRows.push(emptyRoomListRow())
    pasted.forEach((values, offset) => {
      const row: RoomListRow = [...nextRows[rowIndex + offset]]
      values.forEach((value, index) => { row[column + index] = value })
      nextRows[rowIndex + offset] = row
    })
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 200) {
      const log = elapsed >= 1000 ? console.warn : console.info
      log('[room-list] 폴더 상품 붙여넣기', { elapsed, rows: pasted.length })
    }
    onChange(nextRows)
  }

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground">엑셀에서 상품명과 수량을 복사한 뒤 상품명 칸에 붙여넣으세요.</p>
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <table aria-label="상품명과 수량" className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <colgroup><col className="w-10" /><col /><col className="w-24 sm:w-32" />{allowRemove && <col className="w-10" />}</colgroup>
          <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
            <tr>
              <th scope="col" className="px-2 py-2 text-center">행</th>
              <th scope="col" className="px-3 py-2 text-left">상품명</th>
              <th scope="col" className="px-3 py-2 text-right">수량</th>
              {allowRemove && <th scope="col"><span className="sr-only">행 삭제</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row" className="border-b border-r border-border bg-muted/50 px-2 text-center font-normal tabular-nums text-muted-foreground">{rowIndex + 1}</th>
                {COLUMNS.map((label, column) => (
                  <td key={label} className="border-b border-r border-border p-0 last:border-r-0">
                    <Input
                      aria-label={`${allowRemove ? '수정' : '등록'} ${rowIndex + 1}행 ${label}`}
                      autoComplete="off"
                      inputMode={column === 1 ? 'decimal' : undefined}
                      className={`rounded-none border-0 bg-transparent shadow-none focus-visible:bg-card focus-visible:ring-inset ${column === 1 ? 'text-right tabular-nums' : ''}`}
                      disabled={disabled}
                      value={row[column]}
                      onChange={event => {
                        const nextRows = [...rows]
                        const nextRow: RoomListRow = [...row]
                        nextRow[column] = event.target.value
                        nextRows[rowIndex] = nextRow
                        onChange(nextRows)
                      }}
                      onPaste={event => pasteCells(event, rowIndex, column)}
                      onKeyDown={event => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        const current = event.currentTarget.closest('tr')
                        const next = event.shiftKey ? current?.previousElementSibling : current?.nextElementSibling
                        next?.querySelectorAll('input')[column]?.focus()
                      }}
                    />
                  </td>
                ))}
                {allowRemove && (
                  <td className="border-b border-border text-center">
                    <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled}
                      aria-label={`${rowIndex + 1}행 삭제`} onClick={() => {
                        onChange(rows.length === 1 ? [emptyRoomListRow()] : rows.filter((_, index) => index !== rowIndex))
                      }}>
                      <X aria-hidden="true" className="size-4" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled}
        onClick={() => onChange([...rows, emptyRoomListRow()])}>행 추가</Button>
    </div>
  )
}
