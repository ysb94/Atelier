import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react'
import { Download, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { parseFile } from '@/lib/import/parse'
import {
  applyIdleCollectStyleLookup,
  idleCollectAllLinked,
  idleCollectDisplayRows,
  idleCollectLinkedCount,
  idleCollectRowLinked,
  keepIdleCollectLinks,
  parseIdleCollectSheets,
  parseIdleCollectText,
  type IdleCollectRow,
} from '@/lib/bulk-outbound/idle-collect'
import type { StyleRef } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

function sameCollectRows(
  left: readonly IdleCollectRow[],
  right: readonly IdleCollectRow[],
) {
  if (left.length !== right.length) return false
  return left.every(
    (row, index) =>
      row.productName === right[index]?.productName &&
      row.qty === right[index]?.qty &&
      row.styleNo === right[index]?.styleNo &&
      row.styleId === right[index]?.styleId,
  )
}

async function downloadIdleCollectTemplate() {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['상품명', '수량'],
    ['예시 상품', '2'],
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '출고데이터')
  XLSX.writeFile(workbook, '바코드출고_대기_상품명수량.xlsx')
}

const IdleCollectTableRow = memo(function IdleCollectTableRow({
  row,
  index,
  registered,
  onNameChange,
}: {
  row: IdleCollectRow
  index: number
  registered: boolean
  onNameChange: (index: number, value: string) => void
}) {
  const linked = idleCollectRowLinked(row)
  const editable = registered && !linked
  return (
    <tr
      className={cn(
        'border-b border-border last:border-0',
        editable && 'bg-danger/10',
      )}
    >
      <td className="px-3 py-2 font-mono text-xs">
        {linked ? (
          row.styleNo
        ) : registered ? (
          <span className="text-danger">미연결</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-3 py-2">
        {editable ? (
          <Input
            value={row.productName}
            className="h-8 border-danger/40"
            onChange={(event) => onNameChange(index, event.target.value)}
          />
        ) : (
          row.productName
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatNumber(row.qty)}
      </td>
    </tr>
  )
})

export function BulkOutboundIdleCollectPanel({
  rows,
  jobNote,
  saving,
  onSave,
  onBackup,
  onLookupStyles,
}: {
  rows: readonly IdleCollectRow[]
  jobNote: string
  saving: boolean
  onSave: (
    rows: IdleCollectRow[],
    jobNote: string,
    options?: { quiet?: boolean },
  ) => Promise<void>
  onBackup: (
    rows: IdleCollectRow[],
    jobNote: string,
  ) => Promise<{ kinds: number; qty: number }>
  onLookupStyles: (names: string[]) => Promise<{ byName: Map<string, StyleRef[]> }>
}) {
  const [drafts, setDrafts] = useState<IdleCollectRow[]>(() => [...rows])
  const [draftNote, setDraftNote] = useState(jobNote)
  const [registered, setRegistered] = useState(() =>
    rows.some((row) => row.styleNo && row.styleId),
  )
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  const persistTailRef = useRef(Promise.resolve())
  const draftsRef = useRef(drafts)
  const noteRef = useRef(draftNote)
  draftsRef.current = drafts
  noteRef.current = draftNote

  useEffect(() => {
    if (dirtyRef.current && !sameCollectRows(draftsRef.current, rows)) return
    dirtyRef.current = false
    setDrafts([...rows])
    setRegistered((current) =>
      current || rows.some((row) => row.styleNo && row.styleId),
    )
  }, [rows])

  useEffect(() => {
    if (dirtyRef.current) return
    setDraftNote(jobNote)
  }, [jobNote])

  async function persist(
    nextRows: IdleCollectRow[],
    nextNote: string,
    quiet = false,
  ) {
    const run = persistTailRef.current.then(async () => {
      try {
        await onSave(nextRows, nextNote, quiet ? { quiet: true } : undefined)
        dirtyRef.current = false
      } catch (reason) {
        dirtyRef.current = true
        setError(
          reason instanceof Error ? reason.message : '저장하지 못했습니다.',
        )
        throw reason
      }
    })
    persistTailRef.current = run.then(
      () => undefined,
      () => undefined,
    )
    await run
  }

  const handleNameChange = useCallback((index: number, value: string) => {
    dirtyRef.current = true
    setDrafts((current) =>
      current.map((item, rowIndex) =>
        rowIndex === index
          ? {
              ...item,
              productName: value,
              styleNo: '',
              styleId: '',
            }
          : item,
      ),
    )
  }, [])

  async function applyRows(next: IdleCollectRow[], successNote: string) {
    const merged = keepIdleCollectLinks(next, draftsRef.current)
    dirtyRef.current = true
    setDrafts(merged)
    setRegistered(merged.some((row) => row.styleNo && row.styleId))
    await persist(merged, noteRef.current)
    setStatus(successNote)
  }

  async function applyPastedText(text: string) {
    setError(null)
    setStatus(null)
    const parsed = parseIdleCollectText(text)
    if (parsed.error) {
      setError(parsed.error)
      return
    }
    await applyRows(
      parsed.rows,
      `${formatNumber(parsed.rows.length)}행 붙여넣었습니다.`,
    )
  }

  async function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (saving) return
    const text = event.clipboardData.getData('text/plain')
    if (!text.trim()) return
    event.preventDefault()
    try {
      await applyPastedText(text)
    } catch {
      // persist가 이미 오류를 보여 줍니다.
    }
  }

  async function handleUpload(file: File) {
    setError(null)
    setStatus(null)
    try {
      const sheets = await parseFile(file)
      if (sheets.length === 0) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const parsed = parseIdleCollectSheets(sheets)
      if (parsed.error) {
        setError(parsed.error)
        return
      }
      await applyRows(
        parsed.rows,
        `${formatNumber(parsed.rows.length)}행 올렸습니다.`,
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '파일을 읽지 못했습니다.',
      )
    }
  }

  async function handleClear() {
    if (drafts.length === 0) return
    setError(null)
    dirtyRef.current = true
    setDrafts([])
    setRegistered(false)
    try {
      await persist([], noteRef.current)
      setStatus('표를 비웠습니다.')
    } catch {
      // persist가 이미 오류를 보여 줍니다.
    }
  }

  async function handleRegister() {
    if (drafts.length === 0) return
    setError(null)
    setStatus(null)
    try {
      const lookup = await onLookupStyles(
        drafts.map((row) => row.productName),
      )
      const next = applyIdleCollectStyleLookup(drafts, lookup)
      const linked = idleCollectLinkedCount(next)
      const missed = next.length - linked
      dirtyRef.current = true
      setDrafts(next)
      setRegistered(true)
      await persist(next, noteRef.current)
      setStatus(
        missed === 0
          ? `${formatNumber(linked)}행 연결했습니다.`
          : `${formatNumber(linked)}행 연결, ${formatNumber(missed)}행은 상품명을 고쳐 다시 등록하세요.`,
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'M번호를 찾지 못했습니다.',
      )
    }
  }

  async function handleBackup() {
    if (!idleCollectAllLinked(drafts)) return
    setError(null)
    setStatus(null)
    try {
      const result = await onBackup(drafts, noteRef.current)
      setStatus(
        `출고 데이터에 ${formatNumber(result.kinds)}종 · ${formatNumber(result.qty)}개 저장했습니다.`,
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '백업하지 못했습니다.',
      )
    }
  }

  const canBackup = idleCollectAllLinked(drafts)
  const displayRows = idleCollectDisplayRows(drafts)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void downloadIdleCollectTemplate()}
        >
          <Download className="size-3.5" />
          양식 받기
        </Button>
        <label className="inline-flex">
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            className="sr-only"
            disabled={saving}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleUpload(file)
              event.target.value = ''
            }}
          />
          <span
            className={cn(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted/50',
              saving && 'pointer-events-none opacity-50',
            )}
          >
            <Upload className="size-3.5" />
            엑셀 올리기
          </span>
        </label>
        {drafts.length > 0 ? (
          <Badge variant="muted">{formatNumber(drafts.length)}행</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        「상품명」「수량」을 표에 붙여넣거나 엑셀로 올린 뒤 등록하면 M번호를
        붙입니다. 비고는 이 건 전체에 적습니다.
      </p>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <p className="text-xs text-muted-foreground">{status}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || drafts.length === 0}
          onClick={() => void handleClear()}
        >
          비우기
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || drafts.length === 0}
          onClick={() => void handleRegister()}
        >
          등록
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || !canBackup}
          title={
            canBackup
              ? '출고 데이터에 저장'
              : 'M번호를 모두 연결하면 백업할 수 있습니다.'
          }
          onClick={() => void handleBackup()}
        >
          백업
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div
          className="overflow-hidden rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={saving ? -1 : 0}
          onPaste={(event) => {
            void handlePaste(event)
          }}
        >
          {drafts.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              아직 행이 없습니다. 엑셀을 올리거나, 상품명·수량을 여기에
              붙여넣으세요.
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="w-24 px-3 py-2 font-medium">M번호</th>
                    <th className="px-3 py-2 font-medium">상품명</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">
                      수량
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ row, index }) => (
                    <IdleCollectTableRow
                      key={index}
                      row={row}
                      index={index}
                      registered={registered}
                      onNameChange={handleNameChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <label className="flex min-h-[10rem] flex-col gap-1.5 rounded-lg border border-border px-3 py-3">
          <span className="text-xs font-medium text-muted-foreground">비고</span>
          <Textarea
            rows={8}
            value={draftNote}
            placeholder="이 건 전체에 대한 메모"
            onChange={(event) => {
              const value = event.target.value
              dirtyRef.current = true
              setDraftNote(value)
            }}
            onBlur={(event) => {
              const value = event.target.value
              if (value === jobNote) return
              void persist(draftsRef.current, value, true).catch(() => undefined)
            }}
          />
        </label>
      </div>
    </div>
  )
}
