import { useEffect, useMemo } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getInvoiceGiftAllocations,
  getInvoiceGiftRequests,
  getInvoiceGiftSourceAllocations,
  getInvoiceGiftSourceMaps,
  getInvoiceAccessoryRules,
  getInvoiceDiscontinuedStyles,
  getInvoiceItemNameRules,
  getInvoiceItemNameRulesForItemNames,
  getInvoiceNameRules,
  getInvoiceOptionMaps,
  getInvoiceOptionMapsForCombos,
  getInvoicePreorderHolds,
  getInvoiceProductNameExclusions,
  getInvoiceProductNameMaps,
  getInvoiceProductNameMapsForLookupKeys,
  getInvoiceProductNameTagRoles,
  getCodeUsageTargetAliases,
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  getInvoiceWorkInstructions,
  getAiFeatureRoute,
  listAllStyleRefs,
  getActiveWarehouseInventorySet,
  getBrandFields,
  getInvoicePackingSizeMaps,
  getStylesByBrand,
  getWarehouseStockPositions,
  lookupInvoiceBackedUpOrderKeys,
} from '@/lib/api'
import { ITEM_NAME_FEATURE_KEY } from '@/lib/ai/gateway-core'

import { normalizePackingSizeValue, PACKING_SIZE_SOURCE_FIELD_LABEL } from '@/lib/invoice/packing-size-map'

import {
  INVOICE_ITEM_NAME_RULES_QUERY_KEY,
  INVOICE_ITEM_NAME_RULES_WORK_QUERY_KEY,
  INVOICE_OPTION_MAPS_QUERY_KEY,
  INVOICE_OPTION_MAPS_WORK_QUERY_KEY,
} from '@/lib/invoice/invoice-work-query-keys'

import { type InvoiceProductNameTransformation } from '@/lib/invoice/product-name-transform'

import { hashInvoiceOrderKeyPayloads, matchBackedUpInvoiceOrderKeys } from '@/lib/invoice/invoice-order-key'

import { type SabangnetInspection } from '@/lib/invoice/sabangnet'

import type { Brand } from '@/lib/types'
import type { InvoiceOrderKeyGroup } from '@/lib/invoice/invoice-order-key'
import type { OptionMapLookupCombo } from '@/lib/invoice/invoice-item-criteria-keys'
import { TODAY_STEP_INDEX } from './invoice-work-steps'

const PRODUCT_FEATURE_KEY = 'invoice_product_recommendation'

// 송장 기준 조회. 키·활성화 조건·스냅샷 캐시 정책과 조회 순서는 기존 페이지와 동일하다.
function invoiceCriteriaQueryOptions(snapshot: boolean) {
  // 창 포커스 재조회는 전역에서 끈다(App.tsx). 작업 중 원장이 통째로 다시 맞춰지는 것을 막는다.
  return {
    staleTime: snapshot ? Infinity : 5 * 60_000,
  }
}

