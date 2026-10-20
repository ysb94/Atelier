import {
  formatUsageValue,
  type UsageCodeColumn,
  type UsagePrivateValue,
} from './usage-code-columns'
import {
  CODE_USAGE_STATUS_LABEL,
  type ProductCode,
  type CodeUsageStatus,
} from '@/lib/types'

export function usageColumnText(
  column: UsageCodeColumn,
  code: ProductCode | undefined,
  status: CodeUsageStatus,
  styleNames: ReadonlyMap<string, string>,
  values: Record<string, UsagePrivateValue> = {},
) {
  if (column.kind === 'private') return formatUsageValue(values[column.id])
  if (column.kind === 'legacy') return '연결 확인 필요'
  if (column.sourceKey === 'status') return CODE_USAGE_STATUS_LABEL[status]
  if (!code) return '원본 연결 없음'
  if (column.sourceKey === 'code') return code.code || '원본 값 미등록'
  if (column.sourceKey === 'name') return code.name || '원본 값 미등록'
  if (!code.components.length) return '원본 연결 없음'
  return code.components
    .map((component) => {
      const value =
        column.sourceKey === 'styleNo'
          ? component.styleNo
          : styleNames.get(component.styleId)?.trim()
      return `${value || '원본 값 미등록'}${component.qty > 1 ? ` ×${component.qty}` : ''}`
    })
    .join('\n')
}
