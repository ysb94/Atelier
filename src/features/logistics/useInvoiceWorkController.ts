import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { useBrand } from '@/components/layout/brand-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'

import {
  buildFolderForest,
  filterOutboundPartnersByCategory,
  OUTBOUND_UNFILED_CATEGORY,
} from '@/lib/codes/outbound-folder'

import { saveInvoiceGiftSourceMap, backupInvoiceOutboundWork } from '@/lib/api'

import { parseSabangnetInvoiceFile } from '@/lib/invoice/parse-sabangnet'

import { createGiftSeed } from '@/lib/invoice/gift-assign'

import { buildInvoiceOutputRows } from '@/lib/invoice/invoice-output'
import {
  buildOutgoingComponentRowsFromStages,
  buildItemNameTransformIndex,
  type InvoiceItemNameTransformation,
} from '@/lib/invoice/item-name-transform'
import {
  buildOutboundReflectLedger,
  formatOutboundReflectBlockReasons,
  summarizeOutboundReflectProducts,
} from '@/lib/invoice/outbound-reflect-summary'
import {
  computeInvoiceItemNameStep,
  computeInvoiceProductNameStep,
} from '@/lib/invoice/invoice-step-transform-worker'
import {
  runInvoiceItemNameStep,
  type InvoiceProductNameStepResult,
} from '@/lib/invoice/invoice-step-transform'
import {
  buildStockHoldCandidateBundles,
  excludedRowNumbersFromStockHoldBundles,
} from '@/lib/invoice/stock-hold-match'
import { transformInvoiceNamesByCode } from '@/lib/invoice/name-transform'
import {
  createInvoiceWorkJob,
  finishInvoiceWorkJob,
  logInvoiceWork,
  markInvoiceWorkStage,
  timeInvoiceWork,
  type InvoiceWorkJob,
} from '@/lib/invoice/invoice-work-perf'
import {
  collectItemNameLookupTexts,
  collectOptionMapLookupCombos,
} from '@/lib/invoice/invoice-item-criteria-keys'