function prefetchInvoiceWorkCriteria(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
) {
  const options = { staleTime: 5 * 60_000 }
  void Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['invoice-name-rules', brandId],
      queryFn: () => getInvoiceNameRules(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-accessory-rules', brandId],
      queryFn: () => getInvoiceAccessoryRules(brandId, true),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-exclusions', brandId],
      queryFn: () => getInvoiceProductNameExclusions(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-tag-roles', brandId],
      queryFn: () => getInvoiceProductNameTagRoles(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-prefix-requests', brandId],
      queryFn: () => getInvoiceGiftRequests(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-gift-allocations', brandId],
      queryFn: () => getInvoiceGiftAllocations(brandId, { activeOnly: false }),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-work-instructions', brandId],
      queryFn: () => getInvoiceWorkInstructions(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-preorder-holds', brandId, 'active'],
      queryFn: () => getInvoicePreorderHolds(brandId, 'active'),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-discontinued-styles', brandId],
      queryFn: () => getInvoiceDiscontinuedStyles(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-gift-source-maps', brandId],
      queryFn: () => getInvoiceGiftSourceMaps(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['invoice-product-name-all-styles', brandId],
      queryFn: () => listAllStyleRefs(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['codeUsageTargets', brandId],
      queryFn: () => getCodeUsageTargets(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['codeUsageTargetAliases', brandId],
      queryFn: () => getCodeUsageTargetAliases(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['codeUsageTargetFolders', brandId],
      queryFn: () => getCodeUsageTargetFolders(brandId),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['ai-feature-route', brandId, PRODUCT_FEATURE_KEY],
      queryFn: () => getAiFeatureRoute(brandId, PRODUCT_FEATURE_KEY),
      ...options,
    }),
    queryClient.prefetchQuery({
      queryKey: ['ai-feature-route', brandId, ITEM_NAME_FEATURE_KEY],
      queryFn: () => getAiFeatureRoute(brandId, ITEM_NAME_FEATURE_KEY),
      ...options,
    }),
  ])
}

export function useInvoiceBaseCriteria({
  criteriaSnapshot,
  queryClient,
  brand,
  rulesView,
  reachedProduct,
  reachedItem,
  inspection,
  reachedGift,
  reachedStock,
  reachedStepIndex,
  reachedInstruction,
}: {
  criteriaSnapshot: boolean
  queryClient: ReturnType<typeof useQueryClient>
  brand: Pick<Brand, "id">
  rulesView: boolean
  reachedProduct: boolean
  reachedItem: boolean
  inspection: SabangnetInspection | null
  reachedGift: boolean
  reachedStock: boolean
  reachedStepIndex: number
  reachedInstruction: boolean
}) {
  const criteriaQueryOptions = invoiceCriteriaQueryOptions(criteriaSnapshot)
  useEffect(() => {
    prefetchInvoiceWorkCriteria(queryClient, brand.id)
  }, [brand.id, queryClient])
  const nameRulesQuery = useQuery({
    queryKey: ['invoice-name-rules', brand.id],
    queryFn: () => getInvoiceNameRules(brand.id),
    enabled: rulesView || reachedProduct,
    ...criteriaQueryOptions,
  })
  const optionMapsQuery = useQuery({
    queryKey: [INVOICE_OPTION_MAPS_QUERY_KEY, brand.id],
    queryFn: () => getInvoiceOptionMaps(brand.id),
    enabled: rulesView,
    ...criteriaQueryOptions,
  })
  const itemNameRulesQuery = useQuery({
    queryKey: [INVOICE_ITEM_NAME_RULES_QUERY_KEY, brand.id],
    queryFn: () => getInvoiceItemNameRules(brand.id),
    enabled: rulesView,
    ...criteriaQueryOptions,
  })
  const accessoryRulesQuery = useQuery({
    queryKey: ['invoice-accessory-rules', brand.id],
    queryFn: () => getInvoiceAccessoryRules(brand.id, true),
    enabled: reachedItem,
    ...criteriaQueryOptions,
  })
  const rulesProductNameMapsQuery = useQuery({
    queryKey: ['invoice-product-name-maps', brand.id],
    queryFn: () => getInvoiceProductNameMaps(brand.id),
    enabled: rulesView,
    ...criteriaQueryOptions,
  })
  const productNameExclusionsQuery = useQuery({
    queryKey: ['invoice-product-name-exclusions', brand.id],
    queryFn: () => getInvoiceProductNameExclusions(brand.id),
    enabled: rulesView || Boolean(inspection),
    ...criteriaQueryOptions,
  })
  const productNameTagRolesQuery = useQuery({
    queryKey: ['invoice-product-name-tag-roles', brand.id],
    queryFn: () => getInvoiceProductNameTagRoles(brand.id),
    enabled: rulesView || reachedGift,
    ...criteriaQueryOptions,
  })
  const preorderHoldsQuery = useQuery({
    queryKey: ['invoice-preorder-holds', brand.id, 'active'],
    queryFn: () => getInvoicePreorderHolds(brand.id, 'active'),
    enabled: rulesView || reachedStock,
    ...criteriaQueryOptions,
  })
  const discontinuedStylesQuery = useQuery({
    queryKey: ['invoice-discontinued-styles', brand.id],
    queryFn: () => getInvoiceDiscontinuedStyles(brand.id),
    enabled: rulesView || reachedStock,
    ...criteriaQueryOptions,
  })
  const usageTargetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
    enabled: Boolean(inspection) && reachedStepIndex >= TODAY_STEP_INDEX.check,
    ...criteriaQueryOptions,
  })
  const usageAliasesQuery = useQuery({
    queryKey: ['codeUsageTargetAliases', brand.id],
    queryFn: () => getCodeUsageTargetAliases(brand.id),
    enabled: Boolean(inspection) && reachedStepIndex >= TODAY_STEP_INDEX.check,
    ...criteriaQueryOptions,
  })
  const usageFoldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
    enabled: Boolean(inspection) && reachedStepIndex >= TODAY_STEP_INDEX.check,
    ...criteriaQueryOptions,
  })
  const giftRequestsQuery = useQuery({
    queryKey: ['invoice-prefix-requests', brand.id],
    queryFn: () => getInvoiceGiftRequests(brand.id),
    enabled: rulesView || reachedGift,
    ...criteriaQueryOptions,
  })
  const giftAllocationsQuery = useQuery({
    queryKey: ['invoice-gift-allocations', brand.id],
    queryFn: () => getInvoiceGiftAllocations(brand.id, { activeOnly: false }),
    enabled: reachedGift,
    ...criteriaQueryOptions,
  })
  const workInstructionsQuery = useQuery({
    queryKey: ['invoice-work-instructions', brand.id],
    queryFn: () => getInvoiceWorkInstructions(brand.id),
    enabled: rulesView || reachedInstruction,
    ...criteriaQueryOptions,
  })
  const giftSourceMapsQuery = useQuery({
    queryKey: ['invoice-gift-source-maps', brand.id],
    queryFn: () => getInvoiceGiftSourceMaps(brand.id),
    enabled: rulesView || reachedGift,
    ...criteriaQueryOptions,
  })
  return { criteriaQueryOptions, nameRulesQuery, optionMapsQuery, itemNameRulesQuery, accessoryRulesQuery, rulesProductNameMapsQuery, productNameExclusionsQuery, productNameTagRolesQuery, preorderHoldsQuery, discontinuedStylesQuery, usageTargetsQuery, usageAliasesQuery, usageFoldersQuery, giftRequestsQuery, giftAllocationsQuery, workInstructionsQuery, giftSourceMapsQuery }
}

export function useInvoiceBackupCriteria({
  brand,
  workGeneration,
  orderKeyPayloadSig,
  orderKeyGroups,
  inspection,
  currentGenerationBackedUp,
}: {
  brand: Pick<Brand, "id">
  workGeneration: number
  orderKeyPayloadSig: string
  orderKeyGroups: InvoiceOrderKeyGroup[]
  inspection: SabangnetInspection | null
  currentGenerationBackedUp: boolean
}) {
  const backedUpLookupQuery = useQuery({
    queryKey: [
      'invoiceBackedUpOrderKeys',
      brand.id,
      workGeneration,
      orderKeyPayloadSig,
    ],
    queryFn: async () => {
      const hashes = await hashInvoiceOrderKeyPayloads(
        orderKeyGroups.map((group) => group.payload),
      )
      const hits = await lookupInvoiceBackedUpOrderKeys(brand.id, hashes)
      return matchBackedUpInvoiceOrderKeys(orderKeyGroups, hashes, hits)
    },
    enabled:
      Boolean(inspection) &&
      orderKeyGroups.length > 0 &&
      !currentGenerationBackedUp,
  })
  return { backedUpLookupQuery }
}

export function useInvoiceProductMapCriteria({
  brand,
  productLookupTextSig,
  productLookupTexts,
  reachedProduct,
  inspection,
  backupLookupReady,
  productNameTagRolesQuery,
  criteriaQueryOptions,
}: {
  brand: Pick<Brand, "id">
  productLookupTextSig: string
  productLookupTexts: string[]
  reachedProduct: boolean
  inspection: SabangnetInspection | null
  backupLookupReady: boolean
  productNameTagRolesQuery: { isSuccess: boolean }
  criteriaQueryOptions: ReturnType<typeof invoiceCriteriaQueryOptions>
}) {
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
      backupLookupReady &&
      productNameTagRolesQuery.isSuccess,
    ...criteriaQueryOptions,
  })
  return { workProductNameMapsQuery }
}

