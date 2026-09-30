import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  CHAT_FILE_MAX_COUNT,
  chatFileBlockReason,
} from '@/lib/chat/file-rules'
import { CHAT_MESSAGE_MAX_LENGTH } from '@/lib/supabase/chat'
import type { ChatReplyPreview } from '@/lib/inbox/types'

export type ChatUploadItem = {
  id: string
  name: string
  ratio: number
  error: string | null
}

export function ChatComposer({
  onSend,
  onFiles,
  uploads,
  disabled,
  replyTo,
  onCancelReply,
}: {
  onSend: (body: string) => void
  onFiles: (files: File[]) => void
  uploads: readonly ChatUploadItem[]
  disabled?: boolean
  replyTo: ChatReplyPreview | null
  onCancelReply: () => void
}) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const text = draft.trim()
  const tooLong = draft.length > CHAT_MESSAGE_MAX_LENGTH

  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(timer)
  }, [])

  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])

  function send() {
    if (!text || tooLong || disabled) return
    onSend(text)
    setDraft('')
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  function takeFiles(list: FileList | readonly File[] | null) {
    const files = list ? Array.from(list) : []
    if (files.length === 0) return
    const accepted: File[] = []
    const reasons: string[] = []
    for (const file of files) {
      if (accepted.length >= CHAT_FILE_MAX_COUNT) {
        reasons.push('한 번에 10개까지 올릴 수 있습니다.')
        break
      }
      const reason = chatFileBlockReason(file)
      if (reason) reasons.push(`${file.name || '파일'}: ${reason}`)
      else accepted.push(file)
    }
    setNotice(reasons.length > 0 ? reasons.join(' ') : null)
    if (accepted.length > 0) onFiles(accepted)
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    takeFiles(event.dataTransfer.files)
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    takeFiles(files)
  }

  return (
    <div
      className={`border-t border-border p-3 ${dragging ? 'bg-muted' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <p className="mb-2 text-[11px] text-muted-foreground">
        고객 정보가 든 파일은 올리지 마세요.
      </p>
      {notice ? <p className="mb-2 text-[11px] text-danger">{notice}</p> : null}
      {replyTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-primary bg-muted px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{replyTo.authorName}님에게 답장</p>
            <p className="truncate text-muted-foreground">
              {replyTo.deletedAt ? '삭제된 메시지' : replyTo.kind === 'file' ? `파일: ${replyTo.body}` : replyTo.body}
            </p>
          </div>
          <button type="button" aria-label="답장 취소" onClick={onCancelReply}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {uploads.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {uploads.map((item) => (
            <li key={item.id} className="text-[11px] text-muted-foreground">
              <span className="break-all">{item.name}</span>
              <span className="ml-2">
                {item.error
                  ? item.error
                  : item.ratio >= 1
                    ? '보냄'
                    : `${Math.round(item.ratio * 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="파일 선택"
        onChange={(event) => {
          takeFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <div className="mb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="파일 첨부"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip className="size-3.5" />
        </Button>
      </div>
      <div className="flex items-end gap-2 rounded-xl border border-border p-2">
        <Textarea
          ref={inputRef}
          rows={2}
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          placeholder="메시지를 입력하세요. (줄바꿈 Shift + Enter)"
          aria-label="메시지 입력"
          disabled={disabled}
          className="max-h-32 min-h-16 flex-1 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <Button
          type="button"
          size="sm"
          disabled={!text || tooLong || disabled}
          onClick={send}
        >
          전송
        </Button>
      </div>
      {tooLong ? (
        <p className="mt-2 text-[11px] text-danger">
          {`메시지는 ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString('ko-KR')}자까지입니다.`}
        </p>
      ) : null}
    </div>
  )
}
