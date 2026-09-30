import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { formatChatBytes } from '@/lib/chat/file-rules'
import { formatInboxTime } from '@/lib/inbox/format'
import type { ChatAttachment, ChatDownloadRecord } from '@/lib/inbox/types'
import {
  createChatThumbUrl,
  downloadChatAttachment,
  listChatAttachmentDownloads,
  purgeChatAttachment,
  restoreChatAttachment,
  trashChatAttachment,
} from '@/lib/supabase/chat'

function isGone(status: ChatAttachment['status']) {
  return status === 'trashed' || status === 'purged' || status === 'cancelled'
}

export function ChatAttachmentCard({
  attachment,
  fileName,
  canModerate,
  onChanged,
}: {
  attachment?: ChatAttachment | null
  fileName?: string
  canModerate?: boolean
  onChanged?: () => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const [downloads, setDownloads] = useState<ChatDownloadRecord[] | null>(null)
  const name = attachment?.fileName || fileName || '파일'
  const gone = attachment ? isGone(attachment.status) : false
  const thumbPath = attachment?.status === 'ready' ? attachment.thumbPath : null
  const attachmentId = attachment?.id

  useEffect(() => {
    if (!thumbPath || !attachmentId) return
    let cancelled = false
    void createChatThumbUrl(thumbPath)
      .then((url) => {
        if (!cancelled) setThumbUrl(url)
      })
      .catch((caught: unknown) => {
        console.warn('[chat] 썸네일 주소를 만들지 못했습니다', {
          attachmentId,
          message: caught instanceof Error ? caught.message : String(caught),
        })
      })
    return () => {
      cancelled = true
    }
  }, [attachmentId, thumbPath])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '파일을 처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    if (!attachment || attachment.status !== 'ready') return
    await run(() => downloadChatAttachment(attachment))
  }

  async function openPurge() {
    if (!attachment) return
    setPurgeOpen(true)
    setDownloads(null)
    setError(null)
    try {
      setDownloads(await listChatAttachmentDownloads(attachment.id))
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '받은 사람 목록을 불러오지 못했습니다.',
      )
    }
  }

  if (!attachment) {
    return <p className="break-all text-sm">{name}</p>
  }
  if (attachment.status === 'purged' || attachment.status === 'cancelled') {
    return <p className="text-sm italic opacity-80">삭제된 파일</p>
  }
  if (gone) {
    return (
      <div className="mt-1">
        <p className="text-sm italic opacity-80">삭제된 파일</p>
        {canModerate ? (
          <span className="mt-1 flex flex-wrap gap-2 text-[11px]">
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => void run(() => restoreChatAttachment(attachment.id))}
            >
              되돌리기
            </button>
            <button type="button" className="underline" disabled={busy} onClick={() => void openPurge()}>
              고객 정보 포함 삭제
            </button>
          </span>
        ) : null}
        {purgeOpen ? (
          <PurgeConfirm
            downloads={downloads}
            busy={busy}
            onCancel={() => setPurgeOpen(false)}
            onConfirm={() =>
              void run(async () => {
                await purgeChatAttachment(attachment)
                setPurgeOpen(false)
              })
            }
          />
        ) : null}
        {error ? <p className="mt-1 text-[11px]">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="mt-1 min-w-44">
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          className="mb-1 max-h-40 w-full rounded-lg object-cover"
        />
      ) : null}
      <p className="break-all text-sm font-medium">{name}</p>
      <p className="text-[11px] opacity-80">
        {formatChatBytes(attachment.sizeBytes)}
        {attachment.hasMacro ? ' · 매크로 포함' : ''}
      </p>
      <span className="mt-1 flex flex-wrap gap-2 text-[11px]">
        <button
          type="button"
          className="inline-flex items-center gap-1 underline disabled:opacity-60"
          disabled={busy}
          onClick={() => void download()}
        >
          <Download className="size-3" />
          {busy ? '처리 중' : '받기'}
        </button>
        {canModerate ? (
          confirmTrash ? (
            <>
              <button
                type="button"
                className="underline"
                disabled={busy}
                onClick={() => void run(() => trashChatAttachment(attachment.id))}
              >
                휴지통으로
              </button>
              <button type="button" className="underline" onClick={() => setConfirmTrash(false)}>
                취소
              </button>
            </>
          ) : (
            <button type="button" className="underline" disabled={busy} onClick={() => setConfirmTrash(true)}>
              삭제
            </button>
          )
        ) : null}
        {canModerate ? (
          <button type="button" className="underline" disabled={busy} onClick={() => void openPurge()}>
            고객 정보 포함 삭제
          </button>
        ) : null}
      </span>
      {purgeOpen ? (
        <PurgeConfirm
          downloads={downloads}
          busy={busy}
          onCancel={() => setPurgeOpen(false)}
          onConfirm={() =>
            void run(async () => {
              await purgeChatAttachment(attachment)
              setPurgeOpen(false)
            })
          }
        />
      ) : null}
      {error ? <p className="mt-1 text-[11px]">{error}</p> : null}
    </div>
  )
}

function PurgeConfirm({
  downloads,
  busy,
  onCancel,
  onConfirm,
}: {
  downloads: ChatDownloadRecord[] | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="mt-2 rounded-lg bg-black/10 p-2 text-[11px]">
      <p>바로 지웁니다. 되돌릴 수 없습니다.</p>
      {downloads === null ? (
        <p className="mt-1 opacity-80">받은 사람을 확인하는 중입니다.</p>
      ) : downloads.length === 0 ? (
        <p className="mt-1 opacity-80">받은 사람이 없습니다.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {downloads.map((row) => (
            <li key={`${row.profileId}-${row.downloadedAt}`}>
              {row.displayName} · {formatInboxTime(row.downloadedAt)}
            </li>
          ))}
        </ul>
      )}
      <span className="mt-2 flex gap-2">
        <button type="button" className="underline" disabled={busy || downloads === null} onClick={onConfirm}>
          영구 삭제
        </button>
        <button type="button" className="underline" onClick={onCancel}>
          취소
        </button>
      </span>
    </div>
  )
}
