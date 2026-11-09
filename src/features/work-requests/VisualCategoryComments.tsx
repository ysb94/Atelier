import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip, Reply, Send, X } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import {
  downloadVisualWorkCommentFile,
  listVisualWorkComments,
  MAX_VISUAL_COMMENT_LENGTH,
  postVisualWorkComment,
  validateVisualCommentFiles,
  type VisualComment,
  type VisualCommentFile,
} from '@/lib/supabase/work-request-visual-comments'
import { formatDateTime } from './work-request-schedule'

type Draft = {
  body: string
  files: File[]
  reply: { id: string; author: string } | null
  command?: string
  error?: string
}
const EMPTY_DRAFT: Draft = { body: '', files: [], reply: null }
const PREVIEW_IMAGE = /^image\/(?:jpeg|png|webp|gif|avif)$/i

function CommentFile({ file }: { file: VisualCommentFile }) {
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false)
  const previewable = PREVIEW_IMAGE.test(file.type) && file.size <= 5 * 1024 * 1024

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  useEffect(() => {
    if (!previewable) return
    let disposed = false
    let url: string | undefined
    void downloadVisualWorkCommentFile(file).then(blob => {
      if (disposed) return
      url = URL.createObjectURL(blob)
      setPreview(url)
    }).catch(() => {
      if (!disposed) console.warn('[visual-work-comments] 이미지 미리보기 실패', { source: 'attachment' })
    })
    return () => {
      disposed = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file, previewable])

  async function download() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const blob = await downloadVisualWorkCommentFile(file)
      if (!live.current) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      if (live.current) setError('첨부파일을 받을 수 없습니다. 다시 시도해 주세요.')
    } finally {
      if (live.current) setBusy(false)
    }
  }

  return (
    <div className="max-w-60 space-y-1">
      {preview && <img src={preview} alt={file.name} className="max-h-44 rounded-md border border-border object-contain" />}
      <Button type="button" variant="outline" size="sm" disabled={busy} className="max-w-full" onClick={() => void download()}>
        <Download className="size-4 shrink-0" />
        <span className="truncate">{busy ? '받는 중…' : file.name}</span>
      </Button>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  )
}

function CommentEntry({
  comment, onReply,
}: { comment: VisualComment; onReply?: (comment: VisualComment) => void }) {
  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        {comment.authorDepartment && <span className="text-muted-foreground">{comment.authorDepartment}</span>}
        <strong>{comment.authorName}</strong>
        <time className="text-muted-foreground" dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
      </div>
      {comment.body && <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>}
      {!!comment.files.length && <div className="flex flex-wrap gap-2">
        {comment.files.map(file => <CommentFile key={file.path} file={file} />)}
      </div>}
      {onReply && <Button type="button" variant="ghost" size="sm" className="h-7 px-1 text-xs" onClick={() => onReply(comment)}>
        <Reply className="size-3.5" />답글
      </Button>}
    </div>
  )
}

