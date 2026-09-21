import type { StudioImageApi, StyledImageRequest, StyledImageResult } from '../../../supabase/functions/_shared/styled-image-core.ts'
import type { StudioImageJob } from '../../../supabase/functions/_shared/styled-image-job.ts'
import type { StudioPreviewTurn } from './styled-studio'
import { PendingStudioImageError } from './studio-job-polling.ts'

// Keep submitted inputs with their turn, independently of the editable composer.
export type StudioBatch = {
  turn: StudioPreviewTurn
  prepared: StyledImageRequest
  outputProductIds: string[]
  productInfo: string
  total: number
  nextIndex: number
  pendingJob?: StudioImageJob
  error?: string
}

export async function runStudioBatch(
  initial: StudioBatch,
  api: Pick<StudioImageApi, 'generate' | 'resume'>,
  mode: 'generate' | 'resume',
  options: {
    onResult: (result: StyledImageResult, prompt: string, index: number) => void
    onProgress?: (message: string) => void
    shouldContinue?: () => boolean
  },
): Promise<StudioBatch> {
  let batch = { ...initial, error: undefined as string | undefined }
  if (mode === 'generate' && batch.pendingJob) throw new Error('접수된 이미지 결과를 먼저 확인해 주세요.')
  if (mode === 'resume' && !batch.pendingJob) throw new Error('확인할 이미지 작업이 없습니다.')
  while (batch.nextIndex < batch.total && (options.shouldContinue?.() ?? true)) {
    const index = batch.nextIndex
    const prompt = batch.total > 1
      ? `${batch.prepared.prompt}\n\n이번 시안은 ${batch.total}장 중 ${index + 1}번입니다. 같은 제품 정체성을 유지하면서 배치와 구도에 자연스러운 변화를 주세요. 출력은 한 장입니다.`
      : batch.prepared.prompt
    try {
      const onProgress = (message: string) => options.onProgress?.(`${index + 1}/${batch.total}장 · ${message}`)
      onProgress(mode === 'resume' ? '접수된 이미지 결과 확인 중…' : '생성 중…')
      if (batch.pendingJob && !api.resume) throw new PendingStudioImageError('기존 작업의 결과를 확인하는 연결이 필요합니다.', batch.pendingJob)
      const result = batch.pendingJob
        ? await api.resume!(batch.pendingJob, onProgress)
        : await api.generate({ ...batch.prepared, prompt }, onProgress)
      if (!(options.shouldContinue?.() ?? true)) return batch
      options.onResult(result, prompt, index)
      batch = { ...batch, nextIndex: index + 1, pendingJob: undefined }
      // Result lookup never starts another paid image request.
      if (mode === 'resume') break
    } catch (error) {
      console.warn('[styled-image] 묶음 생성 중단', { path: typeof location === 'undefined' ? 'verification' : location.pathname, lastInput: mode === 'resume' ? '기존 이미지 결과 확인' : '이미지 생성', turnId: batch.turn.id, completed: batch.nextIndex, total: batch.total, error })
      return { ...batch, pendingJob: error instanceof PendingStudioImageError ? error.job : undefined, error: error instanceof Error ? error.message : '이미지 생성에 실패했습니다.' }
    }
  }
  return batch
}
