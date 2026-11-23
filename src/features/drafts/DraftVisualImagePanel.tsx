import { useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DRAFT_COLOR_PHOTO_ACCEPT, prepareDraftColorPhoto, resolveDraftVisualPhoto } from '@/lib/drafts/color-photo'
import { draftVisualSaveError, type DraftVisualContent } from '@/lib/supabase/draft-visual-content'
import type { DraftInformationTemporary } from '@/lib/supabase/draft-information-temporary'
import type { DraftColorRow } from '@/lib/types'
import { cn } from '@/lib/utils'

type PhotoSelection = { photo: string; revision: string | null; draftRevision: string }
type SavePhoto = (selection: PhotoSelection, asTemporary: boolean, temporaryRevision?: string) => Promise<void>

function DraftVisualImageCard({ name, visualPhoto, revision, colorPhoto, draftRevision, readOnly, workingCopy, canSaveTemporary, onSave }: {
  name: string
  visualPhoto?: string
  revision?: string
  colorPhoto?: string
  draftRevision: string
  readOnly: boolean
  workingCopy?: DraftInformationTemporary
  canSaveTemporary: boolean
  onSave: SavePhoto
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PhotoSelection>()
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const working = readOnly ? undefined : workingCopy?.edits.image
  const localSelection = pending ?? (working ? {
    photo: working.text, revision: working.source || null, draftRevision: working.draftRevision ?? draftRevision,
  } : undefined)
  const shared = resolveDraftVisualPhoto(visualPhoto, colorPhoto)
  // Existing final photos can be linked by saving them again if they predate the shared image.
  const selection = localSelection ?? (shared.src && visualPhoto !== colorPhoto
    ? { photo: shared.src, revision: revision ?? null, draftRevision } : undefined)
  const temporarilySaved = Boolean(working && !pending)
  const versionChanged = Boolean(localSelection &&
    (localSelection.revision !== (revision ?? null) || localSelection.draftRevision !== draftRevision))
  const preview = localSelection?.photo ?? shared.src
  const showingTemporaryPhoto = !localSelection && shared.temporary

  async function chooseImage(file: File) {
    setPreparing(true)
    setError('')
    try {
      setPending({ photo: await prepareDraftColorPhoto(file), revision: revision ?? null, draftRevision })
    } catch (err) {
      setError(err instanceof Error ? err.message : '이미지를 불러오지 못했습니다.')
    } finally {
      setPreparing(false)
    }
  }

  async function save(asTemporary: boolean) {
    if (!selection || versionChanged) return
    setSaving(true)
    setError('')
    try {
      await onSave(selection, asTemporary, workingCopy?.revision)
      setPending(undefined)
    } catch (error) {
      setError(draftVisualSaveError(error))
    } finally {
      setSaving(false)
    }
  }

  return <section aria-label={`${name} 이미지`}
    className="grid min-w-0 grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)] items-start gap-4 border-b border-primary/45 p-4 @[720px]:gap-5 @[720px]:px-6 @[720px]:py-7 @[720px]:odd:border-r @[720px]:odd:border-r-border">
    <input ref={picker} type="file" hidden accept={DRAFT_COLOR_PHOTO_ACCEPT} aria-label={`${name} 이미지 파일`}
      disabled={readOnly || preparing || saving} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void chooseImage(file)
      }} />
    <Button type="button" variant="outline" aria-label={`${name} 이미지 ${preview ? '변경' : '등록'}`}
      aria-description={temporarilySaved ? '임시저장됨' : showingTemporaryPhoto ? '컬러에 등록된 임시 이미지' : undefined}
      aria-busy={preparing || saving} disabled={readOnly || preparing || saving} onClick={() => picker.current?.click()}
      className={cn('relative grid aspect-square h-auto w-full place-items-center overflow-hidden rounded-xl bg-muted/35 p-0 disabled:opacity-100',
        localSelection && 'draft-visual-image-pending',
        showingTemporaryPhoto && 'draft-visual-image-temporary')}>
      {preview ? <img src={preview} alt={`${name} 이미지 미리보기`} className="absolute inset-0 size-full object-contain" />
        : <ImagePlus size={30} aria-hidden="true" className="text-muted-foreground" />}
    </Button>
    <div className="flex h-full min-w-0 flex-col justify-between gap-3 @[720px]:py-2">
      <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">color
        <Input value={name} readOnly className="h-8 min-w-0 font-medium text-foreground" />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <span role="status" className="mr-auto text-[10px] text-muted-foreground">
          {temporarilySaved ? '임시저장됨' : !localSelection && visualPhoto ? '저장됨' : ''}
        </span>
        {!readOnly && <>
          <Button type="button" aria-label={`${name} 이미지 임시저장`} size="sm" variant="secondary"
            disabled={!canSaveTemporary || !pending || preparing || saving || versionChanged}
            onClick={() => void save(true)}>임시저장</Button>
          <Button type="button" aria-label={`${name} 이미지 저장`} size="sm" className="px-4"
            disabled={!selection || preparing || saving || versionChanged}
            onClick={() => void save(false)}>{saving ? '저장 중…' : '저장'}</Button>
        </>}
      </div>
    </div>
    {(versionChanged || error) && <p role="alert" className="col-span-2 text-xs text-danger">
      {versionChanged ? '다른 화면에서 이미지를 먼저 저장했습니다. 새 이미지를 선택해 주세요.' : error}
    </p>}
  </section>
}

export function DraftVisualImagePanel({ colors, visualPhotos, colorPhotos, draftRevision, readOnly, workingCopies, canSaveTemporary, onSave }: {
  colors: DraftColorRow[]
  visualPhotos: readonly DraftVisualContent[]
  colorPhotos?: Readonly<Record<string, string>>
  draftRevision: string
  readOnly: boolean
  workingCopies?: readonly DraftInformationTemporary[]
  canSaveTemporary: boolean
  onSave: (colorId: string, ...args: Parameters<SavePhoto>) => Promise<void>
}) {
  if (!colors.length) return <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">등록된 컬러가 없습니다.</p>

  return <div className="grid border-t border-border @[720px]:grid-cols-2">
    {colors.map((color, index) => {
      const saved = visualPhotos.find(row => row.kind === 'color-photo' && row.entry_key === color.id)
      const working = workingCopies?.find(row => row.field === 'image' && row.color_id === color.id)
      return <DraftVisualImageCard key={color.id} name={color.name.trim() || `컬러 ${index + 1}`}
        visualPhoto={typeof saved?.payload === 'string' ? saved.payload : undefined} revision={saved?.revision}
        colorPhoto={colorPhotos?.[color.id]} draftRevision={draftRevision} readOnly={readOnly}
        workingCopy={working} canSaveTemporary={canSaveTemporary}
        onSave={(...args) => onSave(color.id, ...args)} />
    })}
  </div>
}
