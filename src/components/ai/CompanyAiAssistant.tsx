import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Bot, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  COMPANY_ASSISTANT_LIMITS,
  findCompanyAssistantSensitiveMatch,
  prepareCompanyAssistantInput,
} from '@/lib/ai/gateway-core'
import { ATELIER_BRAND_ID } from '@/lib/company/capabilities'
import {
  AiGatewayError,
  askCompanyAssistant,
  getCompanyAssistantUsageToday,
} from '@/lib/api'
import { useAuth } from '@/lib/supabase/auth'
import { cn } from '@/lib/utils'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  pending?: boolean
  error?: boolean
  usage?: {
    inputTokens: number | null
    outputTokens: number | null
  }
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  body: '앱 사용법이나 업무 문장 정리를 물어보세요. 회사 데이터는 조회하지 않으며, 새로고침하면 대화가 사라집니다.',
}

function newMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function lastHistoryTurn(messages: ChatMessage[]) {
  const lastUser = [...messages].reverse().find((item) => item.role === 'user')
  if (!lastUser) return []
  const afterUser = messages.slice(messages.indexOf(lastUser) + 1)
  const lastAssistant = afterUser.find(
    (item) => item.role === 'assistant' && !item.pending && !item.error,
  )
  return [
    { role: 'user' as const, body: lastUser.body },
    ...(lastAssistant
      ? [{ role: 'assistant' as const, body: lastAssistant.body }]
      : []),
  ]
}

function tokenLabel(usage?: ChatMessage['usage']) {
  if (!usage) return null
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  if (input <= 0 && output <= 0) return null
  return `토큰 ${input}+${output}`
}

