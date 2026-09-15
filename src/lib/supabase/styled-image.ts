import { StudioApiError, waitForStudioImage } from '../design/studio-job-polling'
import type { StudioImageJobStatus } from '../../../supabase/functions/_shared/styled-image-job'
import { getSupabase } from './client'
import { timeStudioWork } from '../design/studio-timing'
import { validateImageRequest, type StudioImageApi, type StudioCatalog, type StyledImageResult, type DirectorPlan } from '../../../supabase/functions/_shared/styled-image-core'
import { validateDirectorPlan } from '../../../supabase/functions/_shared/styled-director'

async function invoke<T>(body: { action: string; [key: string]: unknown }): Promise<T> {
  const timeout = body.action === 'generate' ? 135_000 : body.action === 'models' || body.action === 'image-status' ? 45_000 : 75_000
  const { data, error } = await getSupabase().functions.invoke('styled-image', { body, timeout })
  if (error) {
    const phase = body.action === 'direct' ? '디렉터 분석' : body.action === 'models' ? '모델 조회' : body.action === 'image-status' ? '기존 이미지 결과 조회' : '이미지 생성'
    const contextName = error.context instanceof Error ? error.context.name : ''
    const status = error.context instanceof Response ? error.context.status : undefined
    let message = /Abort|Timeout/.test(contextName) || status === 504
      ? phase + ' 응답 대기 시간이 초과되었습니다. 생성 요청을 자동으로 반복하지 않습니다.'
      : phase + ' 서버에 연결하지 못했습니다. 네트워크와 로그인 상태를 확인해 주세요.'
    console.warn('[styled-image] 서버 응답 실패', { path: location.pathname, input: phase, action: body.action, status, name: error.name, contextName })
    if (error.context instanceof Response) {
      try { const payload = await error.context.json(); if (payload.error) message = payload.error }
      catch (parseError) { console.warn('[styled-image] 오류 응답 해석 실패', { path: location.pathname, error: parseError }) }
    }
    throw new StudioApiError(message, status)
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
  async resume(job, onProgress) {
    return waitForStudioImage(job, current => invoke<StudioImageJobStatus>({ action: 'image-status', token: current.token }), { onProgress })
  },
  async generate(request, onProgress) {
    timeStudioWork('전송 전 사진 검증', () => validateImageRequest(request))
    if (request.modelId === 'gemini-3-pro-image') return invoke<StyledImageResult>({ ...request, action: 'generate' })
    onProgress?.('이미지 제공자에게 생성 작업을 접수하고 있어요…')
    const started = await invoke<StudioImageJobStatus>({ ...request, action: 'image-start' })
    if (started.status === 'completed') return started.result
    if (started.status === 'failed') throw new Error(started.error)
    return waitForStudioImage(started.job, job => invoke<StudioImageJobStatus>({ action: 'image-status', token: job.token }), { onProgress })
  },
}
