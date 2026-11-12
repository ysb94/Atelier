import { useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, LoaderCircle, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { getStyleByStyleNo } from '@/lib/api'
import { useRenderWatch } from '@/lib/diagnostics'
import { resolveProductImageSources } from '@/lib/products/product-image'
import { useAuth } from '@/lib/supabase/auth'
import type { Style } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { outboundRackLabelPages } from '@/lib/warehouse/outbound-qr'
import { WarehouseFourSlotPrintPreview } from './WarehouseFourSlotPrintPreview'
import './carton-label-print.css'

type LabelInputs = {
  cartonNo: string
  shippedOn: string
  shipmentQuantity: string
  unitsPerBox: string
  origin: string
}

type LabelRow = LabelInputs & {
  id: number
  brandId: string
  styleNo: string
  requestedStyleNo: string
}

const LABEL_FIELDS: readonly {
  key: keyof LabelInputs
  label: string
  width: string
  placeholder?: string
  type?: 'date'
  inputMode?: 'numeric'
}[] = [
  { key: 'cartonNo', label: 'C/T NO', width: 'w-[10%]', placeholder: '선택 입력' },
  { key: 'shippedOn', label: '선적일', width: 'w-[8.5rem]', type: 'date' },
  { key: 'shipmentQuantity', label: '선적 총수량', width: 'w-[5.75rem]', placeholder: 'EA', inputMode: 'numeric' },
  { key: 'unitsPerBox', label: '박스당 수량', width: 'w-[5.75rem]', placeholder: '/ box', inputMode: 'numeric' },
  { key: 'origin', label: '원산지', width: 'w-[6.5rem]', placeholder: 'CHINA' },
]

function newLabelRow(id: number): LabelRow {
  return { id, brandId: '', styleNo: '', requestedStyleNo: '', cartonNo: '', shippedOn: '', shipmentQuantity: '', unitsPerBox: '', origin: '' }
}

type CartonLabel = {
  cartonNo: string
  styleNo: string
  item: string
  photo: string | null
  shipmentQuantity: string
  unitsPerBox: string
  shippedOn: string
  origin: string
}

function wholeQuantity(value: string) {
  const trimmed = value.trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(trimmed)) return null
  const quantity = Number(trimmed.replaceAll(',', ''))
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null
}

async function lookupLabelProduct(brandIds: string[], styleNo: string) {
  const pattern = styleNo.replace(/[\\%_*]/g, '\\$&')
  const candidates = await Promise.all(brandIds.map(brandId => getStyleByStyleNo(brandId, pattern)))
  const matches = candidates.filter((style): style is Style =>
    style !== undefined && style.styleNo.trim().toUpperCase() === styleNo.toUpperCase(),
  )
  const style = matches.length === 1 ? matches[0] : null
  if (style) {
    for (const source of resolveProductImageSources(style)) {
      const image = new Image()
      image.src = source
      try {
        await image.decode()
        return { style, photo: source, ambiguous: false }
      } catch {
        // Try the next catalog image format before showing an empty photo cell.
      }
    }
  }
  return { style, photo: null, ambiguous: matches.length > 1 }
}

function getLabelRowState(row: LabelRow, product?: Awaited<ReturnType<typeof lookupLabelProduct>>) {
  const shipmentQuantity = wholeQuantity(row.shipmentQuantity)
  const unitsPerBox = wholeQuantity(row.unitsPerBox)
  const exceedsShipment = shipmentQuantity !== null && unitsPerBox !== null && unitsPerBox > shipmentQuantity
  const boxCount = shipmentQuantity !== null && unitsPerBox !== null && !exceedsShipment
    ? Math.ceil(shipmentQuantity / unitsPerBox)
    : null
  const origin = row.origin.trim().replace(/^made in(?:\s+|$)/i, '').trim().toUpperCase()
  const label: CartonLabel = {
    cartonNo: row.cartonNo.trim(),
    styleNo: product?.style?.styleNo ?? row.styleNo.trim(),
    item: product?.style?.name ?? '',
    photo: product?.photo ?? null,
    shipmentQuantity: shipmentQuantity === null ? '' : formatNumber(shipmentQuantity),
    unitsPerBox: unitsPerBox === null ? '' : formatNumber(unitsPerBox),
    shippedOn: row.shippedOn.replaceAll('-', '.'),
    origin,
  }
  return {
    label,
    boxCount,
    started: Boolean(row.styleNo.trim() || LABEL_FIELDS.some(({ key }) => row[key].trim())),
    ready: Boolean(label.item.trim() && boxCount !== null && label.shippedOn && label.origin),
    errors: {
      shipmentQuantity: row.shipmentQuantity.trim() && shipmentQuantity === null ? '1 이상의 정수를 입력해 주세요.' : '',
      unitsPerBox: exceedsShipment ? '선적 총수량 이하로 입력해 주세요.'
        : row.unitsPerBox.trim() && unitsPerBox === null ? '1 이상의 정수를 입력해 주세요.' : '',
    },
  }
}

