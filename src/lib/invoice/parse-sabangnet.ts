import { parseFile } from '@/lib/import/parse'
import { inspectSabangnetSheets, type SabangnetInspection } from '@/lib/invoice/sabangnet'
import { INVOICE_PARSE_WORKER_MIN_BYTES } from '@/lib/invoice/invoice-work-thresholds'
import { logInvoiceWork } from '@/lib/invoice/invoice-work-perf'
import type {
  ParseSabangnetWorkerRequest,
  ParseSabangnetWorkerResponse,
} from '@/lib/invoice/parse-sabangnet.worker'

const PARSE_TIMEOUT_MS = 120_000
/**
 * Worker가 `ready`를 보내기까지 기다리는 최대 시간.
 * 일부 내장 브라우저(Electron webview 등)는 Worker를 만들어도 스크립트가 시작되지 않고
 * 오류 이벤트도 없이 멈춘다. 그 경우 120초 타임아웃까지 기다리면 20행 파일도 3만 행
 * 파일과 똑같이 2분이 걸리므로, 시작 신호가 없으면 바로 메인 스레드로 넘긴다.
 */
export const PARSE_WORKER_START_TIMEOUT_MS = 2_500

let nextRequestId = 1
/** 이 세션에서 Worker 시작이 한 번 실패하면 이후 업로드는 곧바로 메인 스레드로 읽는다. */
let parseWorkerUnavailable = false

export function isParseWorkerUnavailable() {
  return parseWorkerUnavailable
}

export async function parseSabangnetInvoiceFile(
  file: File,
): Promise<SabangnetInspection> {
  if (
    typeof Worker === 'undefined' ||
    parseWorkerUnavailable ||
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
    const startedAt = performance.now()
    const worker = new Worker(
      new URL('./parse-sabangnet.worker.ts', import.meta.url),
      { type: 'module' },
    )
    let settled = false
    let startTimer: number | null = null
    let totalTimer: number | null = null
    const settle = (apply: () => void) => {
      if (settled) return
      settled = true
      if (startTimer !== null) window.clearTimeout(startTimer)
      if (totalTimer !== null) window.clearTimeout(totalTimer)
      worker.terminate()
      apply()
    }
    startTimer = window.setTimeout(() => {
      parseWorkerUnavailable = true
      logInvoiceWork('parse-worker-unavailable', {
        waitedMs: Math.round(performance.now() - startedAt),
        fileBytes: file.size,
      })
      settle(() => reject(new Error('파일 확인 Worker가 시작되지 않았습니다.')))
    }, PARSE_WORKER_START_TIMEOUT_MS)
    totalTimer = window.setTimeout(() => {
      settle(() => reject(new Error('파일 확인이 너무 오래 걸립니다.')))
    }, PARSE_TIMEOUT_MS)
    worker.onmessage = (event: MessageEvent<ParseSabangnetWorkerResponse>) => {
      const data = event.data
      if (data.type === 'ready') {
        if (startTimer !== null) {
          window.clearTimeout(startTimer)
          startTimer = null
        }
        return
      }
      if (data.id !== id) return
      settle(() => {
        if (data.ok) resolve(data.inspection)
        else reject(new Error(data.message))
      })
    }
    worker.onerror = (event) => {
      settle(() =>
        reject(
          event.error instanceof Error
            ? event.error
            : new Error(event.message || '파일을 읽지 못했습니다.'),
        ),
      )
    }
    const request: ParseSabangnetWorkerRequest = { id, file }
    worker.postMessage(request)
  })
}
