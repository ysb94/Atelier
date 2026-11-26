import { useState, useRef, type ReactNode } from 'react'
import { useDraftLoading } from './DraftLoading'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { cn } from '@/lib/utils'
import {
  getSamplePack, openSamplePack, samplePackId, samplePackPrefix, samplePackReference,
  samplePackServerMissing, saveSamplePack, uploadSamplePackFile, validateSelectedSampleFiles,
  type SamplePack, type SamplePackFile, type SamplePackUpload,
} from '@/lib/supabase/sample-work-order-packs'
import { SampleWorkOrderPackDetails } from './SampleWorkOrderPackDetails'

type Props = {
  label: string; draftId: string | null; slot: string; side?: ReactNode; readOnly?: boolean; saving?: boolean
  savedFile?: { url: string; name: string } | null
  onRegister?: (file: { url: string; name: string }) => Promise<void>
  onCreateDraft?: () => Promise<string>
  onTemporarySaved?: (draft: string) => void
  validateRegistration?: () => void
}

export function SampleWorkOrderPackField({ label, draftId, slot, side, readOnly, saving, savedFile,
  onRegister, onCreateDraft, onTemporarySaved, validateRegistration }: Props) {
  const cache = useQueryClient()
  const { profile, session } = useAuth()
  const actor = profile?.id === session?.user.id ? profile?.id : undefined
  const busyRef = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const persistedDraft = useRef(draftId)
  const uploadedFiles = useRef(new Map<File, SamplePackFile>())
  const uploadAttempts = useRef(new Map<File, SamplePackUpload>())
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState('')
  const [added, setAdded] = useState<File[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState(false)
  const previousId = samplePackId(savedFile?.url)
  const editingDraftId = draftId ?? createdDraftId
  const temporaryKey = [...samplePackPrefix, actor, 'draft', editingDraftId, slot]
  const draftPack = useQuery({
    queryKey: temporaryKey, queryFn: () => getSamplePack(null, editingDraftId, slot),
    enabled: Boolean(actor) && !readOnly && (!savedFile || editing), retry: false,
  })
  const previous = useQuery({
    queryKey: [...samplePackPrefix, actor, previousId], queryFn: () => getSamplePack(previousId),
    enabled: Boolean(actor && previousId) && editing, retry: false,
  })
  const baseline = draftPack.data ?? previous.data
  const files = (baseline?.files ?? []).filter(file => !removed.includes(file.path))
  const count = files.length + added.length
  const editable = Boolean(actor) && !readOnly && Boolean(onRegister)
  const showEditor = editable && (!savedFile || editing)
  const waiting = samplePackServerMissing(draftPack.error)
  const loading = draftPack.isFetching || (Boolean(previousId) && previous.isFetching)
  useDraftLoading(showEditor && (draftPack.isLoading || previous.isLoading) && '작업지시서 첨부 목록을 불러오는 중…')
  useDraftLoading(busy && (progress || '작업지시서를 저장하는 중…'), true)
  const uploadDisabled = busy || saving || loading || waiting
  const hasEdits = Boolean(added.length || removed.length)

  function select(list: FileList | null) {
    if (!list?.length || uploadDisabled) return
    const next = [...added, ...Array.from(list)]
    try {
      validateSelectedSampleFiles(files, next)
      setAdded(next)
      setStatus('')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '파일을 선택하지 못했습니다.')
    }
  }

  async function save(register: boolean) {
    if (!actor || !editable || busyRef.current || saving || loading || waiting) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      if (register) validateRegistration?.()
      validateSelectedSampleFiles(files, added)
      const id = draftId ?? persistedDraft.current ?? await onCreateDraft?.()
      if (!id) throw new Error('기획안을 먼저 저장해 주세요.')
      persistedDraft.current = id
      setCreatedDraftId(id)
      let pack: SamplePack = draftPack.data ?? await openSamplePack(id, slot)
      if (hasEdits || (!draftPack.data && previous.data)) {
        const uploaded: SamplePackFile[] = []
        let index = 0
        for (const file of added) {
          index += 1
          let item = uploadedFiles.current.get(file)
          if (!item?.path.startsWith(`${pack.id}/`)) {
            let attempt = uploadAttempts.current.get(file)
            if (!attempt?.path.startsWith(`${pack.id}/`)) {
              attempt = { path: `${pack.id}/${crypto.randomUUID()}` }
              uploadAttempts.current.set(file, attempt)
            }
            setProgress(`파일 확인 중 · ${index}/${added.length} · ${file.name}`)
            item = await uploadSamplePackFile(file, attempt, actor, sent => {
              setProgress(`업로드 중 · ${index}/${added.length} · ${Math.floor(sent / file.size * 100)}% · ${file.name}`)
            })
            uploadedFiles.current.set(file, item)
          }
          uploaded.push(item)
        }
        pack = await saveSamplePack(pack, [...files, ...uploaded], baseline?.notes ?? '')
      }
      cache.setQueryData([...samplePackPrefix, actor, 'draft', id, slot], pack)
      uploadedFiles.current.clear()
      uploadAttempts.current.clear()
      setAdded([]); setRemoved([])
      if (register) {
        await onRegister?.(samplePackReference(pack, slot.startsWith('edit:') ? `${label} 수정본` : label))
        cache.removeQueries({ queryKey: [...samplePackPrefix, actor, pack.id], exact: true })
        cache.setQueryData([...samplePackPrefix, actor, 'draft', id, slot], null)
        setEditing(false)
      } else {
        setStatus(`임시저장 · 첨부 ${pack.files.length}개`)
        onTemporarySaved?.(id)
      }
    } catch (cause) {
      setError(samplePackServerMissing(cause) ? '작업지시서 묶음 서버 연결 대기' : cause instanceof Error ? cause.message : '작업지시서를 저장하지 못했습니다.')
    } finally {
      busyRef.current = false
      setBusy(false)
      setProgress('')
    }
  }

  return <div className="mt-5 grid min-w-0 gap-3" aria-label={`${label} 작업지시서 첨부`}>
    {side}
    {savedFile && <>
      {previousId ? <SampleWorkOrderPackDetails id={previousId} showBulk label={savedFile.name} />
        : <a href={savedFile.url} download={savedFile.name} className="text-sm underline">{savedFile.name}</a>}
      {editable && !editing && <Button type="button" variant="outline" size="sm" className="justify-self-start"
        onClick={() => setEditing(true)}>수정본 작성</Button>}
    </>}
    {showEditor && <>
      {count > 0 && <ul aria-label="첨부 파일 목록" className="min-w-0 divide-y divide-border rounded-xl border border-border text-sm">
        {files.map(file => <li key={file.path} className="flex items-center justify-between gap-2 px-3 py-1">
          <span className="break-all">{file.name}</span>
          <Button type="button" variant="ghost" size="sm" disabled={busy || saving} aria-label={`${file.name} 빼기`}
            onClick={() => setRemoved(current => [...current, file.path])}>빼기</Button>
        </li>)}
        {added.map((file, index) => <li key={index} className="flex items-center justify-between gap-2 px-3 py-1">
          <span className="break-all">{file.name}</span>
          <Button type="button" variant="ghost" size="sm" disabled={busy || saving} aria-label={`${file.name} 선택 취소`}
            onClick={() => {
              uploadedFiles.current.delete(file)
              uploadAttempts.current.delete(file)
              setAdded(current => current.filter((_, i) => i !== index))
            }}>빼기</Button>
        </li>)}
      </ul>}
      <div
        onDragOver={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = uploadDisabled ? 'none' : 'copy'
          setDragging(!uploadDisabled)
        }}
        onDragLeave={event => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
        }}
        onDrop={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(false)
          select(event.dataTransfer.files)
        }}
      >
        <input ref={fileInput} type="file" multiple className="hidden"
          aria-label={`${label} 작업지시서 파일`} disabled={uploadDisabled}
          onChange={event => { select(event.currentTarget.files); event.currentTarget.value = '' }} />
        <Button type="button" variant="ghost" disabled={uploadDisabled} aria-label={`${label} 작업지시서 파일 선택`}
          className={cn('h-auto min-h-20 w-full flex-col gap-1 rounded-xl border border-dashed border-border px-4 py-3 font-normal text-muted-foreground',
            dragging && 'border-primary bg-primary/5')}
          onClick={() => fileInput.current?.click()}>
          <span className="flex items-center gap-2"><Upload aria-hidden="true" className="size-4 shrink-0" />파일을 끌어다 놓거나 클릭하세요.</span>
          <span className="text-xs">작업지시서 한 건당 첨부 전체 10GB</span>
        </Button>
      </div>
      {waiting && <p role="status" className="text-sm text-warning">작업지시서 묶음 서버 연결 대기</p>}
      {draftPack.isError && !waiting && <p role="alert" className="text-sm text-danger">임시저장을 불러오지 못했습니다. <Button type="button" size="sm" variant="ghost" onClick={() => void draftPack.refetch()}>다시 조회</Button></p>}
      {previous.isError && <p role="alert" className="text-sm text-danger">기존 파일을 확인하지 못했습니다. <Button type="button" size="sm" variant="ghost" onClick={() => void previous.refetch()}>다시 조회</Button></p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {progress && <p role="status" className="break-all text-sm text-muted-foreground">{progress}</p>}
      {(status || draftPack.data) && <p role="status" className="text-sm text-muted-foreground">{status || `임시저장 · 첨부 ${draftPack.data?.files.length ?? 0}개`}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {editing && <Button type="button" variant="ghost" disabled={busy || saving} onClick={() => {
          uploadedFiles.current.clear(); uploadAttempts.current.clear()
          setEditing(false); setAdded([]); setRemoved([]); setDragging(false); setStatus(''); setError('')
        }}>닫기</Button>}
        <Button type="button" variant="outline" disabled={busy || saving || loading || waiting || !hasEdits || draftPack.isError || previous.isError} onClick={() => void save(false)}>임시저장</Button>
        <Button type="button" disabled={busy || saving || loading || waiting || !count || (editing && !hasEdits && !draftPack.data) || draftPack.isError || previous.isError}
          onClick={() => void save(true)}>{busy ? '처리 중…' : `첨부 ${count}개 · 등록`}</Button>
      </div>
    </>}
  </div>
}
