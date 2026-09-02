import { useState } from 'react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { Button } from '@/components/ui/button'
import type {
  GiftSourceGroup,
  GiftSourceSessionRule,
} from '@/lib/invoice/gift-source-transform'
import type { InvoiceGiftRequest } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { InvoiceGiftSourceQuickSetup } from './InvoiceGiftSourceQuickSetup'
import { InvoicePrefixRequestForm } from './InvoicePrefixRequestForm'

export type InvoiceGiftSetupMode = 'replace' | 'add'

export function InvoiceGiftSetupDialog({
  brandId,
  group,
  applying,
  error,
  existingRequests = [],
  onClose,
  onApplySession,
  onApplyPersist,
}: {
  brandId: string
  group: GiftSourceGroup
  applying: boolean
  error: string | null
  existingRequests?: InvoiceGiftRequest[]
  onClose: () => void
  onApplySession: (rule: GiftSourceSessionRule) => void
  onApplyPersist: (rule: GiftSourceSessionRule) => void
}) {
  const workspaceActive = useWorkspaceTabActivity()
  const [mode, setMode] = useState<InvoiceGiftSetupMode>('replace')

  if (!workspaceActive) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={applying}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-gift-setup-title"
        className="relative z-10 max-h-[min(90vh,800px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="invoice-gift-setup-title"
                className="text-base font-semibold tracking-tight"
              >
                사은품 처리
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {group.mallName || '쇼핑몰 없음'} · {group.productName}
                {group.rowCount > 0
                  ? ` · 대상 ${formatNumber(group.rowCount)}행`
                  : ''}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={applying}
              onClick={onClose}
            >
              닫기
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                mode === 'replace'
                  ? 'border-foreground text-foreground'
                  : 'border-border text-muted-foreground'
              }`}
              onClick={() => setMode('replace')}
            >
              품목명 대체
            </button>
            <button
              type="button"
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                mode === 'add'
                  ? 'border-foreground text-foreground'
                  : 'border-border text-muted-foreground'
              }`}
              onClick={() => setMode('add')}
            >
              사은품 행 추가
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {mode === 'replace' ? (
            <InvoiceGiftSourceQuickSetup
              brandId={brandId}
              group={group}
              applying={applying}
              error={error}
              onApplySession={onApplySession}
              onApplyPersist={onApplyPersist}
            />
          ) : (
            <InvoicePrefixRequestForm
              key={`${group.key}-add`}
              brandId={brandId}
              existingRequests={existingRequests}
              initialMallName={group.mallName}
              initialProductName={group.productName}
              onDone={onClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}
