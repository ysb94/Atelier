import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery, type DiagnosticContext, type WorkflowTrace } from '@/lib/diagnostics/workflow-trace'

const BUCKET = 'company-work-requests'
export const MAX_VISUAL_COMMENT_FILES = 5
export const MAX_VISUAL_COMMENT_LENGTH = 10000

export type VisualCommentFile = { name: string; type: string; size: number; path: string }
export type VisualComment = {
  id: string
  authorId: string
  authorName: string
  authorDepartment: string
  replyTo: string | null
  body: string
  files: VisualCommentFile[]
  createdAt: string
  internal?: boolean
}
type CommentList = { canWrite: boolean; items: VisualComment[] }
type Reservation = { published: boolean; files: (VisualCommentFile & { uploaded: boolean })[] }
type CommentDraft = { command: string; body: string; replyTo: string | null; files: File[] }

export function validateVisualCommentFiles(files: readonly File[], purpose = '댓글') {
  if (files.length > MAX_VISUAL_COMMENT_FILES) return '파일은 ' + purpose + '당 5개까지 첨부할 수 있습니다.'
  if (files.some(file => !file.name || file.name.length > 255 || file.size < 1 || file.size > 20 * 1024 * 1024
    || /[\\/]/.test(file.name) || /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$/i.test(file.name))) {
    return '20MB 이하의 실행 파일이 아닌 자료만 첨부할 수 있습니다.'
  }
  return null
}

function rpcFailure(message: string, error: unknown) {
  return new Error(message, { cause: error })
}

function fileManifest(files: readonly File[]) {
  return files.map(file => ({ name: file.name, type: file.type.split(';')[0] || 'application/octet-stream', size: file.size }))
}

function verifyVisualFileSession(currentSession: () => boolean) {
  if (!currentSession()) throw new Error('계정이 바뀌었습니다. 다시 확인해 주세요.')
}

async function uploadVisualFiles(
  reservation: Reservation, files: readonly File[], currentSession: () => boolean, trace: WorkflowTrace, finish: () => Promise<void>,
) {
  const storage = getSupabase().storage.from(BUCKET)
  try {
    for (const [index, attachment] of reservation.files.entries()) {
      if (attachment.uploaded) continue
      await trace.run('upload_file', async () => {
        verifyVisualFileSession(currentSession)
        const { error } = await storage.upload(attachment.path, files[index], { contentType: attachment.type, upsert: false })
        if (error) throw rpcFailure('파일을 올리지 못했습니다. 다시 시도해 주세요.', error)
      })
    }
    verifyVisualFileSession(currentSession)
    await finish()
  } catch (error) {
    if (currentSession()) {
      try {
        // Published objects are protected even when a successful save response is lost.
        const cleanup = await storage.remove(reservation.files.map(file => file.path))
        if (cleanup.error) console.warn('[visual-work-files] 첨부 정리 실패', { pending: true })
      } catch {
        console.warn('[visual-work-files] 첨부 정리 연결 실패', { pending: true })
      }
    }
    throw error
  }
}

export function listVisualWorkComments(request: string, category: string) {
  return diagnosticOperation('app', 'visual_work_comment_list', async trace => {
    const { data, error } = await trace.run('db_request', context => tracedQuery(
      getSupabase().rpc('list_visual_work_category_comments', { p_request: request, p_category: category }), context,
    ))
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      trace.block('schema_not_ready')
      return { ready: false, canWrite: false, items: [] as VisualComment[] }
    }
    if (error) throw rpcFailure(error.code === '42501' ? '이 분류의 댓글을 조회할 권한이 없습니다.' : '댓글을 불러오지 못했습니다.', error)
    const result = data as CommentList | null
    if (!result || !Array.isArray(result.items)) throw new Error('댓글 목록을 확인하지 못했습니다.')
    return { ready: true, ...result }
  })
}

export function postVisualWorkComment(
  request: string, category: string, draft: CommentDraft, currentSession: () => boolean, parent?: DiagnosticContext,
) {
  return diagnosticOperation('app', 'visual_work_comment_write', async trace => {
    trace.step('validate_input', { count: draft.files.length })
    const body = draft.body.trim()
    const invalidFile = validateVisualCommentFiles(draft.files)
    if (invalidFile || body.length > MAX_VISUAL_COMMENT_LENGTH || (!body && !draft.files.length)) {
      throw new Error(invalidFile ?? '댓글 내용을 확인해 주세요.')
    }
    const args = {
      p_request: request, p_category: category, p_id: draft.command,
      p_body: body, p_reply_to: draft.replyTo,
      p_files: fileManifest(draft.files),
    }
    const save = (publish: boolean, context: DiagnosticContext) => {
      verifyVisualFileSession(currentSession)
      return tracedQuery(getSupabase().rpc('save_visual_work_category_comment', { ...args, p_publish: publish }), context)
    }
    const reserved = await trace.run('reserve_comment', context => save(false, context))
    if (reserved.error) throw rpcFailure(reserved.error.code === '42501' ? '이 분류에 댓글을 쓸 권한이 없습니다.' : '댓글 저장을 시작하지 못했습니다.', reserved.error)
    const reservation = reserved.data as Reservation | null
    if (!reservation || reservation.files.length !== draft.files.length) throw new Error('댓글 저장 응답을 확인하지 못했습니다.')
    if (reservation.published) return

    await uploadVisualFiles(reservation, draft.files, currentSession, trace, async () => {
      const result = await trace.run('publish_comment', context => save(true, context))
      if (result.error) throw rpcFailure('댓글 전송을 확인하지 못했습니다. 다시 시도해 주세요.', result.error)
      if (!(result.data as Reservation | null)?.published) throw new Error('댓글 전송을 확인하지 못했습니다. 다시 시도해 주세요.')
    })
  }, parent)
}

export function submitVisualWorkFiles(
  request: string, category: string, command: string, files: readonly File[], currentSession: () => boolean,
  finish: () => Promise<void>, parent: DiagnosticContext,
) {
  return diagnosticOperation('app', 'visual_work_result_files', async trace => {
    trace.step('validate_input', { count: files.length })
    const invalidFile = validateVisualCommentFiles(files, '결과물')
    if (invalidFile) throw new Error(invalidFile)
    verifyVisualFileSession(currentSession)
    const { data, error } = await trace.run('reserve_result', context => tracedQuery(getSupabase().rpc('reserve_visual_work_result_files', {
      p_request: request, p_category: category, p_id: command, p_files: fileManifest(files),
    }), context))
    if (error) throw rpcFailure('결과물 첨부를 시작하지 못했습니다. 배정과 파일을 확인해 주세요.', error)
    const reservation = data as Reservation | null
    if (!reservation || reservation.files.length !== files.length) throw new Error('결과물 첨부 응답을 확인하지 못했습니다.')
    if (reservation.published) {
      await finish()
    } else {
      await uploadVisualFiles(reservation, files, currentSession, trace, finish)
    }
  }, parent)
}

export function downloadVisualWorkCommentFile(file: VisualCommentFile) {
  return diagnosticOperation('app', 'visual_work_comment_download', async trace => {
    const { data, error } = await trace.run('download_file', () => getSupabase().storage.from(BUCKET).download(file.path))
    if (error || !data) throw rpcFailure('첨부파일을 받을 수 없습니다.', error)
    return data
  })
}
