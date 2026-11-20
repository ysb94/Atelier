import { useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { RELEASE_MD_ID } from '@/lib/company/release-access'
import { listOrgChartMembers } from '@/lib/supabase/profiles'
import { DRAFT_OPEN_DETAIL_OPTIONS, type ProductDraft } from '@/lib/types'
import {
  DEFAULT_DRAFT_MD_OPTIONS, DRAFT_MD_OPTION_LABELS, DraftMdOptionsContext, initialDraftMdOptionId,
  type DraftMdOption, type DraftMdOptionField,
} from './draft-md-options'
import { DraftMdOptionDialog } from './DraftMdOptionDialog'
import { DraftMdOptionEntries, type DraftMdOptionEntry } from './DraftMdOptionEntries'

type MdSection = 'listing' | 'price' | 'options'

const ORDER_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})
const EDIT_CONFIRMED_HINT = '오른쪽 수정 버튼을 눌러 변경한 뒤 다시 확정해 주세요.'

function displayDate(value: string) {
  return value.slice(2).replaceAll('-', '.')
}

export function DraftMdOptionsProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState(DEFAULT_DRAFT_MD_OPTIONS)
  const catalog = useMemo(() => ({
    lists,
    update: (field: DraftMdOptionField, options: DraftMdOption[]) =>
      setLists(current => ({ ...current, [field]: options })),
  }), [lists])
  return <DraftMdOptionsContext.Provider value={catalog}>{children}</DraftMdOptionsContext.Provider>
}

function MdSelect({ label, value, options, disabled, confirmed = false, placeholder = 'select', onChange }: {
  label: string
  value: string
  options: DraftMdOption[]
  disabled: boolean
  confirmed?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const selected = options.some(option => option.id === value) ? value : ''
  return (
    <span className={`draft-md-select${selected && !confirmed ? ' draft-md-unconfirmed' : ''}`}>
      <Select aria-label={label} value={selected} disabled={disabled}
        onChange={event => onChange(event.currentTarget.value)}>
        <option value="">{placeholder}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </Select>
    </span>
  )
}

function MdAssigneeSelect({ actorId, value, disabled, confirmed, onChange }: {
  actorId?: string
  value: string
  disabled: boolean
  confirmed: boolean
  onChange: (value: string) => void
}) {
  const active = useWorkspaceTabActivity()
  const directory = useQuery({
    queryKey: ['orgChartMembers', actorId],
    queryFn: listOrgChartMembers,
    enabled: active && Boolean(actorId) && (!disabled || Boolean(value)),
    staleTime: 15_000,
    retry: false,
  })
  const options = (directory.data ?? []).flatMap(member => {
    const label = member.displayName?.trim()
    return member.departmentId === RELEASE_MD_ID && label ? [{ id: member.id, label }] : []
  })
  let placeholder = 'select'
  if (directory.isLoading) placeholder = '불러오는 중…'
  else if (directory.isError && !directory.data) placeholder = '조회 실패'
  else if (directory.isSuccess && !options.length) placeholder = 'MD 직원 없음'

  return <label className="draft-md-release-field"><span>담당자</span>
    <MdSelect label="담당자" value={value} options={options} disabled={disabled || !options.length}
      confirmed={confirmed} placeholder={placeholder} onChange={onChange} />
  </label>
}

function MdField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`draft-md-field${className ? ` ${className}` : ''}`}><span>{label}</span>{children}</div>
}

