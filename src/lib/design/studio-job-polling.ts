import type { StudioImageJob, StudioImageJobStatus } from '../../../supabase/functions/_shared/styled-image-job'
import type { StyledImageResult } from '../../../supabase/functions/_shared/styled-image-core'

export class PendingStudioImageError extends Error {
  job: StudioImageJob
  constructor(message: string, job: StudioImageJob) { super(message); this.name = 'PendingStudioImageError'; this.job = job }
}
export class StudioApiError extends Error {
  status?: number
  constructor(message: string, status?: number) { super(message); this.name = 'StudioApiError'; this.status = status }
}
export async function waitForStudioImage(job: StudioImageJob, read: (job: StudioImageJob) => Promise<StudioImageJobStatus>, options: {
  onProgress?: (message: string) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  maxWaitMs?: number
} = {}): Promise<StyledImageResult> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + (options.maxWaitMs ?? 8 * 60_000)
  let readFailures = 0
  while (now() < deadline) {
    let result: StudioImageJobStatus
    try { result = await read(job); readFailures = 0 }
    catch (error) {
      if (error instanceof StudioApiError && (error.status === 400 || error.status === 404)) throw error
      if (error instanceof StudioApiError && (error.status === 401 || error.status === 403)) {
        console.warn('[styled-image] 기존 작업 조회 실패', { path: typeof location === 'undefined' ? 'verification' : location.pathname, input: '기존 이미지 결과 확인', modelId: job.modelId, attempt: 1, name: error.name, status: error.status })
        throw new PendingStudioImageError(error.message, job)
      }
      readFailures++
      console.warn('[styled-image] 기존 작업 조회 실패', { path: typeof location === 'undefined' ? 'verification' : location.pathname, input: '기존 이미지 결과 확인', modelId: job.modelId, attempt: readFailures, name: error instanceof Error ? error.name : 'unknown' })
      if (readFailures >= 3) throw new PendingStudioImageError('기존 이미지 작업의 상태를 확인하지 못했습니다. 결과 확인을 다시 누르면 같은 작업을 조회합니다.', job)
      options.onProgress?.('연결을 확인하고 있어요. 새 이미지 요청 없이 기존 작업을 조회합니다…')
      await sleep(5_000)
      continue
    }
    if (result.status === 'completed') return result.result
    if (result.status === 'failed') throw new Error(result.error)
    options.onProgress?.(result.status === 'queued' ? '이미지 제공자가 작업을 접수했습니다. 생성 순서를 기다리고 있어요…' : '이미지 제공자가 생성 중입니다. 기존 작업의 완료 상태를 확인하고 있어요…')
    await sleep(4_000)
  }
  throw new PendingStudioImageError('이미지 제공자가 아직 완료 결과를 보내지 않았습니다. 결과 확인을 다시 누르면 같은 작업을 이어서 조회합니다.', job)
}