export function VisualCategoryComments({
  requestId, category, canDiscuss,
}: {
  requestId: string
  category: { id: string; label: string }
  canDiscuss: boolean
}) {
  useRenderWatch('VisualCategoryComments')
  const { profile, session } = useAuth()
  const active = useWorkspaceTabActivity()
  const preview = usePagePreview()
  const cache = useQueryClient()
  const actor = session?.user.id
  const valid = Boolean(actor && profile?.id === actor && profile?.status === 'active' && !preview?.active)
  const queryKey = ['visual-work-comments', actor, profile?.companyId, requestId, category.id]
  const enabled = valid && canDiscuss && active
  const query = useQuery({
    ...sharedReadPolicy, queryKey, enabled, retry: false,
    queryFn: () => listVisualWorkComments(requestId, category.id),
    refetchInterval: state => state.state.data?.ready === false ? false : readPollInterval(30_000, enabled)(state),
  })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [sending, setSending] = useState<string[]>([])
  const inFlight = useRef(new Set<string>())
  const identity = useRef(actor)
  identity.current = valid ? actor : undefined
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const composerId = useId()
  const draft = drafts[category.id] ?? EMPTY_DRAFT
  const busy = sending.includes(category.id)

  function updateDraft(changes: Partial<Draft>) {
    setDrafts(current => ({
      ...current,
      [category.id]: { ...(current[category.id] ?? EMPTY_DRAFT), error: undefined, command: undefined, ...changes },
    }))
  }

  function addFiles(incoming: File[]) {
    const files = [...draft.files, ...incoming]
    const error = validateVisualCommentFiles(files)
    updateDraft(error ? { error, command: draft.command } : { files })
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const categoryId = category.id
    if (!enabled || !query.data?.canWrite || inFlight.current.has(categoryId) || (!draft.body.trim() && !draft.files.length)) return
    const trace = startWorkflow('app', 'visual_work_comment_submit')
    trace.step('check_access')
    const command = draft.command ?? crypto.randomUUID()
    let committed = false
    inFlight.current.add(categoryId)
    setSending(current => [...current, categoryId])
    updateDraft({ command })
    try {
      await postVisualWorkComment(requestId, categoryId, {
        command, body: draft.body, files: draft.files, replyTo: draft.reply?.id ?? null,
      }, () => mounted.current && identity.current === actor, trace.context())
      committed = true
      if (mounted.current && identity.current === actor) {
        setDrafts(current => ({ ...current, [categoryId]: EMPTY_DRAFT }))
      }
      await trace.run('refresh_comments', () => cache.invalidateQueries({ queryKey }), { writeOutcome: 'committed' })
      trace.done()
    } catch (error) {
      trace.fail(error)
      if (mounted.current && identity.current === actor) {
        setDrafts(current => ({
          ...current,
          [categoryId]: {
            ...(current[categoryId] ?? EMPTY_DRAFT),
            error: committed ? '댓글은 저장했습니다. 목록을 다시 확인해 주세요.'
              : error instanceof Error ? error.message : '댓글을 저장하지 못했습니다.',
          },
        }))
      }
    } finally {
      inFlight.current.delete(categoryId)
      if (mounted.current) setSending(current => current.filter(item => item !== categoryId))
    }
  }

  const writable = enabled && query.isSuccess && query.data.ready && query.data.canWrite
  const replies = new Map<string, VisualComment[]>()
  const roots: VisualComment[] = []
  if (enabled && query.isSuccess && query.data.ready) {
    for (const item of query.data.items) {
      if (!item.replyTo) roots.push(item)
      else {
        const thread = replies.get(item.replyTo)
        if (thread) thread.push(item)
        else replies.set(item.replyTo, [item])
      }
    }
  }

  return (
    <Card aria-label={category.label + ' 댓글'}>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">댓글 <span className="text-xs font-normal text-muted-foreground">{category.label}</span></h3>
        {!valid || !canDiscuss ? <p className="text-sm text-muted-foreground">요청자, 업무 관리자, 이 분류의 담당자가 댓글을 확인할 수 있습니다.</p>
          : query.isError ? <p role="alert" className="text-sm text-danger">{query.error.message}
              <Button type="button" variant="ghost" size="sm" onClick={() => void query.refetch()}>다시 조회</Button>
            </p>
          : query.isPending ? <p role="status" className="text-sm text-muted-foreground">댓글을 불러오는 중…</p>
          : !query.data.ready ? <p role="status" className="text-sm text-muted-foreground">분류별 댓글 서버 연결 대기</p>
          : enabled && !roots.length ? <p className="text-sm text-muted-foreground">아직 등록된 댓글이 없습니다.</p> : null}
        {roots.map(comment => (
          <div key={comment.id} className="border-t border-border">
            <CommentEntry comment={comment} onReply={writable ? item => {
              updateDraft({ reply: { id: item.id, author: item.authorName } })
              editor.current?.focus()
            } : undefined} />
            {replies.get(comment.id)?.map(reply => (
              <div key={reply.id} className="ml-3 border-l border-border pl-3 sm:ml-6 sm:pl-4">
                <CommentEntry comment={reply} />
              </div>
            ))}
          </div>
        ))}
        {writable && (
          <form className="space-y-2 border-t border-border pt-3" onSubmit={event => void submit(event)}>
            {draft.reply && <div className="flex items-center justify-between rounded-md bg-muted px-2 text-xs">
              <span className="truncate">{draft.reply.author} 님에게 답글</span>
              <Button type="button" variant="ghost" size="sm" aria-label="답글 취소" disabled={busy} onClick={() => updateDraft({ reply: null })}>
                <X className="size-4" />
              </Button>
            </div>}
            <label className="sr-only" htmlFor={composerId}>{category.label} 댓글 입력</label>
            <Textarea
              id={composerId}
              ref={editor}
              placeholder="댓글 입력 · Shift+Enter 줄바꿈 / Enter 등록"
              rows={2}
              maxLength={MAX_VISUAL_COMMENT_LENGTH}
              value={draft.body}
              disabled={busy}
              onChange={event => updateDraft({ body: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            {draft.files.length > 0 && <ul className="flex flex-wrap gap-2 text-xs">
              {draft.files.map((file, index) => <li key={file.name + ':' + index} className="flex max-w-full items-center gap-1 rounded-md border border-border pl-2">
                <span className="truncate">{file.name}</span>
                <Button type="button" variant="ghost" size="sm" aria-label={file.name + ' 첨부 취소'} disabled={busy}
                  onClick={() => updateDraft({ files: draft.files.filter((_, i) => i !== index) })}><X className="size-3.5" /></Button>
              </li>)}
            </ul>}
            {draft.error && <p role="alert" className="text-sm text-danger">{draft.error}</p>}
            <div className="flex justify-between gap-2">
              <input type="file" ref={fileInput} className="hidden" multiple
                onChange={event => {
                  addFiles(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }} />
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" />첨부
              </Button>
              <Button type="submit" size="sm" disabled={busy || (!draft.body.trim() && !draft.files.length)}>
                <Send className="size-4" />{busy ? '등록 중…' : draft.reply ? '답글 등록' : '댓글 등록'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