export function useInvoiceGiftSourceCriteria({
  brand,
  giftSourceFileMapIds,
  reachedGift,
  inspection,
  backupLookupReady,
}: {
  brand: Pick<Brand, "id">
  giftSourceFileMapIds: string[]
  reachedGift: boolean
  inspection: SabangnetInspection | null
  backupLookupReady: boolean
}) {
  const giftSourceAllocationsQuery = useQuery({
    queryKey: ['invoice-gift-source-allocations', brand.id, giftSourceFileMapIds],
    queryFn: () =>
      getInvoiceGiftSourceAllocations(brand.id, {
        mapIds: giftSourceFileMapIds,
      }),
    enabled:
      reachedGift &&
      Boolean(inspection) &&
      backupLookupReady &&
      giftSourceFileMapIds.length > 0,
  })
  return { giftSourceAllocationsQuery }
}

export function useInvoiceStyleCriteria({
  brand,
  reachedProduct,
  inspection,
  criteriaQueryOptions,
}: {
  brand: Pick<Brand, "id">
  reachedProduct: boolean
  inspection: SabangnetInspection | null
  criteriaQueryOptions: ReturnType<typeof invoiceCriteriaQueryOptions>
}) {
  const productStyleLookupQuery = useQuery({
    queryKey: ['invoice-product-name-all-styles', brand.id],
    queryFn: () => listAllStyleRefs(brand.id),
    enabled: reachedProduct && Boolean(inspection),
    ...criteriaQueryOptions,
  })
  return { productStyleLookupQuery }
}

