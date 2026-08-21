import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ProductNameComboOrder } from '@/lib/invoice/product-name-transform'
import { formatNumber } from '@/lib/utils'

const SOLO_LABEL = {
  no_order_no: '주문번호 없음',
  no_confirmed_sibling: '본품 형제 없음',
} as const

export function InvoiceProductNameComboOrderTable({
  orders,
}: {
  orders: ProductNameComboOrder[]
}) {
  const [showPersonalInfo, setShowPersonalInfo] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          이 품목명에 걸린 {formatNumber(orders.length)}행입니다. 받는분 정보는
          이 화면에서만 보고, 서버에 올리지 않습니다.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowPersonalInfo((current) => !current)}
        >
          {showPersonalInfo ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
          {showPersonalInfo ? '주문자 정보 숨기기' : '주문자 정보 보기'}
        </Button>
      </div>
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">주문번호</th>
              <th className="px-2 py-1.5 font-medium">쇼핑몰</th>
              <th className="px-2 py-1.5 font-medium">주문일시</th>
              <th className="px-2 py-1.5 font-medium">품목명</th>
              <th className="px-2 py-1.5 font-medium">내품명</th>
              <th className="px-2 py-1.5 text-right font-medium">수량</th>
              <th className="px-2 py-1.5 font-medium">받는분</th>
              <th className="px-2 py-1.5 font-medium">전화</th>
              <th className="min-w-48 px-2 py-1.5 font-medium">주소</th>
              <th className="px-2 py-1.5 font-medium">단독</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((item) => {
              const hidden = !showPersonalInfo
              return (
                <tr
                  key={item.source.rowNumber}
                  className="border-t border-border align-top"
                >
                  <td className="px-2 py-1.5">
                    {item.source.customerOrderNo || '없음'}
                  </td>
                  <td className="px-2 py-1.5">{item.source.mallName}</td>
                  <td className="px-2 py-1.5">{item.source.orderedAt}</td>
                  <td className="max-w-48 truncate px-2 py-1.5">
                    {item.source.productName}
                  </td>
                  <td className="max-w-40 truncate px-2 py-1.5">
                    {item.source.itemName || '내품명 없음'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {item.source.quantity}
                  </td>
                  <td className="px-2 py-1.5">
                    {hidden ? (
                      <span className="text-muted-foreground">숨김</span>
                    ) : (
                      item.source.recipientName
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {hidden ? (
                      <span className="text-muted-foreground">숨김</span>
                    ) : (
                      item.source.recipientPhone
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {hidden ? (
                      <span className="text-muted-foreground">숨김</span>
                    ) : (
                      item.source.recipientAddress
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {item.soloReason ? (
                      <Badge variant="danger">{SOLO_LABEL[item.soloReason]}</Badge>
                    ) : (
                      <Badge variant="success">뺄 수 있음</Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
