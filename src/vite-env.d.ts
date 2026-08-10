/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** DEV LOGIN — 나중에 제거 */
  readonly VITE_DEV_LOGIN_EMAIL?: string
  /** DEV LOGIN — 나중에 제거 */
  readonly VITE_DEV_LOGIN_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
