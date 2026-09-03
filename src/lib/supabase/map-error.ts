/** Supabase/PostgREST 오류를 앱 저장소 오류 코드로 옮긴다. */

export function isMissingRpc(error: { code?: string; message?: string } | null | undefined) {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function|schema cache/i.test(message)
  )
}

export function isUniqueViolation(error: { code?: string; message?: string }) {
  return (
    error.code === '23505' ||
    /duplicate key|unique constraint/i.test(error.message ?? '')
  )
}

export function errorMessage(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
) {
  const message = error?.message?.trim() || ''
  // 송장·바코드가 styles를 참조하면 상품 삭제가 FK로 막힌다.
  if (
    error?.code === '23503' ||
    /foreign key|violates foreign key/i.test(message)
  ) {
    if (
      /invoice_name_rules|invoice_option_map|invoice_product_name_map|invoice_prefix_item_products|invoice_preorder_holds|invoice_discontinued_styles|product_code_components/i.test(
        message,
      )
    ) {
      return '송장 기준이나 바코드에 연결된 상품이라 삭제할 수 없습니다. 연결을 먼저 해제하세요.'
    }
  }
  return message || fallback
}
