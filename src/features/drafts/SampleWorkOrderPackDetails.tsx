import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { ChinaWorkOrderPreviewButton } from '@/features/china/ChinaWorkOrderPreview'
import { downloadSamplePack, downloadSamplePackFile, getSamplePack, previewSamplePackFile, samplePackPrefix, type SamplePackFile } from '@/lib/supabase/sample-work-order-packs'

function SampleWorkOrderPackFile({ file, busy, onDownload }: { file: SamplePackFile; busy: boolean; onDownload: () => void }) {
  const readFile = useCallback(() => previewSamplePackFile(file), [file])
  return <li className="flex flex-wrap items-center gap-1">
    <Button type="button" size="sm" variant="ghost" disabled={busy} className="h-auto whitespace-normal break-all text-left"
      onClick={onDownload}>{file.name}</Button>
    <ChinaWorkOrderPreviewButton url={file.path} name={file.name} readFile={readFile} />
  </li>
}

export function SampleWorkOrderPackDetails({ id, label, showBulk = false }: { id: string; label: string; showBulk?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { profile, session } = useAuth()
  const actor = profile?.id === session?.user.id ? profile?.id : undefined
  const query = useQuery({ queryKey: [...samplePackPrefix, actor, id], queryFn: () => getSamplePack(id), enabled: Boolean(actor), retry: false })
  const pack = query.data

  async function download(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '파일을 받지 못했습니다.') }
    finally { setBusy(false) }
  }

  if (!actor) return null
  if (query.isPending) return <span className="text-xs text-muted-foreground">첨부 목록을 불러오는 중…</span>
  if (query.isError || !pack) return <div className="text-xs text-danger">첨부 목록을 불러오지 못했습니다. <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()}>다시 조회</Button></div>
  return <div className="space-y-1">
    {pack.notes && <p className="whitespace-pre-wrap rounded bg-muted p-2 text-xs"><strong>꼭 확인할 사항</strong><br />{pack.notes}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>첨부 {pack.files.length}개</Button>
      {showBulk && <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => void download(() => downloadSamplePack(id, label))}>전체 다운로드</Button>}
    </div>
    {open && <ul className="text-xs">{pack.files.map(file => <SampleWorkOrderPackFile key={file.path} file={file} busy={busy}
      onDownload={() => void download(() => downloadSamplePackFile(file))} />)}</ul>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>
}
