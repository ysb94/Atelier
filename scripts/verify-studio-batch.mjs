import assert from 'node:assert/strict'
import { runStudioBatch } from '../src/lib/design/studio-batch.ts'
import { PendingStudioImageError } from '../src/lib/design/studio-job-polling.ts'

const prepared = { modelId: 'gpt-image-2', prompt: '원래 지시문', ratio: '4:5', settings: { resolution: '2K', quality: 'high' }, images: [{ name: '사진 1', role: '제품', data: 'data:image/png;base64,aGVsbG8=' }] }
const initial = { turn: { id: 'turn-1', request: '원래 요청', assetIds: ['photo-1'], versionIds: [] }, prepared, total: 4, nextIndex: 0, outputProductIds: ['product-1'], productInfo: '원래 제품' }
const job = { token: 'test-job', modelId: 'gpt-image-2', startedAt: 1 }
const result = { modelId: 'gpt-image-2', data: 'data:image/png;base64,aGVsbG8=', latencyMs: 1 }
const requests = []
const completed = []
let resumeCalls = 0
const options = { onResult: (_result, prompt, index) => completed.push({ prompt, index }) }
const api = {
  async generate(request) {
    requests.push(request)
    if (requests.length === 2) throw new PendingStudioImageError('접수 후 연결 끊김', job)
    return result
  },
  async resume(pending) {
    assert.equal(pending.token, job.token)
    if (++resumeCalls === 1) throw new PendingStudioImageError('아직 생성 중', job)
    return result
  },
}
const paused = await runStudioBatch(initial, api, 'generate', options)
assert.equal(paused.nextIndex, 1)
assert.equal(paused.pendingJob, job)
assert.equal(initial.nextIndex, 0, 'input state is not mutated')
assert.equal(requests.length, 2)
await assert.rejects(runStudioBatch(paused, api, 'generate', options), /결과를 먼저 확인/)
assert.equal(requests.length, 2, 'pending job cannot be generated again')
const stillPending = await runStudioBatch(paused, api, 'resume', options)
assert.equal(stillPending.nextIndex, 1)
assert.equal(stillPending.pendingJob, job, 'repeat lookup preserves the token')
const resumed = await runStudioBatch(stillPending, api, 'resume', options)
assert.equal(resumed.nextIndex, 2)
assert.equal(resumed.total, 4)
assert.equal(resumed.pendingJob, undefined)
assert.equal(requests.length, 2, 'result lookup never starts a paid request')
assert.equal(completed[1].prompt, requests[1].prompt, 'resumed result keeps original per-image prompt')
const finished = await runStudioBatch(resumed, api, 'generate', options)
assert.equal(finished.nextIndex, 4)
assert.deepEqual(completed.map(item => item.index), [0, 1, 2, 3], 'no skipped or duplicated results')
assert.equal(requests.length, 4, 'only the remaining two images are generated')
assert.ok(requests[2].prompt.includes('4장 중 3번'))
assert.ok(requests[3].prompt.includes('4장 중 4번'))
for (const request of requests) {
  assert.equal(request.modelId, prepared.modelId)
  assert.deepEqual(request.settings, prepared.settings)
  assert.deepEqual(request.images, prepared.images)
}
await assert.rejects(runStudioBatch(finished, api, 'resume', options), /확인할 이미지/)
const unavailable = await runStudioBatch(paused, { generate: api.generate }, 'resume', options)
assert.equal(unavailable.pendingJob, job, 'missing resume API must retain the job')
assert.equal(requests.length, 4)
const failed = await runStudioBatch({ ...initial, nextIndex: 2 }, { async generate() { throw new Error('provider failed') } }, 'generate', options)
assert.equal(failed.nextIndex, 2, 'terminal failure retains completed count')
assert.equal(failed.error, 'provider failed')
console.log('studio-batch: pending job retention, lookup without generation, original inputs, partial failure and remaining batch completion passed')
