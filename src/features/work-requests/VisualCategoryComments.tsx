import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CornerDownRight, Download, Paperclip, Send, X } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { cn } from '@/lib/utils'
import {
  downloadVisualWorkCommentFile,
  listVisualWorkComments,
  MAX_VISUAL_COMMENT_LENGTH,
  postVisualWorkComment,
  validateVisualCommentFiles,
  type VisualComment,
  type VisualCommentFile,
} from '@/lib/supabase/work-request-visual-comments'
import { downloadVisualWorkFile, visualWorkDate } from './visual-work-detail'

type Draft = {
  body: string
  files: File[]
  reply: { id: string; author: string } | null
  command?: string
  error?: string
}
const EMPTY_DRAFT: Draft = { body: '', files: [], reply: null }
const PREVIEW_IMAGE = /^image\/(?:jpeg|png|webp|gif|avif)$/i

export function VisualWorkAttachment({ file }: { file: VisualCommentFile }) {
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
      downloadVisualWorkFile(blob, file.name)
    } catch {
      if (live.current) setError('첨부파일을 받을 수 없습니다. 다시 시도해 주세요.')
    } finally {
      if (live.current) setBusy(false)
    }
  }

  return (
    <div className="max-w-40 space-y-1">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void download()}
        title={file.name} aria-label={`${file.name} 다운로드`} aria-busy={busy}
        className={cn('relative size-24 flex-col items-start justify-between overflow-hidden p-3 text-left shadow-none sm:size-28', preview && 'p-0')}>
        {preview ? <img src={preview} alt={file.name} className="size-full object-cover" /> : <span className="line-clamp-3 wrap-anywhere text-sm font-normal">{file.name}</span>}
        <Download className={cn('size-4 shrink-0 text-muted-foreground', preview && 'absolute right-1.5 top-1.5 size-6 rounded bg-card/95 p-1')} />
      </Button>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  )
}

function CommentEntry({
  comment, onReply,
}: { comment: VisualComment; onReply?: (comment: VisualComment) => void }) {
  const created = visualWorkDate(comment.createdAt)
  return (
    <div className="space-y-1.5 py-4 sm:py-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {comment.replyTo && <CornerDownRight aria-hidden="true" className="size-3.5 self-center text-muted-foreground" />}
        {comment.authorDepartment && <span className="text-xs text-muted-foreground sm:text-sm">{comment.authorDepartment}</span>}
        <strong className="wrap-anywhere text-sm font-medium sm:text-base">{comment.authorName}</strong>
        {comment.internal && <span className="text-xs text-muted-foreground">내부 댓글</span>}
        {created && <time className="whitespace-nowrap pl-1 text-xs text-muted-foreground tabular-nums sm:pl-2" dateTime={comment.createdAt}>{created.fullDate} {created.time}</time>}
      </div>
      {comment.body && <p className="whitespace-pre-wrap wrap-anywhere text-[15px] leading-6">
        {comment.body.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, index) => index % 2 === 0 ? part : (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-4 hover:text-primary">{part}</a>
        ))}
      </p>}
      {onReply && <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-0.5 font-normal text-muted-foreground" onClick={() => onReply(comment)}>
        <CornerDownRight className="size-3" />답글
      </Button>}
      {!!comment.files.length && <div className="flex flex-wrap gap-3 pt-2 sm:pl-8">
        {comment.files.map(file => <VisualWorkAttachment key={file.path} file={file} />)}
      </div>}
    </div>
  )
}

