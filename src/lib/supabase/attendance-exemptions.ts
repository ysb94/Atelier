import { getSupabase } from './client'

// 서버 추가 기능을 적용하기 전에는 확인된 기존 두 계정의 제외 상태만 유지한다.
// 통신·인증 오류는 여기에 포함하지 않으며, 조회 실패를 허용 상태로 바꾸지 않는다.
const existingExemptions = ['2dedf0e7-3237-417a-a22f-1fc2cd89272a', '56074867-fdc2-4ce5-8e97-cea431decc36']
function unavailable(error: { code?: string } | null) {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

export async function listAttendanceExemptions(): Promise<string[]> {
  const { data, error } = await getSupabase().rpc('list_company_attendance_exempt')
  if (unavailable(error)) {
    console.warn('[attendance-exemption] 서버 적용 전: 기존 제외자 목록 유지')
    return [...existingExemptions]
  }
  if (error || !Array.isArray(data)) {
    console.warn('[attendance-exemption] 제외자 목록 조회 실패', error)
    throw new Error('출퇴근 제외자 목록을 확인하지 못했습니다.')
  }
  return data as string[]
}

export async function getMyAttendanceExemption(profileId: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('is_my_attendance_exempt')
  if (unavailable(error)) {
    console.warn('[attendance-exemption] 서버 적용 전: 기존 본인 제외 상태 유지')
    return existingExemptions.includes(profileId)
  }
  if (error || typeof data !== 'boolean') {
    console.warn('[attendance-exemption] 본인 제외 여부 조회 실패', error)
    throw new Error('출퇴근 제외 설정을 확인하지 못했습니다. 다시 시도해 주세요.')
  }
  return data
}

export async function setAttendanceExemption(profileId: string, exempt: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('set_attendance_exemption', { p_profile: profileId, p_exempt: exempt })
  if (error) {
    console.warn('[attendance-exemption] 제외자 저장 실패', { profileId, exempt, message: error.message })
    throw new Error(unavailable(error) ? '제외자 저장 기능은 서버 적용 전입니다. 기존 제외 상태는 유지됩니다.' : error.message)
  }
}
