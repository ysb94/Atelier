import { StylePicker } from '@/components/style-picker'
import { Input } from '@/components/ui/input'
import {
  PRODUCT_NAME_AI_QUICK_SLOT_LIMIT,
  shouldIgnoreProductNameAiQuickKey,
  type ProductNameAiQuickSlot,
} from '@/lib/invoice/product-name-ai-review'
import type { StyleRef } from '@/lib/types'

export function InvoiceProductNameAiQuickSlots({
  brandId,
  rowKey,
  slots,
  disabled,
  onTextChange,
  onPickStyle,
  onClear,
  onRegister,
  onEnter,
  onTab,
}: {
  brandId: string
  rowKey: string
  slots: ProductNameAiQuickSlot[]
  disabled?: boolean
  onTextChange: (slotIndex: number, text: string) => void
  onPickStyle: (slotIndex: number, style: StyleRef) => void
  onClear: (slotIndex: number) => void
  onRegister: (slotIndex: number, el: HTMLInputElement | null) => void
  onEnter: (slotIndex: number) => void
  onTab: (slotIndex: number) => void
}) {
  return (
    <div className="flex min-w-[16rem] flex-col gap-1">
      {slots.slice(0, PRODUCT_NAME_AI_QUICK_SLOT_LIMIT).map((slot, slotIndex) => (
        <div key={`${rowKey}-${slotIndex}`} className="space-y-1">
          <Input
            ref={(el) => onRegister(slotIndex, el)}
            value={slot.text}
            disabled={disabled}
            onChange={(event) => onTextChange(slotIndex, event.target.value)}
            onKeyDown={(event) => {
              if (
                shouldIgnoreProductNameAiQuickKey({
                  isComposing: event.nativeEvent.isComposing,
                  key: event.key,
                })
              ) {
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                onEnter(slotIndex)
                return
              }
              if (event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault()
                onTab(slotIndex)
              }
            }}
            aria-label={slotIndex === 0 ? '본품 이름' : `구성품 ${slotIndex}`}
            placeholder={slotIndex === 0 ? '본품 이름' : '추가 구성품'}
            className={`h-7 text-[11px] ${
              slot.status === 'unmatched'
                ? 'border-danger/50'
                : slot.status === 'ambiguous' || slot.status === 'draft'
                  ? 'border-amber-500/50'
                  : ''
            }`}
          />
          {slot.status === 'matched' && slot.style ? (
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:underline"
              disabled={disabled}
              onClick={() => onClear(slotIndex)}
            >
              칸 비우기
            </button>
          ) : null}
          {slot.status === 'ambiguous' && slot.candidates.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {slot.candidates.map((style) => (
                <button
                  key={style.styleId}
                  type="button"
                  className="truncate text-left text-[10px] text-primary hover:underline"
                  disabled={disabled}
                  onClick={() => onPickStyle(slotIndex, style)}
                >
                  {style.styleNo} · {style.name}
                </button>
              ))}
            </div>
          ) : null}
          {slot.status === 'unmatched' ? (
            <div className="space-y-1">
              {slot.error ? (
                <p className="text-[10px] text-danger">{slot.error}</p>
              ) : null}
              <StylePicker
                brandId={brandId}
                value={null}
                onChange={(next) => {
                  if (next) onPickStyle(slotIndex, next)
                }}
                placeholder="M번호 직접 검색"
                disabled={disabled}
                inputClassName="h-7 text-[11px]"
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
