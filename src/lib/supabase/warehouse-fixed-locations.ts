import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { diagnosticOperation } from '@/lib/diagnostics'
import { getSupabase } from '@/lib/supabase/client'
import type { FixedLocationRow } from '@/lib/warehouse/fixed-location-styles'

export type FixedLocationSnapshot = {
  rows: FixedLocationRow[]
  revision: string | null
  syncedAt: string | null
}

const messages: Record<string, string> = {
  sign_in_required: '다시 로그인한 뒤 시트를 불러와 주세요.',
  forbidden: '이 고정 자리 목록을 볼 수 있는 권한이 없습니다.',
  not_configured: '구글 시트를 읽을 서버 계정 설정이 필요합니다.',
  google_access: '구글 시트를 읽을 수 없습니다. 시트의 공유 권한과 연결 설정을 확인해 주세요.',
  storage_unavailable: '고정 자리 목록 저장소에 연결하지 못했습니다.',
}

export function requestWarehouseFixedLocations(
  brandId: string,
  action: 'read' | 'sync',
  previous?: FixedLocationSnapshot,
) {
  const operation = action === 'read' ? 'read_warehouse_fixed_locations' : 'sync_warehouse_fixed_locations'
  return diagnosticOperation('app', operation, (trace) =>
    trace.run(action === 'read' ? 'read_snapshot' : 'sync_sheet', async (context) => {
      const { data, error } = await getSupabase().functions.invoke<Omit<FixedLocationSnapshot, 'rows'> & { rows: FixedLocationRow[] | null }>(
        'warehouse-fixed-locations',
        {
          body: { brandId, action, knownRevision: previous?.revision },
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
          if (response.status === 404) throw new Error('고정 자리 서버 함수가 아직 배포되지 않았습니다.', { cause: error })
          if (response.status === 401) throw new Error(messages.sign_in_required, { cause: error })
        }
        if (error instanceof FunctionsFetchError) {
          throw new Error('고정 자리 서버에 연결하지 못했습니다. 서버 배포 상태 또는 네트워크를 확인해 주세요.', { cause: error })
        }
        throw new Error('고정 자리 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { cause: error })
      }
      if (!data || (data.syncedAt !== null && !Number.isFinite(Date.parse(data.syncedAt)))
        || (data.revision !== null && typeof data.revision !== 'string')) {
        throw new Error('고정 자리 서버 버전을 확인해 주세요.')
      }
      const rows = data.rows === null && previous?.revision === data.revision ? previous?.rows : data.rows
      if (!Array.isArray(rows)) throw new Error('고정 자리 목록의 응답 형식을 확인해 주세요.')
      return { ...data, rows }
    }),
  )
}
