import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  BrandFormDialog,
  type BrandFormValues,
} from '@/features/brands/BrandFormDialog'
import { BrandStoreError, deleteBrand, updateBrand } from '@/lib/api'

export function BrandSettingsPage() {
  const { brand } = useBrand()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const invalidateBrands = async () => {
    await queryClient.invalidateQueries({ queryKey: ['brands'] })
    await queryClient.invalidateQueries({ queryKey: ['brand'] })
  }

  const saveMutation = useMutation({
    mutationFn: (values: BrandFormValues) => updateBrand(brand.id, values),
    onSuccess: async (updated) => {
      setFormError(null)
      setDialogOpen(false)
      await invalidateBrands()
      if (updated.slug !== brand.slug) {
        navigate(`/b/${updated.slug}/settings/brand`, { replace: true })
      }
    },
    onError: (err) => {
      if (err instanceof BrandStoreError) {
        setFormError(err.message)
        return
      }
      setFormError(
        err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteBrand(brand.id),
    onSuccess: async () => {
      await invalidateBrands()
      navigate('/', { replace: true })
    },
  })

  function handleDelete() {
    const ok = window.confirm(
      `"${brand.name}" 브랜드를 삭제할까요?\n삭제 후 복구할 수 없습니다.`,
    )
    if (!ok) return
    deleteMutation.mutate()
  }

  return (
    <div>
      <PageHeader
        title="브랜드 정보"
        description="작업장에 표시되는 브랜드 프로필을 관리합니다."
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFormError(null)
                setDialogOpen(true)
              }}
            >
              <Pencil className="size-3.5" />
              수정
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              <Trash2 className="size-3.5" />
              삭제
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-start gap-4">
          <BrandAvatar brand={brand} className="size-16" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{brand.name}</CardTitle>
              <Badge variant="muted">{brand.foundedYear}</Badge>
            </div>
            <CardDescription className="mt-1">
              {brand.nameKo} · {brand.description}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <InfoRow label="URL slug" value={brand.slug} />
          <InfoRow label="대표 색상" value={brand.color} />
          <InfoRow label="등록 스타일" value={`${brand.styleCount} SKU`} />
          <div className="flex items-center gap-3">
            <dt className="w-24 shrink-0 text-muted-foreground">색상 미리보기</dt>
            <dd
              className="size-6 rounded-md border border-border"
              style={{ backgroundColor: brand.color }}
              aria-label={brand.color}
            />
          </div>
        </CardContent>
      </Card>

      <BrandFormDialog
        open={dialogOpen}
        mode="edit"
        brand={brand}
        isSubmitting={saveMutation.isPending}
        errorMessage={formError}
        onClose={() => {
          if (saveMutation.isPending) return
          setDialogOpen(false)
          setFormError(null)
        }}
        onSubmit={async (values) => {
          setFormError(null)
          await saveMutation.mutateAsync(values)
        }}
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
