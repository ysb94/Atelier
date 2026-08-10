/** Supabase/PostgREST 오류를 앱 저장소 오류 코드로 옮긴다. */

export function isUniqueViolation(error: { code?: string; message?: string }) {
  return (
    error.code === '23505' ||
    /duplicate key|unique constraint/i.test(error.message ?? '')
  )
}

export function errorMessage(
  error: { message?: string } | null | undefined,
  fallback: string,
) {
  return error?.message?.trim() || fallback
}
