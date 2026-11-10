export const BOX_LABEL_HISTORY_PAGE_SIZE = 10
export type BoxLabelBatch = { id: string; created_at: string; source: 'generated' | 'imported'; label_count: number }
async function request<T>(body: object): Promise<T> {
  const response = await fetch('/__box-label-registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.message), { code: result.code })
  return result
}
export const issueBoxLabels = (brandId: string, requestId: string, count: number, codes?: string[]) => request<BoxLabelBatch & { codes: string[] }>({ action: 'issue', brandId, requestId, count, codes })
export const listBoxLabelBatches = (brandId: string, page: number) => request<BoxLabelBatch[]>({ action: 'list', brandId, page })
export const loadBoxLabelCodes = (brandId: string, batchId: string) => request<string[]>({ action: 'load', brandId, batchId })
export const findBoxLabelCode = (brandId: string, code: string) => request<string>({ action: 'find', brandId, code })
