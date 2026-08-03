import { useQuery } from '@tanstack/react-query'
import {
  NavLink,
  Outlet,
  useParams,
  Navigate,
  Link,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import {
  Boxes,
  LayoutGrid,
  Palette,
  Package,
  PenLine,
  ChevronLeft,
  Shirt,
  Upload,
} from 'lucide-react'
import { getBrandBySlug, getBrands } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BrandContext } from './brand-context'

const commonMenus = [
  { to: 'products', label: '전체 상품', icon: Shirt },
  { to: 'import', label: '데이터 가져오기', icon: Upload },
] as const

const modules = [
  { to: 'planning', label: '기획', icon: PenLine },
  { to: 'design', label: '디자인', icon: Palette },
  { to: 'md', label: 'MD', icon: LayoutGrid },
  { to: 'logistics', label: '물류', icon: Boxes },
] as const

export function BrandLayout() {
  const { brandSlug = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const brandQuery = useQuery({
    queryKey: ['brand', brandSlug],
    queryFn: () => getBrandBySlug(brandSlug),
    enabled: Boolean(brandSlug),
  })
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })

  if (brandQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        작업장을 불러오는 중...
      </div>
    )
  }

  if (!brandQuery.data) {
    return <Navigate to="/" replace />
  }

  const brand = brandQuery.data
  const brands = brandsQuery.data ?? []

  return (
    <BrandContext.Provider value={{ brand, brandSlug }}>
      <div className="flex h-full min-h-0">
        <aside className="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
          <div className="border-b border-white/10 px-4 py-4">
            <Link
              to="/"
              className="mb-3 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80"
            >
              <ChevronLeft className="size-3.5" />
              브랜드 선택
            </Link>
            <div className="flex items-center gap-3">
              <div
                className="flex size-9 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: brand.color }}
              >
                {brand.name.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{brand.name}</div>
                <div className="truncate text-xs text-white/50">
                  {brand.nameKo} · {brand.seasonLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-white/10 px-3 py-3">
            <label className="mb-1.5 block px-1 text-[10px] font-medium uppercase tracking-wider text-white/40">
              브랜드 전환
            </label>
            <select
              className="w-full rounded-md border border-white/10 bg-sidebar-muted px-2 py-1.5 text-sm text-white outline-none"
              value={brand.slug}
              onChange={(e) => {
                const next = e.target.value
                if (next === brand.slug) return
                const segment =
                  location.pathname.split('/').filter(Boolean)[2] ?? 'products'
                navigate(`/b/${next}/${segment}`)
              }}
            >
              {brands.map((b) => (
                <option key={b.id} value={b.slug}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 p-3">
            <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-white/40">
              공통
            </div>
            {commonMenus.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={`/b/${brand.slug}/${to}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-white'
                      : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </NavLink>
            ))}

            <div className="mb-1.5 mt-4 px-2 text-[10px] font-medium uppercase tracking-wider text-white/40">
              모듈
            </div>
            {modules.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={`/b/${brand.slug}/${to}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-white'
                      : 'text-white/65 hover:bg-sidebar-muted hover:text-white',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-white/10 px-4 py-3 text-xs text-white/40">
            <div className="flex items-center gap-2">
              <Package className="size-3.5" />
              Atelier Workspace
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl p-6 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </BrandContext.Provider>
  )
}
