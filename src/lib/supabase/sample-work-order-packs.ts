import { Upload } from 'tus-js-client'
import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

export type SamplePackFile = { path: string; name: string; size: number; sha256: string }
export type SamplePack = { id: string; revision: string; files: SamplePackFile[]; notes: string; published: boolean }
export type SamplePackUpload = { path: string; digest?: string; uploadUrl?: string }

export const SAMPLE_PACK_TOTAL_LIMIT = 10_000_000_000
export const SAMPLE_PACK_PREVIEW_LIMIT = 30 * 1024 * 1024
export const SAMPLE_PACK_BUFFER_LIMIT = 100 * 1024 * 1024
const uploadChunkBytes = 6 * 1024 * 1024
const bucket = 'sample-work-orders'
const marker = 'atelier-sample-pack:'
export const samplePackPrefix = ['sample-work-order-pack'] as const

export function samplePackId(value: string | null | undefined) {
  return value?.startsWith(marker) ? value.slice(marker.length).split(':')[0] : null
}

export function samplePackReference(pack: SamplePack, label: string) {
  return { url: `${marker}${pack.id}:${pack.revision}`, name: `${label} 작업지시서 · 첨부 ${pack.files.length}개` }
}

export async function getSamplePack(id: string | null, draft: string | null = null, slot: string | null = null) {
  return diagnosticQuery<SamplePack | null>('app', 'get_sample_work_order_pack',
    getSupabase().rpc('get_sample_work_order_pack', { p_id: id, p_draft: draft, p_slot: slot }))
}

export function openSamplePack(draft: string, slot: string) {
  return diagnosticQuery<SamplePack>('app', 'open_sample_work_order_pack',
    getSupabase().rpc('open_sample_work_order_pack', { p_draft: draft, p_slot: slot }))
}

export function saveSamplePack(pack: SamplePack, files: SamplePackFile[], notes: string) {
  return diagnosticQuery<SamplePack>('app', 'save_sample_work_order_pack',
    getSupabase().rpc('save_sample_work_order_pack', {p_id: pack.id, p_revision: pack.revision, p_files: files, p_notes: notes}))
}

export function receiveSamplePack(id: string, draftRevision: string) {
  return diagnosticQuery<void>('app', 'receive_sample_work_order_pack',
    getSupabase().rpc('receive_sample_work_order_pack', { p_id: id, p_revision: draftRevision }))
}

export function samplePackServerMissing(error: unknown) {
  return ['PGRST202', '42883'].includes((error as { cause?: { code?: string } } | null)?.cause?.code ?? '')
}

export function validateSelectedSampleFiles(existing: readonly Pick<SamplePackFile, 'size'>[], files: readonly File[]) {
  if (files.some(file => !file.name.trim() || Array.from(file.name).length > 205 || /\p{Cc}/u.test(file.name))) {
    throw new Error('파일 이름을 확인해 주세요. 이름은 205자까지 입력할 수 있습니다.')
  }
  if (files.some(file => !file.size)) throw new Error('빈 파일은 첨부할 수 없습니다.')
  const total = [...existing, ...files].reduce((sum, file) => sum + file.size, 0)
  if (total > SAMPLE_PACK_TOTAL_LIMIT) throw new Error('첨부 파일의 전체 용량은 10GB까지 올릴 수 있습니다.')
}

