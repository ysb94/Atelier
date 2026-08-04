import { useEffect, useRef, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ImagePlus, X } from 'lucide-react'
import type { Brand } from '@/lib/types'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'

const MAX_LOGO_BYTES = 500 * 1024

const brandFormSchema = z.object({
  name: z.string().trim().min(1, '영문 브랜드명을 입력하세요.'),
  nameKo: z.string().trim().min(1, '한글 브랜드명을 입력하세요.'),
  slug: z
    .string()
    .trim()
    .min(1, 'URL slug를 입력하세요.')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'slug는 소문자, 숫자, 하이픈만 사용할 수 있습니다.',
    ),
  description: z.string().trim().min(1, '설명을 입력하세요.'),
  color: z
    .string()
    .trim()
    .regex(/^#([0-9A-Fa-f]{6})$/, '색상은 #RRGGBB 형식이어야 합니다.'),
  foundedYear: z
    .number({ error: '설립 연도를 입력하세요.' })
    .int('설립 연도는 정수여야 합니다.')
    .min(1800, '설립 연도가 너무 이릅니다.')
    .max(new Date().getFullYear() + 1, '설립 연도가 미래입니다.'),
  logoUrl: z.string().nullable().optional(),
})

export type BrandFormValues = z.infer<typeof brandFormSchema>

const DEFAULT_VALUES: BrandFormValues = {
  name: '',
  nameKo: '',
  slug: '',
  description: '',
  color: '#2C3E50',
  foundedYear: new Date().getFullYear(),
  logoUrl: null,
}

type BrandFormDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  brand?: Brand | null
  isSubmitting?: boolean
  errorMessage?: string | null
  onClose: () => void
  onSubmit: (values: BrandFormValues) => void | Promise<void>
}

function toFormValues(brand?: Brand | null): BrandFormValues {
  if (!brand) return DEFAULT_VALUES
  return {
    name: brand.name,
    nameKo: brand.nameKo,
    slug: brand.slug,
    description: brand.description,
    color: brand.color,
    foundedYear: brand.foundedYear,
    logoUrl: brand.logoUrl ?? null,
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('이미지를 읽지 못했습니다.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('이미지 읽기 실패'))
    reader.readAsDataURL(file)
  })
}

export function BrandFormDialog({
  open,
  mode,
  brand,
  isSubmitting = false,
  errorMessage,
  onClose,
  onSubmit,
}: BrandFormDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<BrandFormValues>({
    resolver: zodResolver(brandFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const color = watch('color')
  const name = watch('name')
  const logoUrl = watch('logoUrl')

  useEffect(() => {
    if (!open) return
    reset(toFormValues(brand))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open, brand, reset])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={isSubmitting}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-form-title"
        className="relative z-10 max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <h2
              id="brand-form-title"
              className="text-base font-semibold tracking-tight"
            >
              {mode === 'create' ? '새 브랜드' : '브랜드 수정'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              메인 화면에 표시되는 브랜드 정보를 저장합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="닫기"
          >
            <X className="size-4" />
          </Button>
        </div>

        <form
          onSubmit={handleSubmit(async (values) => {
            await onSubmit(values)
          })}
          className="space-y-4 px-5 py-5"
        >
          <Field
            label="브랜드 로고"
            hint="없으면 영문명 앞 2글자가 표시됩니다. (최대 500KB)"
            error={errors.logoUrl?.message}
          >
            <div className="flex items-center gap-4">
              <BrandAvatar
                brand={{
                  name: name || 'BR',
                  color: /^#([0-9A-Fa-f]{6})$/.test(color) ? color : '#2C3E50',
                  logoUrl: logoUrl ?? null,
                }}
                className="size-14"
              />
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  disabled={isSubmitting}
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    if (file.size > MAX_LOGO_BYTES) {
                      setError('logoUrl', {
                        message: '이미지는 500KB 이하여야 합니다.',
                      })
                      event.target.value = ''
                      return
                    }
                    try {
                      const dataUrl = await readFileAsDataUrl(file)
                      clearErrors('logoUrl')
                      setValue('logoUrl', dataUrl, { shouldValidate: true })
                    } catch {
                      setError('logoUrl', {
                        message: '이미지를 불러오지 못했습니다.',
                      })
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" />
                  이미지 선택
                </Button>
                {logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => {
                      setValue('logoUrl', null, { shouldValidate: true })
                      if (fileInputRef.current) fileInputRef.current.value = ''
                      clearErrors('logoUrl')
                    }}
                  >
                    이미지 제거
                  </Button>
                ) : null}
              </div>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="영문명" error={errors.name?.message}>
              <Input
                {...register('name', {
                  onChange: (event) => {
                    if (mode !== 'create') return
                    const auto = slugify(event.target.value)
                    if (auto) setValue('slug', auto, { shouldValidate: true })
                  },
                })}
                placeholder="ATELIER"
                disabled={isSubmitting}
              />
            </Field>
            <Field label="한글명" error={errors.nameKo?.message}>
              <Input
                {...register('nameKo')}
                placeholder="아틀리에"
                disabled={isSubmitting}
              />
            </Field>
          </div>

          <Field
            label="URL slug"
            hint="작업장 주소: /b/{slug}"
            error={errors.slug?.message}
          >
            <Input
              {...register('slug')}
              placeholder="atelier"
              disabled={isSubmitting}
            />
          </Field>

          <Field label="설명" error={errors.description?.message}>
            <Textarea
              {...register('description')}
              rows={3}
              placeholder="시티 모던 여성복"
              disabled={isSubmitting}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="대표 색상" error={errors.color?.message}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#([0-9A-Fa-f]{6})$/.test(color) ? color : '#2C3E50'}
                  onChange={(event) =>
                    setValue('color', event.target.value.toUpperCase(), {
                      shouldValidate: true,
                    })
                  }
                  className="h-9 w-12 cursor-pointer rounded-md border border-border bg-card p-1"
                  disabled={isSubmitting}
                  aria-label="색상 선택"
                />
                <Input
                  {...register('color')}
                  placeholder="#2C3E50"
                  disabled={isSubmitting}
                />
              </div>
            </Field>
            <Field
              label="탄생 연도"
              hint="브랜드 설립/런칭 연도"
              error={errors.foundedYear?.message}
            >
              <Input
                type="number"
                inputMode="numeric"
                {...register('foundedYear', { valueAsNumber: true })}
                placeholder="2018"
                disabled={isSubmitting}
              />
            </Field>
          </div>

          {errorMessage ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? '저장 중...'
                : mode === 'create'
                  ? '생성'
                  : '저장'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </div>
  )
}
