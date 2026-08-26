import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  PRODUCT_NAME_AI_QUICK_SLOT_LIMIT,
  shouldIgnoreProductNameAiQuickKey,
  type ProductNameAiQuickSlot,
} from '@/lib/invoice/product-name-ai-review'
import type { StyleRef } from '@/lib/types'

export function InvoiceProductNameAiQuickSlots({
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
          <div className="flex min-w-0 items-stretch">
            {slot.style?.styleNo ? (
              <span className="inline-flex shrink-0 items-center rounded-l-md border border-r-0 border-border bg-muted px-1.5 text-[11px] font-medium text-foreground">
                {slot.style.styleNo}
              </span>
            ) : null}
            <div className="relative min-w-0 flex-1">
              <Input
                ref={(el) => onRegister(slotIndex, el)}
                value={slot.style ? slot.style.name : slot.text}
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
                aria-label={
                  slot.style
                    ? `${slot.style.styleNo} ${slotIndex === 0 ? '본품 이름' : `구성품 ${slotIndex}`}`
                    : slotIndex === 0
                      ? '본품 이름'
                      : `구성품 ${slotIndex}`
                }
                placeholder={slotIndex === 0 ? '본품 이름' : '추가 구성품'}
                className={`h-7 text-[11px] ${
                  slot.style ? 'rounded-l-none' : ''
                } ${
                  slot.text.trim() ? 'pr-7' : ''
                } ${
                  slot.status === 'unmatched'
                    ? 'border-danger/50'
                    : slot.status === 'ambiguous' || slot.status === 'draft'
                      ? 'border-amber-500/50'
                      : ''
                }`}
              />
              {slot.text.trim() ? (
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  disabled={disabled}
                  aria-label="칸 비우기"
                  onClick={() => onClear(slotIndex)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
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
          {slot.status === 'unmatched' && slot.error ? (
            <p className="text-[10px] text-danger">{slot.error}</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}
