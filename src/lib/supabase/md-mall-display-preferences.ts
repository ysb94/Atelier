import { getSupabase } from './client'

export type MdMallDisplayPreference = { brandId: string; targetIds: string[] }

export async function getMdMallDisplayPreferences(userId: string): Promise<MdMallDisplayPreference[]> {
  const { data, error } = await getSupabase().from('md_mall_display_preferences')
    .select('brand_id, target_ids').eq('user_id', userId)
  if (error) throw new Error(`표시 업체 설정을 불러오지 못했습니다. ${error.message}`)
  return (data ?? []).map(row => ({ brandId: row.brand_id as string, targetIds: row.target_ids as string[] }))
}

export async function saveMdMallDisplayPreferences(userId: string, preferences: MdMallDisplayPreference[]) {
  if (!preferences.length) return
  const { error } = await getSupabase().from('md_mall_display_preferences').upsert(
    preferences.map(row => ({ user_id: userId, brand_id: row.brandId, target_ids: [...new Set(row.targetIds)] })),
    { onConflict: 'user_id,brand_id' },
  )
  if (error) throw new Error(`표시 업체 설정을 저장하지 못했습니다. ${error.message}`)
}