function CartonLabelSheet({ labels }: { labels: (CartonLabel | null)[] }) {
  return (
    <div className="outbound-rack-sheet outbound-slot-sheet carton-label-sheet">
      {labels.map((label, index) => (
        <div className="outbound-rack-label carton-label" key={index}>
          {label && (
            <div className="carton-label-table">
              <div className="carton-label-row carton-label-number"><span>C/T NO</span><span>{label.cartonNo}</span></div>
              <div className="carton-label-row carton-label-image">
                <span>IMAGE</span>
                <div className="carton-label-visual">
                  <div className="carton-label-photo">{label.photo && <img src={label.photo} alt={label.item + ' 대표 사진'} />}</div>
                  <strong className="carton-label-sku" style={{ '--carton-sku-length': Math.max(1, label.styleNo.length) } as CSSProperties}>{label.styleNo}</strong>
                </div>
              </div>
              <div className="carton-label-row carton-label-item">
                <span>ITEM</span>
                <strong className="carton-label-item-name" style={{ '--carton-item-length': Math.max(1, Array.from(label.item).length) } as CSSProperties}>{label.item}</strong>
              </div>
              <div className="carton-label-row carton-label-space" aria-hidden="true"><span /><span /></div>
              <div className="carton-label-row carton-label-quantity">
                <span>Q'TY</span><span>{label.shipmentQuantity && label.shipmentQuantity + ' EA'}</span><span>{label.unitsPerBox && label.unitsPerBox + ' / box'}</span>
              </div>
              <div className="carton-label-row carton-label-footer">
                <span>{label.shippedOn}</span><span>{label.origin && 'MADE IN ' + label.origin}</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function BoxLabelingPage() {
  useRenderWatch('BoxLabelingPage')
  const { session } = useAuth()
  if (!session) return null
  return (
    <>
      <PageHeader title="박스 라벨링" />
      <BoxLabelingForm key={session.user.id} userId={session.user.id} />
    </>
  )
}

function BoxLabelingForm({ userId }: { userId: string }) {
  const active = useWorkspaceTabActivity()
  const { brands, loading: brandsLoading, error: brandsError } = useCompanyBrandScope()
  const nextRowId = useRef(2)
  const [rows, setRows] = useState(() => [newLabelRow(1)])
  const [pageIndex, setPageIndex] = useState(0)
  const [printLabels, setPrintLabels] = useState<CartonLabel[] | null>(null)
  const brandIdsByRow = rows.map(row => brands.filter(brand => !row.brandId || brand.id === row.brandId).map(brand => brand.id))
  const canLookup = rows.map((row, index) => Boolean(row.styleNo.trim() && brandIdsByRow[index].length && !brandsLoading && !brandsError))
  const productQueries = useQueries({
    queries: rows.map((row, index) => ({
      queryKey: ['warehouse-box-label-product', userId, row.id, row.requestedStyleNo, brandIdsByRow[index]],
      queryFn: () => lookupLabelProduct(brandIdsByRow[index], row.requestedStyleNo),
      enabled: active && canLookup[index] && Boolean(row.requestedStyleNo),
      retry: false,
    })),
  })
  const products = productQueries.map((query, index) =>
    canLookup[index] && rows[index].requestedStyleNo && !query.isFetching && !query.isError ? query.data : undefined,
  )
  const rowStates = rows.map((row, index) => getLabelRowState(row, products[index]))
  const startedRows = rowStates.filter(row => row.started)
  const labels = startedRows.flatMap(({ label }) => [label, label])
  const pages = outboundRackLabelPages(labels)
  const currentPageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1))
  const incompleteCount = startedRows.filter(row => !row.ready).length
  const showBrand = brands.length > 1

  function updateRow(id: number, changes: Partial<Omit<LabelRow, 'id'>>) {
    setRows(current => current.map(row => row.id === id ? { ...row, ...changes } : row))
  }

  function addRow() {
    const row = newLabelRow(nextRowId.current++)
    setRows(current => [...current, row])
  }

  function removeRow(id: number) {
    if (rows.length === 1) {
      setRows([newLabelRow(nextRowId.current++)])
      setPageIndex(0)
      return
    }
    setRows(current => current.filter(row => row.id !== id))
  }

  function lookupProduct(event: FormEvent<HTMLFormElement>, row: LabelRow, index: number) {
    event.preventDefault()
    const query = productQueries[index]
    if (!active || !canLookup[index] || query.isFetching) return
    const input = row.styleNo.trim().toUpperCase()
    if (row.requestedStyleNo === input) void query.refetch()
    else updateRow(row.id, { requestedStyleNo: input })
  }

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <Card className="min-w-0">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">라벨 입력</h2>
            <Button type="button" size="sm" variant="outline" onClick={addRow}>
              <Plus className="size-4" />행 추가
            </Button>
          </div>
          {brandsError && <p role="alert" className="text-sm text-danger">브랜드를 불러오지 못했습니다. 화면을 새로고침해 주세요.</p>}
          {!brandsLoading && !brandsError && brands.length === 0 && <p role="status" className="text-sm text-muted-foreground">조회할 수 있는 브랜드가 없습니다.</p>}
          <div className="relative overflow-x-auto rounded-lg border border-border" role="region" aria-label="라벨 입력 표" tabIndex={0}>
            <table className={`w-full table-fixed text-sm ${showBrand ? 'min-w-[48rem]' : 'min-w-[42rem]'}`}>
              <thead className="bg-primary text-primary-foreground">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-1.5 [&>th]:py-2 [&>th]:font-medium">
                  <th scope="col" className="w-9">행</th>
                  {showBrand && <th scope="col" className="w-[6.75rem] text-left">브랜드</th>}
                  <th scope="col" className="text-left">M번호</th>
                  {LABEL_FIELDS.map(field => <th key={field.key} scope="col" className={field.width + ' text-left'}>{field.label}</th>)}
                  <th scope="col" className="w-10"><span className="sr-only">삭제</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => {
                  const query = productQueries[index]
                  const product = products[index]
                  const { boxCount, errors, started } = rowStates[index]
                  const rowNumber = index + 1
                  return (
                    <tr key={row.id} className="align-top [&>td]:px-1.5 [&>td]:py-2"
                      onFocus={() => setPageIndex(Math.floor(rowStates.slice(0, index).filter(entry => entry.started).length / 2))}>
                      <th scope="row" className="pt-4 text-center text-xs font-medium tabular-nums text-muted-foreground">{rowNumber}</th>
                      {showBrand && (
                        <td>
                          <Select aria-label={rowNumber + '행 브랜드'} className="w-full min-w-0 pl-1.5 text-xs" value={row.brandId}
                            onChange={event => updateRow(row.id, { brandId: event.target.value, requestedStyleNo: '' })}>
                            <option value="">전체</option>
                            {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                          </Select>
                        </td>
                      )}
                      <td>
                        <form className="flex items-center gap-1" onSubmit={event => lookupProduct(event, row, index)}>
                          <Input aria-label={rowNumber + '행 M번호'} className="min-w-0 px-1.5" value={row.styleNo} placeholder="M0728" autoComplete="off"
                            onChange={event => updateRow(row.id, { styleNo: event.target.value, requestedStyleNo: '' })} />
                          <Button type="submit" variant="outline" size="icon" className="size-9 shrink-0" aria-label={rowNumber + '행 상품 불러오기'}
                            title="상품 불러오기" disabled={!canLookup[index] || query.isFetching} aria-busy={query.isFetching}>
                            {query.isFetching ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                          </Button>
                        </form>
                        {row.requestedStyleNo && query.isError && <p role="alert" className="mt-1 text-xs text-danger">조회 실패 · 다시 시도해 주세요.</p>}
                        {product?.ambiguous && <p role="status" className="mt-1 text-xs text-muted-foreground">M번호 중복 · 브랜드를 선택해 주세요.</p>}
                        {product && !product.ambiguous && !product.style && <p role="status" className="mt-1 text-xs text-muted-foreground">일치하는 상품이 없습니다.</p>}
                        {product?.style && (
                          <div role="status" className="mt-1 text-xs">
                            <p className="truncate font-medium" title={product.style.name}>{product.style.name || '상품명 미등록'}</p>
                            {!product.photo && <p className="text-muted-foreground">대표 사진 없음</p>}
                          </div>
                        )}
                      </td>
                      {LABEL_FIELDS.map(({ key, label, type, placeholder, inputMode }) => {
                        const error = key === 'shipmentQuantity' || key === 'unitsPerBox' ? errors[key] : ''
                        const errorId = `carton-row-${row.id}-${key}-error`
                        return (
                          <td key={key}>
                            <Input aria-label={rowNumber + '행 ' + label} aria-invalid={Boolean(error)}
                              aria-describedby={error ? errorId : undefined} className="min-w-0 px-1.5 text-xs"
                              type={type} placeholder={placeholder} inputMode={inputMode} value={row[key]}
                              onChange={event => updateRow(row.id, { [key]: event.target.value })} />
                            {error && <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
                            {key === 'unitsPerBox' && boxCount !== null && (
                              <p className="mt-1 text-xs tabular-nums text-muted-foreground">약 {formatNumber(boxCount)}박스</p>
                            )}
                          </td>
                        )
                      })}
                      <td>
                        <Button type="button" variant="ghost" size="icon" aria-label={rowNumber + '행 삭제'} title="행 삭제"
                          disabled={rows.length === 1 && !started && !row.brandId} onClick={() => removeRow(row.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card className="w-full min-w-0 max-w-sm xl:max-w-none">
        <CardContent className="space-y-3 p-3">
          <div>
            <h2 className="text-base font-semibold">A4 4칸 미리보기</h2>
            <p className="mt-1 text-xs text-muted-foreground">한 행에 라벨 2개 · 한 장에 최대 2행</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="outbound-rack-screen-preview outbound-slot-preview carton-label-screen-preview">
              <CartonLabelSheet labels={pages[currentPageIndex] ?? [null, null, null, null]} />
            </div>
          </div>
          {pages.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <Button type="button" size="icon" variant="outline" aria-label="이전 미리보기 페이지" disabled={currentPageIndex === 0} onClick={() => setPageIndex(currentPageIndex - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span aria-live="polite" className="text-xs tabular-nums">{currentPageIndex + 1} / {pages.length}장 · 라벨 {labels.length}개</span>
              <Button type="button" size="icon" variant="outline" aria-label="다음 미리보기 페이지" disabled={currentPageIndex === pages.length - 1} onClick={() => setPageIndex(currentPageIndex + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
          <Button type="button" size="sm" className="w-full" disabled={labels.length === 0 || incompleteCount > 0} onClick={() => setPrintLabels(labels)}>
            <Printer className="size-4" />인쇄 미리보기
          </Button>
          {(labels.length === 0 || incompleteCount > 0) && (
            <p className="text-xs text-muted-foreground">
              {incompleteCount > 0 && <strong className="text-foreground">미완성 {incompleteCount}행 · </strong>}
              상품을 불러오고 선적일, 수량, 원산지를 입력해 주세요.
            </p>
          )}
        </CardContent>
      </Card>
      {printLabels && (
        <WarehouseFourSlotPrintPreview
          labels={printLabels}
          landscape
          title="박스 라벨링 · A4 4칸 라벨"
          dialogClassName="max-w-6xl"
          previewClassName="carton-label-screen-preview"
          unit="라벨"
          printLabel="박스 라벨 인쇄"
          closeLabel="박스 라벨 미리보기 닫기"
          note="입력 순서대로 같은 라벨 2개를 나란히 인쇄합니다."
          renderSheet={labels => <CartonLabelSheet labels={labels} />}
          onClose={() => setPrintLabels(null)}
        />
      )}
    </div>
  )
}
