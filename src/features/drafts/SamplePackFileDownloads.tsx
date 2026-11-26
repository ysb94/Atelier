import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadSamplePackFile, type SamplePack } from '@/lib/supabase/sample-work-order-packs'

export function SamplePackFileDownloads({ pack, onClose }: { pack: SamplePack; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [started, setStarted] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function download(file: SamplePack['files'][number]) {
    setBusy(file.path)
    setError('')
    try {
      await downloadSamplePackFile(file)
      setStarted(current => new Set(current).add(file.path))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '파일을 받지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(false) }}
    className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/50">
    <h2 id={title} className="font-semibold">작업지시서 첨부 받기</h2>
    <p className="mt-2 text-sm text-muted-foreground">파일을 하나씩 받고, 브라우저에서 다운로드가 끝난 것을 확인해 주세요.</p>
    <ul className="my-4 divide-y divide-border">
      {pack.files.map(file => <li key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
        <span className="min-w-0 break-all">{file.name}</span>
        <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} aria-label={`${file.name} 받기`}
          onClick={() => void download(file)}>{busy === file.path ? '준비 중…' : started.has(file.path) ? '다시 받기' : '받기'}</Button>
      </li>)}
    </ul>
    {error && <p role="alert" className="my-2 text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={() => onClose(false)}>닫기</Button>
      <Button type="button" disabled={Boolean(busy) || started.size !== pack.files.length} onClick={() => onClose(true)}>다운로드 확인</Button>
    </div>
  </dialog>
}
