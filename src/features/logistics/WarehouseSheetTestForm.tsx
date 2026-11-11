import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const fields = [
  { name: 'styleNo', label: '상품번호' },
  { name: 'productName', label: '상품명' },
  { name: 'location', label: '자리번호' },
  { name: 'receivedOn', label: '입고일', type: 'date' },
  { name: 'unitsPerBox', label: '박스당 수량', type: 'number', min: 1 },
  { name: 'boxes', label: '남은 박스 수', type: 'number', min: 0 },
  { name: 'note', label: '메모' },
  { name: 'boxQr', label: '박스 QR 고유번호' },
]

export function WarehouseSheetTestForm() {
  const url = import.meta.env.VITE_WAREHOUSE_SHEET_TEST_URL
  const connected = typeof url === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/dev$/.test(url)

  return (
    <details className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold">시트 입력 테스트</summary>
      <p className="mt-2 text-sm text-muted-foreground">
        {connected
          ? '도서관 관리 시트에 한 건을 보냅니다. 새 탭에서 저장을 누르면 행 번호가 표시됩니다.'
          : 'Google 테스트 연결이 설정되면 이 폼에서 시트로 보낼 수 있습니다.'}
      </p>
      <form action={connected ? url : undefined} method="post" target="_blank" rel="noopener" className="mt-4 space-y-4"
        onSubmit={event => { if (!connected) event.preventDefault() }}>
        <input type="hidden" name="atelierAction" value="warehouse-test-row" />
        <fieldset disabled={!connected} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map(({ name, label, type, min }) => (
            <label key={name} className="space-y-1 text-sm">
              <span>{label}</span>
              <Input name={name} type={type ?? 'text'} min={min} maxLength={500} required={name !== 'note'} />
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={!connected}>구글 시트에 한 건 보내기</Button>
      </form>
    </details>
  )
}
