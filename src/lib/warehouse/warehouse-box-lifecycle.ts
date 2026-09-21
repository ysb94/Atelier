import type {
  WarehouseBox,
  WarehouseBoxCompletionKind,
  WarehouseBoxStatus,
  WarehouseZone,
} from '@/lib/types'

export type WarehouseBoxClosedKind =
  | WarehouseBoxCompletionKind
  | 'legacy_archive'

export type WarehouseBoxLifecycleView = {
  status: WarehouseBoxStatus
  zone: WarehouseZone
  initialQty: number
  currentQty: number
  archivedAt: string | null
  completedAt: string | null
  completionKind: WarehouseBoxCompletionKind | null
}

export function isActiveWarehouseBox(
  box: Pick<WarehouseBoxLifecycleView, 'archivedAt' | 'completedAt'>,
): boolean {
  return !box.archivedAt && !box.completedAt
}

export function isClosedWarehouseBox(
  box: Pick<WarehouseBoxLifecycleView, 'archivedAt' | 'completedAt'>,
): boolean {
  return !isActiveWarehouseBox(box)
}

export function warehouseBoxClosedKind(
  box: Pick<
    WarehouseBoxLifecycleView,
    'archivedAt' | 'completedAt' | 'completionKind'
  >,
): WarehouseBoxClosedKind | null {
  if (box.completionKind) return box.completionKind
  if (box.archivedAt) return 'legacy_archive'
  if (box.completedAt) return 'depleted'
  return null
}

export function warehouseBoxClosedAt(
  box: Pick<WarehouseBoxLifecycleView, 'archivedAt' | 'completedAt'>,
): string | null {
  return box.completedAt ?? box.archivedAt
}

export function warehouseBoxClosedKindLabel(
  kind: WarehouseBoxClosedKind | null,
): string {
  if (kind === 'depleted') return '낱개 소진'
  if (kind === 'box_outbound') return '박스 단위 출고'
  if (kind === 'legacy_archive') return '기존 보관·확인 필요'
  return '—'
}

export function canCompleteWarehouseBoxOutbound(
  box: WarehouseBoxLifecycleView,
): boolean {
  return (
    isActiveWarehouseBox(box) &&
    box.status === 'sealed' &&
    box.currentQty === box.initialQty &&
    box.currentQty > 0
  )
}

export function warehouseBoxOutboundBlockedReason(
  box: WarehouseBoxLifecycleView,
): string | null {
  if (!isActiveWarehouseBox(box)) {
    return box.archivedAt
      ? '보관된 박스는 수정할 수 없습니다.'
      : '종료된 박스는 수정할 수 없습니다.'
  }
  if (box.currentQty <= 0) return '출고할 수량이 없습니다.'
  if (box.status !== 'sealed' || box.currentQty !== box.initialQty) {
    return '개봉된 박스는 박스 단위로 출고할 수 없습니다. 남은 수량을 0으로 소진하세요.'
  }
  return null
}

export function canAdjustWarehouseBoxQty(
  box: WarehouseBoxLifecycleView,
  nextQty: number,
): boolean {
  return warehouseBoxQtyAdjustBlockedReason(box, nextQty) == null
}

export function warehouseBoxQtyAdjustBlockedReason(
  box: WarehouseBoxLifecycleView,
  nextQty: number,
): string | null {
  if (!isActiveWarehouseBox(box)) {
    return box.archivedAt
      ? '보관된 박스는 수정할 수 없습니다.'
      : '종료된 박스는 수정할 수 없습니다.'
  }
  if (!Number.isInteger(nextQty) || nextQty < 0) {
    return '현재 수량은 0 이상의 정수로 입력하세요.'
  }
  if (nextQty > box.initialQty) {
    return '현재 수량은 최초 입수보다 많을 수 없습니다.'
  }
  if (box.zone !== 'picking' && nextQty !== box.initialQty) {
    return '박스창고에서는 개봉하거나 수량을 차감할 수 없습니다. 택배 포장 또는 대량 출고 자리로 먼저 이동하세요.'
  }
  return null
}

export function shouldCompleteWarehouseBoxAsDepleted(
  box: WarehouseBoxLifecycleView,
  nextQty: number,
): boolean {
  return canAdjustWarehouseBoxQty(box, nextQty) && nextQty === 0
}

export function warehouseBoxOutboundConfirmText(box: WarehouseBox): string {
  return [
    `박스 ${box.displayCode}`,
    `M번호 ${box.styleNo || '—'}`,
    `전체 ${box.currentQty}개`,
    '를 박스 단위로 출고할까요?',
    '수량이 0이 되고 등록 목록에서 빠집니다.',
  ].join(' ')
}
