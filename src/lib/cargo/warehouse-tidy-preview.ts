import type { WarehouseStockPosition } from '../types'
import { normalizeStyleNo } from '../import/transform'
import { cargoLineHasContent, formatCargoWarehouseNote, UNLOAD_STACK_BOX_LIMIT, type CargoInboundLineDraft } from './inbound'
import { parseCargoLineListInteger, type CargoLineListValues } from './line-list'
import { assignUnloadStowLabels, compareUnloadStyleNo } from './unload-stow'
import { shiftShippedOnStamp } from './warehouse-tidy'

type StockPosition = Pick<WarehouseStockPosition, 'styleNo' | 'remainingBoxes' | 'openedUnits' | 'quantityStatus'>
type EntryKind = 'NEW' | '기존' | '확인 필요'

/** 모든 자리의 같은 SKU를 확인한다. 입고일·최신자리·재고 박스 수는 분할에 사용하지 않는다. */
function stockEntryKinds(positions: readonly StockPosition[]) {
  const result = new Map<string, EntryKind>()
  for (const position of positions) {
    const key = normalizeStyleNo(position.styleNo)
    if (!key) continue
    const kind: EntryKind = (position.remainingBoxes ?? 0) > 0 || position.openedUnits > 0
      ? '기존'
      : position.quantityStatus === 'unknown' || position.remainingBoxes === null
        ? '확인 필요'
        : 'NEW'
    const current = result.get(key)
    if (current === '기존' || (current === '확인 필요' && kind === 'NEW')) continue
    result.set(key, kind)
  }
  return result
}

/** 화면·인쇄 미리보기용 값이다. 기존 창고정리용 저장 행을 교체하지 않는다. */
export function buildWarehouseTidyPreviewRows(
  lines: readonly CargoInboundLineDraft[],
  positions: readonly StockPosition[],
  shippedAt: string,
  stockAvailable: boolean,
): Array<{ key: string; values: CargoLineListValues }> {
  const entryKinds = stockEntryKinds(positions)
  const rows = lines.filter(cargoLineHasContent).flatMap((line, index) => {
    const styleNo = line.styleNo.trim()
    const key = normalizeStyleNo(styleNo)
    const entryKind = stockAvailable && key ? entryKinds.get(key) ?? 'NEW' : '확인 필요'
    const incomingBoxes = parseCargoLineListInteger(line.boxes)
    const partCount = Math.max(1, Math.ceil((incomingBoxes ?? 0) / UNLOAD_STACK_BOX_LIMIT))
    return Array.from({ length: partCount }, (_, partIndex) => ({
      key: `warehouse-preview-${line.id || index}-${partIndex}`,
      values: {
        lineId: line.id,
        partIndex,
        no: line.no.trim() || String(index + 1),
        name: line.name.trim(),
        styleNo,
        quantity: parseCargoLineListInteger(line.qty),
        unitsPerBox: parseCargoLineListInteger(line.perBox),
        boxCount: incomingBoxes === null ? null : Math.min(UNLOAD_STACK_BOX_LIMIT, incomingBoxes - partIndex * UNLOAD_STACK_BOX_LIMIT),
        stow: '',
        note: formatCargoWarehouseNote(line.note, line.requestNote),
        shippedAt: shiftShippedOnStamp(shippedAt, 0),
        latestSlot: entryKind,
        latestBoxCount: null,
        warehouseSlot: '',
      },
    }))
  }).sort((left, right) => compareUnloadStyleNo(left.values.styleNo, right.values.styleNo))
  const stowByKey = assignUnloadStowLabels(rows.map(row => ({
    key: row.key,
    styleNo: row.values.styleNo,
    boxSum: row.values.boxCount ?? 0,
    incomingBoxes: row.values.boxCount ?? 0,
  })))
  return rows.map(row => ({
    ...row,
    values: { ...row.values, stow: stowByKey.get(row.key) ?? '' },
  }))
}
