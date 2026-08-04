import { Link } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function PartnerCodePage() {
  const { brand } = useBrand()

  return (
    <div>
      <PageHeader
        title="거래처 코드"
        description="거래처가 부여한 코드를 등록하고 구성을 연결합니다."
      />
      <Card>
        <CardContent className="space-y-4 p-10 text-center">
          <div>
            <h2 className="text-lg font-semibold">아직 준비 중입니다</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              자사 바코드와 구조는 같지만 거래처 선택, 거래처 전시명, 납품 단위가
              더 붙습니다. 자사 바코드 화면을 확정한 뒤 이어서 만듭니다.
            </p>
          </div>
          <Link to={`/b/${brand.slug}/barcodes`}>
            <Button type="button" variant="outline">
              자사 바코드로 이동
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
