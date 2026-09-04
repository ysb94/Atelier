import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { BarcodeBulkUploadPanel } from '@/features/codes/BarcodeBulkUploadPanel'
import { UsageBulkUploadPanel } from '@/features/codes/UsageBulkUploadPanel'
import { ProductImportWorkspace } from '@/features/upload/ProductImportWorkspace'
import {
  getBarcodeFields,
  getCodeUsageAssignments,
  getCodeUsageTargets,
  getProductCodes,
  getStylesByBrand,
} from '@/lib/api'
import { outboundPartnerDisplayName } from '@/lib/codes/outbound-partner'
import type { CodeUsageStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

type UploadKind = 'products' | 'usage' | 'barcodes' | 'partner'

const KINDS: { id: UploadKind; label: string; description: string }[] = [
  {
    id: 'products',
    label: '전체 상품',
    description:
      '업로드 항목 양식으로 상품을 일괄·한건 등록합니다. 전체 상품에서 내보낸 파일을 엑셀에서 고쳐 올리면 수정·삭제까지 반영됩니다.',
  },
  {
    id: 'usage',
    label: '출고업체별 바코드',
    description: '출고업체에 자사 바코드를 파일로 일괄 연결합니다.',
  },
  {
    id: 'barcodes',
    label: '88바코드 관리',
    description:
      '회사에서 발급한 88코드·바코드 상품명·M번호를 파일로 일괄 등록합니다. M번호는 비워도 되고, 미지정 바코드는 88바코드 관리 화면의 미지정 탭에서 채웁니다. 이미 있는 바코드는 덮어쓰지 않습니다.',
  },
  {
    id: 'partner',
    label: '거래처 코드',
    description: '거래처에서 부여한 코드를 등록합니다.',
  },
]

function parseKind(raw: string | null): UploadKind {
  if (raw === 'usage' || raw === 'barcodes' || raw === 'partner') return raw
  return 'products'
}

export function DataUploadPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const kind = parseKind(searchParams.get('kind'))
  const [usageTargetId, setUsageTargetId] = useState<string>('')

  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
    enabled: kind === 'usage',
  })
  const codesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'own'],
    queryFn: () => getProductCodes(brand.id, 'own'),
    enabled: kind === 'usage',
  })
  const allCodesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'all'],
    queryFn: () => getProductCodes(brand.id),
    enabled: kind === 'barcodes',
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'codes'],
    queryFn: () => getStylesByBrand(brand.id),
    enabled: kind === 'barcodes',
  })
  const fieldsQuery = useQuery({
    queryKey: ['barcodeFields', brand.id],
    queryFn: () => getBarcodeFields(brand.id),
    enabled: kind === 'barcodes',
  })
  const assignmentsQuery = useQuery({
    queryKey: ['codeUsageAssignments', brand.id],
    queryFn: () => getCodeUsageAssignments(brand.id),
    enabled: kind === 'usage',
  })

  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const activeTargets = targets.filter((target) => target.active)
  const selectedTarget =
    targets.find((target) => target.id === usageTargetId) ??
    activeTargets[0] ??
    targets[0] ??
    null

  const existingByCodeId = useMemo(() => {
    const map = new Map<string, CodeUsageStatus>()
    if (!selectedTarget) return map
    for (const row of assignmentsQuery.data ?? []) {
      if (row.usageTargetId !== selectedTarget.id) continue
      map.set(row.productCodeId, row.status)
    }
    return map
  }, [assignmentsQuery.data, selectedTarget])

  function setKind(next: UploadKind) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (next === 'products') params.delete('kind')
      else params.set('kind', next)
      if (next !== 'products') params.delete('mode')
      return params
    })
  }

  const current = KINDS.find((item) => item.id === kind) ?? KINDS[0]

  return (
    <div>
      <PageHeader
        title="일괄 업로드"
        description={`${brand.name} 데이터 영역의 상품·코드를 파일로 한 번에 올립니다.`}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setKind(item.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              item.id === kind
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">{current.description}</p>

      {kind === 'products' ? (
        <ProductImportWorkspace
          embedded
          successPath={`/b/${brand.slug}/data/all`}
          successLabel="데이터 시트로 보기"
        />
      ) : null}

      {kind === 'usage' ? (
        <div className="space-y-4">
          {targetsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              출고업체를 불러오는 중...
            </p>
          ) : targets.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <p className="text-sm font-medium">출고업체가 없습니다</p>
                <p className="text-sm text-muted-foreground">
                  출고업체를 만든 뒤 자사 바코드를 일괄 연결할 수 있습니다.
                </p>
                <Link to={`/b/${brand.slug}/settings/usage-targets`}>
                  <Button type="button" size="sm">
                    출고업체 관리
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (codesQuery.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <p className="text-sm font-medium">88바코드가 없습니다</p>
                <p className="text-sm text-muted-foreground">
                  출고업체 연결 전에 자사 바코드 마스터를 먼저 등록하세요.
                </p>
                <Link to={`/b/${brand.slug}/barcodes`}>
                  <Button type="button" size="sm">
                    88바코드 관리로 이동
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  출고업체
                </span>
                <Select
                  className="h-9 max-w-xs"
                  value={selectedTarget?.id ?? ''}
                  onChange={(event) => setUsageTargetId(event.target.value)}
                >
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {outboundPartnerDisplayName(target)}
                      {target.active ? '' : ' (비활성)'}
                    </option>
                  ))}
                </Select>
              </div>
              {selectedTarget ? (
                <UsageBulkUploadPanel
                  brandName={brand.name}
                  brandId={brand.id}
                  usageTarget={selectedTarget}
                  codes={codesQuery.data ?? []}
                  existingByCodeId={existingByCodeId}
                  onApplied={async () => {
                    await queryClient.invalidateQueries({
                      queryKey: ['codeUsageAssignments', brand.id],
                    })
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {kind === 'barcodes' ? (
        <div className="space-y-4">
          {stylesQuery.isLoading ||
          allCodesQuery.isLoading ||
          fieldsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : (stylesQuery.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <p className="text-sm font-medium">상품이 없습니다</p>
                <p className="text-sm text-muted-foreground">
                  바코드에 연결할 M번호가 필요합니다. 상품을 먼저 등록하세요.
                </p>
                <Link to={`/b/${brand.slug}/data/upload`}>
                  <Button type="button" size="sm">
                    상품 일괄 업로드
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <BarcodeBulkUploadPanel
                brandName={brand.name}
                brandId={brand.id}
                styles={stylesQuery.data ?? []}
                fields={fieldsQuery.data ?? []}
                existingCodes={allCodesQuery.data ?? []}
                onApplied={async () => {
                  await queryClient.invalidateQueries({
                    queryKey: ['productCodes', brand.id],
                  })
                }}
              />
              <p className="text-sm text-muted-foreground">
                M번호 없이 올린 바코드는{' '}
                <Link
                  to={`/b/${brand.slug}/barcodes`}
                  className="underline underline-offset-2"
                >
                  자사 바코드 · M번호 미지정
                </Link>
                탭에서 채울 수 있습니다. 엑셀 헤더는 88바코드 관리 화면의{' '}
                <Link
                  to={`/b/${brand.slug}/barcodes`}
                  className="underline underline-offset-2"
                >
                  항목 관리
                </Link>
                에서 바꿉니다.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {kind === 'partner' ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm font-medium">
              거래처 코드 파일 업로드는 준비 중입니다
            </p>
            <p className="text-sm text-muted-foreground">
              거래처 코드 화면에서 단건으로 등록할 수 있습니다. 상품·출고업체
              업로드가 먼저 준비되어 있습니다.
            </p>
            <Link to={`/b/${brand.slug}/partner-codes`}>
              <Button type="button" size="sm">
                거래처 코드 화면
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