export function useInvoiceItemCriteria({
  brand,
  optionMapComboSig,
  optionMapCombos,
  reachedItem,
  inspection,
  productTransformation,
  criteriaQueryOptions,
  itemNameLookupSig,
  itemNameLookupTexts,
}: {
  brand: Pick<Brand, "id">
  optionMapComboSig: string
  optionMapCombos: OptionMapLookupCombo[]
  reachedItem: boolean
  inspection: SabangnetInspection | null
  productTransformation: InvoiceProductNameTransformation | null
  criteriaQueryOptions: ReturnType<typeof invoiceCriteriaQueryOptions>
  itemNameLookupSig: string
  itemNameLookupTexts: string[]
}) {
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
  return { workOptionMapsQuery, workItemNameRulesQuery }
}

export function useInvoiceLaterStageCriteria({
  brand,
  laterStageSupportEnabled,
  reachedStepIndex,
}: {
  brand: Pick<Brand, "id">
  laterStageSupportEnabled: boolean
  reachedStepIndex: number
}) {
  const laterWarehouseSetQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brand.id],
    queryFn: () => getActiveWarehouseInventorySet(brand.id),
    enabled: laterStageSupportEnabled,
  })
  const laterWarehousePositionsQuery = useQuery({
    queryKey: [
      'warehouse-stock-positions',
      brand.id,
      laterWarehouseSetQuery.data?.id,
    ],
    queryFn: () =>
      getWarehouseStockPositions(brand.id, laterWarehouseSetQuery.data!.id),
    enabled:
      laterStageSupportEnabled && Boolean(laterWarehouseSetQuery.data?.id),
  })
  const laterBrandFieldsQuery = useQuery({
    queryKey: ['brand-fields', brand.id],
    queryFn: () => getBrandFields(brand.id),
    enabled:
      laterStageSupportEnabled &&
      reachedStepIndex >= TODAY_STEP_INDEX.output,
  })
  const laterPackingField = useMemo(() => {
    const target = normalizePackingSizeValue(PACKING_SIZE_SOURCE_FIELD_LABEL)
    return (
      laterBrandFieldsQuery.data?.find(
        (item) => normalizePackingSizeValue(item.label) === target,
      ) ?? null
    )
  }, [laterBrandFieldsQuery.data])
  const laterPackingMapsQuery = useQuery({
    queryKey: [
      'invoice-packing-size-maps',
      brand.id,
      laterPackingField?.id ?? '',
    ],
    queryFn: () => getInvoicePackingSizeMaps(brand.id, laterPackingField!.id),
    enabled:
      laterStageSupportEnabled &&
      reachedStepIndex >= TODAY_STEP_INDEX.output &&
      Boolean(laterPackingField?.id),
  })
  const laterStylesQuery = useQuery({
    queryKey: ['styles', brand.id],
    queryFn: () => getStylesByBrand(brand.id),
    enabled:
      laterStageSupportEnabled &&
      reachedStepIndex >= TODAY_STEP_INDEX.output,
  })
  return { laterWarehouseSetQuery, laterWarehousePositionsQuery, laterBrandFieldsQuery, laterPackingField, laterPackingMapsQuery, laterStylesQuery }
}
