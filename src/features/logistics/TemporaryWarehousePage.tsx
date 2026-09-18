import { useBrand } from '@/components/layout/brand-context'
import { SingleBrandOrList } from '@/components/layout/SingleBrandOrList'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CompanyWarehouseList } from '@/features/workspace/company-operation-lists'
import { useRenderWatch } from '@/lib/diagnostics'
import { TemporaryWarehousePanel } from './TemporaryWarehousePanel'

export function TemporaryWarehousePage() {
  useRenderWatch('TemporaryWarehousePage')
  const { brand } = useBrand()

  return (
    <div>
      <PageHeader
        title="임시 창고관리"
        description="박스창고에는 밀봉 박스만 두고, 출고창고로 이동한 뒤 개봉·수량 차감을 시험합니다."
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>리모델링 후 창고 입력 테스트</CardTitle>
          <CardDescription className="mt-1">
            박스창고·출고창고 자리 리스트는 창고관리 자리 설정과 같은 DB를
            읽습니다. 제품 입력은 개별 박스 원장에 저장되며 기존 묶음 재고는
            건드리지 않습니다. 개봉은 택배 포장 또는 대량 출고 자리에서만
            가능합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemporaryWarehousePanel brandId={brand.id} />
        </CardContent>
      </Card>
    </div>
  )
}

export function CompanyTemporaryWarehousePage() {
  return (
    <SingleBrandOrList list={<CompanyWarehouseList />}>
      <TemporaryWarehousePage />
    </SingleBrandOrList>
  )
}
