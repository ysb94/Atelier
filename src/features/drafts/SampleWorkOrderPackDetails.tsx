import { useCallback, useState } from 'react'
import { useDraftLoading } from './DraftLoading'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { ChinaWorkOrderPreviewButton } from '@/features/china/ChinaWorkOrderPreview'
import { downloadSamplePackFile, getSamplePack, previewSamplePackFile, SAMPLE_PACK_PREVIEW_LIMIT, samplePackPrefix, type SamplePackFile } from '@/lib/supabase/sample-work-order-packs'
import { useSamplePackDownload } from './useSamplePackDownload'

function SampleWorkOrderPackFile({ file, busy, onDownload }: { file: SamplePackFile; busy: boolean; onDownload: () => void }) {
  const readFile = useCallback(() => previewSamplePackFile(file), [file])
  return <li className="flex flex-wrap items-center gap-1">
    <Button type="button" size="sm" variant="ghost" disabled={busy} className="h-auto whitespace-normal break-all text-left"
      onClick={onDownload}>{file.name}</Button>
    {file.size <= SAMPLE_PACK_PREVIEW_LIMIT && <ChinaWorkOrderPreviewButton url={file.path} name={file.name} readFile={readFile} />}
  </li>
}

export function SampleWorkOrderPackDetails({ id, label, showBulk = false }: { id: string; label: string; showBulk?: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bulk = useSamplePackDownload()
  const { profile, session } = useAuth()
  const actor = profile?.id === session?.user.id ? profile?.id : undefined
  const query = useQuery({ queryKey: [...samplePackPrefix, actor, id], queryFn: () => getSamplePack(id), enabled: Boolean(actor), retry: false })
  const pack = query.data
  useDraftLoading(query.isLoading && '작업지시서 첨부 목록을 불러오는 중…')
  useDraftLoading(busy && !bulk.dialog && '작업지시서 다운로드를 준비하는 중…', true)

  async function download(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '파일을 받지 못했습니다.') }
    finally { setBusy(false) }
  }

  if (!actor) return null
  if (query.isPending) return <span className="text-xs text-muted-foreground">첨부 목록을 불러오는 중…</span>
  if (query.isError || !pack) return <div className="text-xs text-danger">첨부 목록을 불러오지 못했습니다. <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()}>다시 조회</Button></div>
  const firstFile = pack.files[0]
  if (!firstFile) return null
  const remaining = pack.files.length - 1
  const expanded = expandedId === id
  const Chevron = expanded ? ChevronDown : ChevronRight
  return <div className="min-w-0 space-y-1">
    {pack.notes && <p className="whitespace-pre-wrap rounded bg-muted p-2 text-xs"><strong>꼭 확인할 사항</strong><br />{pack.notes}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" className="min-w-0 max-w-full shrink border border-border"
        aria-expanded={expanded} title={firstFile.name} onClick={() => setExpandedId(expanded ? null : id)}>
        <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{firstFile.name}</span>
        {remaining > 0 && <span className="shrink-0 text-muted-foreground">외 {remaining}개</span>}
        <Chevron aria-hidden="true" className="size-3.5 shrink-0" />
      </Button>
      {showBulk && <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => void download(() => bulk.download(id, label))}>전체 다운로드</Button>}
    </div>
    {expanded && <ul aria-label="등록한 첨부 파일" className="text-xs">{pack.files.map(file => <SampleWorkOrderPackFile key={file.path} file={file} busy={busy}
      onDownload={() => void download(() => downloadSamplePackFile(file))} />)}</ul>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {bulk.dialog}
  </div>
}
