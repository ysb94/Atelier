/// <reference lib="webworker" />
import { parseFile } from '@/lib/import/parse'
import { inspectSabangnetSheets } from '@/lib/invoice/sabangnet'

export type ParseSabangnetWorkerRequest = {
  id: number
  file: File
}

export type ParseSabangnetWorkerResponse =
  | { id: number; ok: true; inspection: ReturnType<typeof inspectSabangnetSheets> }
  | { id: number; ok: false; message: string }

self.onmessage = async (event: MessageEvent<ParseSabangnetWorkerRequest>) => {
  const { id, file } = event.data
  try {
    const sheets = await parseFile(file)
    if (sheets.length === 0) {
      throw new Error('읽을 수 있는 시트가 없습니다.')
    }
    const inspection = inspectSabangnetSheets(sheets)
    self.postMessage({ id, ok: true, inspection } satisfies ParseSabangnetWorkerResponse)
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : '파일을 읽지 못했습니다. 사방넷 원본 엑셀인지 확인해주세요.',
    } satisfies ParseSabangnetWorkerResponse)
  }
}
