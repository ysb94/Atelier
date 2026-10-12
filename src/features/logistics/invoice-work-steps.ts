import { Upload, Settings2, Clock3, History } from 'lucide-react'
import type { StyleRef } from '@/lib/types'
import type { InvoiceStepComputeStatus } from './useInvoiceStepCompute'

// 송장 화면과 단계의 고정 정의. 검수·계산 조건은 작업 제어 훅에서 관리한다.
export type InvoiceView = 'today' | 'waiting' | 'rules' | 'history'

export const INVOICE_VIEWS: {
  value: InvoiceView
  label: string
  icon: typeof Upload
}[] = [
  { value: 'today', label: '오늘 작업', icon: Upload },
  { value: 'rules', label: '기준정보', icon: Settings2 },
  { value: 'waiting', label: '출고 대기', icon: Clock3 },
  { value: 'history', label: '작업 이력', icon: History },
]

export function isInvoiceView(value: string | null): value is InvoiceView {
  return INVOICE_VIEWS.some((item) => item.value === value)
}

export type TodayStep =
  | 'upload'
  | 'check'
  | 'gift'
  | 'instruction'
  | 'product'
  | 'item'
  | 'outboundReflect'
  | 'stock'
  | 'list'
  | 'output'

export const TODAY_STEPS: { value: TodayStep; label: string }[] = [
  { value: 'upload', label: '파일 올리기' },
  { value: 'check', label: '파일 확인' },
  { value: 'gift', label: '사은품 추가' },
  { value: 'instruction', label: '작업 지시' },
  { value: 'product', label: '품목명 변환' },
  { value: 'item', label: '내품명 변환' },
  { value: 'outboundReflect', label: '(임시) 출고반영' },
  { value: 'stock', label: '재고·예약' },
  { value: 'list', label: '상품 리스트' },
  { value: 'output', label: '최종 행' },
]

export const TODAY_STEP_INDEX: Record<TodayStep, number> = {
  upload: 0,
  check: 1,
  gift: 2,
  instruction: 3,
  product: 4,
  item: 5,
  outboundReflect: 6,
  stock: 7,
  list: 8,
  output: 9,
}

export type UploadAiProgress = {
  settled: boolean
  collecting: boolean
  done: number
  total: number
}

export const IDLE_UPLOAD_AI: UploadAiProgress = {
  settled: true,
  collecting: false,
  done: 0,
  total: 0,
}

export const PENDING_UPLOAD_AI: UploadAiProgress = {
  settled: false,
  collecting: false,
  done: 0,
  total: 0,
}

export function isStepComputeSettled(status: InvoiceStepComputeStatus) {
  return status === 'ready' || status === 'error'
}

export const EMPTY_STYLE_REFS: StyleRef[] = []
