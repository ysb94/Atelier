import { useMemo, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { InvoiceNameRule, InvoiceOptionMap, InvoiceProductNameMap } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceCodeRuleBulkPanel } from './InvoiceCodeRuleBulkPanel'
import { InvoiceCodeRuleForm } from './InvoiceCodeRuleForm'
import { InvoiceCodeRuleTable } from './InvoiceCodeRuleTable'
import { InvoiceAccessoryRuleTable } from './InvoiceAccessoryRuleTable'
import { InvoiceItemNameRuleBulkPanel } from './InvoiceItemNameRuleBulkPanel'
import { InvoiceOptionLedgerImportPanel } from './InvoiceOptionLedgerImportPanel'
import { InvoiceOptionMapForm } from './InvoiceOptionMapForm'
import { InvoiceOptionMapTable } from './InvoiceOptionMapTable'
import { InvoiceProductNameLedgerImportPanel } from './InvoiceProductNameLedgerImportPanel'
import { InvoiceProductNameExclusionTable } from './InvoiceProductNameExclusionTable'
import { InvoiceProductNameMapForm } from './InvoiceProductNameMapForm'
import { InvoiceProductNameMapTable } from './InvoiceProductNameMapTable'

type OptionRuleView =
  | 'productLedger'
  | 'productMaps'
  | 'exclusions'
  | 'ledger'
  | 'maps'
  | 'itemNameRules'
  | 'accessories'
  | 'review'
  | 'codes'

const OPTION_VIEWS: { value: OptionRuleView; label: string }[] = [
  { value: 'productLedger', label: '품목명 원장' },
  { value: 'productMaps', label: '품목명 기준' },
  { value: 'exclusions', label: '송장 제외 기준' },
  { value: 'ledger', label: '내품명 원장' },
  { value: 'maps', label: '내품명 기준' },
  { value: 'itemNameRules', label: '내품명 일괄 규칙' },
  { value: 'accessories', label: '부속품 사전' },
  { value: 'review', label: '검토 필요' },
  { value: 'codes', label: '자체품번코드' },
]

