import { useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { RELEASE_MD_ID } from '@/lib/company/release-access'
import { sampleCountry } from '@/lib/drafts/sample-receipt'
import { listOrgChartMembers } from '@/lib/supabase/profiles'
import type { DraftTeamValues } from '@/lib/supabase/draft-team-work'
import type { ProductDraft } from '@/lib/types'
import {
  DEFAULT_DRAFT_MD_OPTIONS, DRAFT_MD_OPTION_LABELS, DraftMdOptionsContext, initialDraftMdOptionId,
  type DraftMdOption, type DraftMdOptionField,
} from './draft-md-options'
import { DraftMdOptionDialog } from './DraftMdOptionDialog'
import { DraftMdOptionEntries } from './DraftMdOptionEntries'
import { DraftTeamActions, DraftTeamNotice } from './DraftTeamActions'
import { matchesTeamColors, useDraftTeamSection, type DraftTeamWork } from './use-draft-team-work'
import { useDraftSabangnetPartners, withSavedDraftPartner } from './use-draft-sabangnet-partners'

const ORDER_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})
const EDIT_CONFIRMED_HINT = '오른쪽 수정 버튼을 눌러 변경한 뒤 다시 확정해 주세요.'
const EMPTY_OPTION = { id: 'initial', name: '', price: '' }

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

