import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Settings2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ProductsPage } from './ProductsPage'
import { MdEventPricePreview } from './MdEventPricePreview'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { getCodeUsageTargets, getSabangnetProducts } from '@/lib/api'
import { outboundPartnerDisplayName } from '@/lib/codes/outbound-partner'
import type { SabangnetMallUrl } from '@/lib/codes/sabangnet-url-import'
import { useRenderWatch } from '@/lib/diagnostics'
import { interactionContext } from '@/lib/diagnostics/perf-watch'
import { combineListQueries } from '@/lib/query/list-queries'
import { useAuth } from '@/lib/supabase/auth'
import { getMdMallDisplayPreferences, saveMdMallDisplayPreferences } from '@/lib/supabase/md-mall-display-preferences'
import { listSabangnetMallUrls } from '@/lib/supabase/sabangnet-mall-urls'
import type { Brand, CodeUsageTarget, SabangnetProduct } from '@/lib/types'
import { cn, emptyList, formatNumber } from '@/lib/utils'

type Mall = { target: CodeUsageTarget; brand: Brand; label: string; count: number }
type MallRow = { link: SabangnetMallUrl; product: SabangnetProduct; mall: Mall }

function sampleMallRows(rows: MallRow[], seed: number): MallRow[] {
  // A fixed seed keeps samples stable when queries refresh or the page renders again.
  const shuffled = [...rows]
  let state = seed || 0x9e3779b9
  const count = Math.min(7, shuffled.length)
  for (let i = 0; i < count; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    const j = i + Math.floor(((state >>> 0) / 0x100000000) * (shuffled.length - i))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.slice(0, count)
}

function timeMdWork<T>(name: string, work: () => T): T {
  const started = performance.now()
  try { return work() } finally {
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 1000) console.warn('[md-products]', name, `${elapsed}ms`, interactionContext())
    else if (elapsed >= 200) console.info('[md-products]', name, `${elapsed}ms`, interactionContext())
  }
}

