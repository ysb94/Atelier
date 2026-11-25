import { useEffect, useId, useRef, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const previewTypes = {
  'application/pdf': { extension: /\.pdf$/i, matches: (bytes: Uint8Array) => [37, 80, 68, 70, 45].every((byte, index) => bytes[index] === byte) },
  'image/jpeg': { extension: /\.jpe?g$/i, matches: (bytes: Uint8Array) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 },
  'image/png': { extension: /\.png$/i, matches: (bytes: Uint8Array) => [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) },
  'image/webp': { extension: /\.webp$/i, matches: (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' },
} as const

function workOrderPreviewType(url: string | null, fileName: string) {
  const header = url?.match(/^data:([^;,]*)(?:;[^,]*)?,/i)
  if (!header) return null
  const declared = header[1].toLowerCase()
  if (Object.hasOwn(previewTypes, declared)) return declared as keyof typeof previewTypes
  if (declared && declared !== 'application/octet-stream') return null
  return (Object.keys(previewTypes) as (keyof typeof previewTypes)[]).find(type => previewTypes[type].extension.test(fileName.trim())) ?? null
}

export function ChinaWorkOrderPreviewButton({ url, name, readFile }: { url: string | null; name: string; readFile?: () => Promise<Blob> }) {
  const [open, setOpen] = useState(false)
  const type = readFile
    ? (Object.keys(previewTypes) as (keyof typeof previewTypes)[]).find(value => previewTypes[value].extension.test(name.trim()))
    : workOrderPreviewType(url, name)
  if (!url || !type) return null

  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Eye className="size-3.5" aria-hidden="true" />미리보기</Button>
    {open && <ChinaWorkOrderPreview url={url} name={name} type={type} readFile={readFile} onClose={() => setOpen(false)} />}
  </>
}

function ChinaWorkOrderPreview({ url, name, type, readFile, onClose }: {
  url: string
  name: string
  type: keyof typeof previewTypes
  readFile?: () => Promise<Blob>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [preview, setPreview] = useState<{ source: string; objectUrl: string } | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const objectUrl = preview?.source === url ? preview.objectUrl : undefined
  const failed = failedSource === url

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    let previewUrl: string | undefined
    void (async () => {
      try {
        let file: Blob
        if (readFile) file = await readFile()
        else {
          const result = await fetch(url, { signal: abort.signal })
          if (!result.ok) throw new Error()
          file = await result.blob()
        }
        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
        if (!previewTypes[type].matches(header)) throw new Error()
        if (abort.signal.aborted) return
        previewUrl = URL.createObjectURL(new Blob([file], { type }))
        setPreview({ source: url, objectUrl: previewUrl })
      } catch {
        if (!abort.signal.aborted) setFailedSource(url)
      }
    })()
    return () => {
      abort.abort()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [url, type, readFile])

  return <dialog ref={dialog} aria-labelledby={title} onCancel={onClose}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-5xl overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl backdrop:bg-black/50">
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
      <h2 id={title} className="min-w-0 truncate text-sm font-semibold">{name || '작업 지시서'} 미리보기</h2>
      <Button type="button" variant="ghost" size="icon" aria-label="미리보기 닫기" className="shrink-0" onClick={onClose}><X size={18} aria-hidden="true" /></Button>
    </header>
    {failed ? <p role="alert" className="p-5 text-sm text-danger">미리보기를 열 수 없습니다. 파일 받기로 확인해 주세요.</p>
      : objectUrl ? type === 'application/pdf'
        ? <div>
          <div className="flex justify-end border-b border-border px-4 py-2"><a href={objectUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">PDF 새 탭에서 열기</a></div>
          <iframe src={objectUrl} title="PDF 작업 지시서" className="h-[68dvh] w-full border-0" referrerPolicy="no-referrer" />
        </div>
        : <img src={objectUrl} alt={name || '작업 지시서'} className="mx-auto max-h-[75dvh] w-auto max-w-full object-contain" onError={() => setFailedSource(url)} />
      : <p role="status" className="p-5 text-sm text-muted-foreground">미리보기를 준비 중입니다.</p>}
  </dialog>
}