export function CompanyAiAssistant() {
  const dialogId = useId()
  const titleId = useId()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [usedToday, setUsedToday] = useState(0)
  const [dailyLimit, setDailyLimit] = useState<number>(
    COMPANY_ASSISTANT_LIMITS.dailyCallsPerUser,
  )
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  const sendingRef = useRef(false)

  const remaining = Math.max(0, dailyLimit - usedToday)
  const trimmed = draft.trim()
  const overLimit = trimmed.length > COMPANY_ASSISTANT_LIMITS.maxQuestionChars
  const sensitive = findCompanyAssistantSensitiveMatch(trimmed)
  const canSend =
    Boolean(trimmed) &&
    !overLimit &&
    !sensitive &&
    !sending &&
    remaining > 0

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    sendingRef.current = sending
  }, [sending])

  useEffect(() => {
    const list = listRef.current
    if (!list || !open) return
    list.scrollTop = list.scrollHeight
  }, [messages, open])

  useEffect(() => {
    if (!open) return
    const timer = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(timer)
  }, [open])

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || !openRef.current) return
      event.preventDefault()
      closePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open || !profile?.id) return
    let cancelled = false
    void getCompanyAssistantUsageToday(ATELIER_BRAND_ID, profile.id)
      .then((result) => {
        if (cancelled) return
        setUsedToday(result.usedToday)
        setDailyLimit(result.dailyLimit)
      })
      .catch(() => {
        // 사용 횟수는 답변 후에도 갱신되므로 최초 조회 실패는 화면을 막지 않는다.
      })
    return () => {
      cancelled = true
    }
  }, [open, profile?.id])

  function openPanel() {
    setOpen(true)
  }

  function closePanel() {
    setOpen(false)
    window.requestAnimationFrame(() => {
      buttonRef.current?.focus()
    })
  }

  async function sendQuestion() {
    if (sendingRef.current) return
    const text = draft.trim()
    if (!text) return
    if (overLimit) {
      setError(`질문은 ${COMPANY_ASSISTANT_LIMITS.maxQuestionChars}자까지입니다.`)
      return
    }
    if (sensitive) {
      setError(
        `개인정보·비밀정보(${sensitive})가 있어 보낼 수 없습니다. 해당 내용을 지운 뒤 다시 물어보세요.`,
      )
      return
    }
    if (remaining <= 0) {
      setError(`오늘 질문 한도 ${dailyLimit}회를 넘었습니다. 내일 다시 물어보세요.`)
      return
    }

    let prepared
    try {
      prepared = prepareCompanyAssistantInput({
        question: text,
        history: lastHistoryTurn(messages),
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '질문을 보낼 수 없습니다.')
      return
    }

    const userId = newMessageId()
    const pendingId = newMessageId()
    sendingRef.current = true
    setSending(true)
    setError('')
    setDraft('')
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', body: prepared.question },
      { id: pendingId, role: 'assistant', body: '답하는 중...', pending: true },
    ])

    try {
      const result = await askCompanyAssistant({
        brandId: ATELIER_BRAND_ID,
        question: prepared.question,
        history: prepared.history,
      })
      setUsedToday(result.usedToday)
      setDailyLimit(result.dailyLimit)
      setMessages((prev) =>
        prev.map((item) =>
          item.id === pendingId
            ? {
                id: pendingId,
                role: 'assistant',
                body: result.reply,
                usage: result.usage,
              }
            : item,
        ),
      )
    } catch (caught) {
      const message =
        caught instanceof AiGatewayError
          ? caught.actionMessage
          : caught instanceof Error
            ? caught.message
            : '답을 받지 못했습니다.'
      setError(message)
      setMessages((prev) =>
        prev.map((item) =>
          item.id === pendingId
            ? {
                id: pendingId,
                role: 'assistant',
                body: message,
                error: true,
              }
            : item,
        ),
      )
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendQuestion()
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-40 flex flex-col items-end gap-3 sm:inset-x-auto sm:right-5">
      {open ? (
        <section
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="pointer-events-auto flex h-[min(32rem,70vh)] w-full max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:w-96"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-3 py-2.5">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-sm font-medium">
                Atelier
              </h2>
              <p className="text-[11px] text-muted-foreground">
                앱 사용법 · 문장 정리 · 오늘 {usedToday}/{dailyLimit}회
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="닫기"
              onClick={closePanel}
            >
              <X className="size-3.5" />
            </Button>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                    message.role === 'user'
                      ? 'rounded-br-sm bg-primary text-primary-foreground'
                      : message.error
                        ? 'rounded-bl-sm bg-muted text-danger'
                        : 'rounded-bl-sm bg-muted',
                    message.pending && 'text-muted-foreground',
                  )}
                >
                  <p>{message.body}</p>
                  {tokenLabel(message.usage) ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {tokenLabel(message.usage)}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border p-3">
            <Textarea
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder="회사에 대해 물어보세요."
              aria-label="질문 입력"
              disabled={sending}
              onChange={(event) => {
                setDraft(event.target.value)
                if (error) setError('')
              }}
              onKeyDown={handleKeyDown}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p
                className={cn(
                  'text-[11px] text-muted-foreground',
                  (overLimit || sensitive) && 'text-danger',
                )}
              >
                {sensitive
                  ? `개인정보·비밀정보(${sensitive})는 보내지 않습니다.`
                  : overLimit
                    ? `${trimmed.length}/${COMPANY_ASSISTANT_LIMITS.maxQuestionChars}자`
                    : remaining <= 0
                      ? `오늘 한도 ${dailyLimit}회를 넘었습니다.`
                      : `${trimmed.length}/${COMPANY_ASSISTANT_LIMITS.maxQuestionChars}자`}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={!canSend}
                onClick={() => void sendQuestion()}
              >
                <Send className="size-3.5" />
                {sending ? '보내는 중' : '보내기'}
              </Button>
            </div>
            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          </div>
        </section>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        aria-label={open ? 'Atelier 닫기' : 'Atelier 열기'}
        title="Atelier"
        onClick={() => (open ? closePanel() : openPanel())}
        className="pointer-events-auto inline-flex size-14 items-center justify-center rounded-full bg-[linear-gradient(180deg,#c4b5fd_0%,#7c3aed_100%)] text-white shadow-lg transition-opacity hover:opacity-95"
      >
        <span className="relative inline-flex size-6 items-center justify-center">
          <Bot className="size-6" />
          <Sparkles className="absolute -top-1.5 -right-1.5 size-3" />
        </span>
      </button>
    </div>
  )
}
