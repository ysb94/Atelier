import { useEffect, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  saveInvoiceOptionMap,
  type InvoiceOptionMapInput,
} from '@/lib/api'
import { type InvoiceOptionMap, type StyleRef } from '@/lib/types'
import {
  InvoiceOptionExtrasEditor,
  extrasFromOptionMap,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'

function mainFromMap(map: InvoiceOptionMap | null): StyleRef | null {
  return map?.components.find((item) => item.role === 'main')?.style ?? null
}

function resolveMain(
  map: InvoiceOptionMap | null,
  initialMain: StyleRef | null,
) {
  return mainFromMap(map) ?? initialMain
}

export function InvoiceOptionMapForm({
  brandId,
  map = null,
  initialProductName = '',
  initialItemName = '',
  initialMallName = '',
  initialOwnProductCode = '',
  initialMain = null,
  lockSource = false,
  compact = false,
  submitLabel = '기준으로 저장',
  onSaved,
}: {
  brandId: string
  map?: InvoiceOptionMap | null
  initialProductName?: string
  initialItemName?: string
  initialMallName?: string
  initialOwnProductCode?: string
  initialMain?: StyleRef | null
  lockSource?: boolean
  compact?: boolean
  submitLabel?: string
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const formId = useId()
  const [productName, setProductName] = useState(
    map?.productName || initialProductName,
  )
  const [itemName, setItemName] = useState(map?.itemName || initialItemName)
  const [mallName, setMallName] = useState(map?.mallName || initialMallName)
  const [allMalls, setAllMalls] = useState(
    map ? !map.mallName : !initialMallName,
  )
  const [ownProductCode, setOwnProductCode] = useState(
    map?.ownProductCode || initialOwnProductCode,
  )
  const [note, setNote] = useState(map?.note ?? '')
  const [displayItemName, setDisplayItemName] = useState(
    map?.displayItemName ?? '',
  )
  const [main, setMain] = useState<StyleRef | null>(
    () => resolveMain(map, initialMain),
  )
  const [extras, setExtras] = useState<OptionExtraDraft[]>(
    extrasFromOptionMap(map),
  )
  const [savedMessage, setSavedMessage] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(!compact)

  useEffect(() => {
    setProductName(map?.productName || initialProductName)
    setItemName(map?.itemName || initialItemName)
    setMallName(map?.mallName || initialMallName)
    setAllMalls(map ? !map.mallName : !initialMallName)
    setOwnProductCode(map?.ownProductCode || initialOwnProductCode)
    setNote(map?.note ?? '')
    setDisplayItemName(map?.displayItemName ?? '')
    setMain(resolveMain(map, initialMain))
    setExtras(extrasFromOptionMap(map))
    setDetailsOpen(!compact)
    setSavedMessage('')
  }, [
    compact,
    map,
    initialProductName,
    initialItemName,
    initialMallName,
    initialOwnProductCode,
    initialMain,
  ])

  const canSave = Boolean(productName.trim()) && Boolean(main)

  const mutation = useMutation({
    mutationFn: (input: InvoiceOptionMapInput) =>
      saveInvoiceOptionMap(brandId, input, map?.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-option-maps', brandId],
      })
      setSavedMessage('저장했습니다. 현재 파일과 이후 작업에 바로 쓰입니다.')
      if (!lockSource && !map) {
        setProductName('')
        setItemName('')
        setMallName('')
        setAllMalls(true)
        setOwnProductCode('')
        setNote('')
        setDisplayItemName('')
        setMain(null)
        setExtras([])
      }
      onSaved?.()
    },
  })

  function submit() {
    if (!canSave || !main) return
    setSavedMessage('')
    mutation.mutate({
      productName,
      itemName,
      mallName: allMalls ? '' : mallName,
      ownProductCode,
      displayItemName,
      note,
      components: [
        { styleId: main.styleId, role: 'main', quantity: 1 },
        ...extras
          .filter((item) => item.style)
          .map((item) => ({
            styleId: item.style!.styleId,
            role: item.role,
            quantity: item.quantity,
          })),
      ],
    })
  }

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  const sourceFields = (
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
          원본 내품명
        </label>
        <Input
          id={`${formId}-item`}
          value={itemName}
          readOnly={lockSource}
          onChange={(event) => setItemName(event.target.value)}
          placeholder="비우면 품목명만 매칭"
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
  )

  const mallFields = (
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
  )

  const noteField = (
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
        placeholder="선택"
      />
    </div>
  )

  const displayField = (
    <div>
      <label
        htmlFor={`${formId}-display`}
        className="mb-1.5 block text-xs font-medium"
      >
        변환 내품명(선택)
      </label>
      <Input
        id={`${formId}-display`}
        value={displayItemName}
        onChange={(event) => setDisplayItemName(event.target.value)}
        placeholder="비우면 원본 내품명을 유지합니다"
      />
    </div>
  )

  const mainField = (
    <div>
      <p className="mb-1.5 text-xs font-medium">본품 M번호</p>
      <StylePicker
        brandId={brandId}
        value={main}
        onChange={(next) => {
          setMain(next)
          setSavedMessage('')
        }}
        placeholder="본품 M번호 또는 공식명 검색"
      />
    </div>
  )

  const extrasField = (
    <InvoiceOptionExtrasEditor
      brandId={brandId}
      extras={extras}
      onChange={setExtras}
      compact={compact}
    />
  )

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={!canSave || mutation.isPending}
        onClick={submit}
      >
        <Save className="size-3.5" />
        {mutation.isPending ? '저장 중...' : submitLabel}
      </Button>
      {errorMessage ? (
        <p className="text-xs text-danger">{errorMessage}</p>
      ) : savedMessage ? (
        <p className="text-xs text-success">{savedMessage}</p>
      ) : null}
    </div>
  )

  if (compact) {
    return (
      <div className="space-y-3">
        {lockSource ? (
          <p className="break-words text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{productName}</span>
            {itemName ? ` · ${itemName}` : ' · 내품명 없음'}
            {allMalls ? ' · 모든 쇼핑몰' : mallName ? ` · ${mallName}` : ''}
          </p>
        ) : (
          sourceFields
        )}
        {displayField}
        {mainField}
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? '상세 설정 접기' : '상세 설정'}
          </Button>
          {detailsOpen ? (
            <div className="mt-3 space-y-3">
              {lockSource ? (
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
              ) : null}
              {mallFields}
              {extrasField}
              {noteField}
            </div>
          ) : extras.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              구성품 {extras.length}개가 저장에 포함됩니다.
            </p>
          ) : null}
        </div>
        {actions}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sourceFields}
      {mallFields}
      {displayField}
      {mainField}
      {extrasField}
      {noteField}
      {actions}
    </div>
  )
}
