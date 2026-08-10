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
}: {
  sources: string[]
  alt: string
  size?: number
  className?: string
}) {
  const key = sources.join('|')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [key])

  const shell = cn(
    'shrink-0 overflow-hidden rounded border border-border bg-muted',
    className,
  )
  const box = { width: size, height: size }
  const current = sources[index]

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
        <ImageOff className="size-3 text-muted-foreground/60" />
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
      className={cn(shell, 'object-cover')}
      style={box}
      onError={() => setIndex((prev) => prev + 1)}
    />
  )
}
