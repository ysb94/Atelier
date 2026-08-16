import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 대표 이미지 칸.
 * 규칙으로 만든 주소는 확장자가 다를 수 있어서 후보를 순서대로 시도하고,
 * 전부 실패하면 대체 표시로 넘어간다.
 */
export function ProductThumb({
  sources,
  alt,
  size = 24,
  className,
  onCurrentSourceChange,
}: {
  sources: string[]
  alt: string
  size?: number
  className?: string
  onCurrentSourceChange?: (url: string | null) => void
}) {
  const key = sources.join('|')
  const [index, setIndex] = useState(0)
  const current = sources[index] ?? null

  useEffect(() => {
    setIndex(0)
  }, [key])

  useEffect(() => {
    onCurrentSourceChange?.(current)
  }, [current, onCurrentSourceChange])

  const shell = cn(
    'shrink-0 overflow-hidden rounded border border-border bg-muted object-cover',
    className,
  )
  const box = { width: size, height: size }

  if (!current) {
    return (
      <div
        className={cn(shell, 'flex items-center justify-center')}
        style={box}
        title={
          sources.length === 0
            ? '대표 이미지가 없습니다.'
            : '이미지를 찾을 수 없습니다.'
        }
      >
        <ImageOff
          className={cn(
            'text-muted-foreground/60',
            size >= 80 ? 'size-8' : 'size-3',
          )}
        />
      </div>
    )
  }

  return (
    <img
      key={current}
      src={current}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={shell}
      style={box}
      onError={() => setIndex((prev) => prev + 1)}
    />
  )
}
