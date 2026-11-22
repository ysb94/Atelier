import { useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DRAFT_COLOR_PHOTO_ACCEPT, prepareDraftColorPhoto, resolveDraftVisualPhoto } from '@/lib/drafts/color-photo'
import type { DraftColorRow } from '@/lib/types'
import { cn } from '@/lib/utils'

function DraftVisualImageCard({ name, visualPhoto, colorPhoto, readOnly, onSave }: {
  name: string
  visualPhoto?: string
  colorPhoto?: string
  readOnly: boolean
  onSave: (photo: string) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<string>()
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const { src: preview, temporary: showingTemporaryPhoto } = resolveDraftVisualPhoto(pending ?? visualPhoto, colorPhoto)

  async function chooseImage(file: File) {
    setPreparing(true)
    setError('')
    try {
      setPending(await prepareDraftColorPhoto(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : '이미지를 불러오지 못했습니다.')
    } finally {
      setPreparing(false)
    }
  }

  return <section aria-label={`${name} 이미지`}
    className="grid min-w-0 grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)] items-start gap-4 border-b border-primary/45 p-4 @[720px]:gap-5 @[720px]:px-6 @[720px]:py-7 @[720px]:odd:border-r @[720px]:odd:border-r-border">
    <input ref={picker} type="file" hidden accept={DRAFT_COLOR_PHOTO_ACCEPT} aria-label={`${name} 이미지 파일`}
      disabled={readOnly || preparing} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void chooseImage(file)
      }} />
    <Button type="button" variant="outline" aria-label={`${name} 이미지 ${preview ? '변경' : '등록'}`}
      aria-description={showingTemporaryPhoto ? '컬러에 등록된 임시 이미지' : undefined}
      aria-busy={preparing} disabled={readOnly || preparing} onClick={() => picker.current?.click()}
      className={cn('relative grid aspect-square h-auto w-full place-items-center overflow-hidden rounded-xl bg-muted/35 p-0 disabled:opacity-100',
        pending && 'draft-visual-image-pending',
        showingTemporaryPhoto && 'draft-visual-image-temporary')}>
      {preview ? <img src={preview} alt={`${name} 이미지 미리보기`} className="absolute inset-0 size-full object-contain" />
        : <ImagePlus size={30} aria-hidden="true" className="text-muted-foreground" />}
    </Button>
    <div className="flex h-full min-w-0 flex-col justify-between gap-3 @[720px]:py-2">
      <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">color
        <Input value={name} readOnly className="h-8 min-w-0 font-medium text-foreground" />
      </label>
      {!readOnly && <Button type="button" aria-label={`${name} 이미지 저장`} size="sm" className="self-end px-4"
        disabled={!pending || preparing} onClick={() => {
          if (!pending) return
          onSave(pending)
          setPending(undefined)
          setError('')
        }}>저장</Button>}
    </div>
    {error && <p role="alert" className="col-span-2 text-xs text-danger">{error}</p>}
  </section>
}

export function DraftVisualImagePanel({ colors, visualPhotos, colorPhotos, readOnly, onSave }: {
  colors: DraftColorRow[]
  visualPhotos: Readonly<Partial<Record<string, string>>>
  colorPhotos?: Readonly<Record<string, string>>
  readOnly: boolean
  onSave: (colorId: string, photo: string) => void
}) {
  if (!colors.length) return <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">등록된 컬러가 없습니다.</p>

  return <div className="grid border-t border-border @[720px]:grid-cols-2">
    {colors.map((color, index) => <DraftVisualImageCard key={color.id} name={color.name.trim() || `컬러 ${index + 1}`}
      visualPhoto={visualPhotos[color.id]} colorPhoto={colorPhotos?.[color.id]}
      readOnly={readOnly} onSave={photo => onSave(color.id, photo)} />)}
  </div>
}
