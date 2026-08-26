import type { QueryClient } from '@tanstack/react-query'

export function invalidateAiRecommendationQueries(
  queryClient: QueryClient,
  brandId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: ['ai-product-recommendation', brandId],
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: ['ai-item-name-recommendation', brandId],
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: ['ai-quick-slot-candidates', brandId],
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: ['ai-quick-slot-match', brandId],
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: ['ai-item-name-cases', brandId],
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: ['ai-usage-summary', brandId],
    }),
  ])
}
