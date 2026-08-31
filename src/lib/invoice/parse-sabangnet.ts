import { parseFile } from '@/lib/import/parse'
import { inspectSabangnetSheets, type SabangnetInspection } from '@/lib/invoice/sabangnet'
import { INVOICE_PARSE_WORKER_MIN_BYTES } from '@/lib/invoice/invoice-work-thresholds'
import type {
  ParseSabangnetWorkerRequest,
  ParseSabangnetWorkerResponse,
} from '@/lib/invoice/parse-sabangnet.worker'

const PARSE_TIMEOUT_MS = 120_000

let nextRequestId = 1

export async function parseSabangnetInvoiceFile(
  file: File,
): Promise<SabangnetInspection> {
  if (
    typeof Worker === 'undefined' ||
    file.size < INVOICE_PARSE_WORKER_MIN_BYTES
  ) {
    return parseSabangnetInvoiceFileOnMain(file)
  }
  try {
    return await parseSabangnetInvoiceFileInWorker(file)
  } catch {
    return parseSabangnetInvoiceFileOnMain(file)
  }
}

export async function parseSabangnetInvoiceFileOnMain(
  file: File,
): Promise<SabangnetInspection> {
  const sheets = await parseFile(file)
  if (sheets.length === 0) {
    throw new Error('읽을 수 있는 시트가 없습니다.')
  }
  return inspectSabangnetSheets(sheets)
}

function parseSabangnetInvoiceFileInWorker(
  file: File,
): Promise<SabangnetInspection> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId
    nextRequestId += 1
    const worker = new Worker(
      new URL('./parse-sabangnet.worker.ts', import.meta.url),
      { type: 'module' },
    )
    const timer = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('파일 확인이 너무 오래 걸립니다.'))
    }, PARSE_TIMEOUT_MS)
    const finish = () => {
      window.clearTimeout(timer)
      worker.terminate()
    }
    worker.onmessage = (event: MessageEvent<ParseSabangnetWorkerResponse>) => {
      if (event.data.id !== id) return
      finish()
      if (event.data.ok) resolve(event.data.inspection)
      else reject(new Error(event.data.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(
        event.error instanceof Error
          ? event.error
          : new Error(event.message || '파일을 읽지 못했습니다.'),
      )
    }
    const request: ParseSabangnetWorkerRequest = { id, file }
    worker.postMessage(request)
  })
}
