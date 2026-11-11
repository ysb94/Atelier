import { FunctionsHttpError } from '@supabase/supabase-js'
import { diagnosticOperation } from '@/lib/diagnostics'
import { getSupabase } from '@/lib/supabase/client'

export type FixedLocationRow = {
  sheetRow: number
  productName: string
  location: string
}

const messages: Record<string, string> = {
  sign_in_required: '다시 로그인한 뒤 시트를 불러와 주세요.',
  forbidden: '이 고정 자리 목록을 볼 수 있는 권한이 없습니다.',
  not_configured: '고정 자리 시트 연결 설정이 필요합니다.',
  google_access: '구글 시트를 읽을 수 없습니다. 시트의 공유 권한과 연결 설정을 확인해 주세요.',
}

export function readWarehouseFixedLocations(brandId: string) {
  return diagnosticOperation('app', 'read_warehouse_fixed_locations', (trace) =>
    trace.run('read_sheet', async (context) => {
      const { data, error } = await getSupabase().functions.invoke<{ rows: FixedLocationRow[] }>(
        'warehouse-fixed-locations',
        {
          body: { brandId },
          headers: { 'x-client-info': `atelier diagnostic/${context.traceId}/${context.domain}/${context.action}/${context.stage}` },
          timeout: 30_000,
        },
      )
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const response: Response = error.context
          const payload = await response.json().catch(() => null) as { code?: string } | null
          const message = payload?.code ? messages[payload.code] : undefined
          if (message) throw new Error(message, { cause: error })
          if (response.status === 404) throw new Error(messages.not_configured, { cause: error })
          if (response.status === 401) throw new Error(messages.sign_in_required, { cause: error })
        }
        throw new Error('고정 자리 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { cause: error })
      }
      if (!Array.isArray(data?.rows)) throw new Error('고정 자리 목록의 응답 형식을 확인해 주세요.')
      return data.rows
    }),
  )
}
