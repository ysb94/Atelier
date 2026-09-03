import { Badge } from '@/components/ui/badge'
import {
  OUTBOUND_PARTNER_STATUS_LABEL,
  outboundPartnerStatus,
} from '@/lib/codes/outbound-partner'
import type { CodeUsageTarget } from '@/lib/types'
import { cn } from '@/lib/utils'
import { OutboundPartnerIdentity } from '@/features/codes/OutboundPartnerIdentity'

export function OutboundPartnerUnitItem({
  target,
  selected,
  identityVariant = 'full',
  asCompany = false,
  layout = 'block',
  onSelect,
}: {
  target: CodeUsageTarget
  selected: boolean
  identityVariant?: 'full' | 'unit'
  asCompany?: boolean
  layout?: 'block' | 'chip'
  onSelect: () => void
}) {
  const status = outboundPartnerStatus(target)

  return (
    <button
      type="button"
      aria-selected={selected}
      className={cn(
        'rounded-md text-left',
        layout === 'chip'
          ? 'h-7 shrink-0 px-2'
          : 'h-8 w-full px-1.5',
        selected ? 'bg-muted' : 'hover:bg-muted/60',
      )}
      onClick={onSelect}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-medium">
        <OutboundPartnerIdentity
          target={target}
          variant={identityVariant}
          asCompany={asCompany}
          showChannel={false}
        />
        {status !== 'ongoing' ? (
          <Badge variant={status === 'archived' ? 'muted' : 'warning'}>
            {OUTBOUND_PARTNER_STATUS_LABEL[status]}
          </Badge>
        ) : null}
      </span>
    </button>
  )
}
