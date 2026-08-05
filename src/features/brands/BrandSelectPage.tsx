import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  BrandStoreError,
  createBrand,
  deleteBrand,
  getBrands,
  updateBrand,
} from '@/lib/api'
import type { Brand } from '@/lib/types'
import {
  BrandFormDialog,
  type BrandFormValues,
} from '@/features/brands/BrandFormDialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BrandAvatar } from '@/components/brand/BrandAvatar'

export function BrandSelectPage() {
  const queryClient = useQueryClient()
  const {
    data: brands = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const invalidateBrands = async () => {
    await queryClient.invalidateQueries({ queryKey: ['brands'] })
    await queryClient.invalidateQueries({ queryKey: ['brand'] })
  }

  const saveMutation = useMutation({
    mutationFn: async (values: BrandFormValues) => {
      if (dialogMode === 'edit' && editingBrand) {
        return updateBrand(editingBrand.id, values)
      }
      return createBrand(values)
    },
    onSuccess: async () => {
      setFormError(null)
      setDialogOpen(false)
      setEditingBrand(null)
      await invalidateBrands()
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
    mutationFn: (id: string) => deleteBrand(id),
    onMutate: (id) => {
      setDeletingId(id)
    },
    onSuccess: async () => {
      await invalidateBrands()
    },
    onSettled: () => {
      setDeletingId(null)
    },
  })

  const openCreate = () => {
    setDialogMode('create')
    setEditingBrand(null)
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (brand: Brand) => {
    setDialogMode('edit')
    setEditingBrand(brand)
    setFormError(null)
    setDialogOpen(true)
  }

  const handleDelete = (brand: Brand) => {
    const ok = window.confirm(
      `"${brand.name}" 브랜드를 삭제할까요?\n삭제 후 복구할 수 없습니다.`,
    )
    if (!ok) return
    deleteMutation.mutate(brand.id)
  }

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
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
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="size-4" />
            새 브랜드
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중...</div>
        ) : isError ? (
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-6 text-sm text-danger">
            브랜드 목록을 불러오지 못했습니다.
            {error instanceof Error ? ` (${error.message})` : null}
          </div>
        ) : brands.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>등록된 브랜드가 없습니다</CardTitle>
              <CardDescription>
                새 브랜드를 만들어 작업장을 시작해 보세요.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                첫 브랜드 만들기
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {brands.map((brand) => (
              <Card
                key={brand.id}
                className="group relative h-full transition-all hover:border-foreground/20 hover:shadow-md"
              >
                <div className="absolute right-3 top-3 z-10 flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="bg-card/90 shadow-sm"
                    aria-label={`${brand.name} 수정`}
                    onClick={() => openEdit(brand)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="bg-card/90 text-danger shadow-sm hover:bg-danger/10 hover:text-danger"
                    aria-label={`${brand.name} 삭제`}
                    disabled={deletingId === brand.id}
                    onClick={() => handleDelete(brand)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <Link to={`/b/${brand.slug}`} className="block">
                  <CardHeader className="flex flex-row items-start gap-4 pr-20">
                    <BrandAvatar brand={brand} className="size-12" />
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
                  <CardContent>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">등록 스타일</span>
                      <span className="font-medium">{brand.styleCount} SKU</span>
                    </div>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>

      <BrandFormDialog
        open={dialogOpen}
        mode={dialogMode}
        brand={editingBrand}
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
