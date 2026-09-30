import type {
  CodeUsageAssignment,
  CodeUsageAssignmentChange,
  CodeUsageStatus,
  ProductCode,
} from '@/lib/types'

export const CODE_FINDER_PAGE_SIZE = 100

export const EMPTY_ASSIGNMENT_COUNTS: AssignmentCounts = {
  total: 0,
  active: 0,
  paused: 0,
}

export type AssignmentCounts = {
  total: number
  active: number
  paused: number
}

export type CodeUsageChangePlan = {
  changes: CodeUsageAssignmentChange[]
  created: number
  updated: number
  skipped: number
}

function assignmentKey(productCodeId: string, usageTargetId: string) {
  return `${productCodeId}\0${usageTargetId}`
}

function normalizeStatus(status: CodeUsageStatus): CodeUsageStatus {
  return status === 'paused' ? 'paused' : 'active'
}

/** 빈 키는 버리고, 같은 코드·업체는 마지막 상태만 남긴다. */
export function compactCodeUsageChanges(
  changes: readonly CodeUsageAssignmentChange[],
): CodeUsageAssignmentChange[] {
  const wanted = new Map<string, CodeUsageAssignmentChange>()
  for (const change of changes) {
    const productCodeId = change.productCodeId.trim()
    const usageTargetId = change.usageTargetId.trim()
    if (!productCodeId || !usageTargetId) continue
    wanted.set(assignmentKey(productCodeId, usageTargetId), {
      productCodeId,
      usageTargetId,
      status: normalizeStatus(change.status),
    })
  }
  return [...wanted.values()]
}

/**
 * 이미 같은 상태인 연결은 건너뛴다.
 * 없으면 만들고, 상태가 다르면 바꾼다.
 */
export function planCodeUsageChanges(
  existing: readonly Pick<
    CodeUsageAssignment,
    'productCodeId' | 'usageTargetId' | 'status'
  >[],
  desired: readonly CodeUsageAssignmentChange[],
): CodeUsageChangePlan {
  const current = new Map<string, CodeUsageStatus>()
  for (const row of existing) {
    current.set(assignmentKey(row.productCodeId, row.usageTargetId), row.status)
  }

  const changes: CodeUsageAssignmentChange[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  for (const change of compactCodeUsageChanges(desired)) {
    const previous = current.get(
      assignmentKey(change.productCodeId, change.usageTargetId),
    )
    if (previous === undefined) {
      created += 1
      changes.push(change)
      continue
    }
    if (previous === change.status) {
      skipped += 1
      continue
    }
    updated += 1
    changes.push(change)
  }
  return { changes, created, updated, skipped }
}

/** 업체별 등록·사용중·일시중지 건수. 연결 목록을 한 번만 훑는다. */
export function countAssignmentsByTarget(
  assignments: readonly Pick<CodeUsageAssignment, 'usageTargetId' | 'status'>[],
): Map<string, AssignmentCounts> {
  const counts = new Map<string, AssignmentCounts>()
  for (const row of assignments) {
    const current = counts.get(row.usageTargetId) ?? {
      total: 0,
      active: 0,
      paused: 0,
    }
    current.total += 1
    if (row.status === 'paused') current.paused += 1
    else current.active += 1
    counts.set(row.usageTargetId, current)
  }
  return counts
}

/** 바코드·코드명·M번호·상품명을 소문자 한 줄로 붙인다. */
export function codeSearchText(
  code: Pick<ProductCode, 'code' | 'name' | 'components'>,
  styleNames: ReadonlyMap<string, string>,
): string {
  const parts = [code.code, code.name]
  for (const component of code.components) {
    parts.push(component.styleNo)
    const name = styleNames.get(component.styleId)
    if (name) parts.push(name)
  }
  return parts.join('\n').toLowerCase()
}

/** 목록 둘째 줄. 한글 상품명과 M번호, 수량이 2개 이상이면 ×수량을 붙인다. */
export function codeComponentSummary(
  code: Pick<ProductCode, 'components'>,
  styleNames: ReadonlyMap<string, string>,
): string {
  if (code.components.length === 0) return 'M번호 없음'
  return code.components
    .map((component) => {
      const name = styleNames.get(component.styleId)?.trim()
      const qty = component.qty > 1 ? `×${component.qty}` : ''
      const stylePart = `${component.styleNo}${qty}`
      return name ? `${name} · ${stylePart}` : stylePart
    })
    .join(', ')
}

/** 저장 결과를 기존 목록에 반영한다. 같은 코드·업체는 저장된 행으로 바꾼다. */
export function mergeCodeUsageAssignments(
  current: readonly CodeUsageAssignment[],
  saved: readonly CodeUsageAssignment[],
): CodeUsageAssignment[] {
  if (saved.length === 0) return [...current]
  const byKey = new Map(
    current.map((row) => [
      assignmentKey(row.productCodeId, row.usageTargetId),
      row,
    ]),
  )
  for (const row of saved) {
    byKey.set(assignmentKey(row.productCodeId, row.usageTargetId), row)
  }
  return [...byKey.values()].sort((left, right) => {
    const byUpdated = right.updatedAt.localeCompare(left.updatedAt)
    if (byUpdated !== 0) return byUpdated
    return right.id.localeCompare(left.id)
  })
}
