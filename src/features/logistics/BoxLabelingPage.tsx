import { useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, Search } from 'lucide-react'
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
import { WarehouseFourSlotPrintPreview } from './WarehouseFourSlotPrintPreview'
import './carton-label-print.css'

type LabelInputs = {
  cartonNo: string
  shippedOn: string
  shipmentQuantity: string
  unitsPerBox: string
  origin: string
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
  const [brandId, setBrandId] = useState('')
  const [styleNo, setStyleNo] = useState('')
  const [requestedStyleNo, setRequestedStyleNo] = useState('')
  const [fields, setFields] = useState<LabelInputs>({
    cartonNo: '', shippedOn: '', shipmentQuantity: '', unitsPerBox: '', origin: '',
  })
  const [printLabel, setPrintLabel] = useState<CartonLabel | null>(null)
  const brandIds = brands.filter(brand => !brandId || brand.id === brandId).map(brand => brand.id)
  const canLookup = Boolean(styleNo.trim() && brandIds.length && !brandsLoading && !brandsError)
  const productQuery = useQuery({
    queryKey: ['warehouse-box-label-product', userId, requestedStyleNo, brandIds],
    queryFn: () => lookupLabelProduct(brandIds, requestedStyleNo),
    enabled: active && canLookup && Boolean(requestedStyleNo),
    retry: false,
  })
  const product = canLookup && !productQuery.isFetching && !productQuery.isError ? productQuery.data : undefined
  const shipmentQuantity = wholeQuantity(fields.shipmentQuantity)
  const unitsPerBox = wholeQuantity(fields.unitsPerBox)
  const boxCount = shipmentQuantity && unitsPerBox && unitsPerBox <= shipmentQuantity
    ? Math.ceil(shipmentQuantity / unitsPerBox)
    : null
  const invalidQuantity = (fields.shipmentQuantity.trim() && shipmentQuantity === null)
    || (fields.unitsPerBox.trim() && unitsPerBox === null)
  const origin = fields.origin.trim().replace(/^made in(?:\s+|$)/i, '').trim().toUpperCase()
  const label: CartonLabel = {
    cartonNo: fields.cartonNo.trim(),
    styleNo: product?.style?.styleNo ?? styleNo.trim(),
    item: product?.style?.name ?? '',
    photo: product?.photo ?? null,
    shipmentQuantity: shipmentQuantity === null ? '' : formatNumber(shipmentQuantity),
    unitsPerBox: unitsPerBox === null ? '' : formatNumber(unitsPerBox),
    shippedOn: fields.shippedOn.replaceAll('-', '.'),
    origin,
  }
  const canPrint = Boolean(product?.style?.name.trim() && boxCount && fields.shippedOn && origin)

  function updateField(field: keyof LabelInputs, value: string) {
    setFields(current => ({ ...current, [field]: value }))
  }

  function lookupProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canLookup || productQuery.isFetching) return
    const input = styleNo.trim()
    if (requestedStyleNo === input) void productQuery.refetch()
    else setRequestedStyleNo(input)
  }

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-base font-semibold">라벨 입력</h2>
          <form className="space-y-2" onSubmit={lookupProduct}>
            {brands.length > 1 && (
              <label className="block space-y-1">
                <span className="text-sm font-medium">브랜드</span>
                <Select aria-label="브랜드" className="w-full" value={brandId} onChange={event => { setBrandId(event.target.value); setRequestedStyleNo('') }}>
                  <option value="">전체 브랜드</option>
                  {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </Select>
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-sm font-medium">M번호</span>
              <Input value={styleNo} placeholder="예: M0728" autoComplete="off" onChange={event => { setStyleNo(event.target.value); setRequestedStyleNo('') }} />
            </label>
            <Button className="w-full" type="submit" variant="outline" disabled={!canLookup || productQuery.isFetching}>
              <Search className="size-4" />{productQuery.isFetching ? '상품 불러오는 중…' : '상품 불러오기'}
            </Button>
            {brandsError && <p role="alert" className="text-sm text-danger">브랜드를 불러오지 못했습니다. 화면을 새로고침해 주세요.</p>}
            {!brandsLoading && !brandsError && !brandIds.length && <p role="status" className="text-sm text-muted-foreground">조회할 수 있는 브랜드가 없습니다.</p>}
            {requestedStyleNo && productQuery.isError && <p role="alert" className="text-sm text-danger">상품을 불러오지 못했습니다. 다시 시도해 주세요.</p>}
            {product?.ambiguous && <p role="status" className="text-sm text-muted-foreground">같은 M번호가 여러 브랜드에 있습니다. 브랜드를 선택해 주세요.</p>}
            {product && !product.ambiguous && !product.style && <p role="status" className="text-sm text-muted-foreground">일치하는 M번호를 찾지 못했습니다.</p>}
            {product?.style && (
              <div role="status" className="rounded-md border border-border bg-muted/30 p-2.5 text-sm">
                <p className="font-medium">{product.style.name || '상품명 미등록'}</p>
                {!product.photo && <p className="mt-0.5 text-xs text-muted-foreground">대표 사진을 찾지 못했습니다.</p>}
              </div>
            )}
          </form>
          <label className="block space-y-1">
            <span className="text-sm font-medium">C/T NO</span>
            <Input value={fields.cartonNo} onChange={event => updateField('cartonNo', event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">선적일</span>
            <Input type="date" className="min-w-0" value={fields.shippedOn} onChange={event => updateField('shippedOn', event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 space-y-1">
              <span className="text-sm font-medium">선적 총수량</span>
              <Input inputMode="numeric" value={fields.shipmentQuantity} placeholder="EA" onChange={event => updateField('shipmentQuantity', event.target.value)} />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-sm font-medium">박스당 수량</span>
              <Input inputMode="numeric" value={fields.unitsPerBox} placeholder="/ box" onChange={event => updateField('unitsPerBox', event.target.value)} />
            </label>
          </div>
          {invalidQuantity && <p role="alert" className="text-sm text-danger">수량은 1 이상의 정수로 입력해 주세요.</p>}
          {shipmentQuantity && unitsPerBox && unitsPerBox > shipmentQuantity && <p role="alert" className="text-sm text-danger">박스당 수량은 선적 총수량 이하여야 합니다.</p>}
          {boxCount !== null && <p className="text-sm text-muted-foreground">예상 박스 수 <strong className="tabular-nums text-foreground">약 {formatNumber(boxCount)}박스</strong></p>}
          <label className="block space-y-1">
            <span className="text-sm font-medium">원산지</span>
            <Input value={fields.origin} placeholder="예: CHINA" onChange={event => updateField('origin', event.target.value)} />
          </label>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">A4 4칸 라벨</h2>
              <p className="mt-1 text-xs text-muted-foreground">가로 용지 · 같은 라벨 4개 · 한 칸 148.5 × 105mm</p>
            </div>
            <Button type="button" size="sm" disabled={!canPrint} onClick={() => setPrintLabel(label)}>
              <Printer className="size-4" />4칸 라벨 미리보기
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="outbound-rack-screen-preview outbound-slot-preview carton-label-screen-preview">
              <CartonLabelSheet labels={[label, label, label, label]} />
            </div>
          </div>
          {!canPrint && <p className="text-xs text-muted-foreground">상품을 불러오고 선적일, 수량, 원산지를 입력하면 인쇄할 수 있습니다.</p>}
        </CardContent>
      </Card>
      {printLabel && (
        <WarehouseFourSlotPrintPreview
          labels={[printLabel, printLabel, printLabel, printLabel]}
          landscape
          title="박스 라벨링 · A4 4칸 라벨"
          dialogClassName="max-w-6xl"
          previewClassName="carton-label-screen-preview"
          unit="라벨"
          printLabel="박스 라벨 인쇄"
          closeLabel="박스 라벨 미리보기 닫기"
          note="A4 한 장에 동일한 박스 라벨 4개를 인쇄합니다."
          renderSheet={labels => <CartonLabelSheet labels={labels} />}
          onClose={() => setPrintLabel(null)}
        />
      )}
    </div>
  )
}
