import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  getInvoiceAccessoryRules,
  getInvoiceItemNameRulesForItemNames,
  getInvoiceOptionMapsForCombos,
  getInvoiceProductNameExclusions,
  getInvoiceProductNameMapsForLookupKeys,
  getInvoiceProductNameTagRoles,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  listAllStyleRefs,
} from '@/lib/api'
import { emptyGiftSourcePlan } from '@/lib/invoice/gift-source-transform'
import { collectItemNameLookupTexts, collectOptionMapLookupCombos } from '@/lib/invoice/invoice-item-criteria-keys'
import {
  INVOICE_ITEM_NAME_RULES_WORK_QUERY_KEY,
  INVOICE_OPTION_MAPS_WORK_QUERY_KEY,
} from '@/lib/invoice/invoice-work-query-keys'
import {
  buildItemNameTransformIndex,
  type InvoiceItemNameTransformation,
} from '@/lib/invoice/item-name-transform'
import { type InvoiceProductNameStepResult } from '@/lib/invoice/invoice-step-transform'
import {
  computeInvoiceItemNameStep,
  computeInvoiceProductNameStep,
} from '@/lib/invoice/invoice-step-transform-worker'
import { parseSabangnetInvoiceFile } from '@/lib/invoice/parse-sabangnet'
import {
  collectProductNameCandidateTexts,
  invoiceLookupTextsSig,
} from '@/lib/invoice/product-name-patterns'
import {
  buildProductNameLookupIndex,
  catalogFromStyles,
} from '@/lib/invoice/product-name-transform'
import {
  isInvoiceMallReady,
  resolveInvoiceMalls,
} from '@/lib/invoice/mall-resolution'
import {
  assessSabangnetDataEntry,
  validateSabangnetUploadFile,
} from '@/lib/invoice/sabangnet-data-entry'
import type { SabangnetInspection } from '@/lib/invoice/sabangnet'
import type { StyleRef } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import {
  InvoiceFileCheckMallWork,
  InvoiceFileCheckTransformWork,
} from './InvoiceFileCheckWork'
import { InvoiceItemNameTransformPanel } from './InvoiceItemNameTransformPanel'
import { InvoiceMallResolutionDialog } from './InvoiceMallResolutionDialog'
import { InvoiceProductNameTransformPanel } from './InvoiceProductNameTransformPanel'
import { SabangnetOrderTable } from './SabangnetOrderTable'
import {
  shouldHoldInvoiceStepRecompute,
  shouldShowInvoiceStepBlockingState,
} from '@/lib/invoice/invoice-step-compute'
import {
  invoiceStepDepsKey,
  useHeldInvoiceStepDepsKey,
  useInvoiceStepCompute,
} from './useInvoiceStepCompute'

type DataEntryStep = 'upload' | 'check' | 'product' | 'item' | 'apply'

const DATA_ENTRY_STEPS: { value: DataEntryStep; label: string }[] = [
  { value: 'upload', label: '파일 올리기' },
  { value: 'check', label: '파일 확인' },
  { value: 'product', label: '품목명 변환' },
  { value: 'item', label: '내품명 변환' },
  { value: 'apply', label: '출고 반영' },
]

const DATA_ENTRY_STEP_INDEX: Record<DataEntryStep, number> = {
  upload: 0,
  check: 1,
  product: 2,
  item: 3,
  apply: 4,
}

const EMPTY_STYLE_REFS: StyleRef[] = []
const EMPTY_GIFT_SOURCE_PLAN = emptyGiftSourcePlan()
const CRITERIA_STALE_MS = 5 * 60_000