export function DraftMdTeamCell({ draft, readOnly, actorId }: { draft: ProductDraft; readOnly: boolean; actorId?: string }) {
  const catalog = useContext(DraftMdOptionsContext)
  const [arrival, setArrival] = useState('')
  const [editingArrival, setEditingArrival] = useState(false)
  const [orderConfirmed, setOrderConfirmed] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [managingOptions, setManagingOptions] = useState<DraftMdOptionField | null>(null)
  const [registerType, setRegisterType] = useState(() => initialDraftMdOptionId('register', draft.registerType))
  const [openType, setOpenType] = useState(() => initialDraftMdOptionId('open', draft.openType))
  const [release, setRelease] = useState({ partner: draft.openTypeDetail.trim(), from: '', to: '', assignee: '' })
  const [editingPeriod, setEditingPeriod] = useState(false)
  const [retailPrice, setRetailPrice] = useState(draft.retailPrice?.toString() ?? '')
  const [discountPrice, setDiscountPrice] = useState(draft.discountPrice?.toString() ?? '')
  const [extraDiscount, setExtraDiscount] = useState('')
  const [auto, setAuto] = useState(false)
  const [option, setOption] = useState(() => draft.hasOptions
    ? draft.options.some(item => (item.price ?? 0) > 0) ? 'option-surcharge' : 'option-included'
    : '')
  const [optionEntries, setOptionEntries] = useState<DraftMdOptionEntry[]>(() => draft.options.length
    ? draft.options.map(item => ({ id: item.id, name: item.name, price: item.price?.toString() ?? '' }))
    : [{ id: 'initial', name: '', price: '' }])
  const [confirmed, setConfirmed] = useState({ listing: false, price: false, options: false })
  if (!catalog) throw new Error('DraftMdTeamCell requires DraftMdOptionsProvider')

  const listingLocked = readOnly || confirmed.listing
  const priceLocked = readOnly || confirmed.price
  const optionsLocked = readOnly || confirmed.options
  const releaseType = catalog.lists.open.find(item => item.id === openType)
  const specialRelease = releaseType && (releaseType.id === 'open-early' || releaseType.id === 'open-exclusive')
  const releasePeriod = [release.from, release.to].filter(Boolean).map(displayDate).join(' ~ ')
  const releasePartners = [...new Set(['카카오톡', ...DRAFT_OPEN_DETAIL_OPTIONS, release.partner].filter(Boolean))]
    .map(name => ({ id: name, label: name }))
  const selectedOption = catalog.lists.option.find(item => item.id === option)
  const hasOptionEntries = Boolean(selectedOption && selectedOption.id !== 'option-none')

  function confirmOrder() {
    const expectedDay = new Date(`${ORDER_DATE.format(new Date())}T00:00:00Z`)
    expectedDay.setUTCDate(expectedDay.getUTCDate() + 60)
    setArrival(expectedDay.toISOString().slice(0, 10))
    setEditingArrival(false)
    setOrderConfirmed(true)
  }

  function manageOptionButton(field: DraftMdOptionField, disabled: boolean) {
    return (
      <Button type="button" variant="secondary" size="icon" className="draft-md-add"
        aria-label={`${DRAFT_MD_OPTION_LABELS[field]} 목록 관리`} disabled={disabled}
        onClick={() => setManagingOptions(field)}>
        <Plus size={15} strokeWidth={3} aria-hidden="true" />
      </Button>
    )
  }

  function confirmButton(section: MdSection, label: string) {
    const action = confirmed[section] ? '수정' : '확정'
    return (
      <Button type="button" variant="outline" size="sm" className={`draft-md-confirm${confirmed[section] ? ' is-confirmed' : ''}`}
        aria-label={`${label} ${action}`} title={confirmed[section] && !readOnly ? EDIT_CONFIRMED_HINT : undefined} disabled={readOnly}
        onClick={() => {
          if (section === 'listing') setEditingPeriod(false)
          setConfirmed(current => ({ ...current, [section]: !current[section] }))
        }}>
        {action}
      </Button>
    )
  }

  return (
    <td className="draft-sheet-md-cell">
      <div className="draft-md-layout">
        <div className="draft-md-order">
          <div className="draft-color-pad justify-center">
            <Button type="button" variant="outline" size="sm"
              className={`draft-md-order-status${orderConfirmed || draft.orderDone ? ' is-done' : ''}`}
              disabled={readOnly} onClick={confirmOrder}>발주확정</Button>
          </div>
          <div className="draft-color-lines">
            {draft.colors.map((color, index) => {
              const name = color.name.trim() || `컬러 ${index + 1}`
              const quantity = quantities[color.id] ?? color.orderQty?.toString() ?? ''
              return (
                <div key={color.id} className={`draft-color-line${index % 2 === 1 ? ' is-alt' : ''}`}>
                  <label className="draft-md-order-quantity">
                    <Input inputMode="numeric" aria-label={`${name} 발주 수량`} disabled={readOnly}
                      value={quantity.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} onChange={event => {
                        const next = event.currentTarget.value.replaceAll(',', '')
                        if (/^\d*$/.test(next)) setQuantities(current => ({ ...current, [color.id]: next }))
                      }} />
                  </label>
                </div>
              )
            })}
          </div>
        </div>

        <div className="draft-md-main">
          <section className="draft-md-section draft-md-listing" aria-label="등록 및 오픈 유형">
            <div className={`draft-md-arrival${specialRelease ? ' has-release' : ''}`}>
              {specialRelease && <strong className="draft-md-release-notice" title={releasePeriod || undefined}>
                * {[release.partner, releaseType.label].filter(Boolean).join(' ')}{releasePeriod ? ` / ${releasePeriod}` : ''} *
              </strong>}
              {editingArrival && !listingLocked ? (
                <label>예상입고일 : <Input type="date" autoFocus value={arrival} onBlur={() => setEditingArrival(false)}
                  onChange={event => setArrival(event.currentTarget.value)} /></label>
              ) : (
                <button type="button" disabled={listingLocked} onClick={() => setEditingArrival(true)}>
                  예상입고일 : {arrival ? displayDate(arrival) : '미정'}
                </button>
              )}
            </div>
            <div className={`draft-md-listing-fields${specialRelease ? ' has-release' : ''}`}>
              <div>
                <MdField label="등록유형">
                  <MdSelect label="등록유형" value={registerType} options={catalog.lists.register} disabled={listingLocked}
                    confirmed={confirmed.listing} onChange={setRegisterType} />
                  {manageOptionButton('register', listingLocked)}
                </MdField>
                <MdField label="오픈유형">
                  <MdSelect label="오픈유형" value={openType} options={catalog.lists.open} disabled={listingLocked}
                    confirmed={confirmed.listing} onChange={value => {
                      setOpenType(value)
                      setEditingPeriod(false)
                    }} />
                  {manageOptionButton('open', listingLocked)}
                </MdField>
                {specialRelease && <MdField className="draft-md-release-partner" label="진행업체">
                  <MdSelect label="진행업체" value={release.partner} options={releasePartners} disabled={listingLocked}
                    confirmed={confirmed.listing} onChange={partner => setRelease(current => ({ ...current, partner }))} />
                </MdField>}
              </div>
              {specialRelease && <div className="draft-md-release-fields">
                <div className="draft-md-release-field">
                  <span>기간</span>
                  <div className="draft-md-select">
                    <Button type="button" variant="outline" size="sm" aria-label="발매 기간" aria-expanded={editingPeriod}
                      className="draft-md-period-button" title={releasePeriod || undefined} disabled={listingLocked}
                      onClick={() => setEditingPeriod(current => !current)}>{releasePeriod || 'select'}</Button>
                    {editingPeriod && !listingLocked && <div className="draft-md-period-panel">
                      <label>시작일<Input type="date" value={release.from} onChange={event => {
                        const from = event.currentTarget.value
                        setRelease(current => ({ ...current, from, to: from && current.to < from ? '' : current.to }))
                      }} /></label>
                      <label>종료일<Input type="date" min={release.from || undefined} value={release.to} onChange={event => {
                        const to = event.currentTarget.value
                        if (!to || !release.from || to >= release.from) setRelease(current => ({ ...current, to }))
                      }} /></label>
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingPeriod(false)}>닫기</Button>
                    </div>}
                  </div>
                </div>
                <MdAssigneeSelect actorId={actorId} value={release.assignee} disabled={listingLocked}
                  confirmed={confirmed.listing} onChange={assignee => setRelease(current => ({ ...current, assignee }))} />
              </div>}
            </div>
            {confirmButton('listing', '등록 및 오픈 유형')}
          </section>

          <section className={`draft-md-section draft-md-pricing${confirmed.price ? ' is-confirmed' : ''}`}
            aria-label="판매가 및 할인가" title={confirmed.price && !readOnly ? EDIT_CONFIRMED_HINT : undefined}>
            <MdField label="판매가">
              <Input className="draft-md-input" aria-label="판매가" inputMode="numeric" placeholder="직접등록"
                value={retailPrice} disabled={priceLocked} onChange={event => setRetailPrice(event.currentTarget.value)} />
              <Button type="button" variant="outline" size="sm" className="draft-md-auto" aria-pressed={auto} disabled={priceLocked}
                onClick={() => setAuto(current => !current)}>Auto</Button>
            </MdField>
            <MdField label="할인가">
              <Input className="draft-md-input" aria-label="할인가" inputMode="numeric" placeholder="직접등록"
                value={discountPrice} disabled={priceLocked} onChange={event => setDiscountPrice(event.currentTarget.value)} />
              <Input className="draft-md-input" aria-label="할인가 추가 입력" inputMode="numeric" placeholder="직접등록"
                value={extraDiscount} disabled={priceLocked} onChange={event => setExtraDiscount(event.currentTarget.value)} />
            </MdField>
            {confirmButton('price', '판매가 및 할인가')}
          </section>

          <section className="draft-md-section draft-md-product" aria-label="제조국 및 옵션">
            <div className="draft-md-origin"><span>제조국</span><span>{draft.originCountry.trim() || '미정'}</span></div>
            <MdField className="draft-md-option-field" label="옵션유무">
              <MdSelect label="옵션유무" value={option} options={catalog.lists.option} disabled={optionsLocked}
                confirmed={confirmed.options} onChange={setOption} />
              {manageOptionButton('option', optionsLocked)}
              {hasOptionEntries && <DraftMdOptionEntries entries={optionEntries} surcharge={selectedOption?.id === 'option-surcharge'}
                disabled={optionsLocked} confirmed={confirmed.options} onChange={setOptionEntries} />}
            </MdField>
            {confirmButton('options', '제조국 및 옵션')}
          </section>
        </div>
      </div>
      {managingOptions && (
        <DraftMdOptionDialog label={DRAFT_MD_OPTION_LABELS[managingOptions]} options={catalog.lists[managingOptions]}
          onChange={options => catalog.update(managingOptions, options)} onClose={() => setManagingOptions(null)} />
      )}
    </td>
  )
}
