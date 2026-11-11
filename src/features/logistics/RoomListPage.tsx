import { useState, type ClipboardEvent } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { parseRoomListPaste } from './room-list-paste'

type RoomListRow = [productName: string, quantity: string]
const COLUMNS = ['상품명', '수량'] as const
const emptyRow = (): RoomListRow => ['', '']

export function RoomListPage() {
  useRenderWatch('RoomListPage')
  const [rows, setRows] = useState<RoomListRow[]>(() => Array.from({ length: 8 }, emptyRow))
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)

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
    if (!/[\t\r\n]/.test(text)) return
    event.preventDefault()

    const started = performance.now()
    const pasted = parseRoomListPaste(text)
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 200) {
      const log = elapsed >= 1000 ? console.warn : console.info
      log('[room-list] 붙여넣기 읽기', { elapsed, rows: pasted.length })
    }
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

    setRows(current => {
      const updated = current.slice()
      while (updated.length < rowIndex + pasted.length) updated.push(emptyRow())
      pasted.forEach((values, offset) => {
        const row: RoomListRow = [...updated[rowIndex + offset]]
        values.forEach((value, index) => { row[column + index] = value })
        updated[rowIndex + offset] = row
      })
      return updated
    })
    setFeedback({ message: `${pasted.length.toLocaleString('ko-KR')}행을 붙여넣었습니다.` })
  }

  return (
    <>
      <PageHeader
        title="방별리스트"
        description="엑셀에서 상품명과 수량을 복사한 뒤, 넣을 위치의 상품명 칸에 붙여넣으세요."
      />
      <Card className="overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[340px] table-fixed border-separate border-spacing-0 text-sm">
            <caption className="sr-only">방별리스트 상품명과 수량 입력표</caption>
            <colgroup><col className="w-12" /><col /><col className="w-28 sm:w-36" /></colgroup>
            <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
              <tr>
                <th scope="col" className="px-2 py-2 text-center">행</th>
                {COLUMNS.map((label, column) => <th key={label} scope="col"
                  className={column === 1 ? 'px-3 py-2 text-right' : 'px-3 py-2 text-left'}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th scope="row" className="border-b border-r border-border bg-muted/50 px-2 text-center font-normal tabular-nums text-muted-foreground">{rowIndex + 1}</th>
                  {COLUMNS.map((label, column) => (
                    <td key={label} className="border-b border-r border-border p-0 last:border-r-0">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows(current => [...current, emptyRow()])}>행 추가</Button>
          <p role="status" className={feedback?.error ? 'text-sm text-danger' : 'text-sm text-muted-foreground'}>{feedback?.message}</p>
        </div>
      </Card>
    </>
  )
}
