import { Plus, Trash2 } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  INVOICE_OPTION_COMPONENT_ROLE_LABEL,
  type InvoiceItemNameRuleComponent,
  type InvoiceOptionMap,
  type InvoiceOptionMapComponent,
  type StyleRef,
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
}: {
  brandId: string
  extras: OptionExtraDraft[]
  onChange: (next: OptionExtraDraft[]) => void
  compact?: boolean
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
          {compact
            ? '세트면 포함 상품을 넣습니다. 본품만 나가면 비워 두세요.'
            : '본품만 나가면 비워 두세요. 포함 스트랩·필수 태슬·유료추가는 아래에 넣습니다.'}
        </p>
      ) : (
        extras.map((extra) => (
          <div
            key={extra.key}
            className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1.6fr)_7.5rem_4.5rem_auto]"
          >
            <StylePicker
              brandId={brandId}
              value={extra.style}
              onChange={(next) =>
                onChange(
                  extras.map((item) =>
                    item.key === extra.key ? { ...item, style: next } : item,
                  ),
                )
              }
              placeholder="구성 M번호 검색"
            />
            <Select
              value={extra.role}
              onChange={(event) =>
                onChange(
                  extras.map((item) =>
                    item.key === extra.key
                      ? {
                          ...item,
                          role: event.target.value as OptionExtraDraft['role'],
                        }
                      : item,
                  ),
                )
              }
            >
              <option value="included">
                {INVOICE_OPTION_COMPONENT_ROLE_LABEL.included}
              </option>
              <option value="required">
                {INVOICE_OPTION_COMPONENT_ROLE_LABEL.required}
              </option>
              <option value="paid_add">
                {INVOICE_OPTION_COMPONENT_ROLE_LABEL.paid_add}
              </option>
            </Select>
            <Input
              type="number"
              min={1}
              step={1}
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
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() =>
                onChange(extras.filter((item) => item.key !== extra.key))
              }
              aria-label="구성 삭제"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))
      )}
    </div>
  )
}
