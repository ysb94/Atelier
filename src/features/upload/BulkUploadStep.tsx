import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import type { BrandField } from '@/lib/types'
import { parseFile, parseText, type ParsedSheet } from '@/lib/import/parse'
import { downloadUploadTemplate } from '@/lib/import/template'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { cn, formatNumber } from '@/lib/utils'

type BulkUploadStepProps = {
  brandName: string
  fields: BrandField[]
  sheets: ParsedSheet[]
  activeSheetIndex: number
  onSheetsLoaded: (sheets: ParsedSheet[]) => void
  onSelectSheet: (index: number) => void
  onNext: () => void
}

export function BulkUploadStep({
  brandName,
  fields,
  sheets,
  activeSheetIndex,
  onSheetsLoaded,
  onSelectSheet,
  onNext,
}: BulkUploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  async function handleDownloadTemplate() {
    setDownloading(true)
    setError(null)
    try {
      await downloadUploadTemplate({
        brandName,
        fields,
        ownerFilter: 'all',
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '양식을 다운로드하지 못했습니다.',
      )
    } finally {
      setDownloading(false)
    }
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setError(null)
    try {
      const parsed = await parseFile(file)
      if (parsed.length === 0) {
        setError('읽을 수 있는 데이터가 없습니다.')
        return
      }
      setPasted('')
      onSheetsLoaded(parsed)
    } catch {
      setError('파일을 읽지 못했습니다. CSV 또는 엑셀 파일인지 확인해주세요.')
    }
  }

  function handlePaste() {
    if (!pasted.trim()) return
    setError(null)
    const parsed = parseText(pasted)
    if (parsed.rows.length === 0) {
      setError('읽을 수 있는 데이터가 없습니다.')
      return
    }
    onSheetsLoaded([parsed])
  }

  const activeSheet = sheets[activeSheetIndex]
  const dataRowCount = Math.max((activeSheet?.rows.length ?? 0) - 1, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          사이트에서 내려받은 양식의 첫 줄 헤더를 그대로 사용하세요. 헤더 이름으로
          자동 인식합니다. (현재 등록 항목 {fields.length}개)
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleDownloadTemplate()}
          disabled={downloading || fields.length === 0}
          className="shrink-0"
        >
          <Download className="size-4" />
          {downloading ? '준비 중...' : '양식 다운로드'}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>파일 업로드</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                void handleFiles(e.dataTransfer.files)
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                dragging
                  ? 'border-foreground/40 bg-accent/50'
                  : 'border-border bg-muted/30',
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                CSV, TSV, 엑셀 파일을 여기에 끌어다 놓으세요
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                파일 선택
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>구글시트에서 붙여넣기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={6}
              placeholder={
                '시트에서 범위를 복사해 그대로 붙여넣으세요.\n첫 줄은 헤더여야 합니다.'
              }
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handlePaste}
              disabled={!pasted.trim()}
            >
              붙여넣은 데이터 읽기
            </Button>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {sheets.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>불러온 데이터</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sheets.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {sheets.map((sheet, index) => (
                  <button
                    key={sheet.name}
                    type="button"
                    onClick={() => onSelectSheet(index)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
                      index === activeSheetIndex
                        ? 'border-foreground/30 bg-accent'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    <FileSpreadsheet className="size-3.5" />
                    {sheet.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="text-sm text-muted-foreground">
              {formatNumber(dataRowCount)}행 ·{' '}
              {activeSheet?.rows[0]?.length ?? 0}열 (첫 줄 = 헤더)
            </div>

            {activeSheet ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <tbody>
                    {activeSheet.rows.slice(0, 5).map((row, rowIndex) => (
                      <tr
                        key={rowIndex}
                        className={cn(
                          'border-b border-border last:border-0',
                          rowIndex === 0 ? 'bg-muted/60 font-medium' : '',
                        )}
                      >
                        {row.slice(0, 10).map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="max-w-40 truncate px-3 py-2"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={onNext}
                disabled={!activeSheet || dataRowCount === 0}
              >
                검증 결과 보기
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
