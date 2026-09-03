import { Badge } from "@/components/ui/badge";
import {
  isOutboundPartnerIncomplete,
  OUTBOUND_CHANNEL_TYPE_LABEL,
  outboundPartnerDisplayName,
  outboundPartnerUnitLabel,
} from "@/lib/codes/outbound-partner";
import type { CodeUsageTarget } from "@/lib/types";
import { cn } from "@/lib/utils";

export function OutboundPartnerIdentity({
  target,
  className,
  showUnspecified = true,
  showChannel = true,
  variant = "full",
  asCompany = false,
}: {
  target: CodeUsageTarget;
  className?: string;
  showUnspecified?: boolean;
  showChannel?: boolean;
  variant?: "full" | "unit";
  asCompany?: boolean;
}) {
  const incomplete = isOutboundPartnerIncomplete(target);
  const label =
    variant === "unit"
      ? outboundPartnerUnitLabel(target)
      : asCompany
        ? target.groupName || target.name
        : outboundPartnerDisplayName(target);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-1.5",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {showChannel && target.channelType !== "unset" ? (
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          {OUTBOUND_CHANNEL_TYPE_LABEL[target.channelType]}
        </span>
      ) : null}
      {showUnspecified && incomplete ? (
        <Badge variant="warning">정리 필요</Badge>
      ) : null}
    </span>
  );
}
