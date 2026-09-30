import type { InboxNotification } from './types'

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

export const MOCK_NOTIFICATIONS: InboxNotification[] = [
  {
    id: 'n1',
    kind: 'barcode_request',
    title: '88코드 발급 요청',
    body: '김하늘 · M260931 블랙 M',
    href: '/barcodes',
    createdAt: ago(12),
    readAt: null,
  },
  {
    id: 'n2',
    kind: 'barcode_issued',
    title: '88코드 발급 완료',
    body: '8801234001284 · 봄 숄더백 블랙',
    href: '/barcodes',
    createdAt: ago(48),
    readAt: null,
  },
  {
    id: 'n3',
    kind: 'barcode_pending',
    title: 'M번호 미지정 바코드',
    body: '오늘 들어온 88코드 3건이 미지정입니다.',
    href: '/barcodes',
    createdAt: ago(90),
    readAt: null,
  },
  {
    id: 'n4',
    kind: 'outbound_changed',
    title: '바코드 출고 등록이 수정됨',
    body: '쿠팡 · 9/30 수량이 바뀌었습니다.',
    href: '/logistics/bulk-outbound',
    createdAt: ago(150),
    readAt: null,
  },
  {
    id: 'n5',
    kind: 'mention',
    title: '물류팀에서 언급',
    body: '이 바코드로 나간 건지 확인해 주세요.',
    href: '/barcodes',
    createdAt: ago(200),
    readAt: null,
  },
  {
    id: 'n6',
    kind: 'barcode_request',
    title: '88코드 발급 요청',
    body: '박서연 · M261002 아이보리 S',
    href: '/barcodes',
    createdAt: ago(260),
    readAt: null,
  },
  {
    id: 'n7',
    kind: 'outbound_changed',
    title: '바코드 출고 데이터입력',
    body: '스마트스토어 · 어제 등록이 추가됐습니다.',
    href: '/logistics/barcode-outbound-data-entry',
    createdAt: ago(60 * 26),
    readAt: ago(60 * 20),
  },
  {
    id: 'n8',
    kind: 'barcode_issued',
    title: '88코드 발급 완료',
    body: '8801234001215 · 미니 파우치 세트',
    href: '/barcodes',
    createdAt: ago(60 * 50),
    readAt: ago(60 * 48),
  },
]