export function MdProductsPage({ brands }: { brands: Brand[] }) {
  useRenderWatch('MdProductsPage')
  const { profile } = useAuth()
  const client = useQueryClient()
  const [selected, setSelected] = useState('all')
  const [view, setView] = useState<'events' | 'products'>('events')
  const [sampleSeed, setSampleSeed] = useState(() => Math.floor(Math.random() * 0x100000000))
  const [search, setSearch] = useState('')
  const [linkFilter, setLinkFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set())
  const [settingsSearch, setSettingsSearch] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const products = useQueries({ queries: brands.map(brand => ({ queryKey: ['sabangnetProducts', brand.id], queryFn: () => getSabangnetProducts(brand.id) })), combine: combineListQueries<SabangnetProduct> })
  const targets = useQueries({ queries: brands.map(brand => ({ queryKey: ['codeUsageTargets', brand.id], queryFn: () => getCodeUsageTargets(brand.id) })), combine: combineListQueries<CodeUsageTarget> })
  const activeTargetIds = useMemo(() => targets.data.map(rows => rows?.filter(target => target.active).map(target => target.id).sort()), [targets.data])
  const urls = useQueries({ queries: brands.map((brand, index) => ({
    // Activation changes anywhere in the app must also refresh this filtered URL list.
    queryKey: ['sabangnetMallUrls', brand.id, 'productNames', 'activeTargets', activeTargetIds[index]],
    queryFn: () => activeTargetIds[index]?.length ? listSabangnetMallUrls(brand.id, { activeTargetsOnly: true }) : Promise.resolve([]),
    enabled: activeTargetIds[index] !== undefined,
  })), combine: combineListQueries<SabangnetMallUrl> })
  const preference = useQuery({ queryKey: ['mdMallDisplayPreferences', profile?.id], queryFn: () => getMdMallDisplayPreferences(profile!.id), enabled: Boolean(profile?.id) })
  const preferences = preference.data ?? emptyList<{ brandId: string; targetIds: string[] }>()

  const mallData = useMemo(() => timeMdWork('MD 업체 상품 표 구성', () => {
    const brandMap = new Map(brands.map(brand => [brand.id, brand]))
    const productMap = new Map(products.data.flatMap(rows => rows ?? []).map(product => [product.id, product]))
    const targetMap = new Map(targets.data.flatMap(rows => rows ?? []).map(target => [target.id, target]))
    const malls = new Map<string, Mall>()
    const rows: MallRow[] = []
    for (const link of urls.data.flatMap(items => items ?? [])) {
      const target = targetMap.get(link.targetId)
      const brand = brandMap.get(link.brandId)
      const product = productMap.get(link.productId)
      if (!target?.active || !brand || !product || target.brandId !== link.brandId || product.brandId !== link.brandId) continue
      let mall = malls.get(target.id)
      if (!mall) {
        mall = { target, brand, label: outboundPartnerDisplayName(target), count: 0 }
        malls.set(target.id, mall)
      }
      mall.count++
      rows.push({ link, product, mall })
    }
    const sorted = [...malls.values()].sort((a, b) => a.target.order - b.target.order || a.label.localeCompare(b.label, 'ko'))
    rows.sort((a, b) => a.product.code.localeCompare(b.product.code, 'ko', { numeric: true }) || a.mall.label.localeCompare(b.mall.label, 'ko'))
    return { malls: sorted, rows }
  }), [brands, products.data, targets.data, urls.data])

  const visibleMalls = useMemo(() => {
    const configured = new Map(preferences.map(row => [row.brandId, new Set(row.targetIds)]))
    return mallData.malls.filter(mall => !configured.has(mall.brand.id) || configured.get(mall.brand.id)!.has(mall.target.id))
  }, [mallData.malls, preferences])
  // A removed/hidden tab falls back immediately, without navigating hidden workspace tabs.
  const active = selected === 'native' || visibleMalls.some(mall => mall.target.id === selected) ? selected : 'all'
  const linksByProduct = useMemo(() => {
    const result = new Map<string, MallRow[]>()
    for (const row of mallData.rows) { const group = result.get(row.product.id) ?? []; group.push(row); result.set(row.product.id, group) }
    return result
  }, [mallData.rows])
  const eventPreviewProducts = useMemo(() => timeMdWork('MD 이벤트 샘플 선정', () => {
    const visible = new Set(visibleMalls.map(mall => mall.target.id)), seen = new Set<string>()
    const candidates = mallData.rows.filter(row => {
      if (!visible.has(row.mall.target.id) || (active !== 'all' && row.mall.target.id !== active) || seen.has(row.product.id)) return false
      seen.add(row.product.id); return true
    })
    return sampleMallRows(candidates, sampleSeed).map(row => ({ id: row.link.id, name: row.link.mallProductName || '업체 상품명 미등록', code: row.product.code, m: row.product.styles.map(style => style.styleNo).join(', ') || '미연결', provider: row.mall.label, url: row.link.url,
      otherLinks: (linksByProduct.get(row.product.id) ?? []).filter(other => other.mall.target.id !== row.mall.target.id).map(other => ({ id: other.link.id, label: other.mall.label, url: other.link.url, name: other.link.mallProductName || '' })) }))
  }), [active, linksByProduct, mallData.rows, sampleSeed, visibleMalls])
  const filteredRows = useMemo(() => timeMdWork('MD 업체 상품 검색', () => {
    const visibleIds = new Set(visibleMalls.map(mall => mall.target.id))
    const keyword = search.trim().toLowerCase()
    return mallData.rows.filter(row => visibleIds.has(row.mall.target.id)
      && (active === 'all' || row.mall.target.id === active)
      && (linkFilter === 'all' || (linkFilter === 'linked' ? row.product.styles.length > 0 : row.product.styles.length === 0))
      && (!keyword || `${row.product.code} ${row.product.name} ${row.link.mallProductName ?? ''} ${row.link.mallProductCode} ${row.mall.label} ${row.product.styles.map(style => style.styleNo).join(' ')}`.toLowerCase().includes(keyword)))
  }), [active, linkFilter, mallData.rows, search, visibleMalls])
  const pages = Math.max(1, Math.ceil(filteredRows.length / 50))
  const safePage = Math.min(page, pages)
  const pageRows = filteredRows.slice((safePage - 1) * 50, safePage * 50)
  const loading = products.loading || targets.loading || urls.loading || preference.isPending
  const failed = products.errorIndexes.length > 0 || targets.errorIndexes.length > 0 || urls.errorIndexes.length > 0 || preference.isError

  const save = useMutation({
    mutationFn: () => {
      if (!profile) throw new Error('로그인 정보를 확인해 주세요.')
      // Preserve stored IDs for currently unavailable targets rather than discarding them on an incomplete list.
      const available = new Set(mallData.malls.map(mall => mall.target.id))
      return saveMdMallDisplayPreferences(profile.id, brands.map(brand => ({ brandId: brand.id, targetIds: [
        ...mallData.malls.filter(mall => mall.brand.id === brand.id && draftIds.has(mall.target.id)).map(mall => mall.target.id),
        ...(preferences.find(row => row.brandId === brand.id)?.targetIds ?? []).filter(id => !available.has(id)),
      ] })))
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['mdMallDisplayPreferences', profile?.id] }); setSettingsOpen(false); setSaved(true) },
    onError: error => { console.warn('[md-products] 표시 업체 저장 실패', { error, ...interactionContext() }); setSaveError(error.message) },
  })

  const tabs = <div className="mb-5">
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">업체별 등록 상품을 확인하세요. M번호 미연결 상품도 표시됩니다.</p>
      <Button variant="outline" size="sm" disabled={loading || failed || !profile} onClick={() => {
        setDraftIds(new Set(visibleMalls.map(mall => mall.target.id))); setSettingsSearch(''); setSaveError(''); setSettingsOpen(true)
      }}><Settings2 className="size-4" />표시 업체 설정</Button>
    </div>
    <div role="tablist" aria-label="MD 상품 업체" className="flex gap-1 overflow-x-auto border-b border-border pb-1">
      {[{ id: 'all', label: '전체 업체' }, { id: 'native', label: '내 상품' }, ...visibleMalls.map(mall => ({ id: mall.target.id, label: `${mall.label}${brands.length > 1 ? ` · ${mall.brand.name}` : ''}`, count: mall.count }))].map(tab => <button
        key={tab.id} type="button" role="tab" aria-selected={active === tab.id} aria-controls="md-mall-panel"
        onClick={() => { setSelected(tab.id); setPage(1); setSaved(false) }}
        className={cn('shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-4 py-2.5 text-sm transition-colors', active === tab.id ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground')}
      >{tab.label}{'count' in tab ? <span className="ml-2 text-xs tabular-nums opacity-70">{formatNumber(tab.count as number)}</span> : null}</button>)}
    </div>
    {saved ? <p role="status" className="mt-2 text-sm text-success">내 계정의 표시 업체 설정을 저장했습니다.</p> : null}
    {settingsOpen ? <WorkspaceTabOverlay><div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="업체 설정 닫기" disabled={save.isPending} onClick={() => setSettingsOpen(false)} />
      <div role="dialog" aria-modal="true" aria-labelledby="md-mall-settings-title" className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="md-mall-settings-title" className="font-semibold">내 표시 업체 설정</h2><p className="mt-1 text-sm text-muted-foreground">선택한 업체만 내 화면의 탭에 표시합니다. 다른 직원의 설정은 바뀌지 않습니다.</p></div><Button variant="ghost" size="icon" aria-label="업체 설정 닫기" disabled={save.isPending} onClick={() => setSettingsOpen(false)}><X className="size-4" /></Button></div>
        <div className="space-y-3 p-5 pb-2"><Input aria-label="표시 업체 검색" placeholder="업체명 검색" value={settingsSearch} onChange={event => setSettingsSearch(event.target.value)} /><div className="flex gap-2"><Button variant="outline" size="sm" disabled={save.isPending} onClick={() => setDraftIds(new Set(mallData.malls.map(mall => mall.target.id)))}>전체 선택</Button><Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setDraftIds(new Set())}>전체 해제</Button><span className="ml-auto self-center text-sm text-muted-foreground">{draftIds.size}개 선택</span></div></div>
        <div className="grid gap-1 overflow-y-auto px-5 pb-5 sm:grid-cols-2">{mallData.malls.filter(mall => `${mall.label} ${mall.brand.name}`.toLowerCase().includes(settingsSearch.trim().toLowerCase())).map(mall => <label key={mall.target.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted"><input type="checkbox" checked={draftIds.has(mall.target.id)} disabled={save.isPending} onChange={event => setDraftIds(previous => { const next = new Set(previous); if (event.target.checked) next.add(mall.target.id); else next.delete(mall.target.id); return next })} /><span className="min-w-0 text-sm">{mall.label}{brands.length > 1 ? <small className="block text-muted-foreground">{mall.brand.name}</small> : null}</span><span className="ml-auto text-xs text-muted-foreground">{formatNumber(mall.count)}건</span></label>)}</div>
        {saveError ? <p role="alert" className="px-5 pb-3 text-sm text-danger">{saveError}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border p-4"><Button variant="ghost" disabled={save.isPending} onClick={() => setSettingsOpen(false)}>취소</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? '저장 중...' : '내 설정 저장'}</Button></div>
      </div>
    </div></WorkspaceTabOverlay> : null}
  </div>

  const companyTable = <div id="md-mall-panel" role="tabpanel">
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input className="max-w-sm" aria-label="업체 상품 검색" placeholder="사방넷 코드, 상품명, M번호 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      <Select aria-label="M번호 연결 상태" value={linkFilter} onChange={event => { setLinkFilter(event.target.value); setPage(1) }}><option value="all">전체 연결 상태</option><option value="linked">M번호 연결됨</option><option value="unlinked">M번호 미연결</option></Select>
      <span className="ml-auto text-sm text-muted-foreground">{formatNumber(filteredRows.length)}건 · 50건씩</span>
    </div>
    {failed ? <p role="alert" className="mb-3 text-sm text-danger">업체 상품 또는 개인 설정을 불러오지 못했습니다. 새로고침해 주세요.</p> : null}
    <Card className="overflow-hidden"><div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[1080px] table-fixed text-left text-sm">
      <colgroup><col className="w-36" /><col className="w-32" /><col className="w-80" /><col className="w-40" /><col className="w-48" /><col className="w-32" /></colgroup>
      <thead className="sticky top-0 z-20 bg-muted text-xs text-muted-foreground"><tr>{['업체', '사방넷 코드', '업체 상품명', '쇼핑몰 상품코드', '연결된 M번호', '상품 링크'].map(label => <th key={label} className="h-11 px-4 font-medium">{label}</th>)}</tr></thead>
      <tbody>{loading || failed ? <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">{loading ? '업체 상품을 불러오는 중...' : '조회에 실패했습니다.'}</td></tr> : pageRows.length ? pageRows.map(row => <tr key={row.link.id} className="h-12 border-b border-border odd:bg-card even:bg-muted/30 hover:bg-accent/50">
        <td className="px-4"><div className="truncate" title={row.mall.label}>{row.mall.label}</div>{brands.length > 1 ? <small className="text-muted-foreground">{row.mall.brand.name}</small> : null}</td>
        <td className="px-4 font-medium">{row.product.code}</td><td className="px-4"><div className="truncate" title={row.link.mallProductName || '업체 상품명 미등록'}>{row.link.mallProductName || '업체 상품명 미등록'}</div></td>
        <td className="truncate px-4" title={row.link.mallProductCode}>{row.link.mallProductCode || '—'}</td>
        <td className="px-4"><div className="truncate" title={row.product.styles.map(style => style.styleNo).join(', ')}>{row.product.styles.length ? row.product.styles.map(style => style.styleNo).join(', ') : <Link className="text-muted-foreground underline underline-offset-4" to={`/sabangnet-codes?brand=${encodeURIComponent(row.mall.brand.slug)}&q=${encodeURIComponent(row.product.code)}`}>미연결</Link>}</div></td>
        <td className="px-4"><a className="inline-flex items-center gap-1 text-primary hover:underline" href={row.link.url} target="_blank" rel="noopener noreferrer">상품 보기<ExternalLink className="size-3.5" /></a></td>
      </tr>) : <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">{visibleMalls.length ? '조건에 맞는 업체 상품이 없습니다.' : '표시 업체 설정에서 업체를 선택해 주세요.'}</td></tr>}</tbody>
    </table></div><div className="flex items-center justify-between border-t border-border px-4 py-3"><span className="text-xs text-muted-foreground">같은 상품이 여러 업체에 등록되어 있으면 업체별로 표시됩니다.</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={safePage === 1 || loading} onClick={() => setPage(safePage - 1)}>이전</Button><span className="text-sm tabular-nums">{safePage} / {pages}</span><Button variant="outline" size="sm" disabled={safePage === pages || loading} onClick={() => setPage(safePage + 1)}>다음</Button></div></div></Card>
  </div>

  const content = <div>
    <div className="mb-4 flex gap-2" role="group" aria-label="MD 점검 보기">
      <Button variant={view === 'events' ? 'secondary' : 'ghost'} onClick={() => setView('events')}>이벤트 가격 점검</Button>
      <Button variant={view === 'products' ? 'secondary' : 'ghost'} onClick={() => setView('products')}>등록 상품 목록</Button>
    </div>
    {view === 'events' ? <MdEventPricePreview key={active} products={eventPreviewProducts} onResample={() => setSampleSeed(Math.floor(Math.random() * 0x100000000))} mallName={active === 'all' ? '담당 업체 전체' : visibleMalls.find(mall => mall.target.id === active)?.label ?? '선택한 업체'} /> : companyTable}
  </div>
  return <ProductsPage lockedOwner="md" companyBrands={brands} headerAddon={tabs} contentOverride={active === 'native' ? undefined : content} />
}
