import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'

type Photo = { file: File; url: string }
export function SpinPhotoInput({ locked, edge, brightness, contrast, onSettings, onChange, onGenerate }: {
  locked: boolean; edge: number; brightness: number; contrast: number
  onSettings: (values: { edge?: number; brightness?: number; contrast?: number }) => void
  onChange: (count: number) => void; onGenerate: (files: File[]) => void
}) {
  const [photos, setPhotos] = useState<Photo[]>([]), [error, setError] = useState('')
  const current = useRef(photos); current.current = photos
  useEffect(() => () => current.current.forEach(photo => URL.revokeObjectURL(photo.url)), [])
  function choose(files: File[]) {
    if (locked) return
    if (files.length > 70 || files.some(file => !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 150 * 1024 * 1024) { setError('4~70장, PNG·JPG·WebP, 한 장 20MB·전체 150MB 이하로 선택해 주세요.'); return }
    const next = files.map(file => ({ file, url: URL.createObjectURL(file) }))
    photos.forEach(photo => URL.revokeObjectURL(photo.url)); setPhotos(next); setError(''); onChange(next.length)
  }
  function move(index: number, delta: number) {
    const next = photos.slice(), other = index + delta
    if (locked || other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other], next[index]]
    setPhotos(next); onChange(next.length)
  }
  return <div className="space-y-4">
    <h2 className="font-semibold">1. 누끼 이미지와 회전 순서</h2>
    <p className="text-sm text-muted-foreground">앞 → 오른쪽 → 뒤 → 왼쪽 순서로 4~70장을 넣으세요. 투명 PNG가 좋습니다. 업로드한 각도만 사용하며 AI 요금이 발생하지 않습니다.</p>
    <Input type="file" aria-label="360 누끼 이미지" accept="image/png,image/jpeg,image/webp" multiple disabled={locked} onChange={event => { choose(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{photos.map((photo, index) => <div key={photo.url} className="min-w-0 rounded-lg border border-border p-2"><img src={photo.url} className="aspect-square w-full object-contain" alt={`원본 각도 ${index + 1}`} /><p className="truncate text-xs">{index + 1}. {photo.file.name}</p><div className="mt-1 flex gap-1"><Button size="sm" variant="ghost" aria-label={`${index + 1}번 이미지 앞으로`} disabled={locked || index === 0} onClick={() => move(index, -1)}>←</Button><Button size="sm" variant="ghost" aria-label={`${index + 1}번 이미지 뒤로`} disabled={locked || index === photos.length - 1} onClick={() => move(index, 1)}>→</Button></div></div>)}</div>
    <p className="text-xs text-muted-foreground">4장이면 4개 각도로 전환됩니다. 자연스러운 회전에는 더 많은 실제 각도가 필요합니다. 70장을 넣으면 70개 원본 각도를 그대로 내보냅니다.</p>
    <div className="grid grid-cols-3 gap-2"><label className="space-y-1 text-xs">출력 크기<Select aria-label="사진 출력 크기" value={edge} disabled={locked} onChange={event => onSettings({ edge: Number(event.target.value) })}>{[640,800,960].map(value => <option key={value} value={value}>{value} × {value}</option>)}</Select></label><label className="space-y-1 text-xs">밝기 (%)<Input type="number" aria-label="사진 밝기" min={60} max={140} value={brightness} disabled={locked} onChange={event => onSettings({ brightness: Number(event.target.value) })} /></label><label className="space-y-1 text-xs">대비 (%)<Input type="number" aria-label="사진 대비" min={60} max={140} value={contrast} disabled={locked} onChange={event => onSettings({ contrast: Number(event.target.value) })} /></label></div>
    <Button disabled={locked || photos.length < 4} onClick={() => onGenerate(photos.map(photo => photo.file))}>이미지로 회전 뷰어 생성</Button>
  </div>
}
