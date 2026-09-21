/**
 * 개별 박스 종료 규칙 검증.
 * 실행: npx tsx src/lib/warehouse/warehouse-box-lifecycle.verify.ts
 */
import {
  canCompleteWarehouseBoxOutbound,
  isActiveWarehouseBox,
  shouldCompleteWarehouseBoxAsDepleted,
  warehouseBoxClosedKind,
  warehouseBoxClosedKindLabel,
  warehouseBoxOutboundBlockedReason,
  warehouseBoxQtyAdjustBlockedReason,
  type WarehouseBoxLifecycleView,
} from './warehouse-box-lifecycle'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const sealedPicking: WarehouseBoxLifecycleView = {
  status: 'sealed',
  zone: 'picking',
  initialQty: 20,
  currentQty: 20,
  archivedAt: null,
  completedAt: null,
  completionKind: null,
}

const sealedBoxStorage: WarehouseBoxLifecycleView = {
  ...sealedPicking,
  zone: 'box_storage',
}

const openedPicking: WarehouseBoxLifecycleView = {
  status: 'opened',
  zone: 'picking',
  initialQty: 20,
  currentQty: 7,
  archivedAt: null,
  completedAt: null,
  completionKind: null,
}

const depleted: WarehouseBoxLifecycleView = {
  status: 'depleted',
  zone: 'picking',
  initialQty: 20,
  currentQty: 0,
  archivedAt: null,
  completedAt: '2026-09-21T00:00:00.000Z',
  completionKind: 'depleted',
}

const boxOutbound: WarehouseBoxLifecycleView = {
  status: 'depleted',
  zone: 'box_storage',
  initialQty: 20,
  currentQty: 0,
  archivedAt: null,
  completedAt: '2026-09-21T00:00:00.000Z',
  completionKind: 'box_outbound',
}

const legacyArchive: WarehouseBoxLifecycleView = {
  status: 'opened',
  zone: 'picking',
  initialQty: 20,
  currentQty: 16,
  archivedAt: '2026-09-18T00:00:00.000Z',
  completedAt: null,
  completionKind: null,
}

assert(
  canCompleteWarehouseBoxOutbound(sealedPicking),
  '출고창고 밀봉 박스는 박스 출고 가능',
)
assert(
  canCompleteWarehouseBoxOutbound(sealedBoxStorage),
  '박스창고 밀봉 박스는 박스 출고 가능',
)
assert(
  !canCompleteWarehouseBoxOutbound(openedPicking),
  '개봉 박스는 박스 단위 출고 거부',
)
assert(
  warehouseBoxOutboundBlockedReason(openedPicking)?.includes('개봉된 박스'),
  '개봉 박스 출고 거부 사유',
)
assert(
  shouldCompleteWarehouseBoxAsDepleted(openedPicking, 0),
  '출고창고 수량 0은 소진 종료',
)
assert(
  shouldCompleteWarehouseBoxAsDepleted(sealedPicking, 0),
  '출고창고 밀봉 수량 0도 소진 종료',
)
assert(
  !shouldCompleteWarehouseBoxAsDepleted(sealedBoxStorage, 0),
  '박스창고 수량 차감은 소진으로 처리하지 않음',
)
assert(
  warehouseBoxQtyAdjustBlockedReason(sealedBoxStorage, 19)?.includes(
    '박스창고에서는',
  ),
  '박스창고 수량 차감 거부',
)
assert(
  warehouseBoxQtyAdjustBlockedReason(openedPicking, 7) == null,
  '출고창고 개봉 박스 수량 유지는 허용',
)
assert(
  warehouseBoxQtyAdjustBlockedReason(depleted, 0)?.includes('종료된 박스'),
  '종료 박스는 수정 불가',
)
assert(
  warehouseBoxClosedKind(legacyArchive) === 'legacy_archive',
  '과거 archive는 확인 필요',
)
assert(
  warehouseBoxClosedKindLabel(warehouseBoxClosedKind(legacyArchive)) ===
    '기존 보관·확인 필요',
  '과거 archive 라벨',
)
assert(
  warehouseBoxClosedKind(depleted) === 'depleted' &&
    warehouseBoxClosedKindLabel('depleted') === '낱개 소진',
  '소진 종료 라벨',
)
assert(
  warehouseBoxClosedKind(boxOutbound) === 'box_outbound' &&
    warehouseBoxClosedKindLabel('box_outbound') === '박스 단위 출고',
  '박스 출고 종료 라벨',
)
assert(!isActiveWarehouseBox(legacyArchive), '기존 보관은 활성 목록에서 제외')
assert(!isActiveWarehouseBox(depleted), '소진 박스는 활성 목록에서 제외')
assert(isActiveWarehouseBox(sealedPicking), '미종료 밀봉 박스는 활성')

console.log('warehouse-box-lifecycle.verify ok')
