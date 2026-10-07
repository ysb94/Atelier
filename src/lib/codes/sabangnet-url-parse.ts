export function parseSabangnetUrlFile(file: File): Promise<{ rows: string[][]; elapsed: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sabangnet-url-parse.worker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('파일 읽기 시간이 초과되었습니다.')) }, 60000)
    function stop() { window.clearTimeout(timeout); worker.terminate() }
    worker.onmessage = (event: MessageEvent<{ ok: boolean; rows: string[][]; elapsed: number; message?: string }>) => {
      stop(); if (event.data.ok) resolve({ rows: event.data.rows, elapsed: event.data.elapsed }); else reject(new Error(event.data.message || '파일을 읽지 못했습니다.'))
    }
    worker.onerror = event => { stop(); reject(new Error(event.message || '파일 읽기 작업이 실패했습니다.')) }
    worker.postMessage(file)
  })
}
