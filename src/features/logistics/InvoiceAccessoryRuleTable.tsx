import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { StylePicker } from '@/components/style-picker'
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
  deleteInvoiceAccessoryRule,
  getInvoiceAccessoryRules,
  listStyleRefsForLookup,
  saveInvoiceAccessoryRule,
  saveInvoiceAccessoryRules,
  setInvoiceAccessoryRuleActive,
  type InvoiceAccessoryRuleInput,
} from '@/lib/api'
import {
  INVOICE_ACCESSORY_SEED_DRAFTS,
  missingAccessorySeeds,
  toAccessorySeedInput,
} from '@/lib/invoice/accessory-rule-seed'
import {
  INVOICE_ACCESSORY_RULE_TYPE_LABEL,
  type InvoiceAccessoryRule,
  type InvoiceAccessoryRuleType,
  type StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'

const QUERY_KEY = (brandId: string) => ['invoice-accessory-rules', brandId] as const

function ruleSummary(rule: InvoiceAccessoryRule) {
  if (rule.ruleType === 'label' || rule.ruleType === 'default') {
    return `${rule.accessoryKind} · ${rule.namePrefix}`
  }
  if (rule.ruleType === 'color') return rule.colorName
  if (rule.ruleType === 'token') {
    return rule.targetStyle
      ? `${rule.targetStyle.styleNo} · ${rule.targetStyle.name}`
      : '상품 없음'
  }
  return '버림'
}

export function InvoiceAccessoryRuleTable({
  brandId,
}: {
  brandId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = QUERY_KEY(brandId)
  const listQuery = useQuery({
    queryKey,
    queryFn: () => getInvoiceAccessoryRules(brandId),
  })
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | InvoiceAccessoryRuleType>(
    'all',
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [seedMessage, setSeedMessage] = useState<string | null>(null)
  const rules = listQuery.data
  const ruleList = rules ?? []
  const missing = missingAccessorySeeds(INVOICE_ACCESSORY_SEED_DRAFTS, ruleList)

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ko-KR')
    return (rules ?? []).filter((rule) => {
      if (typeFilter !== 'all' && rule.ruleType !== typeFilter) return false
      if (!q) return true
      return [
        rule.pattern,
        rule.accessoryKind,
        rule.colorName,
        rule.namePrefix,
        rule.targetStyle?.styleNo,
        rule.targetStyle?.name,
        rule.note,
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q)
    })
  }, [rules, search, typeFilter])

  const seedMutation = useMutation({
    mutationFn: async () => {
      const lookup = await listStyleRefsForLookup(brandId, {
        styleNos: missing
          .map((item) => item.styleNo)
          .filter((item): item is string => Boolean(item)),
      })
      const styleIdByNo = new Map<string, string>()
      for (const [key, ref] of lookup.byStyleNo) {
        styleIdByNo.set(key, ref.styleId)
      }
      const inputs: InvoiceAccessoryRuleInput[] = []
      const errors: string[] = []
      for (const draft of missing) {
        const next = toAccessorySeedInput(draft, styleIdByNo)
        if ('error' in next) errors.push(next.error)
        else inputs.push(next)
      }
      const result = await saveInvoiceAccessoryRules(brandId, inputs)
      return { ...result, errors }
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey })
      const fail = result.failed.length + result.errors.length
      setActionError(result.errors[0] ?? null)
      setSeedMessage(
        `${formatNumber(result.applied.length)}건 등록` +
          (fail ? ` · 실패 ${formatNumber(fail)}건` : ''),
      )
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error ? reason.message : '권장 사전을 등록하지 못했습니다.',
      )
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setInvoiceAccessoryRuleActive(id, isActive),
    onSuccess: (saved) => {
      queryClient.setQueryData<InvoiceAccessoryRule[]>(queryKey, (current) =>
        current?.map((item) => (item.id === saved.id ? saved : item)),
      )
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error ? reason.message : '상태를 바꾸지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteInvoiceAccessoryRule,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error ? reason.message : '지우지 못했습니다.',
      )
    },
  })

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>부속품 사전</CardTitle>
          <CardDescription>
            옵션 문구에서 태슬·스트랩·키링 M번호를 찾습니다. 인식 결과는 저장하지
            않고 매 파일마다 다시 계산합니다. 모르는 조각이 있으면 검토로 남깁니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {missing.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                실측으로 뽑은 권장 사전 {formatNumber(missing.length)}건이 아직
                없습니다. 라벨·색상·본품 기본 종류·키링 어휘입니다.
              </p>
              <Button
                type="button"
                size="sm"
                disabled={seedMutation.isPending}
                onClick={() => seedMutation.mutate()}
              >
                {seedMutation.isPending ? '등록 중...' : '권장 사전 등록'}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              권장 사전이 모두 등록돼 있습니다. 새 표기는 아래나 검토 화면에서
              추가하세요.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="패턴·종류·색상 검색"
              className="max-w-xs"
            />
            <Select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(
                  event.target.value as 'all' | InvoiceAccessoryRuleType,
                )
              }
              className="w-40"
            >
              <option value="all">종류 전체</option>
              {(Object.keys(INVOICE_ACCESSORY_RULE_TYPE_LABEL) as InvoiceAccessoryRuleType[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {INVOICE_ACCESSORY_RULE_TYPE_LABEL[value]}
                  </option>
                ),
              )}
            </Select>
            <Badge variant="muted">
              {formatNumber(ruleList.filter((item) => item.isActive).length)}건 활성
            </Badge>
          </div>

          {listQuery.isPending ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 사전이 없습니다.</p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[52rem] text-left text-xs">
                <thead className="sticky top-0 bg-muted/80">
                  <tr>
                    <th className="px-3 py-2 font-medium">종류</th>
                    <th className="px-3 py-2 font-medium">패턴</th>
                    <th className="px-3 py-2 font-medium">결과</th>
                    <th className="px-3 py-2 font-medium">메모</th>
                    <th className="px-3 py-2 font-medium">상태</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((rule) => (
                    <tr key={rule.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2">
                        {INVOICE_ACCESSORY_RULE_TYPE_LABEL[rule.ruleType]}
                      </td>
                      <td className="px-3 py-2 font-medium">{rule.pattern}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                        {ruleSummary(rule)}
                      </td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                        {rule.note || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={rule.isActive ? 'success' : 'muted'}>
                          {rule.isActive ? '활성' : '중지'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            toggleMutation.mutate({
                              id: rule.id,
                              isActive: !rule.isActive,
                            })
                          }
                        >
                          {rule.isActive ? '중지' : '재개'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(rule.id)}
                        >
                          삭제
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {seedMessage ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs">{seedMessage}</p>
          ) : null}
          {actionError ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
              {actionError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>사전 직접 등록</CardTitle>
          <CardDescription>
            새 표기나 쇼핑몰 어휘가 나오면 여기에 한 줄 더합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceAccessoryRuleForm
            brandId={brandId}
            onSaved={() => queryClient.invalidateQueries({ queryKey })}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export function InvoiceAccessoryRuleForm({
  brandId,
  initialPattern = '',
  initialType = 'token',
  onSaved,
}: {
  brandId: string
  initialPattern?: string
  initialType?: InvoiceAccessoryRuleType
  onSaved?: () => void
}) {
  const [ruleType, setRuleType] = useState<InvoiceAccessoryRuleType>(initialType)
  const [pattern, setPattern] = useState(initialPattern)
  const [accessoryKind, setAccessoryKind] = useState('')
  const [namePrefix, setNamePrefix] = useState('')
  const [colorName, setColorName] = useState('')
  const [style, setStyle] = useState<StyleRef | null>(null)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')

  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      saveInvoiceAccessoryRule(brandId, {
        ruleType,
        pattern,
        accessoryKind,
        namePrefix,
        colorName,
        targetStyleId: style?.styleId,
        note,
      }),
    onSuccess: async () => {
      setMessage('저장했습니다.')
      setPattern('')
      setNote('')
      setStyle(null)
      await queryClient.invalidateQueries({
        queryKey: ['invoice-accessory-rules', brandId],
      })
      onSaved?.()
    },
    onError: (reason) => {
      setMessage(reason instanceof Error ? reason.message : '저장하지 못했습니다.')
    },
  })

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={ruleType}
          onChange={(event) =>
            setRuleType(event.target.value as InvoiceAccessoryRuleType)
          }
          aria-label="사전 종류"
        >
          {(Object.keys(INVOICE_ACCESSORY_RULE_TYPE_LABEL) as InvoiceAccessoryRuleType[]).map(
            (value) => (
              <option key={value} value={value}>
                {INVOICE_ACCESSORY_RULE_TYPE_LABEL[value]}
              </option>
            ),
          )}
        </Select>
        <Input
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="패턴 (tassel, 레드 키링)"
        />
      </div>
      {ruleType === 'label' || ruleType === 'default' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={accessoryKind}
            onChange={(event) => setAccessoryKind(event.target.value)}
            placeholder="종류 (태슬)"
          />
          <Input
            value={namePrefix}
            onChange={(event) => setNamePrefix(event.target.value)}
            placeholder="상품명 접두어 (태슬 - )"
          />
        </div>
      ) : null}
      {ruleType === 'color' ? (
        <Input
          value={colorName}
          onChange={(event) => setColorName(event.target.value)}
          placeholder="한글 색상 (레드)"
        />
      ) : null}
      {ruleType === 'token' ? (
        <StylePicker
          brandId={brandId}
          value={style}
          onChange={setStyle}
          placeholder="구성품 M번호 검색"
        />
      ) : null}
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="메모 (선택)"
      />
      <div className="flex items-center justify-end gap-2">
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
        <Button
          type="button"
          size="sm"
          disabled={!pattern.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  )
}
