/// <reference lib="webworker" />
import type { SabangnetInspection } from '@/lib/invoice/sabangnet'

export type ParseSabangnetWorkerRequest = {
  id: number
  file: File
}

export type ParseSabangnetWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; ok: true; inspection: SabangnetInspection }
  | { type: 'result'; id: number; ok: false; message: string }

/**
 * 파서·엑셀 라이브러리는 메시지를 받은 뒤 동적으로 불러온다.
 * 정적 import면 라이브러리 로딩이 끝나야 이 본문이 실행되므로, Worker가 살아 있는지
 * 알리는 `ready` 신호가 늦어져 메인 스레드의 시작 확인 시간이 길어진다.
 */
self.postMessage({ type: 'ready' } satisfies ParseSabangnetWorkerResponse)

self.onmessage = async (event: MessageEvent<ParseSabangnetWorkerRequest>) => {
  const { id, file } = event.data
  try {
    const [{ parseFile }, { inspectSabangnetSheets }] = await Promise.all([
      import('@/lib/import/parse'),
      import('@/lib/invoice/sabangnet'),
    ])
    const sheets = await parseFile(file)
    if (sheets.length === 0) {
      throw new Error('읽을 수 있는 시트가 없습니다.')
    }
    const inspection = inspectSabangnetSheets(sheets)
    self.postMessage({
      type: 'result',
      id,
      ok: true,
      inspection,
    } satisfies ParseSabangnetWorkerResponse)
  } catch (error) {
    self.postMessage({
      type: 'result',
      id,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : '파일을 읽지 못했습니다. 사방넷 원본 엑셀인지 확인해주세요.',
    } satisfies ParseSabangnetWorkerResponse)
  }
}
