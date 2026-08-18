import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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

export function upsertInvoiceProductNameMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  saved: InvoiceProductNameMap,
) {
  const queryKey = ['invoice-product-name-maps', brandId] as const
  const current = queryClient.getQueryData<InvoiceProductNameMap[]>(queryKey)
  if (!current) {
    return queryClient.invalidateQueries({ queryKey })
  }
  queryClient.setQueryData<InvoiceProductNameMap[]>(queryKey, (maps = []) => {
    const next = maps.filter((map) => {
      if (map.id === saved.id) return false
      return !(
        saved.normalizedLookupKey &&
        map.normalizedLookupKey === saved.normalizedLookupKey
      )
    })
    return [saved, ...next]
  })
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

export function upsertInvoiceOptionMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  saved: InvoiceOptionMap,
) {
  const queryKey = ['invoice-option-maps', brandId] as const
  const current = queryClient.getQueryData<InvoiceOptionMap[]>(queryKey)
  if (!current) {
    return queryClient.invalidateQueries({ queryKey })
  }
  queryClient.setQueryData<InvoiceOptionMap[]>(queryKey, (maps = []) => {
    const next = maps.filter((map) => map.id !== saved.id)
    return [saved, ...next]
  })
}

function removeInvoiceOptionMapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  mapId: string,
) {
  const queryKey = ['invoice-option-maps', brandId] as const
  const current = queryClient.getQueryData<InvoiceOptionMap[]>(queryKey)
  if (!current) {
    return queryClient.invalidateQueries({ queryKey })
  }
  queryClient.setQueryData<InvoiceOptionMap[]>(queryKey, (maps = []) =>
    maps.filter((map) => map.id !== mapId),
  )
}

function newHistoryId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useInvoiceProductNameSaveQueue(brandId: string) {
  const queryClient = useQueryClient()
  const [history, setHistory] = useState<ProductMapHistoryEntry[]>([])
  const historyRef = useRef(history)
  historyRef.current = history
  const saveActiveRef = useRef(0)
  const savePumpingRef = useRef(false)
  const saveInFlightRef = useRef(new Set<string>())

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
            setHistory((current) =>
              current.map((item) =>
                item.id === entry.id && item.status === 'queued'
                  ? { ...item, status: 'saving', error: null }
                  : item,
              ),
            )
            try {
              const maps =
                queryClient.getQueryData<InvoiceProductNameMap[]>([
                  'invoice-product-name-maps',
                  brandId,
                ]) ?? []
              const previousMap =
                entry.previousMap ??
                findMapByLookupKey(maps, entry.lookupKey)
              const optionMaps =
                queryClient.getQueryData<InvoiceOptionMap[]>([
                  'invoice-option-maps',
                  brandId,
                ]) ?? []
              const previousOptionMap =
                entry.previousOptionMap ??
                findOptionMapByComboPreferring(
                  optionMaps,
                  entry.mallName,
                  entry.productName,
                  entry.itemName,
                  entry.originalItemName,
                )
              const extras = completedOptionExtras(entry.extras)
              const saved = await saveInvoiceProductNameMap(
                brandId,
                {
                  productName: entry.lookupKey,
                  lookupKey: entry.lookupKey,
                  styleId: entry.style.styleId,
                  feedback: entry.feedback,
                },
                previousMap?.id,
              )
              await upsertInvoiceProductNameMapCache(queryClient, brandId, saved)
              let savedOptionMap: InvoiceOptionMap | null = null
              if (extras.length > 0) {
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
                await upsertInvoiceOptionMapCache(
                  queryClient,
                  brandId,
                  savedOptionMap,
                )
              }
              await queryClient.invalidateQueries({
                queryKey: [
                  'ai-product-recommendation',
                  brandId,
                  entry.comboKey,
                ],
                refetchType: 'none',
              })
              await queryClient.invalidateQueries({
                queryKey: ['ai-usage-summary', brandId],
              })
              setHistory((current) =>
                current.map((item) =>
                  item.id === entry.id
                    ? {
                        ...item,
                        status: 'saved',
                        error: null,
                        savedMap: saved,
                        previousMap,
                        savedOptionMap,
                        previousOptionMap,
                        wasCreate: previousMap === null,
                        optionWasCreate: extras.length > 0 && !previousOptionMap,
                        style: saved.style,
                        lookupKey: saved.lookupKey || entry.lookupKey,
                      }
                    : item,
                ),
              )
            } catch (error) {
              setHistory((current) =>
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
  }, [brandId, queryClient])

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
      const maps =
        queryClient.getQueryData<InvoiceProductNameMap[]>([
          'invoice-product-name-maps',
          brandId,
        ]) ?? []
      const previousMap =
        existingEntry?.savedMap ??
        existingEntry?.previousMap ??
        findMapByLookupKey(maps, input.lookupKey)
      const optionMaps =
        queryClient.getQueryData<InvoiceOptionMap[]>([
          'invoice-option-maps',
          brandId,
        ]) ?? []
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

      setHistory((current) => {
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
    [brandId, pump, queryClient],
  )

  const undo = useCallback(
    async (historyId: string) => {
      const entry = historyRef.current.find((item) => item.id === historyId)
      if (!entry?.savedMap || entry.status !== 'saved') {
        throw new Error('되돌릴 저장 내역이 없습니다.')
      }
      setHistory((current) =>
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
        await queryClient.invalidateQueries({
          queryKey: ['invoice-product-name-maps', brandId],
        })
        await queryClient.invalidateQueries({
          queryKey: ['invoice-option-maps', brandId],
        })
        await queryClient.invalidateQueries({
          queryKey: ['ai-product-recommendation', brandId],
          refetchType: 'none',
        })
        setHistory((current) =>
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
        setHistory((current) =>
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
    [brandId, queryClient],
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
