import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { getCodeUsageTargets, getCodeUsageTargetAliases, getCodeUsageTargetFolders } from '@/lib/api'
import { prepareSabangnetUrlRows, urlImportPayload, URL_STATUS_LABEL, type SabangnetMallUrl, type UrlImportStatus } from '@/lib/codes/sabangnet-url-import'
import { timeSabangnetWork } from '@/lib/codes/sabangnet-import'
import { useRenderWatch } from '@/lib/diagnostics'
import { parseSabangnetUrlFile } from '@/lib/codes/sabangnet-url-parse'
import { importSabangnetMallUrls } from '@/lib/supabase/sabangnet-mall-urls'
import type { SabangnetProduct } from '@/lib/types'
import { emptyList, formatNumber } from '@/lib/utils'

export function SabangnetUrlUploadPanel({ brandId, products, existing, onApplied, onClose, onBusyChange }: {
  brandId: string; products: SabangnetProduct[]; existing: SabangnetMallUrl[]
  onApplied: () => Promise<void>; onClose: () => void; onBusyChange: (busy: boolean) => void
}) {
  useRenderWatch('SabangnetUrlUploadPanel')
  const [fileRows, setFileRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')
  const [reading, setReading] = useState(false)
  const [status, setStatus] = useState<'all' | UrlImportStatus>('all')
  const [page, setPage] = useState(1)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const input = useRef<HTMLInputElement>(null)
  const targets = useQuery({ queryKey: ['codeUsageTargets', brandId], queryFn: () => getCodeUsageTargets(brandId) })
  const aliases = useQuery({ queryKey: ['codeUsageTargetAliases', brandId], queryFn: () => getCodeUsageTargetAliases(brandId) })
  const folders = useQuery({ queryKey: ['codeUsageTargetFolders', brandId], queryFn: () => getCodeUsageTargetFolders(brandId) })
  const ready = targets.isSuccess && aliases.isSuccess && folders.isSuccess
  const preview = useMemo(() => {
    if (!fileRows || !ready) return { rows: emptyList<ReturnType<typeof prepareSabangnetUrlRows>[number]>(), error: '' }
    try { return { rows: timeSabangnetWork('업체 URL 연결 미리보기', () => prepareSabangnetUrlRows({ rows: fileRows, products, targets: targets.data!, aliases: aliases.data!, folders: folders.data!, existing })), error: '' } }
    catch (err) { console.warn('[sabangnet] URL 미리보기 실패', { fileName, error: err }); return { rows: emptyList<ReturnType<typeof prepareSabangnetUrlRows>[number]>(), error: err instanceof Error ? err.message : '미리보기를 만들지 못했습니다.' } }
  }, [fileRows, ready, products, targets.data, aliases.data, folders.data, existing, fileName])
  const counts = useMemo(() => { const result = new Map<UrlImportStatus, number>(); for (const row of preview.rows) result.set(row.status, (result.get(row.status) ?? 0) + 1); return result }, [preview.rows])
  const filtered = useMemo(() => status === 'all' ? preview.rows : preview.rows.filter(r => r.status === status), [preview.rows, status])
  const maxPage = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, maxPage)
  const shown = filtered.slice((currentPage - 1) * 50, currentPage * 50)
  const mutation = useMutation({ onMutate: () => onBusyChange(true), mutationFn: () => importSabangnetMallUrls(brandId, fileName, urlImportPayload(preview.rows), (done, total) => setProgress({ done, total })), onSuccess: async result => {
    setSummary(`${formatNumber(result.inserted)}건 등록 · 기존 동일 URL ${formatNumber(result.unchanged)}건 · 저장 시 보류 ${formatNumber(result.held)}건`)
    await onApplied()
  }, onError: async err => { console.warn('[sabangnet] URL 저장 실패', { fileName, error: err }); setError(err instanceof Error ? err.message : '저장하지 못했습니다.'); await onApplied() }, onSettled: () => onBusyChange(false) })
  async function read(file: File) {
    onBusyChange(true); setReading(true); setFileRows(null); setError(''); setSummary(''); setFileName(file.name); setPage(1); setStatus('all')
    try {
      const result = await parseSabangnetUrlFile(file)
      if (result.elapsed >= 200) {
        const report = result.elapsed >= 1000 ? console.warn : console.info
        report('[sabangnet] URL 파일 읽기', { fileName: file.name, elapsed: result.elapsed, path: location.pathname, lastInput: '쇼핑몰 URL 파일 선택' })
      }
      setFileRows(result.rows)
    }
    catch (err) { console.warn('[sabangnet] URL 파일 읽기 실패', { fileName: file.name, error: err }); setError(err instanceof Error ? err.message : '파일을 읽지 못했습니다.') }
    finally { setReading(false); onBusyChange(false) }
  }
  function downloadHeld() {
    const cell = (v: string) => `"${(/^[=+@-]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`
    const rows = [['원본 행', '쇼핑몰명', '사방넷 코드', '상품명', '쇼핑몰상품코드', 'URL', '상태', '이유'], ...preview.rows.filter(r => !['ready', 'unchanged', 'duplicate'].includes(r.status)).map(r => [String(r.lineNo), r.mall, r.code, r.name, r.mallProductCode, r.url, URL_STATUS_LABEL[r.status], r.reason])]
    const href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = href; a.download = '업체_URL_보류_제외.csv'; a.click(); URL.revokeObjectURL(href)
  }
  return <Card><CardContent className="space-y-3 p-4">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">쇼핑몰 URL 가져오기</h2><p className="mt-1 text-xs text-muted-foreground">온라인 업체·별칭과 품번코드로 연결합니다. 없는 코드는 제외하고 서로 다른 URL은 전체 보류합니다. M번호와 기존 URL은 바꾸지 않습니다.</p></div><Button variant="ghost" size="icon" aria-label="URL 가져오기 닫기" disabled={mutation.isPending || reading} onClick={onClose}><X className="size-4" /></Button></div>
    <div className="flex flex-wrap items-center gap-2"><input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = '' }} /><Button variant="outline" disabled={!ready || mutation.isPending || reading} onClick={() => input.current?.click()}><Upload className="size-4" />{reading ? '읽는 중...' : '쇼핑몰 URL 파일 선택'}</Button><span className="text-xs text-muted-foreground">{fileName || '쇼핑몰 상품코드 url.xlsx 양식'}</span></div>
    {!ready ? <p className="text-sm text-muted-foreground">{targets.isError || aliases.isError || folders.isError ? '업체 정보를 불러오지 못했습니다.' : '업체 정보를 불러오는 중...'}</p> : null}
    {error || preview.error ? <p role="alert" className="text-sm text-danger">{error || preview.error}</p> : null}
    {summary ? <p role="status" className="text-sm text-success">{summary}</p> : null}
    {fileRows && !preview.error ? <>
      <div className="flex flex-wrap gap-2">{Object.entries(URL_STATUS_LABEL).map(([key, label]) => <span key={key} className="rounded-md bg-muted px-2 py-1 text-xs">{label} {formatNumber(counts.get(key as UrlImportStatus) ?? 0)}</span>)}</div>
      <div className="flex flex-wrap items-center gap-2"><Select aria-label="URL 등록 상태 필터" className="w-56" value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1) }}><option value="all">전체 {formatNumber(preview.rows.length)}행</option>{Object.entries(URL_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select><Button variant="outline" onClick={downloadHeld}><Download className="size-4" />보류·제외 목록 다운로드</Button><Button disabled={!counts.get('ready') || mutation.isPending || reading} onClick={() => { setError(''); setProgress({ done: 0, total: counts.get('ready') ?? 0 }); mutation.mutate() }}>{mutation.isPending ? `저장 중 ${formatNumber(progress.done)} / ${formatNumber(progress.total)}` : `등록 예정 ${formatNumber(counts.get('ready') ?? 0)}건 저장`}</Button></div>
      <div className="max-h-96 overflow-auto rounded-md border border-border"><table className="w-full min-w-[1050px] table-fixed text-left text-xs"><thead className="sticky top-0 bg-primary text-primary-foreground"><tr>{['원본 행', '쇼핑몰', '사방넷 코드', '상품명', '쇼핑몰상품코드', 'URL', '상태'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{shown.map(r => <tr key={r.lineNo} className="border-t border-border odd:bg-muted/20"><td className="p-2">{r.lineNo}</td><td className="p-2" title={r.targetName}>{r.mall}</td><td className="p-2">{r.code}</td><td className="truncate p-2" title={r.name}>{r.name}</td><td className="truncate p-2" title={r.mallProductCode}>{r.mallProductCode}</td><td className="truncate p-2" title={r.url}>{r.url}</td><td className="p-2" title={r.reason}>{URL_STATUS_LABEL[r.status]}</td></tr>)}</tbody></table></div>
      <div className="flex items-center justify-end gap-3 text-xs"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</Button>{currentPage} / {maxPage}<Button variant="outline" size="sm" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>다음</Button></div>
    </> : null}
  </CardContent></Card>
}
