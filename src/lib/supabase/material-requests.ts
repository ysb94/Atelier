import type { MaterialRequest } from '@/features/planning/MaterialRequestDialog'
import type { ContentBlock } from '@/features/work-requests/work-request-types'
import { startWorkflow, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import type { MaterialNudgeTarget } from '@/lib/workspace/material-request-navigation'
import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

type StoredBlock = Extract<ContentBlock, { type: 'text' }> |
  ((Omit<Extract<ContentBlock, { type: 'image' }>, 'file'> | Omit<Extract<ContentBlock, { type: 'file' }>, 'file'>) & {
    path: string
    name: string
  })
type StoredContent = { title: string; brandId: string; blocks: StoredBlock[] }
type StoredRequest = Omit<MaterialRequest, 'blocks' | 'rounds'> & {
  blocks: StoredBlock[]
  rounds: (Omit<MaterialRequest['rounds'][number], 'content'> & { content?: StoredContent })[]
}
export type MaterialScope = 'planning' | 'china'
export type MaterialAction = 'save' | 'delete' | 'send' | 'review' | 'assign' | 'confirm' | 'ship' | 'receive' | 'rate'

const bucket = 'material-request-files'
const filePaths = new WeakMap<File, { prefix: string; path: string }>()
const permittedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'FONT', 'SPAN'])
const permittedColors = /^(?:black|crimson|royalblue|seagreen|#[0-9a-f]{3,8}|rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))$/i

// Shared requests contain authored HTML. Rebuild only the formatting supported by the editor.
function safeFormatting(html: string) {
  const source = document.createElement('template')
  source.innerHTML = html
  const output = document.createElement('div')
  function append(node: Node, to: HTMLElement) {
    if (node.nodeType === Node.TEXT_NODE) { to.append(document.createTextNode(node.textContent ?? '')); return }
    if (!(node instanceof HTMLElement) || !permittedTags.has(node.tagName)) return
    const next = document.createElement(node.tagName.toLowerCase())
    const color = node.getAttribute('color') ?? node.style.color
    const size = node.getAttribute('size')
    if (permittedColors.test(color)) next.style.color = color
    if (size && /^[1-7]$/.test(size)) next.setAttribute('size', size)
    if (['bold', '700'].includes(node.style.fontWeight)) next.style.fontWeight = 'bold'
    if (node.style.textDecorationLine === 'underline') next.style.textDecorationLine = 'underline'
    if (/^(?:small|medium|large|x-large|\d{1,2}px)$/.test(node.style.fontSize)) next.style.fontSize = node.style.fontSize
    node.childNodes.forEach(child => append(child, next))
    to.append(next)
  }
  source.content.childNodes.forEach(node => append(node, output))
  return output.innerHTML
}

function cleanText(block: Extract<ContentBlock, { type: 'text' }>): StoredBlock {
  return { id: block.id, type: 'text', text: block.text, ...(typeof block.previewHtml === 'string' ? { previewHtml: safeFormatting(block.previewHtml) } : {}) }
}

async function storeBlocks(request: MaterialRequest, context: DiagnosticContext) {
  const prefix = `${request.ownerId}/${request.id}/`
  const blocks: StoredBlock[] = []
  if (request.blocks.length > 80) throw new Error('본문과 첨부 항목은 80개까지 저장할 수 있습니다.')
  for (const block of request.blocks) {
    if (block.type === 'text') { blocks.push(cleanText(block)); continue }
    const { file, ...layout } = block
    if (file.size > 10 * 1024 * 1024) throw new Error('첨부 파일은 한 개당 10MB까지 저장할 수 있습니다.')
    if (file.name.length > 255) throw new Error('첨부 파일 이름을 255자 이하로 줄여 주세요.')
    const saved = filePaths.get(file)
    let path = saved?.prefix === prefix ? saved.path : undefined
    if (!path) {
      path = prefix + crypto.randomUUID()
      await diagnosticQuery('app', 'material_request_upload', getSupabase().storage.from(bucket)
        .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' }), context)
      filePaths.set(file, { prefix, path })
    }
    blocks.push({ ...layout, path, name: file.name })
  }
  return blocks
}

export async function readMaterialRequests(scope: MaterialScope, signal?: AbortSignal) {
  let rpc = getSupabase().rpc('read_material_requests', { p_scope: scope })
  if (signal) rpc = rpc.abortSignal(signal)
  return diagnosticQuery<MaterialRequest[]>('app', 'material_request_list', rpc)
}

async function hydrateMaterialDetail(row: StoredRequest, context: DiagnosticContext, signal?: AbortSignal) {
  const downloaded = new Map<string, Promise<Blob>>()
  async function hydrate(blocks: StoredBlock[]): Promise<ContentBlock[]> {
    const result: ContentBlock[] = []
    for (const block of blocks) {
      signal?.throwIfAborted()
      if (block.type === 'text') { result.push(cleanText(block) as ContentBlock); continue }
      const { path, name, ...layout } = block
      let body = downloaded.get(path)
      if (!body) {
        body = diagnosticQuery<Blob>('app', 'material_request_download', getSupabase().storage.from(bucket).download(path), context)
        downloaded.set(path, body)
      }
      const blob = await body
      signal?.throwIfAborted()
      const file = new File([blob], name, { type: blob.type })
      filePaths.set(file, { prefix: `${row.ownerId}/${row.id}/`, path })
      result.push({ ...layout, file })
    }
    return result
  }
  const blocks = await hydrate(row.blocks)
  const rounds: MaterialRequest['rounds'] = []
  for (const item of row.rounds) {
    const { content, ...state } = item
    rounds.push({ ...state, ...(content ? { content: { ...content, blocks: await hydrate(content.blocks) } } : {}) })
  }
  return { ...row, blocks, rounds }
}

export async function readMaterialDetail(scope: MaterialScope, id: string, round?: number) {
  const trace = startWorkflow('app', 'material_request_detail')
  try {
    const [row] = await trace.run('check_scope', context => diagnosticQuery<StoredRequest[]>('app', 'material_request_detail',
      getSupabase().rpc('read_material_requests', { p_scope: scope, p_id: id, p_round: round ?? null }), context))
    if (!row) throw new Error('요청 내용을 찾지 못했습니다.')
    const result = await hydrateMaterialDetail(row, trace.context())
    trace.done()
    return result
  } catch (error) {
    trace.fail(error)
    throw error
  }
}

export async function readMaterialNudgeRequests(signal?: AbortSignal) {
  let rpc = getSupabase().rpc('material_nudge_workspace', { p_scope: 'list' })
  if (signal) rpc = rpc.abortSignal(signal)
  return diagnosticQuery<MaterialRequest[]>('app', 'material_nudge_request_list', rpc)
}

export const materialNudgeRequestsKey = (accountId: string) => ['material-nudge-requests', accountId] as const

export async function readMaterialNudgeRequest(target: MaterialNudgeTarget, signal: AbortSignal, round?: number) {
  const trace = startWorkflow('app', 'material_nudge_request_detail')
  try {
    const { request, read_at: readAt, pending_notice_ids: pendingNoticeIds } = await trace.run('check_scope', context => diagnosticQuery<{
      request: StoredRequest
      read_at: string | null
      pending_notice_ids?: string[]
    }>('app', 'material_nudge_request_detail', getSupabase().rpc('material_nudge_workspace', {
      p_scope: target.scope, p_id: target.id, p_round: round ?? null,
    }).abortSignal(signal), context))
    if (!request) throw new Error('요청 내용을 찾지 못했습니다.')
    signal.throwIfAborted()
    const result = await hydrateMaterialDetail(request, trace.context(), signal)
    trace.done()
    return { request: result, readAt, pendingNoticeIds }
  } catch (error) {
    trace.fail(error)
    throw error
  }
}

export function confirmMaterialNudgeRequest(requestId: string, noticeIds: string[], context: DiagnosticContext) {
  return diagnosticQuery<boolean>('notification', 'confirm_material_nudge_request',
    getSupabase().rpc('confirm_material_nudge_request', { p_request: requestId, p_notice_ids: noticeIds }), context)
}

export async function writeMaterialRequest(input: {
  action: MaterialAction
  request: MaterialRequest
  round?: number
  assignee?: string
  score?: number
  stage?: 'writing' | 'ready'
}, context: DiagnosticContext) {
  const { action, request, round, assignee, score, stage } = input
  const blocks = action === 'save' ? await storeBlocks(request, context) : null
  return diagnosticQuery<number>('app', 'material_request_write', getSupabase().rpc('write_material_request', {
    p_action: action, p_id: request.id, p_revision: request.revision ?? null, p_round: round ?? null,
    p_title: action === 'save' ? request.title : null, p_brand: action === 'save' ? request.brandId || null : null,
    p_blocks: blocks, p_stage: stage ?? null, p_assignee: assignee ?? null, p_score: score ?? null,
  }), context)
}
