import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  saveInvoiceProductNameMap,
  undoInvoiceProductNameMap,
} from '@/lib/api'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  AiProductRecommendation,
  InvoiceProductNameMap,
  StyleRef,
} from '@/lib/types'

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
  mallName: string
  lookupKey: string
  style: StyleRef
  appliedRule: string | null
  feedback: ProductMapSaveFeedback
  status: ProductMapHistoryStatus
  error: string | null
  createdAt: number
  savedMap: InvoiceProductNameMap | null
  previousMap: InvoiceProductNameMap | null
  wasCreate: boolean
  reviewReasons: string[]
}

export type ProductMapEnqueueInput = {
  historyId?: string
  comboKey: string
  productName: string
  itemName: string
  mallName: string
  lookupKey: string
  style: StyleRef
  appliedRule: string | null
  feedback: ProductMapSaveFeedback
  reviewReasons?: string[]
}

export type ProductMapSaveDraft = {
  lookupKey: string
  style: StyleRef
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
                        wasCreate: previousMap === null,
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

      setHistory((current) => {
        const nextEntry: ProductMapHistoryEntry = {
          id: historyId,
          comboKey: input.comboKey,
          productName: input.productName,
          itemName: input.itemName,
          mallName: input.mallName,
          lookupKey: input.lookupKey,
          style: input.style,
          appliedRule: input.appliedRule,
          feedback: input.feedback,
          status: 'queued',
          error: null,
          createdAt: Date.now(),
          savedMap: null,
          previousMap,
          wasCreate: previousMap === null,
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
        await queryClient.invalidateQueries({
          queryKey: ['invoice-product-name-maps', brandId],
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
                  wasCreate: false,
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
