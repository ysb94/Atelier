import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

export type BarcodePartnerDisplayScope = 'own' | 'partner'

export type BarcodePartnerDisplaySetting = {
  configured: boolean
  targetIds: string[]
}

type SettingRow = {
  id: string
  barcode_partner_display_targets?: Array<{
    usage_target_id: string
  }> | null
}

export class BarcodePartnerDisplaySettingStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BarcodePartnerDisplaySettingStoreError'
  }
}

export async function getBarcodePartnerDisplaySetting(
  brandId: string,
  displayScope: BarcodePartnerDisplayScope,
): Promise<BarcodePartnerDisplaySetting> {
  const { data, error } = await getSupabase()
    .from('barcode_partner_display_settings')
    .select('id, barcode_partner_display_targets(usage_target_id)')
    .eq('brand_id', brandId)
    .eq('display_scope', displayScope)
    .maybeSingle()

  if (error) {
    throw new BarcodePartnerDisplaySettingStoreError(
      errorMessage(error, '바코드 업체 설정을 불러오지 못했습니다.'),
    )
  }

  const row = data as SettingRow | null
  if (!row) {
    return {
      configured: false,
      targetIds: [],
    }
  }

  return {
    configured: true,
    targetIds: (row.barcode_partner_display_targets ?? []).map(
      (target) => target.usage_target_id,
    ),
  }
}

export async function replaceBarcodePartnerDisplayTargets(
  brandId: string,
  displayScope: BarcodePartnerDisplayScope,
  targetIds: string[],
): Promise<void> {
  const { error } = await getSupabase().rpc(
    'replace_barcode_partner_display_targets',
    {
      p_brand_id: brandId,
      p_display_scope: displayScope,
      p_usage_target_ids: [...new Set(targetIds)],
    },
  )

  if (error) {
    throw new BarcodePartnerDisplaySettingStoreError(
      errorMessage(error, '바코드 업체 설정을 저장하지 못했습니다.'),
    )
  }
}

export async function initializeBarcodePartnerDisplayTargets(
  brandId: string,
  displayScope: BarcodePartnerDisplayScope,
  targetIds: string[],
): Promise<boolean> {
  const { data, error } = await getSupabase().rpc(
    'initialize_barcode_partner_display_targets',
    {
      p_brand_id: brandId,
      p_display_scope: displayScope,
      p_usage_target_ids: [...new Set(targetIds)],
    },
  )

  if (error) {
    throw new BarcodePartnerDisplaySettingStoreError(
      errorMessage(error, '기존 바코드 업체 설정을 이전하지 못했습니다.'),
    )
  }

  return data === true
}
