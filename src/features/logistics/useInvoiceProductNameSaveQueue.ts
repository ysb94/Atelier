import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  logInvoiceWork,
  timeInvoiceWorkAsync,
} from '@/lib/invoice/invoice-work-perf'
import {
  INVOICE_OPTION_MAPS_QUERY_KEY,
  INVOICE_OPTION_MAPS_WORK_QUERY_KEY,
} from '@/lib/invoice/invoice-work-query-keys'
import { invalidateAiRecommendationQueries } from '@/lib/ai/query-cache'
import {
  deleteInvoiceOptionMap,
  saveInvoiceOptionMap,
  saveInvoiceProductNameMap,
  undoInvoiceProductNameMap,
} from '@/lib/api'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  AiProductRecommendation,
  InvoiceOptionMap,
  InvoiceProductNameMap,
  StyleRef,
} from '@/lib/types'
import {
  completedOptionExtras,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'

export type ProductMapSaveFeedback = {
  source: 'local' | 'ai' | 'manual'
  cacheId: string | null
  shownRank: number | null
  provider: AiProductRecommendation['provider'] | null
  modelId: string | null
  suggestedStyleId?: string | null
  outcome?: 'confirmed' | 'corrected'
}

export type ProductMapHistoryStatus =
  | 'queued'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'undoing'
  | 'undone'
  | 'undo_failed'

export type ProductMapHistoryEntry = {
  id: string
  comboKey: string
  productName: string
  itemName: string
  originalItemName: string
  mallName: string
  ownProductCode: string
  lookupKey: string
  style: StyleRef
  extras: OptionExtraDraft[]
  appliedRule: string | null
  feedback: ProductMapSaveFeedback
  status: ProductMapHistoryStatus
  error: string | null
  createdAt: number
  savedMap: InvoiceProductNameMap | null
  previousMap: InvoiceProductNameMap | null
  savedOptionMap: InvoiceOptionMap | null
  previousOptionMap: InvoiceOptionMap | null
  wasCreate: boolean
  optionWasCreate: boolean
  reviewReasons: string[]
}

export type ProductMapEnqueueInput = {
  historyId?: string
  comboKey: string
  productName: string
  itemName: string
  originalItemName?: string
  mallName: string
  ownProductCode?: string
  lookupKey: string
  style: StyleRef
  extras?: OptionExtraDraft[]
  appliedRule: string | null
  feedback: ProductMapSaveFeedback
  reviewReasons?: string[]
}

export type ProductMapSaveDraft = {
  lookupKey: string
  style: StyleRef
  extras: OptionExtraDraft[]
  error: string
}

const PRODUCT_MAP_SAVE_LIMIT = 3

export function productMapSaveIdentity(input: {
  lookupKey: string
  styleId: string
}) {
  return `${normalizeInvoiceText(input.lookupKey)}\u0000${input.styleId}`
}

type SharedProductMapSave = {
  identity: string
  consumerIds: Set<string>
  promise: Promise<{
    saved: InvoiceProductNameMap
    previousMap: InvoiceProductNameMap | null
  }>
}

function applyInvoiceProductNameMapUpsert(
  maps: InvoiceProductNameMap[],
  saved: InvoiceProductNameMap,
) {
  const next = maps.filter((map) => {
    if (map.id === saved.id) return false
    return !(
      saved.normalizedLookupKey &&
      map.normalizedLookupKey === saved.normalizedLookupKey
    )
  })
  return [saved, ...next]
}

function applyInvoiceOptionMapUpsert(
  maps: InvoiceOptionMap[],
  saved: InvoiceOptionMap,
) {
  return [saved, ...maps.filter((map) => map.id !== saved.id)]
}

const PRODUCT_NAME_MAPS_QUERY_KEY = 'invoice-product-name-maps'
const PRODUCT_NAME_MAPS_WORK_QUERY_KEY = 'invoice-product-name-maps-for-work'

function cachedProductNameMaps(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
): InvoiceProductNameMap[] {
  const full =
    queryClient.getQueryData<InvoiceProductNameMap[]>([
      PRODUCT_NAME_MAPS_QUERY_KEY,
      brandId,
    ]) ?? []
  const work = queryClient
    .getQueriesData<InvoiceProductNameMap[]>({
      queryKey: [PRODUCT_NAME_MAPS_WORK_QUERY_KEY, brandId],
    })
    .flatMap(([, data]) => data ?? [])
  if (work.length === 0) return full
  const seen = new Set(full.map((map) => map.id))
  const merged = [...full]
  for (const map of work) {
    if (seen.has(map.id)) continue
    seen.add(map.id)
    merged.push(map)
  }
  return merged
}

function writeProductNameMapCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  apply: (maps: InvoiceProductNameMap[]) => InvoiceProductNameMap[],
) {
  const fullKey = [PRODUCT_NAME_MAPS_QUERY_KEY, brandId] as const
  if (queryClient.getQueryData(fullKey)) {
    queryClient.setQueryData<InvoiceProductNameMap[]>(fullKey, (maps = []) =>
      apply(maps),
    )
  } else {
    void queryClient.invalidateQueries({ queryKey: fullKey })
  }

  const workQueries = queryClient.getQueriesData<InvoiceProductNameMap[]>({
    queryKey: [PRODUCT_NAME_MAPS_WORK_QUERY_KEY, brandId],
  })
  if (workQueries.length === 0) {
    void queryClient.invalidateQueries({
      queryKey: [PRODUCT_NAME_MAPS_WORK_QUERY_KEY, brandId],
    })
    return
  }
  for (const [queryKey] of workQueries) {
    queryClient.setQueryData<InvoiceProductNameMap[]>(queryKey, (maps = []) =>
      apply(maps),
    )
  }
}

export function upsertInvoiceProductNameMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  saved: InvoiceProductNameMap,
) {
  writeProductNameMapCaches(queryClient, brandId, (maps) =>
    applyInvoiceProductNameMapUpsert(maps, saved),
  )
}

function findMapByLookupKey(
  maps: InvoiceProductNameMap[],
  lookupKey: string,
): InvoiceProductNameMap | null {
  const key = normalizeInvoiceText(lookupKey)
  if (!key) return null
  return maps.find((map) => map.normalizedLookupKey === key) ?? null
}

export function findOptionMapByCombo(
  maps: InvoiceOptionMap[],
  mallName: string,
  productName: string,
  itemName: string,
): InvoiceOptionMap | null {
  const mall = normalizeInvoiceText(mallName)
  const product = normalizeInvoiceText(productName)
  const item = normalizeInvoiceText(itemName)
  const exact = maps.find(
    (map) =>
      map.normalizedMallName === mall &&
      map.normalizedProductName === product &&
      map.normalizedItemName === item,
  )
  if (exact) return exact
  return (
    maps.find(
      (map) =>
        !map.normalizedMallName &&
        map.normalizedProductName === product &&
        map.normalizedItemName === item,
    ) ?? null
  )
}

export function findOptionMapByComboPreferring(
  maps: InvoiceOptionMap[],
  mallName: string,
  productName: string,
  preferredItemName: string,
  fallbackItemName: string,
) {
  return (
    findOptionMapByCombo(maps, mallName, productName, preferredItemName) ??
    (preferredItemName !== fallbackItemName
      ? findOptionMapByCombo(maps, mallName, productName, fallbackItemName)
      : null)
  )
}

function cachedOptionMaps(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
): InvoiceOptionMap[] {
  const full =
    queryClient.getQueryData<InvoiceOptionMap[]>([
      INVOICE_OPTION_MAPS_QUERY_KEY,
      brandId,
    ]) ?? []
  const work = queryClient
    .getQueriesData<InvoiceOptionMap[]>({
      queryKey: [INVOICE_OPTION_MAPS_WORK_QUERY_KEY, brandId],
    })
    .flatMap(([, data]) => data ?? [])
  if (work.length === 0) return full
  const seen = new Set(full.map((map) => map.id))
  const merged = [...full]
  for (const map of work) {
    if (seen.has(map.id)) continue
    seen.add(map.id)
    merged.push(map)
  }
  return merged
}

function writeInvoiceOptionMapCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  apply: (maps: InvoiceOptionMap[]) => InvoiceOptionMap[],
) {
  const keys = [
    [INVOICE_OPTION_MAPS_QUERY_KEY, brandId] as const,
    ...queryClient
      .getQueriesData<InvoiceOptionMap[]>({
        queryKey: [INVOICE_OPTION_MAPS_WORK_QUERY_KEY, brandId],
      })
      .map(([queryKey]) => queryKey),
  ]
  let touched = false
  for (const queryKey of keys) {
    if (!queryClient.getQueryData(queryKey)) continue
    touched = true
    queryClient.setQueryData<InvoiceOptionMap[]>(queryKey, (maps = []) =>
      apply(maps),
    )
  }
  if (!touched) {
    void queryClient.invalidateQueries({
      queryKey: [INVOICE_OPTION_MAPS_QUERY_KEY, brandId],
    })
    void queryClient.invalidateQueries({
      queryKey: [INVOICE_OPTION_MAPS_WORK_QUERY_KEY, brandId],
    })
  }
}

