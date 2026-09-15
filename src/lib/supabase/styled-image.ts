import { getSupabase } from './client'
import { timeStudioWork } from '../design/studio-timing'
import { validateImageRequest, type StudioImageApi, type StudioCatalog, type StyledImageResult, type DirectorPlan } from '../../../supabase/functions/_shared/styled-image-core'
import { validateDirectorPlan } from '../../../supabase/functions/_shared/styled-director'

async function invoke<T>(body: object): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('styled-image', { body, timeout: 135_000 })
  if (error) {
    let message = '이미지 서버에 연결하지 못했습니다. 로그인과 서버 배포 상태를 확인해 주세요.'
    if (error.context instanceof Response) {
      try { const payload = await error.context.json(); if (payload.error) message = payload.error }
      catch (parseError) { console.warn('[styled-image] 오류 응답 해석 실패', { path: location.pathname, error: parseError }) }
    }
    throw new Error(message)
  }
  if (!data?.ok) throw new Error(data?.error || '이미지 서버 응답을 확인하지 못했습니다.')
  return data as T
}

export const studioImageApi: StudioImageApi = {
  async models() {
    const data = await invoke<StudioCatalog>({ action: 'models' })
    return { models: data.models ?? [], directors: data.directors ?? [] }
  },
  async direct(request) {
    timeStudioWork('디렉터 자료 검증', () => validateImageRequest(request))
    return validateDirectorPlan((await invoke<{ plan: DirectorPlan }>({ ...request, action: 'direct' })).plan)
  },
  async generate(request) {
    timeStudioWork('전송 전 사진 검증', () => validateImageRequest(request))
    return invoke<StyledImageResult>({ ...request, action: 'generate' })
  },
}
