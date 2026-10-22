import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, LogOut, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { isBrandLead, useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { hasPermission } from '@/lib/company/permissions'
import { canAccessBrandManagement } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'

export function BrandSelectPage() {
  useRenderWatch('BrandSelectPage')
  const { profile } = useAuth()
  if (!canAccessBrandManagement(profile)) {
    return (
      <div>
        <Link
          to="/"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          E&J 홈
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>브랜드 관리</CardTitle>
            <CardDescription>
              브랜드 관리 권한이 지정된 담당자만 볼 수 있습니다.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }
  return <BrandSelectPageContent />
}

function BrandSelectPageContent() {
  const queryClient = useQueryClient()
  const { email, profile, signOut } = useAuth()
  const preview = usePagePreview()
  const actualProfile = preview ? preview.realProfile : profile
  const canEditBrand = (id: string) => Boolean(preview?.facts?.brandLead) || isBrandLead(profile, id)
  const isAdmin = hasPermission(profile, 'brand.manage')
  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })
  const brands = data ?? emptyList<Brand>()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const selectedBrand =
    selectedBrandId == null
      ? null
      : (brands.find((brand) => brand.id === selectedBrandId) ?? null)

  const invalidateBrands = async () => {
    await queryClient.invalidateQueries({ queryKey: ['brands'] })
    await queryClient.invalidateQueries({ queryKey: ['brand'] })
  }

  const saveMutation = useMutation({
    mutationFn: async (values: BrandFormValues) => {
      if (dialogMode === 'edit' && editingBrand) {
        if (!isBrandLead(actualProfile, editingBrand.id)) throw new Error('로그인 계정에 이 브랜드를 수정할 권한이 없습니다.')
        return updateBrand(editingBrand.id, values)
      }
      if (!hasPermission(actualProfile, 'brand.manage')) throw new Error('로그인 계정에 브랜드를 생성할 권한이 없습니다.')
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
    mutationFn: (id: string) => {
      if (!hasPermission(actualProfile, 'brand.manage')) throw new Error('로그인 계정에 브랜드를 삭제할 권한이 없습니다.')
      return deleteBrand(id)
    },
    onMutate: (id) => {
      setDeletingId(id)
      setDeleteError(null)
    },
    onSuccess: async (_data, id) => {
      setSelectedBrandId((openId) => (openId === id ? null : openId))
      await invalidateBrands()
    },
    onError: (err) => {
      setDeleteError(
        err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.',
      )
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
    <div>
      <div>
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              to="/"
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              E&J 홈
            </Link>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Atelier
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              브랜드 관리
            </h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              브랜드 정보와 로고를 관리합니다. 업무 화면은 E&J 회사 셸에서
              전 브랜드를 함께 봅니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/products"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              통합 상품 보기
            </Link>
            {profile?.displayName || email ? (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {profile?.displayName || email}
                {profile?.position ? ` · ${profile.position}` : ''}
              </span>
            ) : null}
            <Button variant="outline" onClick={() => void signOut()}>
              <LogOut className="size-4" />
              로그아웃
            </Button>
            {isAdmin ? (
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                새 브랜드
              </Button>
            ) : null}
          </div>
        </div>

        {deleteError ? (
          <div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            {deleteError}
          </div>
        ) : null}

        {selectedBrand ? (
          <BrandInfoCard
            brand={selectedBrand}
            canEdit={canEditBrand(selectedBrand.id)}
            isAdmin={isAdmin}
            deleting={deletingId === selectedBrand.id}
            onEdit={() => openEdit(selectedBrand)}
            onDelete={() => handleDelete(selectedBrand)}
          />
        ) : null}

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
              <CardTitle>볼 수 있는 브랜드가 없습니다</CardTitle>
              <CardDescription>
                {isAdmin
                  ? '새 브랜드를 만들어 회사 목록에 보이게 하세요.'
                  : '등록된 브랜드가 없습니다. 관리자에게 문의해 주세요.'}
              </CardDescription>
            </CardHeader>
            {isAdmin ? (
              <CardContent>
                <Button onClick={openCreate}>
                  <Plus className="size-4" />
                  첫 브랜드 만들기
                </Button>
              </CardContent>
            ) : null}
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {brands.map((brand) => {
              const canEdit = canEditBrand(brand.id)
              const selected = selectedBrandId === brand.id
              return (
                <Card
                  key={brand.id}
                  className={`group relative h-full transition-all hover:border-foreground/20 hover:shadow-md${
                    selected ? ' border-foreground/30 shadow-md' : ''
                  }`}
                >
                  {canEdit || isAdmin ? (
                    <div className="absolute right-3 top-3 z-10 flex gap-1">
                      {canEdit ? (
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
                      ) : null}
                      {isAdmin ? (
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
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="block w-full text-left"
                    aria-expanded={selected}
                    aria-controls="selected-brand-info"
                    onClick={() => setSelectedBrandId(brand.id)}
                  >
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
                  </button>
                </Card>
              )
            })}
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

function BrandInfoCard({
  brand,
  canEdit,
  isAdmin,
  deleting,
  onEdit,
  onDelete,
}: {
  brand: Brand
  canEdit: boolean
  isAdmin: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card id="selected-brand-info" className="mb-6">
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
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            to={`/products?brands=${encodeURIComponent(brand.slug)}`}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            상품 목록
          </Link>
          {canEdit ? (
            <Button type="button" variant="outline" onClick={onEdit}>
              <Pencil className="size-3.5" />
              수정
            </Button>
          ) : null}
          {isAdmin ? (
            <Button
              type="button"
              variant="outline"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              disabled={deleting}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              삭제
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