import { collectProductNameCandidateTexts, invoiceLookupTextsSig } from '@/lib/invoice/product-name-patterns'
import {
  applyProductNameExclusions,
  applyProductNameMapDelta,
  buildProductNameLookupIndex,
  catalogFromStyles,
  overlayGiftSourceOnProductNames,
} from '@/lib/invoice/product-name-transform'
import {
  collectGiftSourceSlots,
  effectiveGiftSourceAppliedKeys,
  emptyGiftSourcePlan,
  giftSourceGroupKey,
  inspectGiftSourceGroup,
  type GiftSourceGroup,
  type GiftSourceSessionRule,
} from '@/lib/invoice/gift-source-transform'
import { planUnifiedGifts } from '@/lib/invoice/gift-unified'
import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import {
  collectInvoiceOrderKeyGroups,
  expandBackedUpExclusionWithProductNameExceptions,
  filterRowsByExcludedNumbers,
  hashInvoiceOrderKeyPayloads,
  type InvoiceOrderKeyMatch,
} from '@/lib/invoice/invoice-order-key'
import {
  countUniqueInvoiceOrders,
  fingerprintInvoiceWorkRows,
  isInvoiceMallReady,
  resolveInvoiceMalls,
  summarizeInvoiceWorkSites,
} from '@/lib/invoice/mall-resolution'
import { PRODUCT_OUTBOUND_UPDATED_EVENT } from '@/lib/outbound/product-outbound'
import { type SabangnetInspection, type SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import { buildWorkInstructionIndex, planWorkInstructions } from '@/lib/invoice/work-instruction-transform'
import type { StyleRef } from '@/lib/types'

import { emptyList, formatNumber } from '@/lib/utils'

import {
  canLeaveInvoiceFileCheck,
  INVOICE_BACKUP_LOOKUP_BUSY_LABEL,
  invoiceBackedUpExcludedRowNumbers,
  isInvoiceBackupLookupReady,
  isInvoicePreConfirmReady,
  isInvoicePreloadFlowReady,
  isInvoiceWorkFlowReady,
  shouldAutoCollectInvoiceAi,
  shouldAutoOpenInvoiceBackupDialog,
  shouldFinishInvoiceUploadPipeline,
  shouldHoldInvoiceStepRecompute,
  shouldRunDeferredInvoiceStep,
  shouldShowInvoiceStepBlockingState,
} from '@/lib/invoice/invoice-step-compute'
import { invoiceStepDepsKey, useHeldInvoiceStepDepsKey, useInvoiceStepCompute } from './useInvoiceStepCompute'
import {
  useInvoiceBaseCriteria,
  useInvoiceBackupCriteria,
  useInvoiceProductMapCriteria,
  useInvoiceGiftSourceCriteria,
  useInvoiceStyleCriteria,
  useInvoiceItemCriteria,
  useInvoiceLaterStageCriteria,
} from './useInvoiceWorkCriteria'
import {
  EMPTY_STYLE_REFS,
  isInvoiceView,
  TODAY_STEPS,
  TODAY_STEP_INDEX,
  IDLE_UPLOAD_AI,
  PENDING_UPLOAD_AI,
  isStepComputeSettled,
  type InvoiceView,
  type TodayStep,
  type UploadAiProgress,
} from './invoice-work-steps'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const EMPTY_ORDER_KEY_MATCH: InvoiceOrderKeyMatch = {
  orderCount: 0,
  rowCount: 0,
  rowNumbers: [],
  hashes: [],
}

// 송장 작업의 상태·계산·검수·단계 이동을 제어한다. 훅 호출 순서와 확정 조건을 유지한다.
export function useInvoiceWorkController() {
  const { brand } = useBrand()
  const workspaceActive = useWorkspaceTabActivity()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: InvoiceView = isInvoiceView(requestedView)
    ? requestedView
    : 'today'
  const inputRef = useRef<HTMLInputElement>(null)
  const workGenerationRef = useRef(0)
  const workJobRef = useRef<InvoiceWorkJob | null>(null)
  const [workGeneration, setWorkGeneration] = useState(0)
  const [step, setStep] = useState<TodayStep>('upload')
  const [isStepPending, startStepTransition] = useTransition()
  const [reachedStepIndex, setReachedStepIndex] = useState(0)
  const [giftExclusionSig, setGiftExclusionSig] = useState('')
  const [inspection, setInspection] = useState<SabangnetInspection | null>(null)
  const [fileName, setFileName] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [uploadPipeline, setUploadPipeline] = useState(false)
  const [productAiPipeline, setProductAiPipeline] =
    useState<UploadAiProgress>(IDLE_UPLOAD_AI)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [productSaveBlockCount, setProductSaveBlockCount] = useState(0)
  const [productCriteriaRetrying, setProductCriteriaRetrying] = useState(false)
  const [itemCriteriaRetrying, setItemCriteriaRetrying] = useState(false)
  const [mallDialogOpen, setMallDialogOpen] = useState(false)
  const [mallCategoryKey, setMallCategoryKey] = useState('')
  const [mallCategoryLocked, setMallCategoryLocked] = useState(false)
  const [outboundBackupBusy, setOutboundBackupBusy] = useState(false)
  const [outboundBackupMessage, setOutboundBackupMessage] = useState<
    string | null
  >(null)
  const [outboundBackupIsError, setOutboundBackupIsError] = useState(false)
  const [currentGenerationBackedUp, setCurrentGenerationBackedUp] =
    useState(false)
  const [backedUpExclusionAccepted, setBackedUpExclusionAccepted] =
    useState(false)
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const mallAutoOpenedRef = useRef<string | null>(null)
  const backupDialogAutoKeyRef = useRef<string | null>(null)
  const rulesView = activeView === 'rules'
  const reachedGift = reachedStepIndex >= TODAY_STEP_INDEX.gift
  const reachedInstruction = reachedStepIndex >= TODAY_STEP_INDEX.instruction
  const reachedProduct = reachedStepIndex >= TODAY_STEP_INDEX.product
  const reachedItem = reachedStepIndex >= TODAY_STEP_INDEX.item
  const reachedOutboundReflect =
    reachedStepIndex >= TODAY_STEP_INDEX.outboundReflect
  const reachedStock = reachedStepIndex >= TODAY_STEP_INDEX.stock
  const criteriaSnapshot = uploadPipeline
  const { criteriaQueryOptions, nameRulesQuery, optionMapsQuery, itemNameRulesQuery, accessoryRulesQuery, rulesProductNameMapsQuery, productNameExclusionsQuery, productNameTagRolesQuery, preorderHoldsQuery, discontinuedStylesQuery, usageTargetsQuery, usageAliasesQuery, usageFoldersQuery, giftRequestsQuery, giftAllocationsQuery, workInstructionsQuery, giftSourceMapsQuery } = useInvoiceBaseCriteria({ criteriaSnapshot, queryClient, brand, rulesView, reachedProduct, reachedItem, inspection, reachedGift, reachedStock, reachedStepIndex, reachedInstruction })
  const giftRequests = useMemo(
    () => giftRequestsQuery.data ?? [],
    [giftRequestsQuery.data],
  )
  const giftAllocations = useMemo(
    () => giftAllocationsQuery.data ?? [],
    [giftAllocationsQuery.data],
  )
  const workInstructions = useMemo(
    () => workInstructionsQuery.data ?? [],
    [workInstructionsQuery.data],
  )
  const giftRequestsError =
    giftRequestsQuery.error instanceof Error
      ? giftRequestsQuery.error.message
      : giftRequestsQuery.error
        ? '사은품 증정 요청 건을 불러오지 못했습니다.'
        : null
  const giftSourceMapsError =
    giftSourceMapsQuery.error instanceof Error
      ? giftSourceMapsQuery.error.message
      : giftSourceMapsQuery.error
        ? '품목명 대체 매핑을 불러오지 못했습니다.'
        : null
  const workInstructionsError =
    workInstructionsQuery.error instanceof Error
      ? workInstructionsQuery.error.message
      : workInstructionsQuery.error
        ? '작업 지시를 불러오지 못했습니다.'
        : null
  // 기간이 겹치는 사은품 요청 건이 둘 이상일 때 사용자가 고른 값. 단계를 옮겨도 유지한다.
  const [giftResolutions, setGiftResolutions] = useState<
    Record<string, string>
  >({})
  const [giftSeed, setGiftSeed] = useState(createGiftSeed)
  const [excludedGiftStyleIds, setExcludedGiftStyleIds] = useState<string[]>(
    [],
  )
  const [stockHoldExcludedOverride, setStockHoldExcludedOverride] = useState<
    number[] | null
  >(null)
  const handleStockHoldExcludedChange = useCallback((rowNumbers: number[]) => {
    setStockHoldExcludedOverride((current) =>
      current &&
      current.length === rowNumbers.length &&
      current.every((value, index) => value === rowNumbers[index])
        ? current
        : rowNumbers,
    )
  }, [])
  const [giftSourceSessionRules, setGiftSourceSessionRules] = useState<
    Record<string, GiftSourceSessionRule>
  >({})
  const [giftSourceSessionAllocations, setGiftSourceSessionAllocations] =
    useState<Record<string, StyleRef>>({})
  const [giftSourceIgnoredKeys, setGiftSourceIgnoredKeys] = useState<string[]>(
    [],
  )
  const [giftSourceApplyingKey, setGiftSourceApplyingKey] = useState<
    string | null
  >(null)
  const [giftSourceError, setGiftSourceError] = useState<string | null>(null)
  const [giftSourceAppliedKeys, setGiftSourceAppliedKeys] = useState<string[]>(
    [],
  )
  const [giftSetupTarget, setGiftSetupTarget] = useState<{
    mallName: string
    productName: string
  } | null>(null)
  const nameRules = useMemo(
    () => nameRulesQuery.data ?? [],
    [nameRulesQuery.data],
  )
  const activeNameRules = useMemo(
    () =>
      nameRules.filter(
        (rule) =>
          rule.isActive &&
          !rule.isTest &&
          rule.matchType === 'own_product_code',
      ),
    [nameRules],
  )
  const orderKeyGroups = useMemo(
    () => collectInvoiceOrderKeyGroups(inspection?.rows ?? []),
    [inspection],
  )
  const orderKeyPayloadSig = useMemo(
    () => orderKeyGroups.map((group) => group.payload).join('\n'),
    [orderKeyGroups],
  )
  const { backedUpLookupQuery } = useInvoiceBackupCriteria({ brand, workGeneration, orderKeyPayloadSig, orderKeyGroups, inspection, currentGenerationBackedUp })
  const backedUpLookupMatch =
    orderKeyGroups.length === 0
      ? EMPTY_ORDER_KEY_MATCH
      : (backedUpLookupQuery.data ?? null)
  const backedUpMatch = useMemo(() => {
    if (!backedUpLookupMatch) return null
    if (
      !inspection ||
      backedUpLookupMatch.rowCount === 0 ||
      !productNameExclusionsQuery.isSuccess
    ) {
      return backedUpLookupMatch
    }
    return expandBackedUpExclusionWithProductNameExceptions({
      rows: inspection.rows,
      match: backedUpLookupMatch,
      exclusions: productNameExclusionsQuery.data ?? emptyList(),
    })
  }, [
    backedUpLookupMatch,
    inspection,
    productNameExclusionsQuery.data,
    productNameExclusionsQuery.isSuccess,
  ])
  const hasBackedUpMatch = (backedUpMatch?.orderCount ?? 0) > 0
  const backupLookupReady = isInvoiceBackupLookupReady({
    hasInspection: Boolean(inspection),
    lookupNeeded: orderKeyGroups.length > 0 && !currentGenerationBackedUp,
    lookupSuccess: backedUpLookupQuery.isSuccess,
    exclusionCriteriaSuccess: productNameExclusionsQuery.isSuccess,
  })
  const backupExclusionReady =
    backupLookupReady &&
    (!hasBackedUpMatch || backedUpExclusionAccepted)
  const backupLookupBusy =
    Boolean(inspection) &&
    !backupLookupReady &&
    (backedUpLookupQuery.isFetching || productNameExclusionsQuery.isFetching)
  const backedUpExcludedRowNumbers = useMemo(
    () =>
      new Set(invoiceBackedUpExcludedRowNumbers({ match: backedUpMatch })),
    [backedUpMatch],
  )
  const workRows = useMemo(
    () =>
      inspection
        ? filterRowsByExcludedNumbers(
            inspection.rows,
            backedUpExcludedRowNumbers,
          )
        : [],
    [backedUpExcludedRowNumbers, inspection],
  )
  const nameTransformation = useMemo(() => {
    if (!inspection || !nameRulesQuery.isSuccess || nameRulesQuery.error) {
      return null
    }
    return transformInvoiceNamesByCode(workRows, activeNameRules)
  }, [
    activeNameRules,
    inspection,
    nameRulesQuery.error,
    nameRulesQuery.isSuccess,
    workRows,
  ])
  const accessoryRules = useMemo(
    () => accessoryRulesQuery.data ?? [],
    [accessoryRulesQuery.data],
  )
  const accessoryRulesError =
    accessoryRulesQuery.error instanceof Error
      ? accessoryRulesQuery.error.message
      : accessoryRulesQuery.error
        ? '부속품 사전을 불러오지 못했습니다.'
        : null
  const rulesProductNameMaps = useMemo(
    () => rulesProductNameMapsQuery.data ?? [],
    [rulesProductNameMapsQuery.data],
  )
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
      workRows,
      productNameTagRoles,
    )
  }, [inspection, productNameTagRoles, workRows])
  const productLookupTextSig = useMemo(
    () => invoiceLookupTextsSig(productLookupTexts),
    [productLookupTexts],
  )
  const { workProductNameMapsQuery } = useInvoiceProductMapCriteria({ brand, productLookupTextSig, productLookupTexts, reachedProduct, inspection, backupLookupReady, productNameTagRolesQuery, criteriaQueryOptions })
  const productNameMaps = useMemo(
    () => workProductNameMapsQuery.data ?? [],
    [workProductNameMapsQuery.data],
  )
  const giftSourceMaps = useMemo(
    () => giftSourceMapsQuery.data ?? [],
    [giftSourceMapsQuery.data],
  )
  const giftSourceIgnoredKeySet = useMemo(
    () => new Set(giftSourceIgnoredKeys),
    [giftSourceIgnoredKeys],
  )
  const giftSourceFileMapIds = useMemo(() => {
    if (!inspection) return []
    const keys = new Set(
      workRows.map((row) => giftSourceGroupKey(row.mallName, row.productName)),
    )
    return giftSourceMaps
      .filter((map) =>
        keys.has(giftSourceGroupKey(map.mallName, map.productName)),
      )
      .map((map) => map.id)
  }, [giftSourceMaps, inspection, workRows])
  const { giftSourceAllocationsQuery } = useInvoiceGiftSourceCriteria({ brand, giftSourceFileMapIds, reachedGift, inspection, backupLookupReady })
  const giftSourceAllocations = useMemo(
    () => giftSourceAllocationsQuery.data ?? [],
    [giftSourceAllocationsQuery.data],
  )
  const giftSourceSessionRuleMap = useMemo(
    () => new Map(Object.entries(giftSourceSessionRules)),
    [giftSourceSessionRules],
  )
  const giftSourceSessionAllocationMap = useMemo(
    () => new Map(Object.entries(giftSourceSessionAllocations)),
    [giftSourceSessionAllocations],
  )
  const giftSourceAppliedKeySet = useMemo(
    () => new Set(giftSourceAppliedKeys),
    [giftSourceAppliedKeys],
  )
  const giftSourceEffectiveAppliedKeys = useMemo(
    () =>
      effectiveGiftSourceAppliedKeys({
        maps: giftSourceMaps,
        sessionRules: giftSourceSessionRuleMap,
        appliedKeys: giftSourceAppliedKeySet,
        ignoredKeys: giftSourceIgnoredKeySet,
      }),
    [
      giftSourceAppliedKeySet,
      giftSourceIgnoredKeySet,
      giftSourceMaps,
      giftSourceSessionRuleMap,
    ],
  )
  const giftSourceCriteriaReady =
    giftSourceMapsQuery.isSuccess &&
    (giftSourceFileMapIds.length === 0 ||
      giftSourceAllocationsQuery.isSuccess)
  const giftSourceAllocationsError =
    giftSourceAllocationsQuery.error instanceof Error
      ? giftSourceAllocationsQuery.error.message
      : giftSourceAllocationsQuery.error
        ? '사은품 원본행 배정을 불러오지 못했습니다.'
        : null
  const productNameMapsError =
    workProductNameMapsQuery.error instanceof Error
      ? workProductNameMapsQuery.error.message
      : workProductNameMapsQuery.error
        ? '품목명 변환 기준을 불러오지 못했습니다.'
        : null
  const rulesProductNameMapsError =
    rulesProductNameMapsQuery.error instanceof Error
      ? rulesProductNameMapsQuery.error.message
      : rulesProductNameMapsQuery.error
        ? '품목명 변환 기준을 불러오지 못했습니다.'
        : null
  const productNameExclusionsError =
    productNameExclusionsQuery.error instanceof Error
      ? productNameExclusionsQuery.error.message
      : productNameExclusionsQuery.error
        ? '상품 연결 예외 기준을 불러오지 못했습니다.'
        : null
  const { productStyleLookupQuery } = useInvoiceStyleCriteria({ brand, reachedProduct, inspection, criteriaQueryOptions })
  // 규칙 저장 직후 수천 행 재변환이 입력을 막지 않도록 한 박자 늦춰 계산한다.
  const deferredAccessoryRules = useDeferredValue(accessoryRules)
  const deferredProductNameMaps = useDeferredValue(productNameMaps)
  const deferredProductNameExclusions = useDeferredValue(productNameExclusions)
  const deferredProductNameTagRoles = useDeferredValue(productNameTagRoles)
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
  const mallCategories = useMemo(() => [
    ...buildFolderForest(usageFolders).map((folder) => ({ key: folder.id, name: folder.name })),
    { key: OUTBOUND_UNFILED_CATEGORY, name: '미분류' },
  ], [usageFolders])
  const mallCategory = mallCategories.find((category) => category.key === mallCategoryKey)
  const onlineCategoryKey = useMemo(
    () => mallCategories.find((category) => category.name === '온라인')?.key ?? '',
    [mallCategories],
  )
  useEffect(() => {
    if (!onlineCategoryKey || mallCategoryKey === onlineCategoryKey) return
    setMallCategoryKey(onlineCategoryKey)
  }, [mallCategoryKey, onlineCategoryKey])
  const scopedUsageTargets = useMemo(
    () => filterOutboundPartnersByCategory(usageTargets, usageFolders, mallCategoryKey),
    [usageTargets, usageFolders, mallCategoryKey],
  )
  const mallResolution = useMemo(
    () => timeInvoiceWork('쇼핑몰명 연결', () => resolveInvoiceMalls(workRows, scopedUsageTargets, usageAliases)),
    [usageAliases, scopedUsageTargets, workRows],
  )
  const mallPartnersReady =
    !usageTargetsQuery.isPending &&
    !usageAliasesQuery.isPending &&
    !usageFoldersQuery.isPending &&
    !usageTargetsQuery.error &&
    !usageAliasesQuery.error &&
    !usageFoldersQuery.error
  const mallsReady =
    Boolean(mallCategory) && mallPartnersReady && isInvoiceMallReady(mallResolution)
  const headerReady = Boolean(
    inspection && inspection.missingHeaders.length === 0,
  )
  const fileReady = Boolean(
    headerReady && inspection && inspection.blockingRowCount === 0,
  )
  const preloadFlowReady = isInvoicePreloadFlowReady({
    backupLookupReady,
    workRowCount: workRows.length,
  })
  const workFlowReady = isInvoiceWorkFlowReady({
    preloadFlowReady,
    hasBackedUpMatch,
    backedUpExclusionAccepted,
  })
  const canLeaveFileCheck = canLeaveInvoiceFileCheck({
    headerReady,
    mallsReady,
    workFlowReady,
  })
  const maxStepIndex = !inspection
    ? 0
    : canLeaveFileCheck
      ? reachedStepIndex
      : Math.min(reachedStepIndex, 1)
  const stepIndex = Math.min(
    TODAY_STEPS.findIndex((item) => item.value === step),
    maxStepIndex,
  )
  const activeStep = TODAY_STEPS[stepIndex]!.value
  useEffect(() => {
    if (!inspection || !headerReady || !mallPartnersReady || !mallCategoryKey) return
    const autoKey = `${mallCategoryKey}:${fileName}:${inspection.rowCount}:${mallResolution.unresolvedCount}`
    if (mallResolution.unresolvedCount === 0) {
      setMallDialogOpen(false)
      return
    }
    if (
      !uploadPipeline &&
      backupExclusionReady &&
      activeStep === 'check' &&
      mallAutoOpenedRef.current !== autoKey
    ) {
      mallAutoOpenedRef.current = autoKey
      setMallDialogOpen(true)
    }
  }, [
    activeStep,
    fileName,
    headerReady,
    inspection,
    mallPartnersReady,
    mallCategoryKey,
    mallResolution.unresolvedCount,
    uploadPipeline,
    backupExclusionReady,
  ])
  const visitedStepsRef = useRef(new Set<TodayStep>())
  visitedStepsRef.current.add(activeStep)
  const giftQueriesReady =
    giftRequestsQuery.isSuccess &&
    giftAllocationsQuery.isSuccess &&
    giftSourceMapsQuery.isSuccess &&
    productNameTagRolesQuery.isSuccess &&
    (giftSourceFileMapIds.length === 0 || giftSourceAllocationsQuery.isSuccess)
  const productQueriesReady =
    workProductNameMapsQuery.isSuccess &&
    productNameExclusionsQuery.isSuccess &&
    productNameTagRolesQuery.isSuccess &&
    productStyleLookupQuery.isSuccess &&
    giftSourceCriteriaReady
  const giftSourceSlots = useMemo(() => {
    if (!inspection) return []
    return collectGiftSourceSlots(
      workRows,
      deferredProductNameTagRoles,
      giftSourceIgnoredKeySet,
      giftSourceEffectiveAppliedKeys,
    )
  }, [
    deferredProductNameTagRoles,
    giftSourceEffectiveAppliedKeys,
    giftSourceIgnoredKeySet,
    inspection,
    workRows,
  ])
  const giftSourceAppliedRowNumbers = useMemo(
    () =>
      new Set(
        giftSourceSlots
          .filter((slot) => giftSourceEffectiveAppliedKeys.has(slot.groupKey))
          .map((slot) => slot.source.rowNumber),
      ),
    [giftSourceEffectiveAppliedKeys, giftSourceSlots],
  )
  const workInstructionIndex = useMemo(
    () => buildWorkInstructionIndex(workInstructions),
    [workInstructions],
  )
  const giftSetupGroup = useMemo(() => {
    if (!inspection || !giftSetupTarget) return null
    return inspectGiftSourceGroup({
      rows: workRows,
      mallName: giftSetupTarget.mallName,
      productName: giftSetupTarget.productName,
      tagRoles: deferredProductNameTagRoles,
      maps: giftSourceMaps,
      allocations: giftSourceAllocations,
      sessionRules: giftSourceSessionRuleMap,
      sessionAllocations: giftSourceSessionAllocationMap,
      ignoredKeys: giftSourceIgnoredKeySet,
      appliedKeys: giftSourceEffectiveAppliedKeys,
    })
  }, [
    deferredProductNameTagRoles,
    giftSetupTarget,
    giftSourceAllocations,
    giftSourceEffectiveAppliedKeys,
    giftSourceIgnoredKeySet,
    giftSourceMaps,
    giftSourceSessionAllocationMap,
    giftSourceSessionRuleMap,
    inspection,
    workRows,
  ])
  const processRowsCacheRef = useRef<{
    inspectionRows: SabangnetOrderRow[]
    signature: string
    rows: SabangnetOrderRow[]
  } | null>(null)
  const productExclusionSigRef = useRef('')
  const productCacheRef = useRef<InvoiceProductNameStepResult | null>(null)
  const fileResetKey = `${fileName}:${workGeneration}`
  const campaignRows = useMemo(
    () =>
      workRows.filter(
        (row) => !giftSourceAppliedRowNumbers.has(row.rowNumber),
      ),
    [giftSourceAppliedRowNumbers, workRows],
  )
  const giftCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      giftQueriesReady &&
      reachedGift &&
      preloadFlowReady,
    depsKey: invoiceStepDepsKey([
      fileName,
      workRows.length,
      campaignRows.length,
      giftSeed,
      excludedGiftStyleIds.join(','),
      JSON.stringify(giftResolutions),
      giftRequests.length,
      giftAllocations.length,
      giftSourceMaps.length,
      giftSourceAllocations.length,
      [...giftSourceEffectiveAppliedKeys].join(','),
      giftSourceIgnoredKeys.join(','),
      Object.keys(giftSourceSessionRules).join(','),
      giftExclusionSig,
      deferredProductNameTagRoles.length,
    ]),
    resetKey: fileResetKey,
    label: 'gift-unified-plan',
    jobRef: workJobRef,
    stage: 'gift',
    compute: () => {
      const excluded = new Set(
        productExclusionSigRef.current
          .split(',')
          .filter(Boolean)
          .map((value) => Number(value)),
      )
      const rows = workRows.filter(
        (row) =>
          !excluded.has(row.rowNumber) &&
          !giftSourceAppliedRowNumbers.has(row.rowNumber),
      )
      const eligibility = planInvoicePrefixes(
        rows,
        giftRequests,
        giftResolutions,
      )
      return {
        eligibility,
        unified: planUnifiedGifts({
          campaignRows: rows,
          sourceRows: workRows,
          prefixPlan: eligibility,
          requests: giftRequests,
          seed: giftSeed,
          excludedGiftStyleIds,
          existingAllocations: giftAllocations,
          tagRoles: deferredProductNameTagRoles,
          maps: giftSourceMaps,
          sourceAllocations: giftSourceAllocations,
          sessionRules: giftSourceSessionRuleMap,
          sessionAllocations: giftSourceSessionAllocationMap,
          ignoredKeys: giftSourceIgnoredKeySet,
          appliedKeys: giftSourceEffectiveAppliedKeys,
          sourceSlots: giftSourceSlots,
        }),
      }
    },
  })
  const giftEligibilityPlan = giftCompute.result?.eligibility ?? null
  const giftPlan = giftCompute.result?.unified.giftPlan ?? null
  const giftSourcePlan = useMemo(
    () =>
      giftCompute.result?.unified.giftSourcePlan ?? emptyGiftSourcePlan(),
    [giftCompute.result],
  )
  const giftSourcePlanSig = useMemo(
    () =>
      [...giftSourcePlan.replacementsByRow.entries()]
        .map(
          ([rowNumber, replacements]) =>
            `${rowNumber}:${replacements
              .map(
                (replacement) =>
                  `${replacement.style.styleId}:${replacement.quantity}`,
              )
              .join(',')}`,
        )
        .join('|'),
    [giftSourcePlan],
  )
  const productMapsSig = useMemo(
    () =>
      invoiceLookupTextsSig(
        deferredProductNameMaps.map(
          (map) => `${map.id}:${map.updatedAt}:${map.style?.styleId ?? ''}`,
        ),
      ),
    [deferredProductNameMaps],
  )
  const productMapsSyncAllowed = shouldRunDeferredInvoiceStep({
    uploadPipeline,
    stepIndex,
    stageIndex: TODAY_STEP_INDEX.item,
  })
  const productMapsHold = useHeldInvoiceStepDepsKey(
    productMapsSig,
    !productMapsSyncAllowed,
    { record: productQueriesReady, resetKey: fileResetKey },
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
  const holdProductRecompute = shouldHoldInvoiceStepRecompute({
    saving: productSaveBlockCount > 0 || productCriteriaRetrying,
    criteriaSettled:
      productNameMaps === deferredProductNameMaps &&
      productNameTagRoles === deferredProductNameTagRoles,
  })
  const liveProductDepsKey = invoiceStepDepsKey([
    fileName,
    workRows.length,
    productMapsHold.depsKey,
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
      productHold.holdEnabled &&
      preloadFlowReady,
    depsKey: productHold.depsKey,
    resetKey: fileResetKey,
    label: 'product-transform',
    jobRef: workJobRef,
    stage: 'product',
    compute: () =>
      computeInvoiceProductNameStep({
        sourceRows: workRows,
        maps: deferredProductNameMaps,
        styles: [],
        tagRoles: deferredProductNameTagRoles,
        exclusions: [],
        giftSourcePlan: emptyGiftSourcePlan(),
        productLookupIndex,
        productCatalog,
      }),
  })
  if (productCompute.result) {
    productCacheRef.current = productCompute.result
  }
  const matchedProductTransformation =
    productCompute.result?.base ?? productCacheRef.current?.base ?? null
  const productRowKeyIndex =
    productCompute.result?.rowKeyIndex ??
    productCacheRef.current?.rowKeyIndex ??
    null
  const productMapSnapshot =
    productCompute.result?.mapSnapshot ??
    productCacheRef.current?.mapSnapshot ??
    null
  const productCandidateRowIndex =
    productCompute.result?.candidateRowIndex ??
    productCacheRef.current?.candidateRowIndex ??
    null
  const mapSyncedProductTransformation = useMemo(() => {
    if (
      !matchedProductTransformation ||
      !productMapSnapshot ||
      !productCandidateRowIndex
    ) {
      return matchedProductTransformation
    }
    return timeInvoiceWork(
      'product-map-delta',
      () =>
        applyProductNameMapDelta({
          base: matchedProductTransformation,
          baseSnapshot: productMapSnapshot,
          candidateRowIndex: productCandidateRowIndex,
          maps: deferredProductNameMaps,
          tagRoles: deferredProductNameTagRoles,
          catalog: productCatalog,
          lookupIndex: productLookupIndex,
        }).transformation,
      workJobRef.current,
    )
  }, [
    deferredProductNameMaps,
    deferredProductNameTagRoles,
    matchedProductTransformation,
    productCandidateRowIndex,
    productCatalog,
    productLookupIndex,
    productMapSnapshot,
  ])
  const excludedProductTransformation = useMemo(() => {
    if (!mapSyncedProductTransformation) return null
    return timeInvoiceWork(
      'product-exclusion-overlay',
      () =>
        applyProductNameExclusions(
          mapSyncedProductTransformation,
          deferredProductNameExclusions,
          productRowKeyIndex ?? undefined,
        ),
      workJobRef.current,
    )
  }, [
    deferredProductNameExclusions,
    mapSyncedProductTransformation,
    productRowKeyIndex,
  ])
  const productTransformation = useMemo(
    () =>
      excludedProductTransformation
        ? overlayGiftSourceOnProductNames(
            excludedProductTransformation,
            giftSourcePlan,
          )
        : null,
    [excludedProductTransformation, giftSourcePlan],
  )
  const optionMapCombos = useMemo(
    () =>
      inspection
        ? collectOptionMapLookupCombos(
            workRows,
            productTransformation?.rows,
          )
        : [],
    [inspection, productTransformation, workRows],
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
            workRows,
            productTransformation?.rows,
          )
        : [],
    [inspection, productTransformation, workRows],
  )
  const itemNameLookupSig = useMemo(
    () => invoiceLookupTextsSig(itemNameLookupTexts),
    [itemNameLookupTexts],
  )
  const { workOptionMapsQuery, workItemNameRulesQuery } = useInvoiceItemCriteria({ brand, optionMapComboSig, optionMapCombos, reachedItem, inspection, productTransformation, criteriaQueryOptions, itemNameLookupSig, itemNameLookupTexts })
  const optionMaps = useMemo(
    () =>
      (rulesView ? optionMapsQuery.data : workOptionMapsQuery.data) ?? [],
    [optionMapsQuery.data, rulesView, workOptionMapsQuery.data],
  )
  const itemNameRules = useMemo(
    () =>
      (rulesView ? itemNameRulesQuery.data : workItemNameRulesQuery.data) ??
      [],
    [itemNameRulesQuery.data, rulesView, workItemNameRulesQuery.data],
  )
  const deferredOptionMaps = useDeferredValue(optionMaps)
  const deferredItemNameRules = useDeferredValue(itemNameRules)
  const optionMapsError = (() => {
    const error = rulesView ? optionMapsQuery.error : workOptionMapsQuery.error
    if (!error) return null
    return error instanceof Error
      ? error.message
      : '내품명 변환 기준을 불러오지 못했습니다.'
  })()
  const itemNameRulesError = (() => {
    const error = rulesView
      ? itemNameRulesQuery.error
      : workItemNameRulesQuery.error
    if (!error) return null
    return error instanceof Error
      ? error.message
      : '내품명 규칙을 불러오지 못했습니다.'
  })()
  const itemNameCriteriaError =
    optionMapsError || itemNameRulesError || accessoryRulesError
  const itemNameCriteriaLoading =
    (rulesView
      ? optionMapsQuery.isLoading || itemNameRulesQuery.isLoading
      : workOptionMapsQuery.isLoading || workItemNameRulesQuery.isLoading) ||
    accessoryRulesQuery.isLoading
  const itemQueriesReady =
    (rulesView
      ? optionMapsQuery.isSuccess && itemNameRulesQuery.isSuccess
      : workOptionMapsQuery.isSuccess && workItemNameRulesQuery.isSuccess) &&
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
    [
      deferredItemNameRules,
      deferredOptionMaps,
      productStyleLookupQuery.data,
    ],
  )
  const excludedRowSignature = useMemo(() => {
    if (!excludedProductTransformation) return ''
    return excludedProductTransformation.rows
      .filter((row) => row.status === 'excluded')
      .map((row) => row.source.rowNumber)
      .sort((left, right) => left - right)
      .join(',')
  }, [excludedProductTransformation])
  productExclusionSigRef.current = excludedRowSignature
  useEffect(() => {
    setGiftExclusionSig(excludedRowSignature)
  }, [excludedRowSignature])
  const processRows = useMemo(() => {
    if (!inspection) {
      processRowsCacheRef.current = null
      return []
    }
    const cached = processRowsCacheRef.current
    if (
      cached &&
      cached.inspectionRows === workRows &&
      cached.signature === excludedRowSignature
    ) {
      return cached.rows
    }
    const excluded = excludedRowSignature
      ? new Set(
          excludedRowSignature.split(',').map((value) => Number(value)),
        )
      : null
    const rows =
      !excluded || excluded.size === 0
        ? workRows
        : workRows.filter((row) => !excluded.has(row.rowNumber))
    processRowsCacheRef.current = {
      inspectionRows: workRows,
      signature: excludedRowSignature,
      rows,
    }
    return rows
  }, [excludedRowSignature, inspection, workRows])
  const prefixRows = useMemo(
    () =>
      processRows.filter(
        (row) => !giftSourceAppliedRowNumbers.has(row.rowNumber),
      ),
    [giftSourceAppliedRowNumbers, processRows],
  )
  const workCompute = useInvoiceStepCompute({
    enabled:
      Boolean(inspection) &&
      workInstructionsQuery.isSuccess &&
      reachedInstruction &&
      preloadFlowReady,
    depsKey: invoiceStepDepsKey([
      fileName,
      processRows.length,
      excludedRowSignature,
      workInstructions.length,
    ]),
    resetKey: fileResetKey,
    label: 'work-plan',
    jobRef: workJobRef,
    stage: 'instruction',
    compute: () =>
      planWorkInstructions(processRows, workInstructions, workInstructionIndex),
  })
  const workPlan = workCompute.result
  const itemCriteriaQueryError = rulesView
    ? optionMapsQuery.error || itemNameRulesQuery.error
    : workOptionMapsQuery.error || workItemNameRulesQuery.error
  const canComputeItemTransformation = Boolean(
    inspection &&
      productTransformation &&
      itemQueriesReady &&
      !itemCriteriaQueryError &&
      !accessoryRulesQuery.error &&
      !productStyleLookupQuery.error,
  )
  const computeItemTransformation =
    useCallback((): InvoiceItemNameTransformation | null => {
      if (!inspection || !productTransformation || !canComputeItemTransformation) {
        return null
      }
      return timeInvoiceWork(
        'item-transform',
        () =>
          runInvoiceItemNameStep({
            sourceRows: workRows,
            optionMaps: [],
            productRows: productTransformation.rows,
            itemNameRules: [],
            accessoryRules: deferredAccessoryRules,
            styles: [],
            itemNameIndex,
          }),
        workJobRef.current,
      )
    }, [
      canComputeItemTransformation,
      deferredAccessoryRules,
      inspection,
      itemNameIndex,
      productTransformation,
      workRows,
    ])
  const itemCacheRef = useRef<InvoiceItemNameTransformation | null>(null)
  const holdItemRecompute = shouldHoldInvoiceStepRecompute({
    saving: productSaveBlockCount > 0 || itemCriteriaRetrying,
    criteriaSettled:
      optionMaps === deferredOptionMaps &&
      itemNameRules === deferredItemNameRules &&
      accessoryRules === deferredAccessoryRules,
  })
  const liveItemDepsKey = invoiceStepDepsKey([
    fileName,
    productTransformation?.mappedRowCount,
    productTransformation?.unresolvedRowCount,
    productTransformation?.excludedRowCount,
    productTransformation?.giftMappedRowCount,
    giftSourcePlanSig,
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
      itemHold.holdEnabled &&
      preloadFlowReady &&
      shouldRunDeferredInvoiceStep({
        uploadPipeline,
        stepIndex,
        stageIndex: TODAY_STEP_INDEX.item,
      }),
    depsKey: itemHold.depsKey,
    resetKey: fileResetKey,
    label: 'item-transform',
    jobRef: workJobRef,
    stage: 'item',
    compute: () => {
      if (!inspection || !productTransformation) {
        throw new Error('내품명 변환 기준이 아직 준비되지 않았습니다.')
      }
      return computeInvoiceItemNameStep({
        sourceRows: workRows,
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
  const outboundReflectSummary = useMemo(() => {
    if (!productTransformation || !itemTransformation) return null
    return summarizeOutboundReflectProducts({
      productTransformation,
      itemTransformation,
    })
  }, [itemTransformation, productTransformation])
  const outboundReflectLedger = useMemo(() => {
    if (!productTransformation || !itemTransformation) return null
    return buildOutboundReflectLedger({
      productTransformation,
      itemTransformation,
      mallResolution,
    })
  }, [itemTransformation, mallResolution, productTransformation])
  const stockHoldBundles = useMemo(() => {
    if (!inspection || !productTransformation) return []
    return buildStockHoldCandidateBundles({
      sourceRows: workRows,
      productRows: productTransformation.rows,
      itemRows: itemTransformation?.rows ?? null,
      discontinued: discontinuedStylesQuery.data ?? [],
      preorderHolds: preorderHoldsQuery.data ?? [],
    })
  }, [
    discontinuedStylesQuery.data,
    inspection,
    itemTransformation,
    preorderHoldsQuery.data,
    productTransformation,
    workRows,
  ])
  const stockHoldBundleKeySig = useMemo(
    () =>
      stockHoldBundles
        .map((bundle) => `${bundle.key}:${bundle.rowNumbers.join(',')}`)
        .join('|'),
    [stockHoldBundles],
  )
  const defaultStockHoldExcludedRowNumbers = useMemo(
    () => excludedRowNumbersFromStockHoldBundles(stockHoldBundles),
    [stockHoldBundles],
  )
  useEffect(() => {
    setStockHoldExcludedOverride(null)
  }, [stockHoldBundleKeySig])
  const stockHoldExcludedRowNumbers =
    stockHoldExcludedOverride ?? defaultStockHoldExcludedRowNumbers
  const stockHoldExcludedSet = useMemo(
    () => new Set(stockHoldExcludedRowNumbers),
    [stockHoldExcludedRowNumbers],
  )
  const listCompute = useInvoiceStepCompute({
    enabled:
      reachedStepIndex >= TODAY_STEP_INDEX.list &&
      Boolean(
        productTransformation && itemTransformation && workPlan && giftPlan,
      ) &&
      shouldRunDeferredInvoiceStep({
        uploadPipeline,
        stepIndex,
        stageIndex: TODAY_STEP_INDEX.list,
      }),
    depsKey: invoiceStepDepsKey([
      fileName,
      productTransformation?.mappedRowCount,
      productTransformation?.excludedRowCount,
      productTransformation?.exclusionGuardedRowCount,
      itemTransformation?.mappedRowCount,
      giftPlan?.shipments.length,
      workPlan?.matchedRowCount,
      stockHoldExcludedRowNumbers.join(','),
    ]),
    resetKey: fileResetKey,
    label: 'product-list-outgoing',
    jobRef: workJobRef,
    stage: 'list',
    compute: () => {
      const productRows =
        stockHoldExcludedSet.size === 0
          ? productTransformation!.rows
          : productTransformation!.rows.filter(
              (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
            )
      const itemRows =
        stockHoldExcludedSet.size === 0
          ? itemTransformation!.rows
          : itemTransformation!.rows.filter(
              (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
            )
      return buildOutgoingComponentRowsFromStages({
        productRows,
        itemRows,
        giftRowsBySource: giftPlan!.giftsBySourceRowNumber,
        giftAssignments: giftPlan!.shipments.flatMap(
          (item) => item.assignments,
        ),
        packingMaterials: workPlan!.materialTotals,
      })
    },
  })
  const outputCompute = useInvoiceStepCompute({
    enabled:
      reachedStepIndex >= TODAY_STEP_INDEX.output &&
      Boolean(
        productTransformation && itemTransformation && workPlan && giftPlan,
      ) &&
      shouldRunDeferredInvoiceStep({
        uploadPipeline,
        stepIndex,
        stageIndex: TODAY_STEP_INDEX.output,
      }),
    depsKey: invoiceStepDepsKey([
      fileName,
      productTransformation?.mappedRowCount,
      productTransformation?.excludedRowCount,
      productTransformation?.exclusionGuardedRowCount,
      itemTransformation?.mappedRowCount,
      giftPlan?.shipments.length,
      workPlan?.matchedRowCount,
      stockHoldExcludedRowNumbers.join(','),
    ]),
    resetKey: fileResetKey,
    label: 'invoice-output-rows',
    jobRef: workJobRef,
    stage: 'output',
    compute: () => {
      const productTransformationForOutput =
        stockHoldExcludedSet.size === 0
          ? productTransformation!
          : {
              ...productTransformation!,
              rows: productTransformation!.rows.filter(
                (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
              ),
            }
      const itemTransformationForOutput =
        stockHoldExcludedSet.size === 0
          ? itemTransformation!
          : {
              ...itemTransformation!,
              rows: itemTransformation!.rows.filter(
                (row) => !stockHoldExcludedSet.has(row.source.rowNumber),
              ),
            }
      return buildInvoiceOutputRows({
        workMatches: workPlan!.matchByRowNumber,
        giftRowsBySource: giftPlan!.giftsBySourceRowNumber,
        giftAssignments: giftPlan!.shipments.flatMap(
          (item) => item.assignments,
        ),
        productTransformation: productTransformationForOutput,
        itemTransformation: itemTransformationForOutput,
      })
    },
  })
  const giftStageError = Boolean(
    giftRequestsError ||
      giftSourceMapsError ||
      giftSourceAllocationsError ||
      giftAllocationsQuery.error ||
      giftCompute.error,
  )
  const giftStageSettled =
    giftStageError || isStepComputeSettled(giftCompute.status)
  const workStageSettled =
    Boolean(workInstructionsError) || isStepComputeSettled(workCompute.status)
  const productStageError = Boolean(
    productNameMapsError ||
      productNameExclusionsError ||
      giftSourceMapsError ||
      giftSourceAllocationsError ||
      productCompute.error,
  )
  const productStageSettled =
    productStageError || isStepComputeSettled(productCompute.status)
  const itemStageSettled =
    Boolean(itemNameCriteriaError) ||
    productStageError ||
    isStepComputeSettled(itemCompute.status)
  const canBuildLaterStages = Boolean(
    productTransformation && itemTransformation && workPlan && giftPlan,
  )
  const laterStageSupportEnabled =
    Boolean(inspection) &&
    headerReady &&
    preloadFlowReady &&
    reachedStepIndex >= TODAY_STEP_INDEX.list
  const { laterWarehouseSetQuery, laterWarehousePositionsQuery, laterBrandFieldsQuery, laterPackingField, laterPackingMapsQuery, laterStylesQuery } = useInvoiceLaterStageCriteria({ brand, laterStageSupportEnabled, reachedStepIndex })
  const productListSupportBusyLabel = (() => {
    if (!laterStageSupportEnabled) return null
    if (laterWarehouseSetQuery.isPending) {
      return '창고 재고를 불러오고 있습니다.'
    }
    if (
      laterWarehouseSetQuery.data?.id &&
      laterWarehousePositionsQuery.isPending
    ) {
      return '창고 자리를 불러오고 있습니다.'
    }
    return null
  })()
  const outputSupportBusyLabel = (() => {
    if (
      !laterStageSupportEnabled ||
      reachedStepIndex < TODAY_STEP_INDEX.output
    ) {
      return null
    }
    if (laterStylesQuery.isPending || laterBrandFieldsQuery.isPending) {
      return '상품·포장 기준을 불러오고 있습니다.'
    }
    if (laterPackingField && laterPackingMapsQuery.isPending) {
      return '포장 규격을 불러오고 있습니다.'
    }
    return productListSupportBusyLabel
  })()
  const productAiAutoCollect = shouldAutoCollectInvoiceAi({
    pipelineActive:
      uploadPipeline &&
      headerReady &&
      giftStageSettled &&
      giftExclusionSig === excludedRowSignature,
    computeReady:
      productCompute.status === 'ready' &&
      productQueriesReady &&
      !holdProductRecompute,
    alreadySettled: productAiPipeline.settled,
  })
  const stagesSettled =
    giftStageSettled &&
    workStageSettled &&
    productStageSettled &&
    itemStageSettled
  const laterStagesSettled =
    !canBuildLaterStages ||
    (isStepComputeSettled(listCompute.status) &&
      isStepComputeSettled(outputCompute.status))
  const preConfirmReady = isInvoicePreConfirmReady({
    backupLookupReady,
    workRowCount: workRows.length,
    stagesSettled,
    productAiSettled: productAiPipeline.settled,
    laterStagesSettled,
    exclusionSigAligned: excludedRowSignature === giftExclusionSig,
  })
  useEffect(() => {
    if (activeView !== 'today' || activeStep !== 'check' || isParsing) {
      setBackupDialogOpen(false)
      backupDialogAutoKeyRef.current = null
      return
    }
    if (!hasBackedUpMatch || backedUpExclusionAccepted) {
      if (backedUpExclusionAccepted) setBackupDialogOpen(false)
      return
    }
    if (
      !shouldAutoOpenInvoiceBackupDialog({
        isParsing,
        uploadPipeline,
        preConfirmReady,
        hasBackedUpMatch,
        accepted: backedUpExclusionAccepted,
      })
    ) {
      return
    }
    const autoKey = `${fileName}:${backedUpMatch?.orderCount ?? 0}:${backedUpMatch?.rowCount ?? 0}`
    if (backupDialogAutoKeyRef.current === autoKey) return
    backupDialogAutoKeyRef.current = autoKey
    setBackupDialogOpen(true)
  }, [
    activeStep,
    activeView,
    backedUpExclusionAccepted,
    backedUpMatch,
    fileName,
    hasBackedUpMatch,
    isParsing,
    preConfirmReady,
    uploadPipeline,
  ])
  const productCriteriaLoading =
    workProductNameMapsQuery.isLoading ||
    productNameExclusionsQuery.isLoading ||
    productNameTagRolesQuery.isLoading ||
    productStyleLookupQuery.isLoading ||
    giftSourceMapsQuery.isLoading ||
    (giftSourceFileMapIds.length > 0 && giftSourceAllocationsQuery.isLoading)
  const productStepError =
    productNameMapsError ||
    productNameExclusionsError ||
    giftSourceMapsError ||
    giftSourceAllocationsError ||
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
      giftSourceMapsQuery.refetch(),
      giftSourceAllocationsQuery.refetch(),
    ]).then(() => {
      setProductCriteriaRetrying(false)
      productCompute.retry()
    })
  }
  const itemStepError =
    itemNameCriteriaError ||
    itemCompute.error ||
    null
  const itemStepBlock = shouldShowInvoiceStepBlockingState({
    hasResult: Boolean(itemTransformation),
    computing:
      itemNameCriteriaLoading || itemCompute.status === 'computing',
    hasError: Boolean(itemStepError),
  })
  const retryItemStep = () => {
    setItemCriteriaRetrying(true)
    void Promise.allSettled([
      optionMapsQuery.refetch(),
      itemNameRulesQuery.refetch(),
      workOptionMapsQuery.refetch(),
      workItemNameRulesQuery.refetch(),
      accessoryRulesQuery.refetch(),
    ]).then(() => {
      setItemCriteriaRetrying(false)
      itemCompute.retry()
    })
  }
  const handleProductAiProgress = useCallback(
    (progress: { collecting: boolean; done: number; total: number }) => {
      if (workGenerationRef.current !== workGeneration) return
      setProductAiPipeline((current) => ({
        ...current,
        collecting: progress.collecting,
        done: progress.done,
        total: progress.total,
      }))
    },
    [workGeneration],
  )
  const handleProductAiSettled = useCallback(() => {
    if (workGenerationRef.current !== workGeneration) return
    markInvoiceWorkStage(workJobRef.current, 'product-ai')
    setProductAiPipeline((current) =>
      current.settled
        ? current
        : { ...current, settled: true, collecting: false },
    )
  }, [workGeneration])
  const handleOpenGiftSetup = useCallback(
    (target: { mallName: string; productName: string }) => {
      setGiftSourceError(null)
      setGiftSetupTarget({
        mallName: target.mallName,
        productName: target.productName,
      })
    },
    [],
  )
  useEffect(() => {
    if (!uploadPipeline) return
    if (productStageError) {
      setProductAiPipeline((current) =>
        current.settled
          ? current
          : { ...current, settled: true, collecting: false },
      )
    }
  }, [productStageError, uploadPipeline])
  useEffect(() => {
    if (!uploadPipeline || !workJobRef.current) return
    if (
      giftQueriesReady &&
      workInstructionsQuery.isSuccess &&
      productQueriesReady &&
      itemQueriesReady
    ) {
      markInvoiceWorkStage(workJobRef.current, 'criteria')
    }
  }, [
    giftQueriesReady,
    itemQueriesReady,
    productQueriesReady,
    uploadPipeline,
    workInstructionsQuery.isSuccess,
  ])
  useEffect(() => {
    if (!uploadPipeline || isParsing) return
    if (
      shouldFinishInvoiceUploadPipeline({
        headerReady,
        backupLookupReady,
        workRowCount: workRows.length,
        exclusionSigAligned: excludedRowSignature === giftExclusionSig,
        stagesSettled,
        laterStagesSettled,
        productAiSettled: productAiPipeline.settled,
      })
    ) {
      finishInvoiceWorkJob(workJobRef.current)
      setUploadPipeline(false)
    }
  }, [
    backupLookupReady,
    excludedRowSignature,
    giftExclusionSig,
    headerReady,
    isParsing,
    laterStagesSettled,
    productAiPipeline.settled,
    stagesSettled,
    uploadPipeline,
    workRows.length,
  ])
  const nameRulesError =
    nameRulesQuery.error instanceof Error
      ? nameRulesQuery.error.message
      : nameRulesQuery.error
        ? '송장 자체품번코드 기준을 불러오지 못했습니다.'
        : null
  function selectView(view: InvoiceView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'today') next.delete('view')
      else next.set('view', view)
      return next
    })
  }
  function resetGiftState() {
    setGiftResolutions({})
    setGiftSeed(createGiftSeed())
    setExcludedGiftStyleIds([])
    setStockHoldExcludedOverride(null)
    setGiftSourceSessionRules({})
    setGiftSourceSessionAllocations({})
    setGiftSourceIgnoredKeys([])
    setGiftSourceApplyingKey(null)
    setGiftSourceError(null)
    setGiftSourceAppliedKeys([])
    setGiftSetupTarget(null)
  }
  function resetFile() {
    workGenerationRef.current += 1
    setWorkGeneration(workGenerationRef.current)
    workJobRef.current = null
    visitedStepsRef.current = new Set<TodayStep>(['upload'])
    itemCacheRef.current = null
    processRowsCacheRef.current = null
    productCacheRef.current = null
    productExclusionSigRef.current = ''
    mallAutoOpenedRef.current = null
    backupDialogAutoKeyRef.current = null
    setMallDialogOpen(false)
    setBackupDialogOpen(false)
    setBackedUpExclusionAccepted(false)
    setCurrentGenerationBackedUp(false)
    setMallCategoryLocked(false)
    setOutboundBackupBusy(false)
    setOutboundBackupMessage(null)
    setOutboundBackupIsError(false)
    setInspection(null)
    setFileName('')
    setError(null)
    setProductSaveBlockCount(0)
    setProductCriteriaRetrying(false)
    setItemCriteriaRetrying(false)
    setReachedStepIndex(0)
    setGiftExclusionSig('')
    setUploadPipeline(false)
    setProductAiPipeline(IDLE_UPLOAD_AI)
    setStep('upload')
    resetGiftState()
    if (inputRef.current) inputRef.current.value = ''
  }
  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
      setError('사방넷에서 내려받은 엑셀 파일(.xlsx, .xls)을 선택해주세요.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('파일이 50MB를 넘습니다. 주문 기간을 나눠서 내려받아 주세요.')
      return
    }
    setMallCategoryLocked(false)

    workGenerationRef.current += 1
    setWorkGeneration(workGenerationRef.current)
    const generation = workGenerationRef.current
    workJobRef.current = createInvoiceWorkJob()
    setIsParsing(true)
    setUploadPipeline(true)
    setProductAiPipeline(PENDING_UPLOAD_AI)
    setError(null)
    visitedStepsRef.current = new Set<TodayStep>(['upload'])
    itemCacheRef.current = null
    processRowsCacheRef.current = null
    productCacheRef.current = null
    productExclusionSigRef.current = ''
    mallAutoOpenedRef.current = null
    backupDialogAutoKeyRef.current = null
    setMallDialogOpen(false)
    setBackupDialogOpen(false)
    setBackedUpExclusionAccepted(false)
    setCurrentGenerationBackedUp(false)
    setOutboundBackupBusy(false)
    setOutboundBackupMessage(null)
    setOutboundBackupIsError(false)
    setInspection(null)
    setFileName(file.name)
    setProductSaveBlockCount(0)
    setProductCriteriaRetrying(false)
    setItemCriteriaRetrying(false)
    setReachedStepIndex(0)
    setGiftExclusionSig('')
    resetGiftState()

    try {
      const nextInspection = await parseSabangnetInvoiceFile(file)
      if (generation !== workGenerationRef.current) return
      markInvoiceWorkStage(workJobRef.current, 'parse', {
        rows: nextInspection.rowCount,
      })
      setInspection(nextInspection)
      setStep('check')
      if (nextInspection.missingHeaders.length === 0) {
        setReachedStepIndex(TODAY_STEP_INDEX.output)
      } else {
        setReachedStepIndex(TODAY_STEP_INDEX.check)
        setUploadPipeline(false)
        setProductAiPipeline(IDLE_UPLOAD_AI)
      }
    } catch (reason) {
      if (generation !== workGenerationRef.current) return
      setUploadPipeline(false)
      setProductAiPipeline(IDLE_UPLOAD_AI)
      workJobRef.current = null
      setError(
        reason instanceof Error
          ? reason.message
          : '파일을 읽지 못했습니다. 사방넷 원본 엑셀인지 확인해주세요.',
      )
    } finally {
      if (generation === workGenerationRef.current) {
        setIsParsing(false)
      }
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  function changeTodayStep(next: TodayStep) {
    if (TODAY_STEP_INDEX[next] > reachedStepIndex) return
    if (TODAY_STEP_INDEX[next] > TODAY_STEP_INDEX.check && !canLeaveFileCheck) {
      return
    }
    if (
      step === 'product' &&
      next !== 'product' &&
      productSaveBlockCount > 0
    ) {
      return
    }
    logInvoiceWork('tab-commit', { from: step, to: next })
    if (TODAY_STEP_INDEX[next] > TODAY_STEP_INDEX.check) setMallCategoryLocked(true)
    startStepTransition(() => {
      setStep(next)
    })
  }
  function goNextStep(next: TodayStep) {
    if (TODAY_STEP_INDEX[next] > TODAY_STEP_INDEX.check && !canLeaveFileCheck) {
      return
    }
    if (
      step === 'product' &&
      next !== 'product' &&
      productSaveBlockCount > 0
    ) {
      return
    }
    setReachedStepIndex((current) =>
      Math.max(current, TODAY_STEP_INDEX[next]),
    )
    if (TODAY_STEP_INDEX[next] > TODAY_STEP_INDEX.check) setMallCategoryLocked(true)
    setStep(next)
  }
  function notifyOutboundUpdated() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent(PRODUCT_OUTBOUND_UPDATED_EVENT, {
        detail: { brandId: brand.id },
      }),
    )
  }
  async function backupOutboundReflect() {
    if (
      !inspection ||
      !productTransformation ||
      !itemTransformation ||
      !outboundReflectLedger
    ) {
      return
    }
    if (!outboundReflectLedger.ok) {
      setOutboundBackupIsError(true)
      setOutboundBackupMessage(
        formatOutboundReflectBlockReasons(outboundReflectLedger.reasons),
      )
      return
    }
    setOutboundBackupBusy(true)
    setOutboundBackupIsError(false)
    setOutboundBackupMessage(null)
    try {
      const sourceRef = await fingerprintInvoiceWorkRows(processRows)
      const orderKeyHashes = await hashInvoiceOrderKeyPayloads(
        collectInvoiceOrderKeyGroups(workRows).map((group) => group.payload),
      )
      await backupInvoiceOutboundWork({
        brandId: brand.id,
        sourceRef,
        note: fileName ? `invoice:${fileName}` : '',
        entries: outboundReflectLedger.entries.map((entry) => ({
          usageTargetId: entry.usageTargetId,
          styleId: entry.styleId,
          shippedOn: entry.shippedOn,
          quantity: entry.quantity,
        })),
        sourceFileName: fileName,
        sourceRowCount: processRows.length,
        sourceOrderCount: countUniqueInvoiceOrders(processRows),
        sites: summarizeInvoiceWorkSites({
          sourceRows: processRows,
          outputRows: [],
          resolution: mallResolution,
        }),
        orderKeyHashes,
      })
      setCurrentGenerationBackedUp(true)
      setBackupDialogOpen(false)
      notifyOutboundUpdated()
      await queryClient.invalidateQueries({
        queryKey: ['outboundShipments', brand.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['invoiceWorkRuns', brand.id],
      })
      const dateRange =
        outboundReflectLedger.firstOrderedOn &&
        outboundReflectLedger.lastOrderedOn
          ? outboundReflectLedger.firstOrderedOn ===
            outboundReflectLedger.lastOrderedOn
            ? outboundReflectLedger.firstOrderedOn
            : `${outboundReflectLedger.firstOrderedOn} ~ ${outboundReflectLedger.lastOrderedOn}`
          : ''
      setOutboundBackupMessage(
        `출고 데이터에 ${formatNumber(outboundReflectLedger.styleCount)}종 · ${formatNumber(outboundReflectLedger.totalQuantity)}개${dateRange ? ` · ${dateRange}` : ''} 반영했습니다.`,
      )
    } catch (reason) {
      setOutboundBackupIsError(true)
      setOutboundBackupMessage(
        reason instanceof Error
          ? reason.message
          : '출고 데이터에 반영하지 못했습니다.',
      )
    } finally {
      setOutboundBackupBusy(false)
    }
  }
  function markGiftSourceApplied(key: string) {
    setGiftSourceAppliedKeys((current) =>
      current.includes(key) ? current : [...current, key],
    )
    setGiftSourceIgnoredKeys((current) => current.filter((item) => item !== key))
    setGiftSetupTarget(null)
  }
  function applyGiftSourceSession(
    group: GiftSourceGroup,
    rule: GiftSourceSessionRule,
  ) {
    setGiftSourceError(null)
    setGiftSourceSessionRules((current) => ({ ...current, [group.key]: rule }))
    markGiftSourceApplied(group.key)
  }
  async function applyGiftSourcePersist(
    group: GiftSourceGroup,
    rule: GiftSourceSessionRule,
  ) {
    setGiftSourceApplyingKey(group.key)
    setGiftSourceError(null)
    try {
      await saveInvoiceGiftSourceMap(brand.id, {
        mallName: group.mallName,
        productName: group.productName,
        assignmentMode: rule.assignmentMode,
        styleIds: rule.poolStyles.map((style) => style.styleId),
        uniquePerRecipient: true,
      })
      setGiftSourceSessionRules((current) => ({ ...current, [group.key]: rule }))
      markGiftSourceApplied(group.key)
      await queryClient.invalidateQueries({
        queryKey: ['invoice-gift-source-maps', brand.id],
      })
    } catch (error) {
      setGiftSourceError(
        error instanceof Error
          ? error.message
          : '사은품 원본행 설정을 저장하지 못했습니다.',
      )
    } finally {
      setGiftSourceApplyingKey(null)
    }
  }
  const todayStepBusyLabel = ((): string | null => {
    if (activeView !== 'today') return null
    if (isParsing) return '파일을 확인하고 있습니다.'
    if (uploadPipeline && !backupLookupReady) {
      return INVOICE_BACKUP_LOOKUP_BUSY_LABEL
    }
    if (uploadPipeline && preloadFlowReady) {
      if (!giftQueriesReady && !giftStageError) {
        return '사은품 기준을 불러오고 있습니다.'
      }
      if (!giftStageSettled) {
        return '사은품 추가를 계산하고 있습니다.'
      }
      if (workInstructionsQuery.isLoading && !workInstructionsError) {
        return '작업 지시를 불러오고 있습니다.'
      }
      if (!workStageSettled) {
        return '작업 지시를 계산하고 있습니다.'
      }
      if (!productQueriesReady && !productStageError) {
        return '품목명 변환 기준을 불러오고 있습니다.'
      }
      if (!productStageSettled) {
        return '품목명 변환을 계산하고 있습니다.'
      }
      if (!productAiPipeline.settled) {
        if (productAiPipeline.collecting && productAiPipeline.total > 0) {
          return `품목명 전체 AI 추천을 모으고 있습니다. ${formatNumber(productAiPipeline.done)} / ${formatNumber(productAiPipeline.total)}`
        }
        return '품목명 전체 AI 추천을 준비하고 있습니다.'
      }
      if (itemNameCriteriaLoading && !itemNameCriteriaError) {
        return '내품명 변환 기준을 불러오고 있습니다.'
      }
      if (!itemStageSettled) {
        return '내품명 변환을 계산하고 있습니다.'
      }
      if (
        canBuildLaterStages &&
        !isStepComputeSettled(listCompute.status)
      ) {
        return '상품 리스트를 계산하고 있습니다.'
      }
      if (
        canBuildLaterStages &&
        !isStepComputeSettled(outputCompute.status)
      ) {
        return '최종 행을 계산하고 있습니다.'
      }
      if (canBuildLaterStages && outputSupportBusyLabel) {
        return outputSupportBusyLabel
      }
      if (canBuildLaterStages && productListSupportBusyLabel) {
        return productListSupportBusyLabel
      }
      return '업로드 작업을 마무리하고 있습니다.'
    }
    if (activeStep === 'check') {
      if (!backupLookupReady || (hasBackedUpMatch && !backedUpExclusionAccepted)) {
        return null
      }
      if (
        usageTargetsQuery.isLoading ||
        usageAliasesQuery.isLoading ||
        usageFoldersQuery.isLoading
      ) {
        return '쇼핑몰명 연결 기준을 불러오고 있습니다.'
      }
      return null
    }
    if (activeStep === 'gift') {
      if (
        giftRequestsError ||
        giftSourceMapsError ||
        giftSourceAllocationsError ||
        giftCompute.error
      ) {
        return null
      }
      if (!giftQueriesReady) return '사은품 기준을 불러오고 있습니다.'
      if (
        giftCompute.status === 'computing' ||
        !giftPlan ||
        !giftEligibilityPlan
      ) {
        return '사은품 추가를 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'instruction') {
      if (workInstructionsError || workCompute.error) return null
      if (workInstructionsQuery.isLoading) {
        return '작업 지시를 불러오고 있습니다.'
      }
      if (workCompute.status === 'computing' || !workPlan) {
        return '작업 지시를 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'product') {
      if (productTransformation) return null
      if (
        productNameMapsError ||
        productNameExclusionsError ||
        giftSourceMapsError ||
        giftSourceAllocationsError ||
        productCompute.error
      ) {
        return null
      }
      if (!productQueriesReady) return '품목명 변환 기준을 불러오고 있습니다.'
      if (productCompute.status === 'computing') {
        return '품목명 변환을 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'item') {
      if (itemTransformation) return null
      if (itemNameCriteriaError || itemCompute.error) return null
      if (productCompute.status === 'computing') {
        return '품목명 변환 결과를 맞추고 있습니다.'
      }
      if (itemNameCriteriaLoading) {
        return '내품명 변환 기준을 불러오고 있습니다.'
      }
      if (itemCompute.status === 'computing') {
        return '내품명 변환을 계산하고 있습니다.'
      }
      return null
    }
    if (activeStep === 'stock') {
      if (!itemTransformation || !workPlan || !giftPlan) {
        return '이전 단계 결과를 기다리고 있습니다.'
      }
      if (
        discontinuedStylesQuery.isLoading ||
        preorderHoldsQuery.isLoading
      ) {
        return '단종·예발 기준을 불러오고 있습니다.'
      }
      return null
    }
    if (activeStep === 'list') {
      if (listCompute.error) return null
      if (listCompute.status === 'computing' || !listCompute.result) {
        return '상품 리스트를 계산하고 있습니다.'
      }
      if (productListSupportBusyLabel) return productListSupportBusyLabel
      return null
    }
    if (activeStep === 'output') {
      if (outputCompute.error) return null
      if (outputCompute.status === 'computing' || !outputCompute.result) {
        return '최종 행을 계산하고 있습니다.'
      }
      if (outputSupportBusyLabel) return outputSupportBusyLabel
      return null
    }
    return null
  })()
  return {
    workspaceActive,
    todayStepBusyLabel,
    uploadPipeline,
    isParsing,
    brand,
    activeView,
    selectView,
    stepIndex,
    maxStepIndex,
    isStepPending,
    changeTodayStep,
    activeStep,
    visitedStepsRef,
    inputRef,
    setIsDragging,
    handleFile,
    isDragging,
    error,
    inspection,
    fileName,
    setStep,
    fileReady,
    headerReady,
    mallPartnersReady,
    mallResolution,
    backupLookupBusy,
    productNameExclusionsQuery,
    backedUpLookupQuery,
    hasBackedUpMatch,
    backedUpMatch,
    backedUpExclusionAccepted,
    workRows,
    setBackupDialogOpen,
    mallCategory,
    usageTargetsQuery,
    usageAliasesQuery,
    usageFoldersQuery,
    setMallDialogOpen,
    resetFile,
    canLeaveFileCheck,
    goNextStep,
    backupDialogOpen,
    preConfirmReady,
    setBackedUpExclusionAccepted,
    giftQueriesReady,
    giftCompute,
    giftPlan,
    giftEligibilityPlan,
    giftRequestsError,
    giftSourceMapsError,
    giftSourceAllocationsError,
    giftRequestsQuery,
    giftAllocationsQuery,
    giftSourceMapsQuery,
    giftSourceAllocationsQuery,
    productNameTagRolesQuery,
    prefixRows,
    giftRequests,
    giftAllocations,
    giftResolutions,
    setGiftResolutions,
    giftSeed,
    excludedGiftStyleIds,
    setGiftSeed,
    setExcludedGiftStyleIds,
    workInstructionsQuery,
    workCompute,
    workPlan,
    workInstructionsError,
    processRows,
    workInstructions,
    reachedProduct,
    productStepBlock,
    productQueriesReady,
    productStepError,
    retryProductStep,
    productTransformation,
    productCompute,
    workGeneration,
    productRowKeyIndex,
    matchedProductTransformation,
    productAiAutoCollect,
    handleProductAiProgress,
    handleProductAiSettled,
    setProductSaveBlockCount,
    giftSourcePlan,
    handleOpenGiftSetup,
    productSaveBlockCount,
    nameTransformation,
    itemTransformation,
    computeItemTransformation,
    reachedItem,
    itemStepBlock,
    itemQueriesReady,
    itemStepError,
    retryItemStep,
    itemCompute,
    itemNameRules,
    accessoryRules,
    productStyleLookupQuery,
    reachedOutboundReflect,
    outboundBackupBusy,
    currentGenerationBackedUp,
    outboundReflectLedger,
    backupOutboundReflect,
    outboundBackupMessage,
    outboundBackupIsError,
    outboundReflectSummary,
    reachedStock,
    discontinuedStylesQuery,
    preorderHoldsQuery,
    stockHoldBundles,
    handleStockHoldExcludedChange,
    listCompute,
    optionMapsQuery,
    itemNameRulesQuery,
    workOptionMapsQuery,
    workItemNameRulesQuery,
    accessoryRulesQuery,
    outputCompute,
    workProductNameMapsQuery,
    excludedProductTransformation,
    campaignRows,
    deferredProductNameTagRoles,
    giftSourceSessionRuleMap,
    giftSourceSessionAllocationMap,
    giftSourceIgnoredKeySet,
    giftSourceEffectiveAppliedKeys,
    nameRules,
    nameRulesQuery,
    nameRulesError,
    optionMaps,
    optionMapsError,
    rulesProductNameMaps,
    rulesProductNameMapsQuery,
    rulesProductNameMapsError,
    giftSourceMaps,
    mallDialogOpen,
    mallCategoryKey,
    scopedUsageTargets,
    usageAliases,
    usageFolders,
    giftSetupGroup,
    giftSourceApplyingKey,
    giftSourceError,
    setGiftSourceError,
    setGiftSetupTarget,
    applyGiftSourceSession,
    applyGiftSourcePersist,
    mallCategoryLocked,
    setMallCategoryKey,
    mallCategories,
  }
}

export type InvoiceWorkModel = ReturnType<typeof useInvoiceWorkController>