export function VisualCategoryComments({
  requestId, category, canDiscuss, legacyConversation, sharedOnly,
}: {
  requestId: string
  category: { id: string; label: string }
  canDiscuss: boolean
  legacyConversation?: ReactNode
  sharedOnly?: boolean
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
  const [legacyCategory, setLegacyCategory] = useState<string | null>(null)
  const inFlight = useRef(new Set<string>())
  const identity = useRef(actor)
  identity.current = valid ? actor : undefined
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const composerId = useId()
  const legacyId = useId()
  const legacyOpen = Boolean(legacyConversation && legacyCategory === category.id)
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
  const hasDraft = Boolean(draft.body.trim() || draft.files.length)
  const replies = new Map<string, VisualComment[]>()
  const roots: VisualComment[] = []
  if (enabled && query.isSuccess && query.data.ready) {
    for (const item of query.data.items) {
      if (sharedOnly && item.internal) continue
      if (!item.replyTo) roots.push(item)
      else {
        const thread = replies.get(item.replyTo)
        if (thread) thread.push(item)
        else replies.set(item.replyTo, [item])
      }
    }
  }

  return (
    <section aria-label={category.label + ' 댓글'} className="mt-8 border-y border-border bg-background/50 sm:mt-12">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-8 lg:px-10">
        <h3 className="text-base font-medium">댓글</h3>
        {legacyConversation && <Button type="button" variant="secondary" size="sm"
          className="h-6 px-2 text-[11px] font-normal text-muted-foreground" aria-expanded={legacyOpen} aria-controls={legacyId}
          onClick={() => setLegacyCategory(legacyOpen ? null : category.id)}>
          {legacyOpen ? '이전 댓글 닫기' : '이전 댓글 보기'}
        </Button>}
      </header>
      <div className="px-4 pb-5 sm:px-8 sm:pb-6 lg:px-10">
        {legacyConversation && <div id={legacyId} hidden={!legacyOpen} className="pt-4">{legacyOpen && legacyConversation}</div>}
        {!valid || !canDiscuss ? <p className="py-4 text-sm text-muted-foreground">요청자, 업무 관리자, 이 분류의 담당자가 댓글을 확인할 수 있습니다.</p>
          : query.isError ? <p role="alert" className="py-4 text-sm text-danger">{query.error.message}
              <Button type="button" variant="ghost" size="sm" onClick={() => void query.refetch()}>다시 조회</Button>
            </p>
          : query.isPending ? <p role="status" className="py-4 text-sm text-muted-foreground">댓글을 불러오는 중…</p>
          : !query.data.ready ? <p role="status" className="py-4 text-sm text-muted-foreground">분류별 댓글 서버 연결 대기</p>
          : enabled && !roots.length ? <p className="py-4 text-sm text-muted-foreground">아직 등록된 댓글이 없습니다.</p> : null}
        {roots.map(comment => (
          <article key={comment.id} className="border-b border-border py-1">
            <CommentEntry comment={comment} onReply={writable ? item => {
              updateDraft({ reply: { id: item.id, author: item.authorName } })
              editor.current?.focus()
            } : undefined} />
            {replies.get(comment.id)?.map(reply => (
              <div key={reply.id} className="ml-5 border-t border-border sm:ml-9">
                <CommentEntry comment={reply} />
              </div>
            ))}
          </article>
        ))}
        {writable && (
          <form className="space-y-2 pt-4 sm:pt-6" onSubmit={event => void submit(event)}>
            {draft.reply && <div className="flex items-center justify-between rounded-md bg-muted px-2 text-xs">
              <span className="truncate">{draft.reply.author} 님에게 답글</span>
              <Button type="button" variant="ghost" size="sm" aria-label="답글 취소" disabled={busy} onClick={() => updateDraft({ reply: null })}>
                <X className="size-4" />
              </Button>
            </div>}
            <label className="sr-only" htmlFor={composerId}>{category.label} 댓글 입력</label>
            <div className="flex items-center rounded-md border border-border bg-card px-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25">
              <Textarea
                id={composerId}
                ref={editor}
                placeholder="줄바꿈 Shift+Enter / 입력 Enter"
                rows={2}
                className="min-w-0 resize-y border-0 px-2 py-4 shadow-none focus-visible:ring-0 sm:px-3"
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
              <input type="file" ref={fileInput} className="hidden" multiple
                onChange={event => {
                  addFiles(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }} />
              <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground" disabled={busy}
                aria-label="댓글 파일 첨부" title="댓글 파일 첨부" onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" />
              </Button>
              {(hasDraft || busy) && <Button type="submit" variant="ghost" size="icon" className="size-9 shrink-0 text-primary" disabled={busy}
                aria-label={busy ? '등록 중…' : draft.reply ? '답글 등록' : '댓글 등록'} title={draft.reply ? '답글 등록' : '댓글 등록'}>
                <Send className="size-4" />
              </Button>}
            </div>
            {draft.files.length > 0 && <ul className="flex flex-wrap gap-2 text-xs">
              {draft.files.map((file, index) => <li key={file.name + ':' + index} className="flex max-w-full items-center gap-1 rounded-md border border-border pl-2">
                <span className="truncate">{file.name}</span>
                <Button type="button" variant="ghost" size="sm" aria-label={file.name + ' 첨부 취소'} disabled={busy}
                  onClick={() => updateDraft({ files: draft.files.filter((_, i) => i !== index) })}><X className="size-3.5" /></Button>
              </li>)}
            </ul>}
            {draft.error && <p role="alert" className="text-sm text-danger">{draft.error}</p>}
          </form>
        )}
      </div>
    </section>
  )
}
