import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import { corsHeaders } from '../_shared/cors.ts'
import { directorBody, parseDirectorPlan } from '../_shared/styled-director.ts'
import {
  STYLED_IMAGE_MODELS, MAX_IMAGE_REQUEST_BYTES, directorModel, imageModel, parseDirectorModels, validateImageRequest,
  openAiImageBody, geminiImageBody, parseGeneratedImage,
} from '../_shared/styled-image-core.ts'

const COMPANY_ID = 'e0000000-0000-4000-8000-000000000001'
const SECRETS = { openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' } as const
const TIMEOUT_MS = 120_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function readBody(req: Request) {
  const reader = req.body?.getReader()
  if (!reader) throw new Error('요청 본문이 없습니다.')
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_REQUEST_BYTES) { await reader.cancel(); throw new Error('참고자료 용량이 큽니다. 사진 크기나 장수를 줄여 주세요.') }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { reader.releaseLock() }
}

async function providerJson(url: string, options: RequestInit, timeout = TIMEOUT_MS) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) {
    let detail = ''
    try {
      const failure = await response.json()
      if (typeof failure?.error?.message === 'string') {
        detail = failure.error.message.replace(/[A-Za-z0-9+/=_-]{60,}/g, '[생략]').slice(0, 600)
        for (const secretName of Object.values(SECRETS)) {
          const secret = Deno.env.get(secretName)
          if (secret) detail = detail.replaceAll(secret, '[비공개]')
        }
      }
    } catch (error) {
      console.warn('[styled-image] 제공자 오류 형식 해석 실패', { status: response.status, name: error instanceof Error ? error.name : 'unknown' })
    }
    // Do not log provider bodies: they can echo prompts, images or credentials.
    console.warn('[styled-image] 제공자 요청 실패', { status: response.status, requestId: response.headers.get('x-request-id') })
    const hint = response.status === 401 || response.status === 403 ? 'API 키·모델 사용 권한을 확인해 주세요.'
      : response.status === 429 ? 'API 한도·크레딧을 확인해 주세요.'
      : response.status === 404 ? '이 API 계정에서 모델을 사용할 수 없습니다.'
      : '요청 조건이나 제공자 상태를 확인해 주세요.'
    throw Object.assign(new Error(`이미지 API 오류 (${response.status}). ${hint}${detail ? `\n${detail}` : ''}`), { providerFailure: true })
  }
  return await response.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST만 지원합니다.' }, 405)
  const started = Date.now()
  let modelId = ''
  let userId = ''
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ ok: false, error: '로그인이 필요합니다.' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authorization } },
    })
    const { data: { user }, error } = await supabase.auth.getUser(authorization.slice(7))
    if (error || !user) return json({ ok: false, error: '다시 로그인해 주세요.' }, 401)
    userId = user.id
    const { data: profile, error: profileError } = await supabase.from('profiles').select('status,company_id,is_admin').eq('id', user.id).maybeSingle()
    if (profileError) throw new Error('직원 정보를 확인하지 못했습니다.')
    if (profile?.status !== 'active' || profile.company_id !== COMPANY_ID) return json({ ok: false, error: '승인된 회사 직원만 사용할 수 있습니다.' }, 403)
    if (!profile.is_admin) {
      const { data: capability, error: capabilityError } = await supabase.from('profile_capabilities').select('capability').eq('profile_id', user.id).eq('capability', 'design').maybeSingle()
      if (capabilityError) throw new Error('디자인 권한을 확인하지 못했습니다.')
      if (!capability) return json({ ok: false, error: '디자인 업무 권한이 필요합니다.' }, 403)
    }
    const body = await readBody(req)
    if (body.action === 'models') {
      const openaiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
      const [models, directors] = await Promise.all([
        Promise.all(STYLED_IMAGE_MODELS.map(async (model) => {
          const key = Deno.env.get(SECRETS[model.provider])?.trim()
          if (!key) return { modelId: model.id, available: false, message: 'API 키가 등록되지 않았습니다.' }
          try {
            await providerJson(model.provider === 'openai'
              ? `https://api.openai.com/v1/models/${model.id}`
              : `https://generativelanguage.googleapis.com/v1beta/models/${model.id}`, {
              headers: model.provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key },
            }, 15_000)
            return { modelId: model.id, available: true, message: '모델 조회 확인 · 생성 시 API 요금 발생' }
          } catch (error) {
            console.warn('[styled-image] 모델 조회 실패', { modelId: model.id, name: error instanceof Error ? error.name : '조회 실패' })
            return { modelId: model.id, available: false, message: error instanceof Error ? error.message : '모델 조회 실패' }
          }
        })),
        openaiKey
          ? providerJson('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${openaiKey}` } }, 15_000)
            .then(parseDirectorModels)
            .catch((error) => {
              console.warn('[styled-image] 디렉터 모델 목록 조회 실패', { name: error instanceof Error ? error.name : '조회 실패' })
              return []
            })
          : Promise.resolve([]),
      ])
      return json({ ok: true, models, directors })
    }
    if (body.action !== 'generate' && body.action !== 'direct') return json({ ok: false, error: '지원하지 않는 요청입니다.' }, 400)
    const request = validateImageRequest(body)
    if (body.action === 'direct') {
      modelId = directorModel(request.directorModelId).id
      const key = Deno.env.get('OPENAI_API_KEY')?.trim()
      if (!key) throw new Error('디렉터에 사용할 OpenAI API 키가 등록되지 않았습니다.')
      console.info('[styled-image] 디렉터 시작', { userId, modelId, images: request.images.length })
      const payload = await providerJson('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(directorBody(request)),
      }, 60_000)
      const plan = parseDirectorPlan(payload)
      console.info('[styled-image] 디렉터 완료', { userId, modelId, latencyMs: Date.now() - started, clarification: !!plan.question })
      return json({ ok: true, plan })
    }
    modelId = request.modelId
    const model = imageModel(modelId)
    const key = Deno.env.get(SECRETS[model.provider])?.trim()
    if (!key) throw new Error('선택한 제공자의 API 키가 등록되지 않았습니다.')
    console.info('[styled-image] 생성 시작', { userId, modelId, images: request.images.length, ratio: request.ratio })
    const payload = model.provider === 'openai'
      ? await providerJson('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: openAiImageBody(request) })
      : await providerJson('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(geminiImageBody(request)) })
    const data = parseGeneratedImage(model.provider, payload)
    const latencyMs = Date.now() - started
    console.info('[styled-image] 생성 완료', { userId, modelId, latencyMs })
    return json({ ok: true, data, modelId, latencyMs })
  } catch (error) {
    const timedOut = error instanceof Error && /Timeout|Abort/.test(error.name)
    const message = timedOut ? '생성 응답 대기 시간이 초과되었습니다. 제공자에서 처리되었을 수 있으므로 자동 재시도하지 않습니다.' : error instanceof Error ? error.message : '이미지 생성에 실패했습니다.'
    console.warn('[styled-image] 요청 실패', { userId, modelId, latencyMs: Date.now() - started, message: error && typeof error === 'object' && 'providerFailure' in error ? '제공자 오류 (상세는 요청자에게 반환)' : message })
    return json({ ok: false, error: message }, timedOut ? 504 : 400)
  }
})
