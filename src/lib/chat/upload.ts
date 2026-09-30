import { Upload } from 'tus-js-client'
import { getSupabase } from '@/lib/supabase/client'
import { ChatStoreError } from '@/lib/supabase/chat'

const CHUNK_BYTES = 6 * 1024 * 1024

function uploadEndpoint() {
  const raw = import.meta.env.VITE_SUPABASE_URL
  if (!raw) throw new ChatStoreError('Supabase 환경변수가 없습니다.')
  const host = new URL(raw).hostname.split('.')[0]
  return `https://${host}.storage.supabase.co/storage/v1/upload/resumable`
}

/**
 * 이어 올리기. 조각은 6MB다.
 * 시도마다 저장 경로가 새로 생기므로 이전 업로드를 이어서 받지 않는다.
 * getSession은 저장소에 넘길 접속 토큰을 읽기 위해서만 쓴다.
 */
export async function uploadChatObject(input: {
  path: string
  file: Blob
  contentType: string
  onProgress?: (ratio: number) => void
}): Promise<void> {
  const supabase = getSupabase()
  const { data, error } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) {
    throw new ChatStoreError('로그인이 필요합니다.')
  }
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiKey) throw new ChatStoreError('Supabase 환경변수가 없습니다.')

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(input.file, {
      endpoint: uploadEndpoint(),
      chunkSize: CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: apiKey,
        'x-upsert': 'false',
      },
      metadata: {
        bucketName: 'company-chat',
        objectName: input.path,
        contentType: input.contentType || 'application/octet-stream',
        cacheControl: '3600',
      },
      onError: (uploadError) => reject(uploadError),
      onProgress: (sent, total) => {
        input.onProgress?.(total > 0 ? sent / total : 0)
      },
      onSuccess: () => resolve(),
    })
    upload.start()
  })
}