export async function uploadSamplePackFile(file: File, attempt: SamplePackUpload, actor: string, onProgress: (sent: number) => void): Promise<SamplePackFile> {
  const { sha256 } = await import('@noble/hashes/sha256')
  if (!attempt.digest) {
    const hash = sha256.create()
    for (let offset = 0; offset < file.size; offset += uploadChunkBytes) {
      hash.update(new Uint8Array(await file.slice(offset, offset + uploadChunkBytes).arrayBuffer()))
    }
    attempt.digest = hex(hash.digest())
  }
  const supabase = getSupabase()
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase 저장소 설정을 확인해 주세요.')
  const endpoint = new URL(url)
  if (endpoint.hostname.endsWith('.supabase.co') && !endpoint.hostname.endsWith('.storage.supabase.co')) {
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co')
  }
  endpoint.pathname = '/storage/v1/upload/resumable'
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: endpoint.href,
      uploadUrl: attempt.uploadUrl ?? null,
      chunkSize: uploadChunkBytes,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      uploadDataDuringCreation: false,
      storeFingerprintForResuming: false,
      headers: { apikey: key },
      metadata: { bucketName: bucket, objectName: attempt.path, contentType: 'application/octet-stream' },
      onBeforeRequest: async request => {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session || session.user.id !== actor) throw new Error('같은 계정으로 다시 로그인해 주세요.')
        request.setHeader('Authorization', `Bearer ${session.access_token}`)
      },
      onUploadUrlAvailable: () => { attempt.uploadUrl = upload.url ?? undefined },
      onProgress,
      onError: () => reject(new Error(`${file.name} 업로드를 완료하지 못했습니다. 저장을 다시 눌러 주세요.`)),
      onSuccess: () => resolve(),
    })
    upload.start()
  })
  return { path: attempt.path, name: file.name, size: file.size, sha256: attempt.digest }
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

async function signedPackFile(file: SamplePackFile, download = false) {
  const { signedUrl } = await diagnosticQuery<{ signedUrl: string }>('app', 'sign_sample_work_order_file',
    getSupabase().storage.from(bucket).createSignedUrl(file.path, 3600))
  if (!download) return signedUrl
  const url = new URL(signedUrl)
  url.searchParams.set('download', safeSamplePackName(file.name))
  return url.href
}

async function readPackFile(file: SamplePackFile) {
  const { sha256 } = await import('@noble/hashes/sha256')
  const response = await fetch(await signedPackFile(file))
  if (!response.ok || !response.body) throw new Error(`파일을 열 수 없습니다. ${file.name}`)
  const hash = sha256.create()
  let size = 0
  return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength
      if (size > file.size) throw new Error(`파일을 다시 확인해 주세요. ${file.name}`)
      hash.update(chunk)
      controller.enqueue(chunk)
    },
    flush() {
      if (size !== file.size || hex(hash.digest()) !== file.sha256) throw new Error(`파일을 다시 확인해 주세요. ${file.name}`)
    },
  }))
}

function clickDownload(href: string, name: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function downloadSamplePackBlob(value: Blob, name: string) {
  const href = URL.createObjectURL(value)
  clickDownload(href, name)
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

export async function downloadSamplePackFile(file: SamplePackFile) {
  clickDownload(await signedPackFile(file, true), file.name)
}

export async function previewSamplePackFile(file: SamplePackFile) {
  if (file.size > SAMPLE_PACK_PREVIEW_LIMIT) throw new Error('파일을 내려받아 열어 주세요.')
  return new Response(await readPackFile(file)).blob()
}

export async function streamSamplePackZip(pack: SamplePack) {
  if (!pack.files.length) throw new Error('첨부 파일을 한 개 이상 올려 주세요.')
  const { makeZip } = await import('client-zip')
  const used = new Set<string>()
  async function* entries() {
    for (const file of pack.files) {
      const safe = safeSamplePackName(file.name)
      const dot = safe.lastIndexOf('.') > 0 ? safe.lastIndexOf('.') : safe.length
      let name = safe
      let sequence = 2
      while (used.has(name.normalize('NFC').toLowerCase())) {
        name = `${safe.slice(0, dot)} (${sequence++})${safe.slice(dot)}`
      }
      used.add(name.normalize('NFC').toLowerCase())
      yield { name, size: file.size, input: await readPackFile(file) }
    }
  }
  return makeZip(entries())
}

export function safeSamplePackName(value: string) {
  return Array.from(value, character => character.charCodeAt(0) < 32 ? '_' : character)
    .join('').replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim() || '작업지시서'
}

export function samplePackSize(pack: Pick<SamplePack, 'files'>) {
  return pack.files.reduce((sum, file) => sum + file.size, 0)
}

export async function getPublishedSamplePack(id: string) {
  const pack = await getSamplePack(id)
  if (!pack?.published || !pack.files.length) throw new Error('등록된 작업지시서를 다시 확인해 주세요.')
  return pack
}