function SummaryItem({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function DataEntryStepProgress({
  stepIndex,
  maxStepIndex,
  onChange,
}: {
  stepIndex: number
  maxStepIndex: number
  onChange: (step: DataEntryStep) => void
}) {
  return (
    <div className="flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border pb-px">
      {DATA_ENTRY_STEPS.map((item, index) => {
        const active = index === stepIndex
        const reachable = index <= maxStepIndex
        return (
          <button
            key={item.value}
            type="button"
            disabled={!reachable}
            aria-current={active ? 'step' : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors',
              active
                ? 'border-border bg-card text-foreground'
                : reachable
                  ? 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  : 'border-transparent text-muted-foreground/40',
            )}
          >
            {index < stepIndex ? (
              <CheckCircle2 className="size-3.5 text-success" />
            ) : (
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-muted' : 'bg-muted/70',
                )}
              >
                {index + 1}
              </span>
            )}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

const DataEntryStepPanel = memo(function DataEntryStepPanel({
  active,
  keepMounted,
  children,
}: {
  active: boolean
  keepMounted: boolean
  children: ReactNode
}) {
  if (!keepMounted) return null
  return (
    <div hidden={!active} className={active ? undefined : 'hidden'}>
      {children}
    </div>
  )
})

function StepCriteriaLoading({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

function StepCriteriaError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        다시 불러오기
      </Button>
    </div>
  )
}

function StepCriteriaNotice({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  )
}

/** 사방넷 파일을 올려 출고 데이터용으로 점검·변환하는 임시 화면. */
export function InvoiceDataEntryPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const workspaceActive = useWorkspaceTabActivity()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<DataEntryStep>('upload')
  const [reachedStepIndex, setReachedStepIndex] = useState(0)
  const [inspection, setInspection] = useState<SabangnetInspection | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [visitedSteps, setVisitedSteps] = useState<Set<DataEntryStep>>(
    () => new Set(['upload']),
  )
  const [workGeneration, setWorkGeneration] = useState(0)
  const [productSaveBlockCount, setProductSaveBlockCount] = useState(0)
  const [productCriteriaRetrying, setProductCriteriaRetrying] = useState(false)
  const [itemCriteriaRetrying, setItemCriteriaRetrying] = useState(false)
  const [mallDialogOpen, setMallDialogOpen] = useState(false)
  const parseGenerationRef = useRef(0)
  const productCacheRef = useRef<InvoiceProductNameStepResult | null>(null)
  const itemCacheRef = useRef<InvoiceItemNameTransformation | null>(null)
  const mallAutoOpenedRef = useRef('')

  const assessment = useMemo(
    () => (inspection ? assessSabangnetDataEntry(inspection.rows) : null),
    [inspection],
  )
  const headerReady = Boolean(
    inspection && inspection.missingHeaders.length === 0,
  )
  const fileReady = Boolean(
    headerReady && assessment && assessment.blockingRowCount === 0,
  )
  const reachedProduct = reachedStepIndex >= DATA_ENTRY_STEP_INDEX.product
  const reachedItem = reachedStepIndex >= DATA_ENTRY_STEP_INDEX.item
  const reachedCheck = reachedStepIndex >= DATA_ENTRY_STEP_INDEX.check

  const criteriaQueryOptions = {
    staleTime: CRITERIA_STALE_MS,
    refetchOnWindowFocus: false,
  }

  const usageTargetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
    enabled: Boolean(inspection) && reachedCheck,
    ...criteriaQueryOptions,
  })
  const usageAliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
    enabled: Boolean(inspection) && reachedCheck,
    ...criteriaQueryOptions,
  })
  const usageFoldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
    enabled: Boolean(inspection) && reachedCheck,
    ...criteriaQueryOptions,
  })
  const usageTargets = useMemo(
    () => usageTargetsQuery.data ?? [],
    [usageTargetsQuery.data],
  )
  const usageAliases = useMemo(
    () => usageAliasesQuery.data ?? [],
    [usageAliasesQuery.data],
  )
  const usageFolders = useMemo(
    () => usageFoldersQuery.data ?? [],
    [usageFoldersQuery.data],
  )
  const mallResolution = useMemo(
    () =>
      inspection
        ? resolveInvoiceMalls(inspection.rows, usageTargets, usageAliases)
        : resolveInvoiceMalls([], [], []),
    [inspection, usageTargets, usageAliases],
  )
  const mallPartnersReady =
    !usageTargetsQuery.isPending &&
    !usageAliasesQuery.isPending &&
    !usageTargetsQuery.error &&
    !usageAliasesQuery.error
  const mallsReady = mallPartnersReady && isInvoiceMallReady(mallResolution)
  const maxStepIndex = !inspection
    ? 0
    : fileReady && mallsReady
      ? reachedStepIndex
      : Math.min(reachedStepIndex, DATA_ENTRY_STEP_INDEX.check)
  const stepIndex = Math.min(
    DATA_ENTRY_STEPS.findIndex((item) => item.value === step),
    maxStepIndex,
  )
  const activeStep = DATA_ENTRY_STEPS[stepIndex]!.value

  useEffect(() => {
    if (!inspection || !headerReady || !mallPartnersReady) return
    const autoKey = `${fileName}:${inspection.rowCount}:${mallResolution.unresolvedCount}`
    if (mallResolution.unresolvedCount === 0) {
      setMallDialogOpen(false)
      return
    }
    if (activeStep === 'check' && mallAutoOpenedRef.current !== autoKey) {
      mallAutoOpenedRef.current = autoKey
      setMallDialogOpen(true)
    }
  }, [
    activeStep,
    fileName,
    headerReady,
    inspection,
    mallPartnersReady,
    mallResolution.unresolvedCount,
  ])

  useEffect(() => {
    if (!fileReady) return
    void Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['invoice-product-name-tag-roles', brand.id],
        queryFn: () => getInvoiceProductNameTagRoles(brand.id),
        staleTime: CRITERIA_STALE_MS,
      }),
      queryClient.prefetchQuery({
        queryKey: ['invoice-product-name-exclusions', brand.id],
        queryFn: () => getInvoiceProductNameExclusions(brand.id),
        staleTime: CRITERIA_STALE_MS,
      }),
      queryClient.prefetchQuery({
        queryKey: ['invoice-product-name-all-styles', brand.id],
        queryFn: () => listAllStyleRefs(brand.id),
        staleTime: CRITERIA_STALE_MS,
      }),
    ])
  }, [brand.id, fileReady, queryClient])

  const productNameExclusionsQuery = useQuery({
    queryKey: ['invoice-product-name-exclusions', brand.id],
    queryFn: () => getInvoiceProductNameExclusions(brand.id),
    enabled: reachedProduct,
    ...criteriaQueryOptions,
  })
  const productNameTagRolesQuery = useQuery({
    queryKey: ['invoice-product-name-tag-roles', brand.id],
    queryFn: () => getInvoiceProductNameTagRoles(brand.id),
    enabled: fileReady || reachedProduct,
    ...criteriaQueryOptions,
  })
  const productNameExclusions = useMemo(
    () => productNameExclusionsQuery.data ?? [],
    [productNameExclusionsQuery.data],
  )
  const productNameTagRoles = useMemo(
    () => productNameTagRolesQuery.data ?? [],
    [productNameTagRolesQuery.data],
  )
  const productLookupTexts = useMemo(() => {
    if (!inspection) return []
    return collectProductNameCandidateTexts(
      inspection.rows,
      productNameTagRoles,
    )
  }, [inspection, productNameTagRoles])
  const productLookupTextSig = useMemo(
    () => invoiceLookupTextsSig(productLookupTexts),
    [productLookupTexts],
  )
  const workProductNameMapsQuery = useQuery({
    queryKey: [
      'invoice-product-name-maps-for-work',
      brand.id,
      productLookupTextSig,
    ],
    queryFn: () =>
      getInvoiceProductNameMapsForLookupKeys(brand.id, productLookupTexts),
    enabled:
      reachedProduct &&
      Boolean(inspection) &&
      productNameTagRolesQuery.isSuccess,
    ...criteriaQueryOptions,
  })
  const productNameMaps = useMemo(
    () => workProductNameMapsQuery.data ?? [],
    [workProductNameMapsQuery.data],
  )
  const productStyleLookupQuery = useQuery({
    queryKey: ['invoice-product-name-all-styles', brand.id],
    queryFn: () => listAllStyleRefs(brand.id),
    enabled: reachedProduct && Boolean(inspection),
    ...criteriaQueryOptions,
  })
  const deferredProductNameMaps = useDeferredValue(productNameMaps)
  const deferredProductNameExclusions = useDeferredValue(productNameExclusions)
  const deferredProductNameTagRoles = useDeferredValue(productNameTagRoles)
  const productQueriesReady =
    workProductNameMapsQuery.isSuccess &&
    productNameExclusionsQuery.isSuccess &&
    productNameTagRolesQuery.isSuccess &&
    productStyleLookupQuery.isSuccess
  const productNameMapsError =
    workProductNameMapsQuery.error instanceof Error
      ? workProductNameMapsQuery.error.message
      : workProductNameMapsQuery.error
        ? '품목명 변환 기준을 불러오지 못했습니다.'
        : null
  const productNameExclusionsError =
    productNameExclusionsQuery.error instanceof Error
      ? productNameExclusionsQuery.error.message
      : productNameExclusionsQuery.error
        ? '상품 연결 예외 기준을 불러오지 못했습니다.'
        : null
  const productMapsSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        deferredProductNameMaps.map(
          (map) => `${map.id}:${map.updatedAt}:${map.style?.styleId ?? ''}`,
        ),
      ),
    [deferredProductNameMaps],
  )
  const productExclusionContentSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        deferredProductNameExclusions.map(
          (item) => `${item.id}:${item.updatedAt}`,
        ),
      ),
    [deferredProductNameExclusions],
  )
  const productTagRoleSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        deferredProductNameTagRoles.map(
          (item) => `${item.id}:${item.role}:${item.updatedAt}`,
        ),
      ),
    [deferredProductNameTagRoles],
  )
  const productLookupIndex = useMemo(
    () =>
      buildProductNameLookupIndex(
        deferredProductNameMaps,
        deferredProductNameTagRoles,
      ),
    [deferredProductNameMaps, deferredProductNameTagRoles],
  )
  const productCatalog = useMemo(
    () => catalogFromStyles(productStyleLookupQuery.data ?? EMPTY_STYLE_REFS),
    [productStyleLookupQuery.data],
  )
  const fileResetKey = `${fileName}:${workGeneration}`
  const holdProductRecompute = shouldHoldInvoiceStepRecompute({
    saving: productSaveBlockCount > 0 || productCriteriaRetrying,
    criteriaSettled:
      productNameMaps === deferredProductNameMaps &&
      productNameExclusions === deferredProductNameExclusions &&
      productNameTagRoles === deferredProductNameTagRoles,
  })
  const liveProductDepsKey = invoiceStepDepsKey([
    fileName,
    workGeneration,
    inspection?.rowCount,
    productMapsSig,
    productExclusionContentSig,
    productTagRoleSig,
    productStyleLookupQuery.data?.length,
  ])
  const productHold = useHeldInvoiceStepDepsKey(
    liveProductDepsKey,
    holdProductRecompute,
    { record: productQueriesReady, resetKey: fileResetKey },
  )
  const productCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      productQueriesReady &&
      reachedProduct &&
      productHold.holdEnabled,
    depsKey: productHold.depsKey,
    resetKey: fileResetKey,
    label: 'data-entry-product-transform',
    compute: () =>
      computeInvoiceProductNameStep({
        sourceRows: inspection!.rows,
        maps: [],
        styles: [],
        tagRoles: deferredProductNameTagRoles,
        exclusions: deferredProductNameExclusions,
        giftSourcePlan: EMPTY_GIFT_SOURCE_PLAN,
        productLookupIndex,
        productCatalog,
      }),
  })
  if (productCompute.result) {
    productCacheRef.current = productCompute.result
  }
  const productTransformation =
    productCompute.result?.product ?? productCacheRef.current?.product ?? null

  const optionMapCombos = useMemo(
    () =>
      inspection
        ? collectOptionMapLookupCombos(
            inspection.rows,
            productTransformation?.rows,
          )
        : [],
    [inspection, productTransformation],
  )
  const optionMapComboSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        optionMapCombos.map(
          (combo) =>
            `${combo.mallName}\u0000${combo.productName}\u0000${combo.itemName}`,
        ),
      ),
    [optionMapCombos],
  )
  const itemNameLookupTexts = useMemo(
    () =>
      inspection
        ? collectItemNameLookupTexts(
            inspection.rows,
            productTransformation?.rows,
          )
        : [],
    [inspection, productTransformation],
  )
  const itemNameLookupSig = useMemo(
    () => invoiceLookupTextsSig(itemNameLookupTexts),
    [itemNameLookupTexts],
  )
  const workOptionMapsQuery = useQuery({
    queryKey: [INVOICE_OPTION_MAPS_WORK_QUERY_KEY, brand.id, optionMapComboSig],
    queryFn: () => getInvoiceOptionMapsForCombos(brand.id, optionMapCombos),
    enabled:
      reachedItem && Boolean(inspection) && Boolean(productTransformation),
    ...criteriaQueryOptions,
  })
  const workItemNameRulesQuery = useQuery({
    queryKey: [
      INVOICE_ITEM_NAME_RULES_WORK_QUERY_KEY,
      brand.id,
      itemNameLookupSig,
    ],
    queryFn: () =>
      getInvoiceItemNameRulesForItemNames(brand.id, itemNameLookupTexts),
    enabled:
      reachedItem && Boolean(inspection) && Boolean(productTransformation),
    ...criteriaQueryOptions,
  })
  const accessoryRulesQuery = useQuery({
    queryKey: ['invoice-accessory-rules', brand.id],
    queryFn: () => getInvoiceAccessoryRules(brand.id, true),
    enabled: reachedItem,
    ...criteriaQueryOptions,
  })
  const optionMaps = useMemo(
    () => workOptionMapsQuery.data ?? [],
    [workOptionMapsQuery.data],
  )
  const itemNameRules = useMemo(
    () => workItemNameRulesQuery.data ?? [],
    [workItemNameRulesQuery.data],
  )
  const accessoryRules = useMemo(
    () => accessoryRulesQuery.data ?? [],
    [accessoryRulesQuery.data],
  )
  const deferredOptionMaps = useDeferredValue(optionMaps)
  const deferredItemNameRules = useDeferredValue(itemNameRules)
  const deferredAccessoryRules = useDeferredValue(accessoryRules)
  const optionMapsError = workOptionMapsQuery.error
    ? workOptionMapsQuery.error instanceof Error
      ? workOptionMapsQuery.error.message
      : '내품명 변환 기준을 불러오지 못했습니다.'
    : null
  const itemNameRulesError = workItemNameRulesQuery.error
    ? workItemNameRulesQuery.error instanceof Error
      ? workItemNameRulesQuery.error.message
      : '내품명 규칙을 불러오지 못했습니다.'
    : null
  const accessoryRulesError =
    accessoryRulesQuery.error instanceof Error
      ? accessoryRulesQuery.error.message
      : accessoryRulesQuery.error
        ? '부속품 사전을 불러오지 못했습니다.'
        : null
  const itemNameCriteriaError =
    optionMapsError || itemNameRulesError || accessoryRulesError
  const itemNameCriteriaLoading =
    workOptionMapsQuery.isLoading ||
    workItemNameRulesQuery.isLoading ||
    accessoryRulesQuery.isLoading
  const itemQueriesReady =
    workOptionMapsQuery.isSuccess &&
    workItemNameRulesQuery.isSuccess &&
    accessoryRulesQuery.isSuccess &&
    productStyleLookupQuery.isSuccess
  const optionMapsContentSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        deferredOptionMaps.map((map) => `${map.id}:${map.updatedAt}`),
      ),
    [deferredOptionMaps],
  )
  const itemNameRulesContentSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        deferredItemNameRules.map((rule) => `${rule.id}:${rule.updatedAt}`),
      ),
    [deferredItemNameRules],
  )
  const itemNameIndex = useMemo(
    () =>
      buildItemNameTransformIndex(
        deferredOptionMaps,
        deferredItemNameRules,
        productStyleLookupQuery.data ?? EMPTY_STYLE_REFS,
      ),
    [deferredItemNameRules, deferredOptionMaps, productStyleLookupQuery.data],
  )
  const holdItemRecompute = shouldHoldInvoiceStepRecompute({
    saving: productSaveBlockCount > 0 || itemCriteriaRetrying,
    criteriaSettled:
      optionMaps === deferredOptionMaps &&
      itemNameRules === deferredItemNameRules &&
      accessoryRules === deferredAccessoryRules,
  })
  const liveItemDepsKey = invoiceStepDepsKey([
    fileName,
    workGeneration,
    productTransformation?.mappedRowCount,
    productTransformation?.unresolvedRowCount,
    productTransformation?.excludedRowCount,
    optionMapsContentSig,
    itemNameRulesContentSig,
    accessoryRulesQuery.dataUpdatedAt,
    deferredAccessoryRules.length,
    productStyleLookupQuery.data?.length,
  ])
  const itemHold = useHeldInvoiceStepDepsKey(liveItemDepsKey, holdItemRecompute, {
    record: itemQueriesReady,
    resetKey: fileResetKey,
  })
  const itemCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      itemQueriesReady &&
      productCompute.status === 'ready' &&
      reachedItem &&
      itemHold.holdEnabled,
    depsKey: itemHold.depsKey,
    resetKey: fileResetKey,
    label: 'data-entry-item-transform',
    compute: () => {
      if (!inspection || !productTransformation) {
        throw new Error('내품명 변환 기준이 아직 준비되지 않았습니다.')
      }
      return computeInvoiceItemNameStep({
        sourceRows: inspection.rows,
        optionMaps: [],
        productRows: productTransformation.rows,
        itemNameRules: [],
        accessoryRules: deferredAccessoryRules,
        styles: [],
        itemNameIndex,
      })
    },
  })
  if (itemCompute.result) {
    itemCacheRef.current = itemCompute.result
  }
  const itemTransformation = itemCompute.result ?? itemCacheRef.current
  const productCriteriaLoading =
    workProductNameMapsQuery.isLoading ||
    productNameExclusionsQuery.isLoading ||
    productNameTagRolesQuery.isLoading ||
    productStyleLookupQuery.isLoading
  const productStepError =
    productNameMapsError ||
    productNameExclusionsError ||
    productCompute.error ||
    (productNameTagRolesQuery.error
      ? '품목명 태그 역할을 불러오지 못했습니다.'
      : productStyleLookupQuery.error instanceof Error
        ? productStyleLookupQuery.error.message
        : productStyleLookupQuery.error
          ? '상품 마스터를 대조하지 못했습니다.'
          : null)
  const productStepBlock = shouldShowInvoiceStepBlockingState({
    hasResult: Boolean(productTransformation),
    computing:
      productCriteriaLoading || productCompute.status === 'computing',
    hasError: Boolean(productStepError),
  })
  const retryProductStep = () => {
    setProductCriteriaRetrying(true)
    void Promise.allSettled([
      workProductNameMapsQuery.refetch(),
      productNameExclusionsQuery.refetch(),
      productNameTagRolesQuery.refetch(),
      productStyleLookupQuery.refetch(),
    ]).then(() => {
      setProductCriteriaRetrying(false)
      productCompute.retry()
    })
  }
  const itemStepError = itemNameCriteriaError || itemCompute.error || null
  const itemStepBlock = shouldShowInvoiceStepBlockingState({
    hasResult: Boolean(itemTransformation),
    computing:
      itemNameCriteriaLoading || itemCompute.status === 'computing',
    hasError: Boolean(itemStepError),
  })
  const retryItemStep = () => {
    setItemCriteriaRetrying(true)
    void Promise.allSettled([
      workOptionMapsQuery.refetch(),
      workItemNameRulesQuery.refetch(),
      accessoryRulesQuery.refetch(),
    ]).then(() => {
      setItemCriteriaRetrying(false)
      itemCompute.retry()
    })
  }

  function markVisited(next: DataEntryStep) {
    setVisitedSteps((current) => {
      if (current.has(next)) return current
      const updated = new Set(current)
      updated.add(next)
      return updated
    })
  }

  function changeStep(next: DataEntryStep) {
    if (DATA_ENTRY_STEP_INDEX[next] > maxStepIndex) return
    if (step === 'product' && next !== 'product' && productSaveBlockCount > 0) {
      return
    }
    markVisited(next)
    setStep(next)
  }

  function goNextStep(next: DataEntryStep) {
    if (step === 'product' && next !== 'product' && productSaveBlockCount > 0) {
      return
    }
    setReachedStepIndex((current) =>
      Math.max(current, DATA_ENTRY_STEP_INDEX[next]),
    )
    markVisited(next)
    setStep(next)
  }

  function resetFile() {
    parseGenerationRef.current += 1
    setWorkGeneration(parseGenerationRef.current)
    productCacheRef.current = null
    itemCacheRef.current = null
    setProductSaveBlockCount(0)
    setProductCriteriaRetrying(false)
    setItemCriteriaRetrying(false)
    setInspection(null)
    setFileName('')
    setError(null)
    setIsParsing(false)
    setReachedStepIndex(0)
    setVisitedSteps(new Set(['upload']))
    setStep('upload')
    setMallDialogOpen(false)
    mallAutoOpenedRef.current = ''
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    const validationError = validateSabangnetUploadFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    parseGenerationRef.current += 1
    const generation = parseGenerationRef.current
    setWorkGeneration(generation)
    productCacheRef.current = null
    itemCacheRef.current = null
    setProductSaveBlockCount(0)
    setProductCriteriaRetrying(false)
    setItemCriteriaRetrying(false)
    setIsParsing(true)
    setError(null)
    setInspection(null)
    setFileName(file.name)
    setReachedStepIndex(0)
    setVisitedSteps(new Set(['upload']))
    setStep('upload')
    setMallDialogOpen(false)
    mallAutoOpenedRef.current = ''

    try {
      const nextInspection = await parseSabangnetInvoiceFile(file)
      if (generation !== parseGenerationRef.current) return
      setInspection(nextInspection)
      setReachedStepIndex(DATA_ENTRY_STEP_INDEX.check)
      markVisited('check')
      setStep('check')
    } catch (reason) {
      if (generation !== parseGenerationRef.current) return
      setError(
        reason instanceof Error
          ? reason.message
          : '파일을 읽지 못했습니다. 사방넷 원본 엑셀인지 확인해주세요.',
      )
    } finally {
      if (generation === parseGenerationRef.current) {
        setIsParsing(false)
      }
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <PageHeader
        title="(임시) 송장데이터 입력"
        description={`${brand.name} 사방넷 파일에서 업체별 상품 출고 데이터를 넣습니다. 받는분 성명·연락처·주소·배송메세지는 없어도 됩니다.`}
      />

      <div className="space-y-4">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <DataEntryStepProgress
            stepIndex={stepIndex}
            maxStepIndex={maxStepIndex}
            onChange={changeStep}
          />
        </div>

        <DataEntryStepPanel
          active={activeStep === 'upload'}
          keepMounted={visitedSteps.has('upload')}
        >
          <Card>
            <CardHeader>
              <CardTitle>사방넷 파일 올리기</CardTitle>
              <CardDescription>
                사방넷에서 받은 운송장출력용 엑셀을 그대로 올려주세요. 출고
                데이터만 쓰므로 받는분 개인정보가 비어 있어도 됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                aria-busy={isParsing}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    inputRef.current?.click()
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                  void handleFile(event.dataTransfer.files[0])
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-muted/20 hover:bg-muted/40',
                )}
              >
                <div className="flex size-11 items-center justify-center rounded-full bg-muted">
                  {isParsing ? (
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {isParsing
                      ? '파일을 확인하고 있습니다...'
                      : '엑셀 파일을 여기에 놓으세요'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    또는 눌러서 파일 선택 · XLSX, XLS · 최대 50MB
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isParsing}
                  onClick={(event) => {
                    event.stopPropagation()
                    inputRef.current?.click()
                  }}
                >
                  <FileSpreadsheet className="size-4" />
                  {isParsing ? '읽는 중...' : '사방넷 파일 선택'}
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  className="hidden"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
              </div>

              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <p>
                  받는 분 이름·전화번호·주소는 없어도 되고, 있어도 서버에
                  올리거나 저장하지 않습니다.
                </p>
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {inspection ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <p className="min-w-0 truncate text-xs text-muted-foreground">
                    올린 파일 · {fileName}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={resetFile}>
                      파일 바꾸기
                    </Button>
                    <Button type="button" onClick={() => changeStep('check')}>
                      파일 확인으로
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </DataEntryStepPanel>

        <DataEntryStepPanel
          active={activeStep === 'check'}
          keepMounted={visitedSteps.has('check') && Boolean(inspection)}
        >
          {inspection && assessment ? (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>파일 점검 결과</CardTitle>
                    <Badge
                      variant={
                        fileReady
                          ? 'success'
                          : headerReady
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {fileReady
                        ? '출고 데이터 형식 확인 완료'
                        : headerReady
                          ? '일부 행 확인 필요'
                          : '다른 형식의 파일'}
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">
                    {fileName} · {inspection.sheetName} 시트 · 헤더{' '}
                    {inspection.headerRowNumber}행
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={resetFile}>
                  파일 바꾸기
                </Button>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryItem
                    label="불러온 상품 행"
                    value={`${formatNumber(inspection.rowCount)}행`}
                  />
                  <SummaryItem
                    label="고유 주문번호"
                    value={`${formatNumber(inspection.orderCount)}건`}
                    tone="success"
                  />
                  <SummaryItem
                    label="쇼핑몰명 연결 필요"
                    value={
                      mallPartnersReady
                        ? `${formatNumber(mallResolution.unresolvedCount)}곳`
                        : '…'
                    }
                    tone={
                      !mallPartnersReady
                        ? 'default'
                        : mallResolution.unresolvedCount > 0
                          ? 'warning'
                          : 'success'
                    }
                  />
                  <SummaryItem
                    label="출고 필수값 확인 필요"
                    value={`${formatNumber(assessment.blockingRowCount)}행`}
                    tone={
                      assessment.blockingRowCount > 0 ? 'danger' : 'success'
                    }
                  />
                </div>

                {inspection.missingHeaders.length > 0 ? (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div>
                        <p className="text-sm font-medium text-danger">
                          사방넷 필수 항목을 찾지 못했습니다.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          빠진 항목: {inspection.missingHeaders.join(', ')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : assessment.blockingRowCount > 0 ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      <div>
                        <p className="text-sm font-medium">
                          출고 데이터를 확인해주세요.
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          품목명 없음 {assessment.missingProductNameCount}행 ·
                          업체 없음 {assessment.missingMallCount}행 · 주문일시
                          오류 {assessment.missingOrderedAtCount}행 · 수량 오류{' '}
                          {assessment.invalidQuantityCount}행
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-4">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    <div>
                      <p className="text-sm font-medium text-success">
                        출고 데이터용 사방넷 파일로 확인했습니다.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        품목명·수량·쇼핑몰명·주문일시가 있습니다. 받는분
                        개인정보가 비어 있는 행은{' '}
                        {formatNumber(assessment.emptyShippingCount)}행이며
                        이번 화면에서는 막지 않습니다.
                      </p>
                    </div>
                  </div>
                )}

                {headerReady ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <InvoiceFileCheckTransformWork
                      missingProductCodeCount={
                        inspection.missingProductCodeCount
                      }
                      nextStepLabel="다음 품목명·내품명 변환"
                    />
                    <InvoiceFileCheckMallWork
                      resolution={mallResolution}
                      partnersReady={mallPartnersReady}
                      partnersError={Boolean(
                        usageTargetsQuery.error || usageAliasesQuery.error,
                      )}
                      blockLabel="품목명 변환으로 갈 수 없습니다."
                      onOpen={() => setMallDialogOpen(true)}
                    />
                  </div>
                ) : null}

                <SabangnetOrderTable
                  rows={inspection.rows}
                  columnCount={inspection.columnCount}
                />

                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={!fileReady || !mallsReady}
                    onClick={() => goNextStep('product')}
                  >
                    품목명 변환으로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </DataEntryStepPanel>

        <DataEntryStepPanel
          active={activeStep === 'product'}
          keepMounted={reachedProduct && Boolean(inspection) && fileReady}
        >
          {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>품목명 변환</CardTitle>
                <CardDescription>
                  송장작업과 같은 품목명 원장·예외·태그 역할로 본품 공식명을
                  맞춥니다. 사은품 배정은 이 화면에서 하지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {productStepBlock === 'loading' ? (
                  <StepCriteriaLoading
                    label={
                      productQueriesReady
                        ? '이 파일의 품목명 변환을 계산하고 있습니다.'
                        : '이 브랜드의 품목명 변환 기준을 불러오고 있습니다.'
                    }
                  />
                ) : productStepBlock === 'error' ? (
                  <StepCriteriaError
                    message={
                      productStepError ||
                      '품목명 변환을 계산하지 못했습니다.'
                    }
                    onRetry={retryProductStep}
                  />
                ) : productTransformation ? (
                  <>
                    {productStepError ? (
                      <StepCriteriaNotice
                        message={productStepError}
                        onRetry={retryProductStep}
                      />
                    ) : productCompute.status === 'computing' ? (
                      <p className="text-sm text-muted-foreground">
                        품목명 변환을 다시 계산하고 있습니다.
                      </p>
                    ) : null}
                    <InvoiceProductNameTransformPanel
                      key={`${fileName}:${workGeneration}`}
                      brandId={brand.id}
                      transformation={productTransformation}
                      renderUi={activeStep === 'product' && workspaceActive}
                      autoCollect={false}
                      autoCollectKey={`${fileName}:${workGeneration}`}
                      onBlockingSaveCountChange={setProductSaveBlockCount}
                      giftGroups={[]}
                    />
                  </>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={productSaveBlockCount > 0}
                    onClick={() => changeStep('check')}
                  >
                    <ArrowLeft className="size-4" />
                    파일 확인으로
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      !productTransformation || productSaveBlockCount > 0
                    }
                    onClick={() => goNextStep('item')}
                  >
                    내품명 변환으로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </DataEntryStepPanel>

        <DataEntryStepPanel
          active={activeStep === 'item'}
          keepMounted={
            reachedItem &&
            Boolean(inspection) &&
            fileReady &&
            Boolean(productTransformation)
          }
        >
          {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>내품명 변환</CardTitle>
                <CardDescription>
                  송장작업과 같은 내품명 규칙·구성품·부속품 사전으로 남은
                  내품명을 정리합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {itemStepBlock === 'loading' ? (
                  <StepCriteriaLoading
                    label={
                      itemQueriesReady
                        ? '이 파일의 내품명 변환을 계산하고 있습니다.'
                        : '이 브랜드의 내품명 변환 기준을 불러오고 있습니다.'
                    }
                  />
                ) : itemStepBlock === 'error' ? (
                  <StepCriteriaError
                    message={
                      itemStepError || '내품명 변환을 계산하지 못했습니다.'
                    }
                    onRetry={retryItemStep}
                  />
                ) : itemTransformation ? (
                  <>
                    {itemStepError ? (
                      <StepCriteriaNotice
                        message={itemStepError}
                        onRetry={retryItemStep}
                      />
                    ) : itemCompute.status === 'computing' ? (
                      <p className="text-sm text-muted-foreground">
                        내품명 변환을 다시 계산하고 있습니다.
                      </p>
                    ) : null}
                    <InvoiceItemNameTransformPanel
                      key={`${fileName}:${workGeneration}`}
                      brandId={brand.id}
                      brandName={brand.name}
                      transformation={itemTransformation}
                      itemNameRules={itemNameRules}
                      accessoryRules={accessoryRules}
                      styles={productStyleLookupQuery.data ?? EMPTY_STYLE_REFS}
                      renderUi={activeStep === 'item' && workspaceActive}
                      autoCollect={false}
                      autoCollectKey={`${fileName}:${workGeneration}`}
                    />
                  </>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => changeStep('product')}
                  >
                    <ArrowLeft className="size-4" />
                    품목명 변환으로
                  </Button>
                  <Button
                    type="button"
                    disabled={!itemTransformation}
                    onClick={() => goNextStep('apply')}
                  >
                    출고 반영으로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </DataEntryStepPanel>

        <DataEntryStepPanel
          active={activeStep === 'apply'}
          keepMounted={visitedSteps.has('apply') && fileReady}
        >
          <Card>
            <CardHeader>
              <CardTitle>출고 반영</CardTitle>
              <CardDescription>
                변환된 공식 상품을 업체·주문일 기준으로 운영 현황 출고 데이터에
                넣는 단계입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                이번 단계의 저장은 아직 연결하지 않았습니다. 화면만 열어 둔
                상태입니다.
              </div>
              <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
                <p className="font-medium">이후 반영 기준</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  포함할 상품: 본품·구성품·사은품·포장재
                  <br />
                  중복 제외: 고객주문번호 + 쇼핑몰명 + 주문일시가 같은 값은
                  다시 올리지 않음
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="button" disabled>
                  출고 데이터에 반영
                </Button>
              </div>
            </CardContent>
          </Card>
        </DataEntryStepPanel>
      </div>

      {workspaceActive && mallDialogOpen && inspection ? (
        <InvoiceMallResolutionDialog
          brandId={brand.id}
          brandSlug={brand.slug}
          sites={mallResolution.sites}
          targets={usageTargets}
          aliases={usageAliases}
          folders={usageFolders}
          onClose={() => setMallDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}
