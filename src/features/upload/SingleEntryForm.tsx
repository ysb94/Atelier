import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  applyProductImport,
  type ImportApplyRow,
} from '@/lib/api'
import type { BrandField, Season, Style } from '@/lib/types'
import { prepareSingleEntry } from '@/lib/import/transform'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'

type SingleEntryFormProps = {
  brandId: string
  brandSlug: string
  fields: BrandField[]
  seasons: Season[]
  existingStyles: Style[]
}

export function SingleEntryForm({
  brandId,
  brandSlug,
  fields,
  seasons,
  existingStyles,
}: SingleEntryFormProps) {
  const queryClient = useQueryClient()
  const ordered = useMemo(
    () => [...fields].sort((a, b) => a.order - b.order),
    [fields],
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<'created' | 'updated' | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const prepared = prepareSingleEntry({
        values,
        fields: ordered,
        existingStyles,
        seasons,
      })
      if (prepared.status === 'error') {
        throw new Error(prepared.errors.join(' / ') || '입력값을 확인하세요.')
      }
      const row: ImportApplyRow = {
        lineNo: prepared.lineNo,
        styleNo: prepared.styleNo,
        matchKey: prepared.matchKey,
        targetStyleId: prepared.targetStyleId,
        applied: prepared.applied,
        customFields: prepared.customFields,
      }
      const applied = await applyProductImport(brandId, [row])
      const failure = applied.failures[0]
      if (failure) throw new Error(failure.message)
      return { applied, prepared }
    },
    onSuccess: async ({ applied }) => {
      setResult(applied.created > 0 ? 'created' : 'updated')
      setFormError(null)
      setValues({})
      await queryClient.invalidateQueries()
    },
    onError: (err) => {
      setResult(null)
      setFormError(
        err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.',
      )
    },
  })

  function setFieldValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setResult(null)
  }

  function fieldKey(field: BrandField) {
    return field.systemKey ?? field.label
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>한건 등록</CardTitle>
        <p className="text-sm text-muted-foreground">
          업로드 항목 구성에 맞춰 상품 1건을 등록하거나 품번 기준으로
          업데이트합니다.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
        >
          {ordered.map((field) => {
            const key = fieldKey(field)
            const value = values[key] ?? ''
            const label = `${field.label}${field.required ? ' *' : ''}`

            if (field.type === 'season') {
              return (
                <label key={field.id} className="block space-y-1.5">
                  <span className="text-sm font-medium">{label}</span>
                  <Select
                    value={value}
                    onChange={(e) => setFieldValue(key, e.target.value)}
                    required={field.required}
                  >
                    <option value="">시즌 선택</option>
                    {seasons.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )
            }

            if (field.type === 'gender') {
              return (
                <label key={field.id} className="block space-y-1.5">
                  <span className="text-sm font-medium">{label}</span>
                  <Select
                    value={value}
                    onChange={(e) => setFieldValue(key, e.target.value)}
                    required={field.required}
                  >
                    <option value="">선택</option>
                    <option value="W">여성 (W)</option>
                    <option value="M">남성 (M)</option>
                    <option value="U">공용 (U)</option>
                  </Select>
                </label>
              )
            }

            if (field.type === 'list' || field.systemKey === 'description') {
              return (
                <label
                  key={field.id}
                  className={
                    field.systemKey === 'description'
                      ? 'block space-y-1.5 sm:col-span-2'
                      : 'block space-y-1.5'
                  }
                >
                  <span className="text-sm font-medium">{label}</span>
                  <Textarea
                    rows={field.systemKey === 'description' ? 3 : 2}
                    value={value}
                    placeholder={
                      field.type === 'list' ? '예: Ivory, Black' : undefined
                    }
                    onChange={(e) => setFieldValue(key, e.target.value)}
                    required={field.required}
                  />
                </label>
              )
            }

            return (
              <label key={field.id} className="block space-y-1.5">
                <span className="text-sm font-medium">{label}</span>
                <Input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={(e) => setFieldValue(key, e.target.value)}
                  required={field.required}
                />
              </label>
            )
          })}

          {formError ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-2">
              {formError}
            </p>
          ) : null}

          {result ? (
            <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success sm:col-span-2">
              {result === 'created' ? '신규 등록 완료.' : '기존 상품 갱신 완료.'}{' '}
              <Link
                to={`/b/${brandSlug}/products`}
                className="underline underline-offset-2"
              >
                전체 상품 보기
              </Link>
            </p>
          ) : null}

          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
