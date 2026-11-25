import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

export type SamplePackFile = { path: string; name: string; size: number; sha256: string }
export type SamplePack = { id: string; revision: string; files: SamplePackFile[]; notes: string; published: boolean }

export const SAMPLE_PACK_FILE_LIMIT = 30 * 1024 * 1024
export const SAMPLE_PACK_TOTAL_LIMIT = 100 * 1024 * 1024
export const SAMPLE_PACK_COUNT_LIMIT = 10
export const SAMPLE_PACK_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.doc,.docx'
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

async function sha256(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

export function validateSelectedSampleFiles(existing: readonly Pick<SamplePackFile, 'size'>[], files: readonly File[]) {
  if (existing.length + files.length > SAMPLE_PACK_COUNT_LIMIT) throw new Error('한 작업지시서에 파일을 최대 10개까지 올릴 수 있습니다.')
  if (files.some(file => !/\.(pdf|png|jpe?g|webp|xlsx?|docx?)$/i.test(file.name) || file.name.length > 195)) {
    throw new Error('파일명이 195자 이내인 PDF, 이미지, 엑셀 또는 워드 파일을 선택해 주세요.')
  }
  if (files.some(file => file.size === 0 || file.size > SAMPLE_PACK_FILE_LIMIT)) throw new Error('빈 파일을 제외하고 파일당 30MB 이하로 올려 주세요.')
  const total = [...existing, ...files].reduce((sum, file) => sum + file.size, 0)
  if (total > SAMPLE_PACK_TOTAL_LIMIT) throw new Error('첨부 파일의 전체 용량은 100MB까지 올릴 수 있습니다.')
}

export async function uploadSamplePackFile(packId: string, file: File): Promise<SamplePackFile> {
  const path = `${packId}/${crypto.randomUUID()}`
  const digest = await sha256(await file.arrayBuffer())
  await diagnosticQuery('app', 'upload_sample_work_order_file',
    getSupabase().storage.from(bucket).upload(path, file, { upsert: false }))
  return { path, name: file.name, size: file.size, sha256: digest }
}

async function readPackFile(file: SamplePackFile) {
  const blob = await diagnosticQuery<Blob>('app', 'download_sample_work_order_file',
    getSupabase().storage.from(bucket).download(file.path))
  const bytes = await blob.arrayBuffer()
  if (bytes.byteLength !== file.size || await sha256(bytes) !== file.sha256) {
    throw new Error(`파일을 다시 확인해 주세요. ${file.name}`)
  }
  return bytes
}

function downloadObject(value: Blob, name: string) {
  const href = URL.createObjectURL(value)
  const link = document.createElement('a')
  link.href = href
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

export async function downloadSamplePackFile(file: SamplePackFile) {
  downloadObject(new Blob([await readPackFile(file)]), file.name)
}

export async function previewSamplePackFile(file: SamplePackFile) {
  return new Blob([await readPackFile(file)])
}

export async function buildSamplePackZip(pack: SamplePack) {
  if (!pack.files.length) throw new Error('첨부 파일을 한 개 이상 올려 주세요.')
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const used = new Set<string>()
  for (const file of pack.files) {
    const safe = Array.from(file.name, character => character.charCodeAt(0) < 32 ? '_' : character)
      .join('').replace(/[\\/:*?"<>|]/g, '_')
    const dot = safe.lastIndexOf('.')
    let name = safe
    let sequence = 2
    while (used.has(name.normalize('NFC').toLowerCase())) {
      name = `${safe.slice(0, dot)} (${sequence++})${safe.slice(dot)}`
    }
    used.add(name.normalize('NFC').toLowerCase())
    zip.file(name, await readPackFile(file))
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

export async function downloadSamplePack(id: string, label: string) {
  const pack = await getSamplePack(id)
  if (!pack?.published) throw new Error('등록된 작업지시서를 다시 확인해 주세요.')
  downloadObject(await buildSamplePackZip(pack), `${label.replace(/[\\/:*?"<>|]/g, '_')}.zip`)
}
