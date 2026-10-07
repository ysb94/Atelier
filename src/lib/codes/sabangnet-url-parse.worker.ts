/// <reference lib="webworker" />
self.onmessage = async (event: MessageEvent<File>) => {
  const start = performance.now()
  try {
    const { parseFile } = await import('@/lib/import/parse')
    const sheets = await parseFile(event.data)
    if (!sheets[0]) throw new Error('파일에 시트가 없습니다.')
    self.postMessage({ ok: true, rows: sheets[0].rows, elapsed: Math.round(performance.now() - start) })
  } catch (error) {
    console.warn('[sabangnet] URL 엑셀 파싱 실패', { fileName: event.data.name, error })
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' })
  }
}
