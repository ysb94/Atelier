import { chatFileBlockReason } from '@/lib/chat/file-rules'
import { prepareChatImage } from '@/lib/chat/image'
import { timeChatWork } from '@/lib/chat/chat-work-perf'
import { uploadChatObject } from '@/lib/chat/upload'
import {
  beginChatAttachment,
  cancelChatAttachment,
  completeChatAttachment,
  removeChatObjects,
} from '@/lib/supabase/chat'

export async function sendChatFile(input: {
  roomId: string
  file: File
  onProgress?: (ratio: number) => void
}): Promise<void> {
  const reason = chatFileBlockReason(input.file)
  if (reason) throw new Error(reason)

  const prepared = await prepareChatImage(input.file)
  const convertedReason = chatFileBlockReason(prepared.file)
  if (convertedReason) throw new Error(convertedReason)
  const begun = await beginChatAttachment({
    roomId: input.roomId,
    fileName: prepared.file.name,
    mimeType: prepared.file.type || 'application/octet-stream',
    sizeBytes: prepared.file.size,
  })

  const thumbWeight = prepared.thumb ? 0.15 : 0
  try {
    await timeChatWork('upload-file', () =>
      uploadChatObject({
        path: begun.objectPath,
        file: prepared.file,
        contentType: prepared.file.type || 'application/octet-stream',
        onProgress: (ratio) => input.onProgress?.(ratio * (1 - thumbWeight)),
      }),
    )
    if (prepared.thumb && begun.thumbPath) {
      await timeChatWork('upload-thumb', () =>
        uploadChatObject({
          path: begun.thumbPath!,
          file: prepared.thumb!,
          contentType: 'image/jpeg',
          onProgress: (ratio) =>
            input.onProgress?.(1 - thumbWeight + ratio * thumbWeight),
        }),
      )
    }
    await completeChatAttachment(begun.attachmentId, Boolean(prepared.thumb))
    input.onProgress?.(1)
  } catch (error) {
    console.warn('[chat] 파일 전송 실패', {
      roomId: input.roomId,
      name: prepared.file.name,
      message: error instanceof Error ? error.message : String(error),
    })
    await cancelChatAttachment(begun.attachmentId).catch((cancelError: unknown) => {
      console.warn('[chat] 파일 올리기 취소 실패', {
        attachmentId: begun.attachmentId,
        message:
          cancelError instanceof Error ? cancelError.message : String(cancelError),
      })
    })
    await removeChatObjects(
      [begun.objectPath, begun.thumbPath].filter((path): path is string => Boolean(path)),
    ).catch((removeError: unknown) => {
      console.warn('[chat] 올라가다 만 파일 삭제 실패', {
        attachmentId: begun.attachmentId,
        message:
          removeError instanceof Error ? removeError.message : String(removeError),
      })
    })
    throw error instanceof Error ? error : new Error('파일을 보내지 못했습니다.')
  }
}