function formatMdPrice(value: string) {
  const [whole, fraction] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

function MdPriceInput({ label, value, disabled, onChange }: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return <Input className="draft-md-input tabular-nums" aria-label={label} inputMode="decimal" placeholder="직접등록"
    value={formatMdPrice(value)} disabled={disabled} onChange={event => {
      const input = event.currentTarget
      const raw = input.value
      const next = raw.replaceAll(',', '')
      if (next.length > 24 || !/^-?\d*(\.\d*)?$/.test(next)) return
      const formatted = formatMdPrice(next)
      const position = input.selectionStart ?? raw.length
      onChange(next)
      if (formatted === raw) return

      // Keep the caret at the same digit when a grouping separator moves.
      let caret = raw.slice(0, position).replaceAll(',', '').length
      for (let index = 0; index < caret; index += 1) {
        if (formatted[index] === ',') caret += 1
      }
      if (next === value && formatted[caret] === ',' && (event.nativeEvent as InputEvent).inputType === 'deleteContentForward') {
        caret += 1
      }
      requestAnimationFrame(() => {
        if (document.activeElement === input && input.value === formatted) input.setSelectionRange(caret, caret)
      })
    }} />
}

export function DraftMdTeamCell({ draft, readOnly, hidden, actorId, teamWork }: {
  draft: ProductDraft; readOnly: boolean; hidden: boolean; actorId?: string; teamWork: DraftTeamWork
}) {
  const catalog = useContext(DraftMdOptionsContext)
  const [editingArrival, setEditingArrival] = useState(false)
  const [managingOptions, setManagingOptions] = useState<DraftMdOptionField | null>(null)
  const [editingPeriod, setEditingPeriod] = useState(false)
  const listing = useDraftTeamSection(teamWork, 'md-listing', {
    registerType: initialDraftMdOptionId('register', draft.registerType), registerLabel: '',
    openType: initialDraftMdOptionId('open', draft.openType), openLabel: '',
    partnerId: draft.specs.openChannelTargetId ?? null,
    partner: draft.openTypeDetail === '전체' ? '' : draft.openTypeDetail.trim(),
    from: '', to: '', assignee: '',
  }, readOnly)
  const release = listing.value
  const { registerType, openType } = release
  const specialRelease = openType === 'open-early' || openType === 'open-exclusive'
  const partners = useDraftSabangnetPartners(draft.brandId, specialRelease)
  const partnerName = release.partnerId ? partners.names.get(release.partnerId) : undefined
  const releasePartners = withSavedDraftPartner(partners.options, release.partnerId, release.partner, partnerName)
  const quantity = useDraftTeamSection(teamWork, 'md-quantity', { quantities: {}, arrival: '' }, readOnly)
  const price = useDraftTeamSection(teamWork, 'md-price', {
    retail: draft.retailPrice?.toString() ?? '', discount: draft.discountPrice?.toString() ?? '', extraDiscount: '', auto: false,
  }, readOnly)
  const initialOption = draft.hasOptions
    ? draft.options.some(item => (item.price ?? 0) > 0) ? 'option-surcharge' : 'option-included'
    : ''
  const options = useDraftTeamSection(teamWork, 'md-options', {
    type: DEFAULT_DRAFT_MD_OPTIONS.option.find(item => item.id === initialOption) ?? null,
    entries: draft.options.map(item => ({ id: item.id, name: item.name, price: item.price?.toString() ?? '' })),
  }, readOnly)
  if (!catalog) throw new Error('DraftMdTeamCell requires DraftMdOptionsProvider')

  const listingConfirmed = listing.confirmed
  const listingLocked = listing.locked || listingConfirmed || listing.conflict
  const quantityConfirmed = quantity.confirmed && matchesTeamColors(quantity.value.quantities, draft.colors)
  const quantityLocked = quantity.locked || quantityConfirmed || quantity.conflict
  const priceLocked = price.locked || price.confirmed || price.conflict
  const optionsLocked = options.locked || options.confirmed || options.conflict
  const registerOptions = withSavedDraftPartner(catalog.lists.register, registerType || null, release.registerLabel)
  const openOptions = withSavedDraftPartner(catalog.lists.open, openType || null, release.openLabel)
  const releaseType = openOptions.options.find(item => item.id === openType)
  const releasePeriod = [release.from, release.to].filter(Boolean).map(displayDate).join(' ~ ')
  const selectedOption = options.value.type
  const optionTypes = selectedOption ? catalog.lists.option.map(item => item.id === selectedOption.id ? selectedOption : item)
    : catalog.lists.option
  const selectableOptions = selectedOption && !optionTypes.some(item => item.id === selectedOption.id)
    ? [...optionTypes, selectedOption] : optionTypes
  const hasOptionEntries = Boolean(selectedOption && selectedOption.id !== 'option-none')
  const surcharge = selectedOption?.id === 'option-surcharge'
  const { arrival } = quantity.value

  function saveQuantities(confirmed: boolean) {
    let expectedArrival = arrival
    if (confirmed && !expectedArrival) {
      const expectedDay = new Date(`${ORDER_DATE.format(new Date())}T00:00:00Z`)
      expectedDay.setUTCDate(expectedDay.getUTCDate() + 60)
      expectedArrival = expectedDay.toISOString().slice(0, 10)
    }
    setEditingArrival(false)
    void quantity.save(confirmed, { arrival: expectedArrival, quantities: Object.fromEntries(draft.colors.map(color => [
      color.id, quantity.value.quantities[color.id] ?? color.orderQty?.toString() ?? '',
    ])) })
  }

  function setPrice(field: keyof Omit<DraftTeamValues['md-price'], 'auto'>, value: string) {
    price.change(previous => ({ ...previous, [field]: value }))
  }

  function updateOptionCatalog(field: DraftMdOptionField, items: DraftMdOption[]) {
    const previousType = catalog?.lists.option.find(item => item.id === selectedOption?.id)
    if (field === 'option' && previousType) {
      const nextType = items.find(item => item.id === previousType.id) ?? null
      if (nextType?.label !== previousType.label) options.change(previous => ({ ...previous, type: nextType }))
    }
    if (field === 'register' || field === 'open') {
      const key = field === 'register' ? 'registerType' : 'openType'
      const labelKey = field === 'register' ? 'registerLabel' : 'openLabel'
      const previous = catalog?.lists[field].find(item => item.id === release[key])
      const next = items.find(item => item.id === release[key])
      if (previous && previous.label !== next?.label) {
        listing.change(current => ({ ...current, [key]: next?.id ?? '', [labelKey]: next?.label ?? '' }))
      }
    }
    catalog?.update(field, items)
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

  return (
    <td className="draft-sheet-md-cell" hidden={hidden}>
      <div className="draft-md-layout">
        <div className="draft-md-order">
          <div className="draft-color-pad justify-center">
            <DraftTeamActions label="MD 수량" confirmText="수량 확정" className="draft-md-quantity-actions"
              locked={quantity.locked} confirmed={quantityConfirmed} busy={quantity.busy} editing={quantity.editing}
              conflict={quantity.conflict} onEdit={() => quantity.change(value => value)} onSave={saveQuantities} onReset={quantity.reset} />
          </div>
          <div className="draft-color-lines">
            {draft.colors.map((color, index) => {
              const name = color.name.trim() || `컬러 ${index + 1}`
              const amount = quantity.value.quantities[color.id] ?? color.orderQty?.toString() ?? ''
              return (
                <div key={color.id} className={`draft-color-line${index % 2 === 1 ? ' is-alt' : ''}`}>
                  <label className="draft-md-order-quantity">
                    <Input inputMode="numeric" aria-label={`${name} 발주 수량`} disabled={quantityLocked}
                      value={amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} onChange={event => {
                        const next = event.currentTarget.value.replaceAll(',', '')
                        if (/^\d{0,15}$/.test(next)) quantity.change(current => ({ ...current, quantities: { ...current.quantities, [color.id]: next } }))
                      }} />
                  </label>
                </div>
              )
            })}
          </div>
          <DraftTeamNotice error={quantity.error} conflict={quantity.conflict} />
        </div>

        <div className="draft-md-main">
          <section className={`draft-md-section draft-md-listing${listingConfirmed ? ' is-confirmed' : ''}`}
            aria-label="등록 및 오픈 유형">
            <div className={`draft-md-arrival${specialRelease ? ' has-release' : ''}`}>
              {specialRelease && releaseType && <strong className="draft-md-release-notice" title={releasePeriod || undefined}>
                * {[partnerName || release.partner, releaseType.label].filter(Boolean).join(' ')}{releasePeriod ? ` / ${releasePeriod}` : ''} *
              </strong>}
              {editingArrival && !quantityLocked ? (
                <label>예상입고일 : <Input type="date" autoFocus value={arrival} onBlur={() => setEditingArrival(false)}
                  onChange={event => {
                    const next = event.currentTarget.value
                    quantity.change(previous => ({ ...previous, arrival: next }))
                  }} /></label>
              ) : (
                <button type="button" disabled={quantityLocked} onClick={() => setEditingArrival(true)}>
                  예상입고일 : {arrival ? displayDate(arrival) : '미정'}
                </button>
              )}
            </div>
            <div className={`draft-md-listing-fields${specialRelease ? ' has-release' : ''}`}>
              <div>
                <MdField label="등록유형">
                  <MdSelect label="등록유형" value={registerType} options={registerOptions.options} disabled={listingLocked}
                    confirmed={listingConfirmed} onChange={registerType => listing.change(current => ({
                      ...current, registerType, registerLabel: catalog.lists.register.find(item => item.id === registerType)?.label ?? '',
                    }))} />
                  {manageOptionButton('register', listingLocked)}
                </MdField>
                <MdField label="오픈유형">
                  <MdSelect label="오픈유형" value={openType} options={openOptions.options} disabled={listingLocked}
                    confirmed={listingConfirmed} onChange={openType => {
                      listing.change(current => ({
                        ...current, openType, openLabel: catalog.lists.open.find(item => item.id === openType)?.label ?? '',
                      }))
                      setEditingPeriod(false)
                    }} />
                  {manageOptionButton('open', listingLocked)}
                </MdField>
                {specialRelease && <MdField className="draft-md-release-partner" label="진행업체">
                  <MdSelect label="진행업체" value={releasePartners.value} options={releasePartners.options}
                    placeholder={partners.placeholder} disabled={listingLocked} confirmed={listingConfirmed} onChange={id => {
                      if (id === releasePartners.value) return
                      const target = partners.options.find(option => option.id === id)
                      listing.change(current => ({ ...current, partnerId: target?.id ?? null, partner: target?.registeredName ?? '' }))
                    }} />
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
                        listing.change(current => ({ ...current, from, to: from && current.to < from ? '' : current.to }))
                      }} /></label>
                      <label>종료일<Input type="date" min={release.from || undefined} value={release.to} onChange={event => {
                        const to = event.currentTarget.value
                        if (!to || !release.from || to >= release.from) listing.change(current => ({ ...current, to }))
                      }} /></label>
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingPeriod(false)}>닫기</Button>
                    </div>}
                  </div>
                </div>
                <MdAssigneeSelect actorId={actorId} value={release.assignee} disabled={listingLocked}
                  confirmed={listingConfirmed} onChange={assignee => listing.change(current => ({ ...current, assignee }))} />
              </div>}
            </div>
            <DraftTeamActions label="등록 및 오픈 유형" className="draft-md-section-actions" locked={listing.locked}
              confirmed={listingConfirmed} busy={listing.busy} editing={listing.editing} conflict={listing.conflict}
              onEdit={() => listing.change(value => value)} onReset={listing.reset} onSave={confirmed => {
                setEditingPeriod(false)
                void listing.save(confirmed)
              }} />
            <DraftTeamNotice error={listing.error} conflict={listing.conflict} />
          </section>

          <section className={`draft-md-section draft-md-pricing${price.confirmed ? ' is-confirmed' : ''}`}
            aria-label="판매가 및 할인가" title={price.confirmed && !readOnly ? EDIT_CONFIRMED_HINT : undefined}>
            <MdField label="판매가">
              <MdPriceInput label="판매가" value={price.value.retail} disabled={priceLocked} onChange={value => setPrice('retail', value)} />
              <Button type="button" variant="outline" size="sm" className="draft-md-auto" aria-pressed={price.value.auto} disabled={priceLocked}
                onClick={() => price.change(previous => ({ ...previous, auto: !previous.auto }))}>Auto</Button>
            </MdField>
            <MdField label="할인가">
              <MdPriceInput label="할인가" value={price.value.discount} disabled={priceLocked} onChange={value => setPrice('discount', value)} />
              <MdPriceInput label="할인가 추가 입력" value={price.value.extraDiscount} disabled={priceLocked} onChange={value => setPrice('extraDiscount', value)} />
            </MdField>
            <DraftTeamActions label="판매가 및 할인가" className="draft-md-section-actions" locked={price.locked}
              confirmed={price.confirmed} busy={price.busy} editing={price.editing} conflict={price.conflict}
              onEdit={() => price.change(value => value)} onSave={confirm => void price.save(confirm)} onReset={price.reset} />
            <DraftTeamNotice error={price.error} conflict={price.conflict} />
          </section>

          <section className={`draft-md-section draft-md-product${options.confirmed ? ' is-confirmed' : ''}`}
            aria-label="제조국 및 옵션">
            <div className="draft-md-origin"><span>제조국</span><span>{draft.originCountry.trim() ? sampleCountry(draft.originCountry).label : '미정'}</span></div>
            <MdField className="draft-md-option-field" label="옵션유무">
              <MdSelect label="옵션유무" value={selectedOption?.id ?? ''} options={selectableOptions} disabled={optionsLocked}
                confirmed={options.confirmed} onChange={id => options.change(previous => ({ ...previous,
                  type: selectableOptions.find(item => item.id === id) ?? null,
                }))} />
              {manageOptionButton('option', optionsLocked)}
              {hasOptionEntries && <DraftMdOptionEntries entries={options.value.entries.length ? options.value.entries : [EMPTY_OPTION]} surcharge={surcharge}
                disabled={optionsLocked} confirmed={options.confirmed} onChange={entries => options.change(previous => ({ ...previous, entries }))} />}
            </MdField>
            <DraftTeamActions label="제조국 및 옵션" className="draft-md-section-actions" locked={options.locked}
              confirmed={options.confirmed} busy={options.busy} editing={options.editing} conflict={options.conflict}
              onEdit={() => options.change(value => value)} onSave={confirm => void options.save(confirm, {
                type: selectedOption ?? null, entries: hasOptionEntries ? options.value.entries.map(entry => ({
                  ...entry, price: surcharge ? entry.price : '',
                })) : [],
              })} onReset={options.reset} />
            <DraftTeamNotice error={options.error} conflict={options.conflict} />
          </section>
        </div>
      </div>
      {managingOptions && (
        <DraftMdOptionDialog label={DRAFT_MD_OPTION_LABELS[managingOptions]} options={catalog.lists[managingOptions]}
          onChange={items => updateOptionCatalog(managingOptions, items)} onClose={() => setManagingOptions(null)} />
      )}
    </td>
  )
}
