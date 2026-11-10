import { useCallback, useEffect, useRef, useState } from 'react'
import { issueBoxLabels, listBoxLabelBatches, loadBoxLabelCodes, findBoxLabelCode, type BoxLabelBatch } from '@/lib/api/warehouse-box-labels'

function message(cause: unknown) {
  const error = cause as { message?: string; code?: string }
  if (['23505', '22023', '42501'].includes(error?.code ?? '') || cause instanceof Error && /등록된 번호|발급 번호/.test(cause.message)) return error.message!
  return '서버에서 결과를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 발급 요청은 재시도해도 같은 번호로 처리됩니다.'
}

export function useBoxLabelRegistry(brandId: string, onLoad: (codes: string[]) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [history, setHistory] = useState<BoxLabelBatch[]>([])
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [savedKey, setSavedKey] = useState('')
  const lock = useRef(false)
  const mounted = useRef(true)
  const pending = useRef<{ signature: string; id: string } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true); setHistoryError('')
    void listBoxLabelBatches(brandId, page).then(rows => { if (!cancelled) setHistory(rows) })
      .catch(cause => { if (!cancelled) { setHistory([]); setHistoryError('발급 내역을 불러오지 못했습니다. 새로고침해 주세요.') }; console.warn('[warehouse-qr] 발급 내역 조회 실패', { code: cause?.code }) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [brandId, page, revision])

  async function run(work: () => Promise<string[]>, success: string) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice(''); setSavedKey('')
    try {
      const codes = await work()
      if (!mounted.current) return
      onLoad(codes); setSavedKey(JSON.stringify(codes)); setNotice(success)
    } catch (cause) {
      console.warn('[warehouse-qr] 발급 기록 처리 실패', { code: (cause as { code?: string })?.code })
      if (mounted.current) setError(message(cause))
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }

  function issue(count: number, codes?: string[]) {
    return run(async () => {
      const signature = JSON.stringify([brandId, count, codes ?? null])
      if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() }
      const result = await issueBoxLabels(brandId, pending.current.id, count, codes)
      pending.current = null
      if (mounted.current) { setPage(0); refresh() }
      return result.codes
    }, codes ? '기존 번호를 공용 기록에 등록했습니다. 이제 재출력할 수 있습니다.' : '새 번호 발급과 공용 저장을 완료했습니다. 인쇄하거나 나중에 내역에서 다시 불러오세요.')
  }
  function load(batchId: string) { return run(() => loadBoxLabelCodes(brandId, batchId), '기존 번호를 불러왔습니다. 재출력해도 새 번호가 발급되지 않습니다.') }
  function find(code: string) { return run(async () => [await findBoxLabelCode(brandId, code.trim())], '등록된 번호를 불러왔습니다. 재출력할 수 있습니다.') }
  return { busy, error, notice, page, setPage, history, historyError, historyLoading, savedKey, issue, load, find, refresh }
}
