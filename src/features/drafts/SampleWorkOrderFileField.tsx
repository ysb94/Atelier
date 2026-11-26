import { useRef, useState, type ReactNode } from 'react'
import { useDraftLoading } from './DraftLoading'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readFileAsDataUrl } from '@/lib/images'
import { cn } from '@/lib/utils'

export const SAMPLE_WORK_ORDER_ACCEPT =
  'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx'
export const SAMPLE_WORK_ORDER_MAX_BYTES = 8 * 1024 * 1024

export type SampleWorkOrderFile = { url: string; name: string }

export function SampleWorkOrderFileField({ label, savedFile, side, readOnly, saving, onRegister }: {
  label: string
  savedFile?: SampleWorkOrderFile | null
  side?: ReactNode
  readOnly?: boolean
  saving?: boolean
  onRegister?: (file: SampleWorkOrderFile) => Promise<void>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const [file, setFile] = useState<SampleWorkOrderFile | null>(null)
  const [reading, setReading] = useState(false)
  const [registering, setRegistering] = useState(false)
  useDraftLoading(reading && '작업지시서 파일을 읽는 중…', true)
  useDraftLoading(registering && '작업지시서를 등록하는 중…', true)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const editable = !readOnly && Boolean(onRegister)
  const disabled = !editable || saving || reading || registering
  const boxClass = 'flex min-h-20 w-full items-center justify-center rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground'
  const savedLink = savedFile && <a href={savedFile.url} download={savedFile.name} className="min-w-0 truncate text-foreground underline-offset-2 hover:underline">{savedFile.name}</a>

  async function select(files: FileList | null) {
    if (disabled || pending.current || !files?.length) return
    setFile(null)
    setError('')
    const selected = files[0]
    if (files.length !== 1) { setError('작업지시서는 한 번에 한 파일만 선택해 주세요.'); return }
    if (selected.size > SAMPLE_WORK_ORDER_MAX_BYTES) { setError('작업지시서는 8MB 이하만 올릴 수 있습니다.'); return }
    if (!SAMPLE_WORK_ORDER_ACCEPT.split(',').some(value =>
      value.startsWith('.') ? selected.name.toLowerCase().endsWith(value) : selected.type === value,
    )) { setError('PDF, 이미지(PNG·JPG·WEBP), 엑셀 파일을 선택해 주세요.'); return }
    pending.current = true
    setReading(true)
    try {
      setFile({ url: await readFileAsDataUrl(selected), name: selected.name })
    } catch {
      setError('작업지시서를 불러오지 못했습니다. 다시 선택해 주세요.')
    } finally {
      pending.current = false
      setReading(false)
    }
  }

  async function register() {
    if (disabled || pending.current || !file || !onRegister) return
    pending.current = true
    setRegistering(true)
    setError('')
    try {
      await onRegister(file)
      setFile(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '작업지시서를 등록하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      pending.current = false
      setRegistering(false)
    }
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="col-start-2 text-center text-sm text-muted-foreground">{label} 작업지시서</p>
        {editable && <Button type="button" size="sm" className="justify-self-end" disabled={disabled || !file}
          onClick={() => void register()}>{registering ? '등록 중...' : '등록'}</Button>}
      </div>
      <div className={cn('mt-4 grid items-start gap-4', Boolean(side) && 'sm:grid-cols-[240px_minmax(0,1fr)]')}>
        {side}
        <div className="min-w-0">
          {editable ? (
            <div
              onDragOver={event => {
                event.preventDefault()
                const canDrop = !disabled && event.dataTransfer.types.includes('Files')
                event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none'
                setDragging(canDrop)
              }}
              onDragLeave={event => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
              }}
              onDrop={event => {
                event.preventDefault()
                setDragging(false)
                void select(event.dataTransfer.files)
              }}
            >
              <input ref={fileInput} type="file" aria-label={`${label} 작업지시서 파일`}
                accept={SAMPLE_WORK_ORDER_ACCEPT} className="hidden" disabled={disabled}
                onChange={event => {
                  void select(event.currentTarget.files)
                  event.currentTarget.value = ''
                }} />
              <Button type="button" variant="ghost" aria-label={`${label} 작업지시서 파일 선택`}
                className={cn(boxClass, 'h-auto flex-col overflow-hidden font-normal', dragging && 'border-primary bg-primary/5')}
                disabled={disabled} onClick={() => fileInput.current?.click()}>
                <span className="flex w-full min-w-0 items-center justify-center gap-2">
                  <Upload className="size-4 shrink-0" />
                  <span className="truncate">{reading ? '파일 읽는 중...' : file?.name ?? (savedFile ? '교체할 파일 선택' : '올린 파일이 없습니다.')}</span>
                </span>
                <span className="text-xs">{file ? '등록을 누르면 저장됩니다.' : '클릭하거나 파일을 끌어다 놓으세요.'}</span>
              </Button>
              {savedLink && <p className="mt-2 flex gap-2 text-xs text-muted-foreground"><span className="shrink-0">등록된 파일</span>{savedLink}</p>}
            </div>
          ) : (
            <div className={boxClass}>{savedLink || '올린 파일이 없습니다.'}</div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      </div>
    </>
  )
}
