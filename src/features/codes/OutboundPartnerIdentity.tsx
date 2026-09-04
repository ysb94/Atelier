import { Badge } from "@/components/ui/badge";
import {
  isOutboundPartnerIncomplete,
  outboundPartnerDisplayName,
  outboundPartnerUnitLabel,
} from "@/lib/codes/outbound-partner";
import type { CodeUsageTarget } from "@/lib/types";
import { cn } from "@/lib/utils";

export function OutboundPartnerIdentity({
  target,
  className,
  showUnspecified = true,
  variant = "full",
}: {
  target: CodeUsageTarget;
  className?: string;
  showUnspecified?: boolean;
  variant?: "full" | "unit";
}) {
  const incomplete = isOutboundPartnerIncomplete(target);
  const label =
    variant === "unit"
      ? outboundPartnerUnitLabel(target)
      : outboundPartnerDisplayName(target);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-1.5",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {showUnspecified && incomplete ? (
        <Badge variant="warning">정리 필요</Badge>
      ) : null}
    </span>
  );
}
