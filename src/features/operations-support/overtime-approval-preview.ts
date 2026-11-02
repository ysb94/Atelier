import type { RequestKind } from '../settings/personal-requests.ts'

/** 과거 야근은 외근 보정 여부를 확인하지 못하면 승인하지 않는다. */
export function overtimeApprovalReady(kind: RequestKind | undefined, date: string | undefined, today: string, previewReady: boolean): boolean {
  return kind !== 'overtime' || !date || date >= today || previewReady
}
