import { useEffect, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  saveInvoiceProductNameMap,
  type InvoiceProductNameMapInput,
} from '@/lib/api'
import type { InvoiceProductNameMap, StyleRef } from '@/lib/types'
import { upsertInvoiceProductNameMapCache } from './useInvoiceProductNameSaveQueue'

export function InvoiceProductNameMapForm({
  brandId,
  map = null,
  initialProductName = '',
  initialItemNameContext = '',
  initialMallName = '',
  initialOwnProductCode = '',
  initialStyle = null,
  lockSource = false,
  submitLabel = '품목명 기준으로 저장',
  onSaved,
}: {
  brandId: string
  map?: InvoiceProductNameMap | null
  initialProductName?: string
  initialItemNameContext?: string
  initialMallName?: string
  initialOwnProductCode?: string
  initialStyle?: StyleRef | null
  lockSource?: boolean
  submitLabel?: string
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const formId = useId()
  const [productName, setProductName] = useState(
    map?.productName || initialProductName,
  )
  const [itemNameContext, setItemNameContext] = useState(
    map?.itemNameContext || initialItemNameContext,
  )
  const [lookupKey, setLookupKey] = useState(map?.lookupKey ?? '')
  const [mallName, setMallName] = useState(map?.mallName || initialMallName)
  const [allMalls, setAllMalls] = useState(
    map ? !map.mallName : !initialMallName,
  )
  const [ownProductCode, setOwnProductCode] = useState(
    map?.ownProductCode || initialOwnProductCode,
  )
  const [note, setNote] = useState(map?.note ?? '')
  const [style, setStyle] = useState<StyleRef | null>(
    map?.style ?? initialStyle,
  )
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    setProductName(map?.productName || initialProductName)
    setItemNameContext(map?.itemNameContext || initialItemNameContext)
    setLookupKey(map?.lookupKey ?? '')
    setMallName(map?.mallName || initialMallName)
    setAllMalls(map ? !map.mallName : !initialMallName)
    setOwnProductCode(map?.ownProductCode || initialOwnProductCode)
    setNote(map?.note ?? '')
    setStyle(map?.style ?? initialStyle)
  }, [
    map,
    initialProductName,
    initialItemNameContext,
    initialMallName,
    initialOwnProductCode,
    initialStyle,
  ])

  const canSave =
    Boolean(productName.trim() || lookupKey.trim()) && Boolean(style)

  const mutation = useMutation({
    mutationFn: (input: InvoiceProductNameMapInput) =>
      saveInvoiceProductNameMap(brandId, input, map?.id),
    onSuccess: (saved) => {
      // 저장 API가 완성된 행을 돌려주므로, 1만여 건 전체를 다시 읽지 않는다.
      // 같은 React Query 캐시를 쓰는 품목명 단계와 기준 표가 즉시 함께 갱신된다.
      void upsertInvoiceProductNameMapCache(queryClient, brandId, saved)
      setSavedMessage('저장했습니다. 품목명 단계에만 바로 다시 쓰입니다.')
      if (!lockSource && !map) {
        setProductName('')
        setItemNameContext('')
        setLookupKey('')
        setMallName('')
        setAllMalls(true)
        setOwnProductCode('')
        setNote('')
        setStyle(null)
      }
      onSaved?.()
    },
  })

  function submit() {
    if (!canSave || !style) return
    setSavedMessage('')
    mutation.mutate({
      productName: productName.trim() || lookupKey.trim(),
      itemNameContext: lookupKey.trim() ? '' : itemNameContext,
      mallName: allMalls || lookupKey.trim() ? '' : mallName,
      ownProductCode,
      lookupKey,
      styleId: style.styleId,
      note,
    })
  }

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label
            htmlFor={`${formId}-product`}
            className="mb-1.5 block text-xs font-medium"
          >
            원본 품목명
          </label>
          <Input
            id={`${formId}-product`}
            value={productName}
            readOnly={lockSource}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="사방넷 품목명"
            className={lockSource ? 'bg-muted/40 font-medium' : undefined}
          />
        </div>
        <div>
          <label
            htmlFor={`${formId}-item`}
            className="mb-1.5 block text-xs font-medium"
          >
            내품명 문맥(읽기 전용 조회키)
          </label>
          <Input
            id={`${formId}-item`}
            value={itemNameContext}
            readOnly={lockSource}
            onChange={(event) => setItemNameContext(event.target.value)}
            placeholder="출력하지 않음"
            className={lockSource ? 'bg-muted/40' : undefined}
          />
        </div>
        <div>
          <label
            htmlFor={`${formId}-code`}
            className="mb-1.5 block text-xs font-medium"
          >
            자체상품코드
          </label>
          <Input
            id={`${formId}-code`}
            value={ownProductCode}
            onChange={(event) => setOwnProductCode(event.target.value)}
            placeholder="참고용"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={`${formId}-lookup`}
          className="mb-1.5 block text-xs font-medium"
        >
          조회 키(기존 원장 방식, 선택)
        </label>
        <Input
          id={`${formId}-lookup`}
          value={lookupKey}
          onChange={(event) => setLookupKey(event.target.value)}
          placeholder="예: 마스마룰즈 래빗에코백 Color: 트로피칼"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          채우면 이 문자열 하나로만 맞춥니다. 쇼핑몰·내품명 문맥은 쓰지 않습니다.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label
            htmlFor={`${formId}-mall`}
            className="mb-1.5 block text-xs font-medium"
          >
            쇼핑몰명
          </label>
          <Input
            id={`${formId}-mall`}
            value={allMalls ? '' : mallName}
            disabled={allMalls}
            onChange={(event) => setMallName(event.target.value)}
            placeholder="비우면 모든 쇼핑몰"
            className={allMalls ? 'bg-muted/40' : undefined}
          />
        </div>
        <label className="mt-6 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={allMalls}
            onChange={(event) => setAllMalls(event.target.checked)}
          />
          모든 쇼핑몰
        </label>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium">본품 M번호</p>
        <StylePicker
          brandId={brandId}
          value={style}
          onChange={(next) => {
            setStyle(next)
            setSavedMessage('')
          }}
          placeholder="본품 1개만 고르세요"
        />
      </div>

      <div>
        <label
          htmlFor={`${formId}-note`}
          className="mb-1.5 block text-xs font-medium"
        >
          메모
        </label>
        <Input
          id={`${formId}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!canSave || mutation.isPending}
          onClick={submit}
        >
          {mutation.isPending ? '저장 중...' : submitLabel}
        </Button>
        {errorMessage ? (
          <p className="text-xs text-danger">{errorMessage}</p>
        ) : savedMessage ? (
          <p className="text-xs text-success">{savedMessage}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            내품명 편집이나 구성품 입력은 이 화면에 없습니다.
          </p>
        )}
      </div>
    </div>
  )
}
