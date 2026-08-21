import { Plus, Trash2 } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  InvoiceItemNameRuleComponent,
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  StyleRef,
} from '@/lib/types'

export type OptionExtraDraft = {
  key: string
  style: StyleRef | null
  role: 'included' | 'required' | 'paid_add'
  quantity: number
}

export function extrasFromRuleComponents(
  components: InvoiceItemNameRuleComponent[],
): OptionExtraDraft[] {
  return components.map((item, index) => ({
    key: item.id || `extra-${index}`,
    style: item.style,
    role: item.role,
    quantity: item.quantity,
  }))
}

export function extrasFromOptionMap(
  map: InvoiceOptionMap | null | undefined,
): OptionExtraDraft[] {
  if (!map) return []
  return map.components
    .filter(
      (
        item,
      ): item is InvoiceOptionMapComponent & { role: OptionExtraDraft['role'] } =>
        item.role !== 'main',
    )
    .map((item, index) => ({
      key: item.id || `extra-${index}`,
      style: item.style,
      role: item.role,
      quantity: item.quantity,
    }))
}

export function newOptionExtraDraft(): OptionExtraDraft {
  return {
    key: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    style: null,
    role: 'included',
    quantity: 1,
  }
}

export function expandOptionExtrasToUnits(
  extras: OptionExtraDraft[],
): OptionExtraDraft[] {
  return extras.flatMap((extra, index) => {
    const count = extra.style ? Math.max(1, Math.floor(extra.quantity || 1)) : 1
    return Array.from({ length: count }, (_, unit) => ({
      ...extra,
      key: `${extra.key || extra.style?.styleId || 'extra'}-${index}-${unit}`,
      quantity: 1,
    }))
  })
}

export function completedOptionExtras(extras: OptionExtraDraft[]) {
  return extras.filter(
    (item): item is OptionExtraDraft & { style: StyleRef } => Boolean(item.style),
  )
}

export function InvoiceOptionExtrasEditor({
  brandId,
  extras,
  onChange,
  compact = false,
  unitMode = false,
}: {
  brandId: string
  extras: OptionExtraDraft[]
  onChange: (next: OptionExtraDraft[]) => void
  compact?: boolean
  unitMode?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">구성품</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...extras, newOptionExtraDraft()])}
        >
          <Plus className="size-3.5" />
          구성 추가
        </Button>
      </div>
      {extras.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {unitMode
            ? '같이 나가는 상품을 1개씩 넣습니다. 같은 M번호도 행을 나눠 추가합니다.'
            : compact
              ? '같이 나가는 상품을 넣습니다. 본품만 나가면 비워 두세요.'
              : '본품만 나가면 비워 두세요. 같이 나가는 상품과 수량을 아래에 넣습니다.'}
        </p>
      ) : (
        extras.map((extra) => (
          <div
            key={extra.key}
            className={
              compact
                ? 'space-y-2 rounded-lg border border-border p-2'
                : 'grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(14rem,1fr)_6.5rem_auto]'
            }
          >
            <StylePicker
              brandId={brandId}
              value={extra.style}
              onChange={(next) =>
                onChange(
                  extras.map((item) =>
                    item.key === extra.key
                      ? {
                          ...item,
                          style: next,
                          quantity: unitMode ? 1 : item.quantity,
                        }
                      : item,
                  ),
                )
              }
              placeholder="구성 M번호 검색"
            />
            <div
              className={
                compact
                  ? 'flex items-center gap-2'
                  : 'contents'
              }
            >
            {unitMode ? null : (
              <>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  aria-label="나가는 수량"
                  title="주문 1행당 나가는 수량"
                  className={compact ? 'w-20' : undefined}
                  value={extra.quantity}
                  onChange={(event) =>
                    onChange(
                      extras.map((item) =>
                        item.key === extra.key
                          ? {
                              ...item,
                              quantity: Math.max(
                                1,
                                Math.floor(Number(event.target.value) || 1),
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                />
                <span
                  className={
                    compact
                      ? 'shrink-0 text-xs text-muted-foreground'
                      : 'hidden'
                  }
                >
                  개
                </span>
              </>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={compact ? 'ml-auto' : undefined}
              onClick={() =>
                onChange(extras.filter((item) => item.key !== extra.key))
              }
              aria-label="구성 삭제"
            >
              <Trash2 className="size-3.5" />
            </Button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
