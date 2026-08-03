import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { getBrands } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function BrandSelectPage() {
  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
        <div className="mb-10">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Atelier
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            브랜드를 선택하세요
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            브랜드별 작업장에서 기획, 디자인, MD, 물류를 관리합니다.
            선택하면 해당 브랜드 데이터만 보입니다.
          </p>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중...</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {brands.map((brand) => (
              <Link
                key={brand.id}
                to={`/b/${brand.slug}/products`}
                className="group"
              >
                <Card className="h-full transition-all hover:border-foreground/20 hover:shadow-md">
                  <CardHeader className="flex flex-row items-start gap-4">
                    <div
                      className="flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: brand.color }}
                    >
                      {brand.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle>{brand.name}</CardTitle>
                        <Badge variant="muted">{brand.seasonLabel}</Badge>
                      </div>
                      <CardDescription className="mt-1">
                        {brand.nameKo} · {brand.description}
                      </CardDescription>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">등록 스타일</span>
                      <span className="font-medium">{brand.styleCount} SKU</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
