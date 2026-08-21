import type { KeyboardEvent } from 'react'
import { StylePicker } from '@/components/style-picker'
import { Input } from '@/components/ui/input'
import {
  ITEM_NAME_AI_QUICK_SLOT_LIMIT,
  type ItemNameAiQuickSlot,
} from '@/lib/invoice/item-name-ai-review'
import type { StyleRef } from '@/lib/types'

function composing(event: KeyboardEvent<HTMLInputElement>) {
  return event.nativeEvent.isComposing || event.key === 'Process'
}

export function InvoiceItemNameAiQuickSlots({
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
  slots: ItemNameAiQuickSlot[]
  disabled?: boolean
  onTextChange: (slotIndex: number, text: string) => void
  onPickStyle: (slotIndex: number, style: StyleRef) => void
  onClear: (slotIndex: number) => void
  onRegister: (slotIndex: number, el: HTMLInputElement | null) => void
  onEnter: (slotIndex: number, allEmpty: boolean) => void
  onTab: (slotIndex: number) => void
}) {
  return (
    <div className="flex min-w-[16rem] flex-col gap-1">
      {slots.slice(0, ITEM_NAME_AI_QUICK_SLOT_LIMIT).map((slot, slotIndex) => (
        <div key={`${rowKey}-${slotIndex}`} className="space-y-1">
          <Input
            ref={(el) => onRegister(slotIndex, el)}
            value={slot.text}
            disabled={disabled}
            onChange={(event) => onTextChange(slotIndex, event.target.value)}
            onKeyDown={(event) => {
              if (composing(event)) return
              if (event.key === 'Enter') {
                event.preventDefault()
                const allEmpty = slots.every((item) => !item.text.trim())
                onEnter(slotIndex, allEmpty)
                return
              }
              if (event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault()
                onTab(slotIndex)
              }
            }}
            aria-label={`구성품 ${slotIndex + 1}`}
            placeholder={slotIndex === 0 ? '구성품 이름' : '추가 구성품'}
            className={`h-7 text-[11px] ${
              slot.status === 'unmatched'
                ? 'border-danger/50'
                : slot.status === 'ambiguous'
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
