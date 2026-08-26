import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  ACCESSORY_FEATURE_KEY,
  AI_PROVIDERS,
  ITEM_NAME_FEATURE_KEY,
  PROVIDER_LABEL,
  PROVIDER_SECRET,
  type AiFeatureKey,
  type AiProvider,
} from '@/lib/ai/gateway-core'
import { invalidateAiRecommendationQueries } from '@/lib/ai/query-cache'
import {
  AiGatewayError,
  AiSettingsStoreError,
  getAiFeatureRoutes,
  getAiUsageSummary,
  listAiModels,
  saveAiFeatureRoute,
  testAiConnection,
} from '@/lib/api'
import { isBrandLead, useAuth } from '@/lib/supabase/auth'

const FEATURE_LABEL: Record<AiFeatureKey, string> = {
  invoice_product_recommendation: '품목명 공식상품 추천',
  invoice_item_name_recommendation: '내품명 변환 추천',
  invoice_accessory_recommendation: '부속품 옵션 추천',
}

function formatUsd(value: number | null) {
  if (value == null) return '-'
  return `$${value.toFixed(4)}`
}

function formatRate(value: number | null) {
  return value == null ? '-' : `${Math.round(value * 100)}%`
}

export function AiSettingsPage() {
  const { brand } = useBrand()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = isBrandLead(profile, brand.id)
  const [featureKey, setFeatureKey] = useState<AiFeatureKey>(
    'invoice_product_recommendation',
  )
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [modelId, setModelId] = useState('')
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState('')
  const [message, setMessage] = useState('')

  const routesQuery = useQuery({
    queryKey: ['ai-feature-routes', brand.id],
    queryFn: () => getAiFeatureRoutes(brand.id),
  })
  const route = useMemo(
    () =>
      routesQuery.data?.find((item) => item.featureKey === featureKey) ?? null,
    [featureKey, routesQuery.data],
  )

  useEffect(() => {
    setMonthlyBudgetUsd(
      route?.monthlyBudgetUsd == null ? '' : String(route.monthlyBudgetUsd),
    )
  }, [route?.monthlyBudgetUsd])

  const modelsQuery = useQuery({
    queryKey: ['ai-models', provider],
    queryFn: () => listAiModels(provider),
    enabled: canEdit,
    retry: false,
  })
  const usageQuery = useQuery({
    queryKey: ['ai-usage-summary', brand.id],
    queryFn: () => getAiUsageSummary(brand.id),
  })
  const featureUsage = usageQuery.data?.features.find(
    (item) => item.featureKey === featureKey,
  )

  const saveMutation = useMutation({
    mutationFn: () =>
      saveAiFeatureRoute(brand.id, {
        featureKey,
        provider,
        modelId,
        monthlyBudgetUsd: monthlyBudgetUsd.trim()
          ? Number(monthlyBudgetUsd)
          : null,
      }),
    onSuccess: async () => {
      setMessage('선택한 제공자와 모델을 저장했습니다.')
      await queryClient.invalidateQueries({
        queryKey: ['ai-feature-routes', brand.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-feature-route', brand.id],
      })
      await invalidateAiRecommendationQueries(queryClient, brand.id)
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : '저장에 실패했습니다.')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => testAiConnection(provider, modelId),
    onSuccess: (result) => {
      setMessage(`연결 테스트 성공 · ${result.latencyMs}ms`)
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : '연결 테스트에 실패했습니다.')
    },
  })

  const selectedModels = modelsQuery.data?.models ?? []
  const providerError =
    modelsQuery.error instanceof AiGatewayError
      ? modelsQuery.error
      : modelsQuery.error instanceof Error
        ? modelsQuery.error
        : null

  return (
    <div>
      <PageHeader
        title="AI 설정"
        description="브랜드별로 품목명·내품명·부속품 추천에 쓸 제공자와 모델을 고릅니다. API 키는 화면에 저장하지 않습니다."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>제공자 연결</CardTitle>
            <CardDescription>
              모델 목록은 각 제공자 API에서 새로 읽습니다. 새 모델은 목록에만
              나타나고, 실제 사용 모델은 아래에서 직접 골라야 바뀝니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {AI_PROVIDERS.map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={provider === item ? 'default' : 'outline'}
                  disabled={!canEdit}
                  onClick={() => {
                    setProvider(item)
                    setModelId('')
                    setMessage('')
                  }}
                >
                  {PROVIDER_LABEL[item]}
                </Button>
              ))}
            </div>
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={modelsQuery.isFetching}
                  onClick={() =>
                    queryClient.invalidateQueries({
                      queryKey: ['ai-models', provider],
                    })
                  }
                >
                  {modelsQuery.isFetching ? '새로고침 중...' : '모델 목록 새로고침'}
                </Button>
                {modelsQuery.isSuccess ? (
                  <Badge variant="success">
                    {PROVIDER_LABEL[provider]} {selectedModels.length}개
                  </Badge>
                ) : providerError ? (
                  <Badge variant="danger">연결 실패</Badge>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                모델 변경은 브랜드 팀장 또는 관리자만 할 수 있습니다.
              </p>
            )}
            {providerError ? (
              <p className="text-sm text-danger">
                {providerError.message}
                {providerError instanceof AiGatewayError &&
                providerError.missingSecret
                  ? ` Secret 이름: ${PROVIDER_SECRET[provider]}`
                  : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{FEATURE_LABEL[featureKey]}</CardTitle>
            <CardDescription>
              {featureKey === ITEM_NAME_FEATURE_KEY
                ? '내품명 변환은 전용 모델과 확정 사례를 씁니다. AI는 초안만 채우고 사람이 고른 뒤에만 저장합니다.'
                : featureKey === ACCESSORY_FEATURE_KEY
                  ? '부속품 사전은 내품명과 분리된 모델을 씁니다. AI는 예상값만 채우고 사람이 고른 뒤에만 저장합니다.'
                  : '송장 품목명 지정 화면에 추천 조회 키 1개와 공식상품 3개를 보여 줍니다. AI는 채우기만 하고 등록은 기존 버튼이 확정합니다.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FEATURE_LABEL) as AiFeatureKey[]).map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={featureKey === key ? 'default' : 'outline'}
                  onClick={() => {
                    setFeatureKey(key)
                    setModelId('')
                    setMessage('')
                  }}
                >
                  {FEATURE_LABEL[key]}
                </Button>
              ))}
            </div>
            {route ? (
              <p className="text-sm">
                현재 사용:{' '}
                <span className="font-medium">
                  {PROVIDER_LABEL[route.provider]} · {route.modelId}
                </span>
                {' · '}
                {route.recommendationPolicy}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                아직 이 기능에 선택된 모델이 없습니다.
              </p>
            )}
            {canEdit ? (
              <>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">월 소프트 예산(USD)</span>
                  <Input
                    className="w-full max-w-xl"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="비우면 경고 없음"
                    value={monthlyBudgetUsd}
                    onChange={(event) => setMonthlyBudgetUsd(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">모델</span>
                  <Select
                    className="w-full max-w-xl"
                    value={modelId}
                    onChange={(event) => {
                      setModelId(event.target.value)
                      setMessage('')
                    }}
                  >
                    <option value="">모델을 선택하세요</option>
                    {selectedModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!modelId || saveMutation.isPending}
                    onClick={() => {
                      setMessage('')
                      saveMutation.mutate()
                    }}
                  >
                    {saveMutation.isPending ? '저장 중...' : '이 모델 사용'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!modelId || testMutation.isPending}
                    onClick={() => {
                      setMessage('')
                      testMutation.mutate()
                    }}
                  >
                    {testMutation.isPending ? '테스트 중...' : '연결 테스트'}
                  </Button>
                </div>
              </>
            ) : null}
            {message ? (
              <p
                className={`text-sm ${
                  saveMutation.isError ||
                  testMutation.isError ||
                  message.includes('실패')
                    ? 'text-danger'
                    : 'text-success'
                }`}
              >
                {message}
              </p>
            ) : null}
            {featureUsage ? (
              <div className="space-y-2">
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>
                    최근 30일 호출{' '}
                    <span className="font-medium text-foreground">
                      {featureUsage.total}
                    </span>
                  </p>
                  <p>
                    로컬 생략{' '}
                    <span className="font-medium text-foreground">
                      {featureUsage.skippedAiCount}
                    </span>
                  </p>
                  <p>
                    캐시 적중{' '}
                    <span className="font-medium text-foreground">
                      {featureUsage.cacheCount}
                    </span>
                  </p>
                  <p>
                    AI 호출{' '}
                    <span className="font-medium text-foreground">
                      {featureUsage.aiCount}
                    </span>
                  </p>
                  <p>
                    토큰{' '}
                    <span className="font-medium text-foreground">
                      {featureUsage.inputTokens + featureUsage.outputTokens}
                    </span>
                  </p>
                  <p>
                    추정 비용{' '}
                    <span className="font-medium text-foreground">
                      {formatUsd(featureUsage.estimatedCostUsd)}
                    </span>
                  </p>
                  <p>
                    축적 사례{' '}
                    <span className="font-medium text-foreground">
                      {featureUsage.caseCount}
                    </span>
                  </p>
                  <p>
                    확정률{' '}
                    <span className="font-medium text-foreground">
                      {formatRate(featureUsage.confirmedRate)}
                    </span>
                  </p>
                  <p>
                    수정률{' '}
                    <span className="font-medium text-foreground">
                      {formatRate(featureUsage.correctionRate)}
                    </span>
                  </p>
                  {featureKey === 'invoice_product_recommendation' ? (
                    <p>
                      Top-1{' '}
                      <span className="font-medium text-foreground">
                        {formatRate(featureUsage.top1Rate)}
                      </span>
                    </p>
                  ) : null}
                </div>
                {featureUsage.models.length > 0 ? (
                  <div className="space-y-1 rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">모델별 사용</p>
                    {featureUsage.models.map((model) => (
                      <p key={`${model.provider}:${model.modelId}`}>
                        {model.provider} · {model.modelId || '(모델 미기록)'} —
                        호출 {model.total}, 토큰{' '}
                        {model.inputTokens + model.outputTokens}, 비용{' '}
                        {formatUsd(model.estimatedCostUsd)}
                      </p>
                    ))}
                  </div>
                ) : null}
                {featureUsage.budgetWarning ? (
                  <p className="text-xs text-amber-700">
                    이번 달 추정 비용이 소프트 예산
                    {featureUsage.monthlyBudgetUsd == null
                      ? ''
                      : ` ${formatUsd(featureUsage.monthlyBudgetUsd)}`}
                    을 넘었습니다. 업무는 막지 않습니다.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  비용은 앱 추정치입니다. 공식 청구액은 각 제공자 대시보드를
                  확인하세요. 가격표를 모르는 새 모델은 토큰만 남깁니다.
                </p>
              </div>
            ) : null}
            {saveMutation.error instanceof AiSettingsStoreError ? (
              <p className="text-xs text-muted-foreground">
                권한 오류면 브랜드 팀장 또는 관리자 계정으로 다시 시도하세요.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
