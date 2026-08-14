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
