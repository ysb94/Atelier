import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { CompanyBrandFilter } from '@/components/layout/CompanyBrandFilter'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  getBarcodeDataEntryRuns,
  getBulkOutboundJobs,
  getInvoiceWorkRuns,
  getOutboundShipments,
  getProductCodes,
  getActiveWarehouseInventorySet,
  getWarehouseStockPositions,
} from '@/lib/api'
import type { Brand } from '@/lib/types'
import { warehousePositionQty } from '@/lib/warehouse/stock'
import { formatNumber } from '@/lib/utils'
import { withBrandTarget, withBrandsFilter } from '@/lib/workspace/company-paths'

function BrandCell({
  brandId,
  brandById,
}: {
  brandId: string
  brandById: Map<string, Brand>
}) {
  const brand = brandById.get(brandId)
  if (!brand) return <span>—</span>
  return (
    <span className="flex items-center gap-2">
      <BrandAvatar brand={brand} className="size-6" />
      {brand.name}
    </span>
  )
}

function ListShell({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} />
      <div className="mb-3">
        <CompanyBrandFilter />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        브랜드를 하나만 고르면 상세 관리 화면이 열립니다. 행 수정은 그 행의
        브랜드를 따릅니다.
      </p>
      {children}
    </div>
  )
}

export function CompanyBarcodeList() {
  const { selectedBrands, brandById, brands } = useCompanyBrandScope()
  const queries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['productCodes', item.id, 'own'] as const,
      queryFn: () => getProductCodes(item.id, 'own'),
    })),
  })
  const rows = queries.flatMap((query, index) =>
    (query.data ?? []).map((code) => ({
      ...code,
      brandId: selectedBrands[index]?.id ?? code.brandId,
    })),
  )
  const loading = queries.some((query) => query.isLoading)

  return (
    <ListShell
      title="88바코드 관리"
      description="전 브랜드 자사 바코드를 한 목록에서 봅니다."
      actions={
        <Link to="/data/upload">
          <Button type="button" size="sm">
            일괄 등록
          </Button>
        </Link>
      }
    >
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">바코드</th>
              <th className="px-4 py-3 font-medium">이름</th>
              <th className="px-4 py-3 font-medium">구성</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  바코드가 없습니다. 브랜드를 하나만 고르면 등록할 수 있습니다.
                </td>
              </tr>
            ) : (
              rows.map((code) => {
                const brand = brandById.get(code.brandId)
                return (
                  <tr key={`${code.brandId}:${code.id}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <BrandCell brandId={code.brandId} brandById={brandById} />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{code.code}</td>
                    <td className="px-4 py-2">{code.name || '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {code.components
                        .map((item) => item.styleNo)
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                    {brand ? (
                      <td className="hidden">{brand.slug}</td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </Card>
      {brands.length > 1 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          출고업체별 바코드·거래처 코드의 업체 트리와 헤더는 브랜드를 하나만
          고른 뒤에 엽니다.
        </p>
      ) : null}
    </ListShell>
  )
}

export function CompanyUsageCodeList() {
  return (
    <ListShell
      title="출고업체별 바코드"
      description="업체 헤더와 폴더 트리는 브랜드마다 다릅니다. 브랜드를 하나만 고르면 기존 관리 화면이 열립니다."
    >
      <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
        전체 보기에서는 업체 트리를 섞지 않습니다. 위에서 브랜드를 하나 고르세요.
      </Card>
    </ListShell>
  )
}

export function CompanyPartnerCodeList() {
  return (
    <ListShell
      title="거래처 코드"
      description="거래처 코드 헤더는 브랜드마다 다릅니다. 브랜드를 하나만 고르면 기존 관리 화면이 열립니다."
    >
      <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
        전체 보기에서는 거래처 헤더를 섞지 않습니다. 위에서 브랜드를 하나 고르세요.
      </Card>
    </ListShell>
  )
}

export function CompanyInvoiceLanding() {
  const { selectedBrands, brandById, brands } = useCompanyBrandScope()
  const queries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['invoiceWorkRuns', item.id] as const,
      queryFn: () => getInvoiceWorkRuns(item.id),
    })),
  })
  const rows = queries.flatMap((query) => query.data ?? [])
  const loading = queries.some((query) => query.isLoading)

  return (
    <div>
      <PageHeader
        title="송장작업"
        description="E&J 전체 작업 이력을 봅니다. 새 파일 작업은 브랜드를 고른 뒤 그 브랜드 기준만 불러옵니다."
        actions={
          <div className="flex flex-wrap gap-2">
            {brands.map((item) => (
              <Link
                key={item.id}
                to={withBrandTarget('/logistics/invoices', item.slug)}
              >
                <Button type="button" size="sm" variant="outline">
                  {item.name} 작업
                </Button>
              </Link>
            ))}
          </div>
        }
      />
      <div className="mb-3">
        <CompanyBrandFilter />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">파일</th>
              <th className="px-4 py-3 font-medium">작업자</th>
              <th className="px-4 py-3 font-medium">주문</th>
              <th className="px-4 py-3 font-medium">내보낸 행</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  작업 이력이 없습니다. 브랜드를 고르고 새 작업을 시작하세요.
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr key={`${item.brandId}:${item.id}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <BrandCell brandId={item.brandId} brandById={brandById} />
                  </td>
                  <td className="px-4 py-2">{item.sourceFileName || '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {item.workerLabel || '—'}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatNumber(item.sourceOrderCount)}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatNumber(item.exportedRowCount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function CompanyBarcodeEntryLanding() {
  const { selectedBrands, brandById, brands } = useCompanyBrandScope()
  const queries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['barcode-data-entry-runs', item.id] as const,
      queryFn: () => getBarcodeDataEntryRuns(item.id),
    })),
  })
  const rows = queries.flatMap((query, index) =>
    (query.data ?? []).map((item) => ({
      ...item,
      brandId: selectedBrands[index]?.id ?? '',
    })),
  )
  const loading = queries.some((query) => query.isLoading)

  return (
    <div>
      <PageHeader
        title="바코드 출고 데이터입력"
        description="E&J 전체 등록 이력을 봅니다. 새 입력은 브랜드를 고른 뒤 그 브랜드 업체·원장만 불러옵니다."
        actions={
          <div className="flex flex-wrap gap-2">
            {brands.map((item) => (
              <Link
                key={item.id}
                to={withBrandTarget(
                  '/logistics/barcode-outbound-data-entry',
                  item.slug,
                )}
              >
                <Button type="button" size="sm" variant="outline">
                  {item.name} 입력
                </Button>
              </Link>
            ))}
          </div>
        }
      />
      <div className="mb-3">
        <CompanyBrandFilter />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">출고일</th>
              <th className="px-4 py-3 font-medium">업체</th>
              <th className="px-4 py-3 font-medium">작업자</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  등록 이력이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr key={`${item.brandId}:${item.id}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <BrandCell brandId={item.brandId} brandById={brandById} />
                  </td>
                  <td className="px-4 py-2">{item.shippedOn || '—'}</td>
                  <td className="px-4 py-2">{item.companyKey || '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {item.workerLabel || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function CompanyBulkOutboundList() {
  const { selectedBrands, brandById, brands } = useCompanyBrandScope()
  const queries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['bulkOutboundJobs', item.id] as const,
      queryFn: () => getBulkOutboundJobs(item.id, new Map()),
    })),
  })
  const rows = queries.flatMap((query) => query.data ?? [])
  const loading = queries.some((query) => query.isLoading)

  return (
    <div>
      <PageHeader
        title="바코드 출고"
        description="모든 브랜드 Job을 한 목록에서 봅니다. 기존 Job은 그 브랜드로 열고, 새 Job은 브랜드를 고릅니다."
        actions={
          <div className="flex flex-wrap gap-2">
            {brands.map((item) => (
              <Link
                key={item.id}
                to={withBrandsFilter('/logistics/bulk-outbound', [item.slug], brands.map((brand) => brand.slug))}
              >
                <Button type="button" size="sm" variant="outline">
                  {item.name} 새 작업
                </Button>
              </Link>
            ))}
          </div>
        }
      />
      <div className="mb-3">
        <CompanyBrandFilter />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">제목</th>
              <th className="px-4 py-3 font-medium">업체</th>
              <th className="px-4 py-3 font-medium">상태</th>
              <th className="px-4 py-3 font-medium">수량</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Job이 없습니다. 브랜드를 하나 고르고 새 작업을 만드세요.
                </td>
              </tr>
            ) : (
              rows.map((job) => {
                const brand = brandById.get(job.brandId)
                return (
                  <tr key={`${job.brandId}:${job.id}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <BrandCell brandId={job.brandId} brandById={brandById} />
                    </td>
                    <td className="px-4 py-2">
                      {brand ? (
                        <Link
                          to={withBrandsFilter(
                            '/logistics/bulk-outbound',
                            [brand.slug],
                            brands.map((item) => item.slug),
                          )}
                          className="font-medium hover:underline"
                        >
                          {job.title || '제목 없음'}
                        </Link>
                      ) : (
                        job.title || '제목 없음'
                      )}
                    </td>
                    <td className="px-4 py-2">{job.partnerName || '—'}</td>
                    <td className="px-4 py-2">{job.status}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {formatNumber(job.plannedQty)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export function CompanyOutboundList() {
  const { selectedBrands, brandById } = useCompanyBrandScope()
  const queries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['outboundShipments', item.id] as const,
      queryFn: () => getOutboundShipments(item.id),
    })),
  })
  const rows = queries.flatMap((query) => query.data ?? [])
  const loading = queries.some((query) => query.isLoading)
  const totalQty = rows.reduce((sum, item) => sum + (item.quantity ?? 0), 0)

  return (
    <ListShell
      title="운영 현황"
      description="전 브랜드 출고 원장을 합쳐 회사 합계와 브랜드 열을 보여 줍니다."
    >
      <p className="mb-3 text-sm">
        회사 합계 수량 <b className="tabular-nums">{formatNumber(totalQty)}</b>
      </p>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">출고일</th>
              <th className="px-4 py-3 font-medium">품번</th>
              <th className="px-4 py-3 font-medium">수량</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  출고 원장이 없습니다.
                </td>
              </tr>
            ) : (
              rows.slice(0, 200).map((item) => (
                <tr
                  key={`${item.brandId}:${item.id}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2">
                    <BrandCell brandId={item.brandId} brandById={brandById} />
                  </td>
                  <td className="px-4 py-2">{item.shippedOn || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {item.styleNo || '—'}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatNumber(item.quantity ?? 0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </ListShell>
  )
}

export function CompanyWarehouseList() {
  const { selectedBrands, brandById, brands } = useCompanyBrandScope()
  const setQueries = useQueries({
    queries: selectedBrands.map((item) => ({
      queryKey: ['warehouse-inventory-set', item.id] as const,
      queryFn: () => getActiveWarehouseInventorySet(item.id),
    })),
  })
  const positionQueries = useQueries({
    queries: selectedBrands.map((item, index) => ({
      queryKey: [
        'warehouse-stock-positions',
        item.id,
        setQueries[index]?.data?.id,
      ] as const,
      queryFn: () =>
        getWarehouseStockPositions(item.id, setQueries[index]!.data!.id),
      enabled: Boolean(setQueries[index]?.data?.id),
    })),
  })
  const rows = positionQueries.flatMap((query, index) =>
    (query.data ?? []).map((item) => ({
      ...item,
      brandId: selectedBrands[index]?.id ?? item.brandId,
    })),
  )
  const loading =
    setQueries.some((query) => query.isLoading) ||
    positionQueries.some((query) => query.isLoading)

  return (
    <div>
      <PageHeader
        title="창고 관리"
        description="전 브랜드 재고를 한 목록에서 봅니다. 행 작업은 그 행의 브랜드를 따르고, 새 XLSX 적재는 브랜드를 하나 고른 뒤 합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            {brands.map((item) => (
              <Link
                key={item.id}
                to={withBrandsFilter(
                  '/logistics/warehouses',
                  [item.slug],
                  brands.map((brand) => brand.slug),
                )}
              >
                <Button type="button" size="sm" variant="outline">
                  {item.name} 적재
                </Button>
              </Link>
            ))}
          </div>
        }
      />
      <div className="mb-3">
        <CompanyBrandFilter />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">품번</th>
              <th className="px-4 py-3 font-medium">위치</th>
              <th className="px-4 py-3 font-medium">수량</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  재고가 없습니다. 브랜드를 하나 고르고 XLSX를 적재하세요.
                </td>
              </tr>
            ) : (
              rows.slice(0, 200).map((item) => (
                <tr
                  key={`${item.brandId}:${item.id}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2">
                    <BrandCell brandId={item.brandId} brandById={brandById} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {item.styleNo || '—'}
                  </td>
                  <td className="px-4 py-2">{item.locationCode || '—'}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatNumber(warehousePositionQty(item))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