export function InvoiceOptionMapRulesPanel({
  brandId,
  brandName,
  maps,
  mapsLoading,
  mapsError,
  productNameMaps,
  productNameMapsLoading,
  productNameMapsError,
  nameRules,
  nameRulesLoading,
  nameRulesError,
}: {
  brandId: string
  brandName: string
  maps: InvoiceOptionMap[]
  mapsLoading: boolean
  mapsError: string | null
  productNameMaps: InvoiceProductNameMap[]
  productNameMapsLoading: boolean
  productNameMapsError: string | null
  nameRules: InvoiceNameRule[]
  nameRulesLoading: boolean
  nameRulesError: string | null
}) {
  const [view, setView] = useState<OptionRuleView>('productLedger')
  const [registerMode, setRegisterMode] = useState<'single' | 'bulk'>('single')

  const paused = useMemo(
    () => maps.filter((map) => !map.isActive),
    [maps],
  )
  const missingMain = useMemo(
    () =>
      maps.filter((map) => !map.components.some((item) => item.role === 'main')),
    [maps],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {OPTION_VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={view === item.value}
            onClick={() => setView(item.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              view === item.value
                ? 'bg-card shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'productLedger' ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>품목명 원장 가져오기</CardTitle>
            <CardDescription>
              품목명 원장이나 `이름 변경 단계` 사례집을 올립니다. 본품 기준만
              만들고 내품명·구성품은 건드리지 않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceProductNameLedgerImportPanel
              brandId={brandId}
              brandName={brandName}
            />
          </CardContent>
        </Card>
      ) : null}

      {view === 'productMaps' ? (
        <>
          <InvoiceProductNameMapTable
            brandId={brandId}
            maps={productNameMaps}
            loading={productNameMapsLoading}
            error={productNameMapsError}
          />
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>품목명 기준 직접 등록</CardTitle>
              <CardDescription>
                원본 품목명과 내품명 문맥을 본품 1개에만 연결합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvoiceProductNameMapForm brandId={brandId} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {view === 'exclusions' ? (
        <InvoiceProductNameExclusionTable brandId={brandId} />
      ) : null}

      {view === 'ledger' ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>내품명 원장 가져오기</CardTitle>
            <CardDescription>
              누적 VLOOKUP이나 구성 원장을 올립니다. 품목명 원장과 섞지
              않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceOptionLedgerImportPanel
              brandId={brandId}
              brandName={brandName}
            />
          </CardContent>
        </Card>
      ) : null}

      {view === 'maps' ? (
        <>
          <InvoiceOptionMapTable
            brandId={brandId}
            maps={maps}
            loading={mapsLoading}
            error={mapsError}
          />
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>내품명 변환 기준 직접 등록</CardTitle>
              <CardDescription>
                원본 내품명과 같이 나가는 구성품 M번호·수량을 지정합니다. 변환
                내품명을 비우면 원문을 유지합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvoiceOptionMapForm brandId={brandId} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {view === 'itemNameRules' ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>내품명 일괄 규칙 엑셀 등록</CardTitle>
            <CardDescription>
              품목명 단계에서 본품은 맞았지만 내품명을 지우거나 구성품으로
              바꿔야 하는 건을 엑셀로 한 번에 등록합니다. 오늘 작업의 내품명
              변환 단계에서 「검토 목록 내려받기」로 받아 동작과 구성품만 채워
              올리세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceItemNameRuleBulkPanel
              brandId={brandId}
              brandName={brandName}
            />
          </CardContent>
        </Card>
      ) : null}

      {view === 'accessories' ? (
        <InvoiceAccessoryRuleTable brandId={brandId} />
      ) : null}

      {view === 'review' ? (
        <Card className="shadow-none">
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>검토 필요</CardTitle>
              <CardDescription className="mt-1">
                오늘 작업 파일에서 나온 미해결·충돌 조합은 오늘 작업의
                품목·옵션 변환 단계에서 자주 나온 순으로 처리합니다. 여기서는
                중지됐거나 본품이 빠진 기준만 보여 줍니다.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge variant="muted">중지 {formatNumber(paused.length)}</Badge>
              <Badge variant="danger">
                본품 없음 {formatNumber(missingMain.length)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {missingMain.length === 0 && paused.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                저장된 기준 중 검토할 항목이 없습니다. 매일 파일의 새 조합은
                오늘 작업에서 처리하세요.
              </p>
            ) : (
              <InvoiceOptionMapTable
                brandId={brandId}
                maps={[...missingMain, ...paused.filter((map) => !missingMain.includes(map))]}
                loading={false}
                error={null}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'codes' ? (
        <>
          <p className="text-xs text-muted-foreground">
            자체품번코드는 내품명이 비어 있을 때만 보조로 씁니다. 품목명·옵션
            조합이 있으면 그 변환 결과가 우선합니다.
          </p>
          <InvoiceCodeRuleTable
            brandId={brandId}
            rules={nameRules}
            loading={nameRulesLoading}
            error={nameRulesError}
          />
          <Card className="shadow-none">
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>자체품번코드 등록</CardTitle>
                <CardDescription className="mt-1">
                  내품명이 없는 행의 보조 기준으로 저장됩니다.
                </CardDescription>
              </div>
              <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
                <button
                  type="button"
                  aria-pressed={registerMode === 'single'}
                  onClick={() => setRegisterMode('single')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    registerMode === 'single'
                      ? 'bg-card shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  직접 입력
                </button>
                <button
                  type="button"
                  aria-pressed={registerMode === 'bulk'}
                  onClick={() => setRegisterMode('bulk')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    registerMode === 'bulk'
                      ? 'bg-card shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  엑셀 일괄 등록
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {registerMode === 'single' ? (
                <InvoiceCodeRuleForm brandId={brandId} />
              ) : (
                <InvoiceCodeRuleBulkPanel
                  brandId={brandId}
                  brandName={brandName}
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
