import { useMemo, useState } from 'react'
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
import { Select } from '@/components/ui/input'
import {
  ACCESSORY_FEATURE_KEY,
  AI_PROVIDERS,
  PROVIDER_LABEL,
  PROVIDER_SECRET,
  type AiFeatureKey,
  type AiProvider,
} from '@/lib/ai/gateway-core'
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
  invoice_accessory_recommendation: '부속품 사전 추천',
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

  const saveMutation = useMutation({
    mutationFn: () =>
      saveAiFeatureRoute(brand.id, {
        featureKey,
        provider,
        modelId,
      }),
    onSuccess: async () => {
      setMessage('선택한 제공자와 모델을 저장했습니다.')
      await queryClient.invalidateQueries({
        queryKey: ['ai-feature-routes', brand.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-feature-route', brand.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-product-recommendation', brand.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-accessory-recommendation', brand.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai-feature-route', brand.id],
      })
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
        description="브랜드별로 품목명·부속품 추천에 쓸 제공자와 모델을 고릅니다. API 키는 화면에 저장하지 않습니다."
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
              {featureKey === ACCESSORY_FEATURE_KEY
                ? '내품명 검토의 미인식 조각을 부속품 사전 후보로 제안합니다. AI는 채우기만 하고 등록은 사람이 고른 뒤에만 저장합니다.'
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
                hybrid_auto
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                아직 이 기능에 선택된 모델이 없습니다.
              </p>
            )}
            {canEdit ? (
              <>
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
            {usageQuery.data ? (
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <p>
                  로컬 처리율{' '}
                  <span className="font-medium text-foreground">
                    {usageQuery.data.total
                      ? `${Math.round((usageQuery.data.skippedAiCount / usageQuery.data.total) * 100)}%`
                      : '-'}
                  </span>
                </p>
                <p>
                  캐시 적중{' '}
                  <span className="font-medium text-foreground">
                    {usageQuery.data.cacheCount}
                  </span>
                </p>
                <p>
                  AI 호출{' '}
                  <span className="font-medium text-foreground">
                    {usageQuery.data.aiCount}
                  </span>
                </p>
                <p>
                  토큰{' '}
                  <span className="font-medium text-foreground">
                    {usageQuery.data.inputTokens + usageQuery.data.outputTokens}
                  </span>
                </p>
                <p>
                  Top-1{' '}
                  <span className="font-medium text-foreground">
                    {usageQuery.data.top1Rate == null
                      ? '-'
                      : `${Math.round(usageQuery.data.top1Rate * 100)}%`}
                  </span>
                </p>
                <p>
                  직접 수정률{' '}
                  <span className="font-medium text-foreground">
                    {usageQuery.data.editRate == null
                      ? '-'
                      : `${Math.round(usageQuery.data.editRate * 100)}%`}
                  </span>
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
