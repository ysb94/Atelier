import type { ItemNameLearningCase } from '@/lib/ai/learning-core'
import type { AiProductCandidate } from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

type CandidateRow = {
  source: string
  lookup_key: string
  style_id: string
  style_no: string
  style_name: string
  score: number
  rank?: number
}

export class AiCandidateStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiCandidateStoreError'
  }
}

export async function searchInvoiceProductCandidates(
  brandId: string,
  texts: string[],
  limit = 20,
): Promise<AiProductCandidate[]> {
  const { data, error } = await getSupabase().rpc(
    'search_invoice_product_candidates',
    {
      p_brand_id: brandId,
      p_texts: texts,
      p_limit: limit,
    },
  )
  if (error) {
    throw new AiCandidateStoreError(
      errorMessage(error, '유사 상품 후보를 찾지 못했습니다.'),
    )
  }
  return ((data ?? []) as CandidateRow[]).map((row) => ({
    source: row.source,
    lookupKey: row.lookup_key,
    styleId: row.style_id,
    styleNo: row.style_no,
    name: row.style_name,
    score: Number(row.score) || 0,
    rank: row.rank,
  }))
}

type ItemNameCaseRow = {
  context_id: string
  source: string
  scope: string
  item_name: string
  product_lookup_key: string
  main_style_id: string | null
  action: 'delete' | 'components'
  score: number
  components: Array<{
    styleId?: string
    styleNo?: string
    name?: string
    quantity?: number
  }> | null
  rule_id: string | null
  feedback_id: string | null
}

export async function searchInvoiceItemNameCases(
  brandId: string,
  contexts: Array<{
    contextId: string
    itemName: string
    mainStyleId?: string | null
    productLookupKey?: string
  }>,
  limit = 5,
): Promise<ItemNameLearningCase[]> {
  const { data, error } = await getSupabase().rpc(
    'search_invoice_item_name_cases',
    {
      p_brand_id: brandId,
      p_contexts: contexts.map((item) => ({
        contextId: item.contextId,
        itemName: item.itemName,
        mainStyleId: item.mainStyleId ?? null,
        productLookupKey: item.productLookupKey ?? '',
      })),
      p_limit: limit,
    },
  )
  if (error) {
    throw new AiCandidateStoreError(
      errorMessage(error, '내품명 확정 사례를 찾지 못했습니다.'),
    )
  }
  return ((data ?? []) as ItemNameCaseRow[]).flatMap((row) => {
    if (row.action !== 'delete' && row.action !== 'components') return []
    return [
      {
        contextId: row.context_id,
        source: row.source,
        scope: row.scope,
        itemName: row.item_name,
        productLookupKey: row.product_lookup_key ?? '',
        mainStyleId: row.main_style_id,
        action: row.action,
        score: Number(row.score) || 0,
        components: (row.components ?? []).flatMap((item) =>
          item.styleId
            ? [
                {
                  styleId: item.styleId,
                  styleNo: item.styleNo ?? '',
                  name: item.name ?? '',
                  quantity: Math.max(1, item.quantity ?? 1),
                },
              ]
            : [],
        ),
        ruleId: row.rule_id,
        feedbackId: row.feedback_id,
      },
    ]
  })
}
