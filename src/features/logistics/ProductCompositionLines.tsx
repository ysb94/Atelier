import {
  formatProductCompositionLines,
  type ProductCompositionItem,
} from '@/lib/invoice/product-composition'

export function ProductCompositionLines({
  items,
  emptyLabel = '본품 미확정',
  className,
}: {
  items: ProductCompositionItem[]
  emptyLabel?: string
  className?: string
}) {
  const lines = formatProductCompositionLines(items)
  if (lines.length === 0) {
    return <p className={className}>{emptyLabel}</p>
  }
  return (
    <div className={className ?? 'space-y-0.5'}>
      {lines.map((line) => (
        <p key={line} className="break-words">
          {line}
        </p>
      ))}
    </div>
  )
}