export function upsertInvoiceOptionMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  saved: InvoiceOptionMap,
) {
  writeInvoiceOptionMapCaches(queryClient, brandId, (maps) =>
    applyInvoiceOptionMapUpsert(maps, saved),
  )
}

function removeInvoiceOptionMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  mapId: string,
) {
  writeInvoiceOptionMapCaches(queryClient, brandId, (maps) =>
    maps.filter((map) => map.id !== mapId),
  )
}

function newHistoryId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const CACHE_FLUSH_MS = 32
const AI_USAGE_INVALIDATE_MS = 400

export function useInvoiceProductNameSaveQueue(brandId: string) {
  const queryClient = useQueryClient()
  const [history, setHistory] = useState<ProductMapHistoryEntry[]>([])
  const historyRef = useRef(history)
  const saveActiveRef = useRef(0)
  const savePumpingRef = useRef(false)
  const saveInFlightRef = useRef(new Set<string>())
  const sharedProductMapSavesRef = useRef(
    new Map<string, SharedProductMapSave>(),
  )
  const pendingProductMapsRef = useRef<InvoiceProductNameMap[]>([])
  const pendingOptionMapsRef = useRef<InvoiceOptionMap[]>([])
  const historyFlushRafRef = useRef<number | null>(null)
  const cacheFlushTimerRef = useRef<number | null>(null)
  const aiUsageTimerRef = useRef<number | null>(null)

  const patchHistory = useCallback(
    (patch: (current: ProductMapHistoryEntry[]) => ProductMapHistoryEntry[]) => {
      historyRef.current = patch(historyRef.current)
      if (historyFlushRafRef.current != null) return
      historyFlushRafRef.current = requestAnimationFrame(() => {
        historyFlushRafRef.current = null
        setHistory(historyRef.current)
      })
    },
    [],
  )

  const flushCaches = useCallback(() => {
    cacheFlushTimerRef.current = null
    const products = pendingProductMapsRef.current
    pendingProductMapsRef.current = []
    const options = pendingOptionMapsRef.current
    pendingOptionMapsRef.current = []
    if (products.length > 0) {
      writeProductNameMapCaches(queryClient, brandId, (maps) => {
        let next = maps
        for (const saved of products) {
          next = applyInvoiceProductNameMapUpsert(next, saved)
        }
        return next
      })
      logInvoiceWork('product-map-cache-flush', { count: products.length })
    }
    if (options.length > 0) {
      writeInvoiceOptionMapCaches(queryClient, brandId, (maps) => {
        let next = maps
        for (const saved of options) {
          next = applyInvoiceOptionMapUpsert(next, saved)
        }
        return next
      })
    }
  }, [brandId, queryClient])

  const queueProductMapUpsert = useCallback(
    (saved: InvoiceProductNameMap) => {
      pendingProductMapsRef.current.push(saved)
      if (cacheFlushTimerRef.current != null) return
      cacheFlushTimerRef.current = window.setTimeout(flushCaches, CACHE_FLUSH_MS)
    },
    [flushCaches],
  )

  const queueOptionMapUpsert = useCallback(
    (saved: InvoiceOptionMap) => {
      pendingOptionMapsRef.current.push(saved)
      if (cacheFlushTimerRef.current != null) return
      cacheFlushTimerRef.current = window.setTimeout(flushCaches, CACHE_FLUSH_MS)
    },
    [flushCaches],
  )

  const scheduleAiUsageInvalidate = useCallback(() => {
    if (aiUsageTimerRef.current != null) return
    aiUsageTimerRef.current = window.setTimeout(() => {
      aiUsageTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: ['ai-usage-summary', brandId],
      })
    }, AI_USAGE_INVALIDATE_MS)
  }, [brandId, queryClient])

  useEffect(
    () => () => {
      if (historyFlushRafRef.current != null) {
        cancelAnimationFrame(historyFlushRafRef.current)
      }
      if (cacheFlushTimerRef.current != null) {
        window.clearTimeout(cacheFlushTimerRef.current)
      }
      if (aiUsageTimerRef.current != null) {
        window.clearTimeout(aiUsageTimerRef.current)
      }
    },
    [],
  )

  const activeComboKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const entry of history) {
      if (entry.status === 'queued' || entry.status === 'saving') {
        keys.add(entry.comboKey)
      }
    }
    return keys
  }, [history])

  const failedDrafts = useMemo(() => {
    const drafts: Record<string, ProductMapSaveDraft> = {}
    for (const entry of history) {
      if (entry.status !== 'failed' || !entry.error) continue
      drafts[entry.comboKey] = {
        lookupKey: entry.lookupKey,
        style: entry.style,
        extras: entry.extras,
        error: entry.error,
      }
    }
    return drafts
  }, [history])

  const savingCount = useMemo(
    () =>
      history.filter(
        (entry) => entry.status === 'queued' || entry.status === 'saving',
      ).length,
    [history],
  )

  const failedCount = useMemo(
    () => history.filter((entry) => entry.status === 'failed').length,
    [history],
  )

  const pump = useCallback(async () => {
    if (savePumpingRef.current) return
    savePumpingRef.current = true
    try {
      while (true) {
        const queued = historyRef.current.filter(
          (entry) =>
            entry.status === 'queued' && !saveInFlightRef.current.has(entry.id),
        )
        if (queued.length === 0) break
        const slots = PRODUCT_MAP_SAVE_LIMIT - saveActiveRef.current
        if (slots <= 0) break
        const batch = queued.slice(0, slots)
        await Promise.all(
          batch.map(async (entry) => {
            saveInFlightRef.current.add(entry.id)
            saveActiveRef.current += 1
            patchHistory((current) =>
              current.map((item) =>
                item.id === entry.id && item.status === 'queued'
                  ? { ...item, status: 'saving', error: null }
                  : item,
              ),
            )
            try {
              const maps = cachedProductNameMaps(queryClient, brandId)
              const previousMap =
                entry.previousMap ??
                findMapByLookupKey(maps, entry.lookupKey)
              const optionMaps = cachedOptionMaps(queryClient, brandId)
              const previousOptionMap =
                entry.previousOptionMap ??
                findOptionMapByComboPreferring(
                  optionMaps,
                  entry.mallName,
                  entry.productName,
                  entry.itemName,
                  entry.originalItemName,
                )
              const extras = completedOptionExtras(entry.extras).reduce<
                ReturnType<typeof completedOptionExtras>
              >((merged, extra) => {
                const existing = merged.find(
                  (item) => item.style.styleId === extra.style.styleId,
                )
                if (existing) {
                  existing.quantity += Math.max(1, extra.quantity)
                  return merged
                }
                merged.push({
                  ...extra,
                  quantity: Math.max(1, extra.quantity),
                })
                return merged
              }, [])
              const normalizedLookupKey = normalizeInvoiceText(entry.lookupKey)
              const identity = productMapSaveIdentity({
                lookupKey: entry.lookupKey,
                styleId: entry.style.styleId,
              })
              const activeShared =
                sharedProductMapSavesRef.current.get(normalizedLookupKey)
              let ownsProductMapSave = false
              let shared: SharedProductMapSave
              if (activeShared?.identity === identity) {
                shared = activeShared
                shared.consumerIds.add(entry.id)
              } else {
                ownsProductMapSave = true
                const save = async () => {
                  const saved = await timeInvoiceWorkAsync(
                    'product-map-save',
                    () =>
                      saveInvoiceProductNameMap(
                        brandId,
                        {
                          productName: entry.lookupKey,
                          lookupKey: entry.lookupKey,
                          styleId: entry.style.styleId,
                          feedback: entry.feedback,
                        },
                        previousMap?.id,
                      ),
                  )
                  return { saved, previousMap }
                }
                const promise = activeShared
                  ? activeShared.promise
                      .catch(() => null)
                      .then(() => save())
                  : save()
                shared = {
                  identity,
                  consumerIds: new Set([entry.id]),
                  promise,
                }
                sharedProductMapSavesRef.current.set(
                  normalizedLookupKey,
                  shared,
                )
              }
              let sharedResult: Awaited<typeof shared.promise>
              try {
                sharedResult = await shared.promise
              } catch (error) {
                if (
                  sharedProductMapSavesRef.current.get(normalizedLookupKey) ===
                  shared
                ) {
                  sharedProductMapSavesRef.current.delete(normalizedLookupKey)
                }
                throw error
              }
              const saved = sharedResult.saved
              if (ownsProductMapSave) queueProductMapUpsert(saved)
              let savedOptionMap: InvoiceOptionMap | null = null
              if (extras.length > 0 || previousOptionMap) {
                savedOptionMap = await saveInvoiceOptionMap(
                  brandId,
                  {
                    productName: entry.productName,
                    itemName: entry.itemName,
                    mallName: entry.mallName,
                    ownProductCode: entry.ownProductCode,
                    displayItemName: previousOptionMap?.displayItemName,
                    note: previousOptionMap?.note,
                    components: [
                      {
                        styleId: entry.style.styleId,
                        role: 'main',
                        quantity: 1,
                      },
                      ...extras.map((item) => ({
                        styleId: item.style.styleId,
                        role: item.role,
                        quantity: item.quantity,
                      })),
                    ],
                  },
                  previousOptionMap?.id,
                )
                queueOptionMapUpsert(savedOptionMap)
              }
              await invalidateAiRecommendationQueries(queryClient, brandId, {
                comboKey: entry.comboKey,
                lookupKey: entry.lookupKey,
              })
              scheduleAiUsageInvalidate()
              const sharesProductMap = shared.consumerIds.size > 1
              patchHistory((current) =>
                current.map((item) => {
                  if (item.id === entry.id) {
                    return {
                      ...item,
                      status: 'saved',
                      error: null,
                      savedMap: saved,
                      previousMap: sharesProductMap
                        ? saved
                        : sharedResult.previousMap,
                      savedOptionMap,
                      previousOptionMap,
                      wasCreate:
                        !sharesProductMap && sharedResult.previousMap === null,
                      optionWasCreate: extras.length > 0 && !previousOptionMap,
                      style: saved.style,
                      lookupKey: saved.lookupKey || entry.lookupKey,
                    }
                  }
                  if (
                    sharesProductMap &&
                    shared.consumerIds.has(item.id) &&
                    item.savedMap?.id === saved.id
                  ) {
                    return {
                      ...item,
                      previousMap: saved,
                      wasCreate: false,
                    }
                  }
                  return item
                }),
              )
            } catch (error) {
              patchHistory((current) =>
                current.map((item) =>
                  item.id === entry.id
                    ? {
                        ...item,
                        status: 'failed',
                        error:
                          error instanceof Error
                            ? error.message
                            : '저장하지 못했습니다.',
                      }
                    : item,
                ),
              )
            } finally {
              saveInFlightRef.current.delete(entry.id)
              saveActiveRef.current = Math.max(0, saveActiveRef.current - 1)
            }
          }),
        )
      }
    } finally {
      savePumpingRef.current = false
      if (
        historyRef.current.some(
          (entry) =>
            entry.status === 'queued' &&
            !saveInFlightRef.current.has(entry.id),
        )
      ) {
        void pump()
      }
    }
  }, [
    brandId,
    patchHistory,
    queryClient,
    queueOptionMapUpsert,
    queueProductMapUpsert,
    scheduleAiUsageInvalidate,
  ])

  const enqueue = useCallback(
    (input: ProductMapEnqueueInput) => {
      const existingEntry = input.historyId
        ? historyRef.current.find((item) => item.id === input.historyId)
        : historyRef.current.find(
            (item) =>
              item.comboKey === input.comboKey &&
              (item.status === 'failed' ||
                item.status === 'queued' ||
                item.status === 'undo_failed'),
          )
      const historyId =
        input.historyId ?? existingEntry?.id ?? newHistoryId()
      const maps = cachedProductNameMaps(queryClient, brandId)
      const previousMap =
        existingEntry?.savedMap ??
        existingEntry?.previousMap ??
        findMapByLookupKey(maps, input.lookupKey)
      const optionMaps = cachedOptionMaps(queryClient, brandId)
      const originalItemName =
        input.originalItemName ??
        existingEntry?.originalItemName ??
        input.itemName
      const previousOptionMap =
        existingEntry?.savedOptionMap ??
        existingEntry?.previousOptionMap ??
        findOptionMapByComboPreferring(
          optionMaps,
          input.mallName,
          input.productName,
          input.itemName,
          originalItemName,
        )

      patchHistory((current) => {
        const nextEntry: ProductMapHistoryEntry = {
          id: historyId,
          comboKey: input.comboKey,
          productName: input.productName,
          itemName: input.itemName,
          originalItemName,
          mallName: input.mallName,
          ownProductCode: input.ownProductCode ?? existingEntry?.ownProductCode ?? '',
          lookupKey: input.lookupKey,
          style: input.style,
          extras: input.extras ?? existingEntry?.extras ?? [],
          appliedRule: input.appliedRule,
          feedback: input.feedback,
          status: 'queued',
          error: null,
          createdAt: Date.now(),
          savedMap: null,
          previousMap,
          savedOptionMap: null,
          previousOptionMap,
          wasCreate: previousMap === null,
          optionWasCreate: false,
          reviewReasons:
            input.reviewReasons ?? existingEntry?.reviewReasons ?? [],
        }
        const without = current.filter((item) => item.id !== historyId)
        return [nextEntry, ...without]
      })
      queueMicrotask(() => {
        void pump()
      })
    },
    [brandId, patchHistory, pump, queryClient],
  )

  const undo = useCallback(
    async (historyId: string) => {
      const entry = historyRef.current.find((item) => item.id === historyId)
      if (!entry?.savedMap || entry.status !== 'saved') {
        throw new Error('되돌릴 저장 내역이 없습니다.')
      }
      patchHistory((current) =>
        current.map((item) =>
          item.id === historyId
            ? { ...item, status: 'undoing', error: null }
            : item,
        ),
      )
      try {
        if (!entry.wasCreate && !entry.previousMap) {
          throw new Error('복원할 이전 원장 정보가 없습니다.')
        }
        await undoInvoiceProductNameMap(brandId, {
          mapId: entry.savedMap.id,
          expectedUpdatedAt: entry.savedMap.updatedAt,
          previous: entry.wasCreate ? null : entry.previousMap,
        })
        if (entry.savedOptionMap) {
          if (entry.optionWasCreate || !entry.previousOptionMap) {
            await deleteInvoiceOptionMap(entry.savedOptionMap.id)
            removeInvoiceOptionMapCache(
              queryClient,
              brandId,
              entry.savedOptionMap.id,
            )
          } else {
            const restored = await saveInvoiceOptionMap(
              brandId,
              {
                productName: entry.previousOptionMap.productName,
                itemName: entry.previousOptionMap.itemName,
                mallName: entry.previousOptionMap.mallName,
                ownProductCode: entry.previousOptionMap.ownProductCode,
                displayItemName: entry.previousOptionMap.displayItemName,
                note: entry.previousOptionMap.note,
                components: entry.previousOptionMap.components.map((item) => ({
                  styleId: item.style.styleId,
                  role: item.role,
                  quantity: item.quantity,
                })),
              },
              entry.savedOptionMap.id,
            )
            await upsertInvoiceOptionMapCache(queryClient, brandId, restored)
          }
        }
        if (entry.previousMap?.id !== entry.savedMap.id) {
          sharedProductMapSavesRef.current.delete(
            normalizeInvoiceText(entry.lookupKey),
          )
        }
        await queryClient.invalidateQueries({
          queryKey: [PRODUCT_NAME_MAPS_QUERY_KEY, brandId],
        })
        await queryClient.invalidateQueries({
          queryKey: [PRODUCT_NAME_MAPS_WORK_QUERY_KEY, brandId],
        })
        await queryClient.invalidateQueries({
          queryKey: [INVOICE_OPTION_MAPS_QUERY_KEY, brandId],
        })
        await queryClient.invalidateQueries({
          queryKey: [INVOICE_OPTION_MAPS_WORK_QUERY_KEY, brandId],
        })
        await invalidateAiRecommendationQueries(queryClient, brandId, {
          comboKey: entry.comboKey,
          lookupKey: entry.lookupKey,
        })
        patchHistory((current) =>
          current.map((item) =>
            item.id === historyId
              ? {
                  ...item,
                  status: 'undone',
                  error: null,
                  savedMap: entry.wasCreate ? null : entry.previousMap,
                  previousMap: null,
                  savedOptionMap: entry.optionWasCreate
                    ? null
                    : entry.previousOptionMap,
                  previousOptionMap: null,
                  wasCreate: false,
                  optionWasCreate: false,
                  style: entry.previousMap?.style ?? entry.style,
                  lookupKey:
                    entry.previousMap?.lookupKey ||
                    entry.previousMap?.productName ||
                    entry.lookupKey,
                }
              : item,
          ),
        )
      } catch (error) {
        patchHistory((current) =>
          current.map((item) =>
            item.id === historyId
              ? {
                  ...item,
                  status: 'undo_failed',
                  error:
                    error instanceof Error
                      ? error.message
                      : '되돌리지 못했습니다.',
                }
              : item,
          ),
        )
        throw error
      }
    },
    [brandId, patchHistory, queryClient],
  )

  return {
    history,
    activeComboKeys,
    failedDrafts,
    savingCount,
    failedCount,
    enqueue,
    undo,
  }
}
