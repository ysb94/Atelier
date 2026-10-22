import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { FieldManager } from '@/features/upload/FieldManager'
import { getBrandFields } from '@/lib/api'

export function FieldsSettingsPage() {
  const { brand } = useBrand()

  const fieldsQuery = useQuery({
    queryKey: ['brandFields', brand.id],
    queryFn: () => getBrandFields(brand.id),
  })

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data])

  return (
    <div>
      <PageHeader
        title="업로드 항목"
        description={`${brand.name} 업로드 양식에 포함할 항목을 관리합니다.`}
      />

      {fieldsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">항목을 불러오는 중...</div>
      ) : (
        <FieldManager
          brandId={brand.id}
          brandName={brand.name}
          fields={fields}
        />
      )}
    </div>
  )
}
