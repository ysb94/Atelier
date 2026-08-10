import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 브라우저용 Supabase 클라이언트.
 * 여기에는 publishable(anon) 키만 쓴다. secret / service_role 키는 넣지 않는다.
 * 업무 데이터 원본은 Supabase다. 브라우저 UI 설정만 localStorage에 남긴다.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

function missingEnvMessage(): string | null {
  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (missing.length === 0) return null
  return `Supabase 환경변수가 없습니다: ${missing.join(', ')}. .env.local을 확인하세요.`
}

let client: SupabaseClient | null = null

/** 환경변수가 없으면 원인을 알려주고 실패한다. */
export function getSupabase(): SupabaseClient {
  const problem = missingEnvMessage()
  if (problem || !url || !publishableKey) {
    throw new Error(problem ?? 'Supabase 환경변수가 없습니다.')
  }
  if (!client) {
    client = createClient(url, publishableKey)
  }
  return client
}

/** 설정 여부만 확인한다. 화면에서 연결 상태를 보여줄 때 쓴다. */
export function isSupabaseConfigured(): boolean {
  return missingEnvMessage() === null
}

/**
 * 테이블 없이도 되는 연결 확인.
 * 로그인하지 않은 상태에서는 session이 null인 것이 정상이다.
 */
export async function checkSupabaseConnection(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const { error } = await getSupabase().auth.getSession()
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Supabase 연결에 실패했습니다.',
    }
  }
}
