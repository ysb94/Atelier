import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, useParams, useSearchParams } from 'react-router-dom'
import { BrandTargetGate } from '@/components/layout/BrandTargetGate'
import { CompanyBrandScopeProvider } from '@/components/layout/company-brand-scope'
import { CompanyHomePage } from '@/features/home/CompanyHomePage'
import { CompanySchedulePage } from '@/features/home/CompanySchedulePage'
import { WorkRequestPage } from '@/features/work-requests/WorkRequestPage'
import { OrgChartPage } from '@/features/org/OrgChartPage'
import { MembersPage } from '@/features/settings/MembersPage'
import { ProfileSettingsPage } from '@/features/settings/ProfileSettingsPage'
import { PermissionSettingsPage } from '@/features/settings/PermissionSettingsPage'
import { AccessIpRecordsPage } from '@/features/settings/AccessIpRecordsPage'
import { BrandSelectPage } from '@/features/brands/BrandSelectPage'
import { CompanyProductsPage } from '@/features/products/CompanyProductsPage'
import { DepartmentProductsPage } from '@/features/products/ProductsPage'
import { ProductDetailDrawer } from '@/features/products/ProductDetailDrawer'
import { CompanySampleWorkOrderPage } from '@/features/china/SampleWorkOrderPage'
import { DesignStyledCutsPage } from '@/features/design/StyledCutsPage'
import { CompanyDraftsPage } from '@/features/drafts/DraftsPage'
import { DraftEditPage } from '@/features/drafts/DraftEditPage'
import { CompanyBarcodePage } from '@/features/codes/BarcodePage'
import { SabangnetCodePage } from '@/features/codes/SabangnetCodePage'
import { CompanyUsageCodePage } from '@/features/codes/UsageCodePage'
import { CompanyPartnerCodePage } from '@/features/codes/PartnerCodePage'
import { FieldsSettingsPage } from '@/features/settings/FieldsSettingsPage'
import { ProductCategorySettingsPage } from '@/features/settings/ProductCategorySettingsPage'
import { UsageTargetsSettingsPage } from '@/features/settings/UsageTargetsSettingsPage'
import { AiSettingsPage } from '@/features/settings/AiSettingsPage'
import { CompanyDataSheetPage } from '@/features/data/DataSheetPage'
import { DataUploadPage } from '@/features/data/DataUploadPage'
import { CompanyInvoiceWorkPage } from '@/features/logistics/InvoiceWorkPage'
import { CompanyBarcodeOutboundDataEntryPage } from '@/features/logistics/BarcodeOutboundDataEntryPage'
import { CompanyBulkOutboundPage } from '@/features/logistics/BulkOutboundPage'
import { CompanyOutboundDataPage } from '@/features/logistics/OutboundDataPage'
import { CompanyWarehousePage } from '@/features/logistics/WarehousePage'
import { CompanyWarehouseFinderPage } from '@/features/logistics/WarehouseFinderPage'
import { CompanyCargoInboundPage } from '@/features/logistics/CargoInboundPage'
import { CompanyTemporaryWarehousePage } from '@/features/logistics/TemporaryWarehousePage'
import { PriceComparePage } from '@/features/md/PriceComparePage'
import { OperationsSupportPage } from '@/features/operations-support/OperationsSupportPage'
import { MamamIdeaInboxPage } from '@/features/mamam/MamamIdeaInboxPage'
import { DeveloperPreviewPage } from './DeveloperPreview'
import { ReleasePageGate } from './ReleasePageGate'

function RedirectTo({
  to,
  preserveSearch = false,
}: {
  to: string
  preserveSearch?: boolean
}) {
  const [searchParams] = useSearchParams()
  const search = preserveSearch ? searchParams.toString() : ''
  return <Navigate to={search ? `${to}?${search}` : to} replace />
}

const DesignFileManagerPage = lazy(async () => {
  const mod = await import('@/features/design/file-manager/DesignFileManagerPage')
  return { default: mod.CompanyDesignFileManagerPage }
})

function DesignFileManagerRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          이미지 업로드 화면을 불러오는 중...
        </div>
      }
    >
      <DesignFileManagerPage />
    </Suspense>
  )
}

function Gated({
  lock,
  autoSelectFirst,
  children,
}: {
  lock?: boolean
  autoSelectFirst?: boolean
  children: ReactNode
}) {
  return (
    <BrandTargetGate
      lockAfterSelect={lock}
      autoSelectFirst={autoSelectFirst}
    >
      {children}
    </BrandTargetGate>
  )
}

function CompanyScopeLayout() {
  return (
    <ReleasePageGate>
    <CompanyBrandScopeProvider>
      <DeveloperPreviewPage>
      <Outlet />
      </DeveloperPreviewPage>
    </CompanyBrandScopeProvider>
    </ReleasePageGate>
  )
}

function LegacyDraftRedirect() {
  const { draftId } = useParams()
  return <Navigate to={`/drafts/${draftId}`} replace />
}

/** 회사 셸 안쪽 화면. 탭 KeepAlive가 같은 트리로 여러 개를 띄운다. */
export const companyWorkspaceRoutes = (
    <Route element={<CompanyScopeLayout />}>
      <Route index element={<CompanyHomePage />} />
      <Route path="work" element={<Navigate to="/settings/profile?part=work" replace />} />
      <Route path="work-requests/:owner" element={<WorkRequestPage />} />
      <Route path="schedule" element={<CompanySchedulePage />} />
      <Route path="meetings" element={<Navigate to="/settings/profile?part=meetings" replace />} />
      <Route path="org-chart" element={<OrgChartPage />} />
      <Route path="members" element={<MembersPage />} />
      <Route path="settings/profile" element={<ProfileSettingsPage />} />
      <Route path="settings/permissions" element={<PermissionSettingsPage />} />
      <Route path="settings/access-ip" element={<AccessIpRecordsPage />} />
      <Route path="brands" element={<BrandSelectPage />} />
      <Route path="products" element={<CompanyProductsPage />}>
        <Route path=":brandSlug/:styleNo" element={<ProductDetailDrawer />} />
      </Route>
      <Route path="drafts" element={<CompanyDraftsPage />} />
      <Route path="drafts/new" element={<DraftEditPage />} />
      <Route path="drafts/:draftId" element={<DraftEditPage />} />
      <Route
        path="china/work-orders"
        element={<CompanySampleWorkOrderPage />}
      />
      <Route
        path="drafts/:legacyBrandSlug/:draftId"
        element={<LegacyDraftRedirect />}
      />
      <Route
        path="product-work/planning/:brandSlug/:styleNo"
        element={<RedirectTo to="/products" preserveSearch />}
      />
      <Route
        path="product-work/planning/*"
        element={<RedirectTo to="/products" preserveSearch />}
      />
      <Route
        path="product-work/design/:brandSlug/:styleNo"
        element={<RedirectTo to="/products" preserveSearch />}
      />
      <Route
        path="product-work/design/*"
        element={<RedirectTo to="/products" preserveSearch />}
      />
      <Route path="product-work/:owner" element={<DepartmentProductsPage />}>
        <Route
          path=":brandSlug/:styleNo"
          element={<ProductDetailDrawer />}
        />
      </Route>
      <Route path="design/styled-cuts" element={<DesignStyledCutsPage />} />
      <Route
        path="design/color-samples"
        element={<RedirectTo to="/design/styled-cuts" />}
      />
      <Route path="design/file-manager" element={<DesignFileManagerRoute />} />
      <Route path="logistics/invoices" element={<CompanyInvoiceWorkPage />} />
      <Route
        path="logistics/invoice-data-entry"
        element={<RedirectTo to="/logistics/invoices" />}
      />
      <Route
        path="logistics/barcode-outbound-data-entry"
        element={<CompanyBarcodeOutboundDataEntryPage />}
      />
      <Route path="logistics/bulk-outbound" element={<CompanyBulkOutboundPage />} />
      <Route path="logistics/finder" element={<CompanyWarehouseFinderPage />} />
      <Route path="logistics/warehouses" element={<CompanyWarehousePage />} />
      <Route
        path="logistics/temporary-warehouse"
        element={<CompanyTemporaryWarehousePage />}
      />
      <Route
        path="logistics/cargo-inbound"
        element={<CompanyCargoInboundPage />}
      />
      <Route path="data" element={<RedirectTo to="/data/all" />} />
      <Route
        path="data/upload"
        element={
          <Gated>
            <DataUploadPage />
          </Gated>
        }
      />
      <Route path="data/:owner" element={<CompanyDataSheetPage />}>
        <Route path=":brandSlug/:styleNo" element={<ProductDetailDrawer />} />
      </Route>
      <Route path="barcodes" element={<CompanyBarcodePage />} />
      <Route
        path="sabangnet-codes"
        element={
          <Gated autoSelectFirst>
            <SabangnetCodePage />
          </Gated>
        }
      />
      <Route path="usage-codes" element={<CompanyUsageCodePage />} />
      <Route path="partner-codes" element={<CompanyPartnerCodePage />} />
      <Route path="operations-support" element={<OperationsSupportPage />} />
      <Route path="idea-contest" element={<MamamIdeaInboxPage />} />
      <Route path="operations" element={<CompanyOutboundDataPage />} />
      <Route path="outbound-data" element={<RedirectTo to="/operations" />} />
      <Route
        path="settings/fields"
        element={
          <Gated>
            <FieldsSettingsPage />
          </Gated>
        }
      />
      <Route
        path="settings/product-categories"
        element={
          <Gated>
            <ProductCategorySettingsPage />
          </Gated>
        }
      />
      <Route path="settings/seasons" element={<Navigate to="/drafts" replace />} />
      <Route
        path="settings/usage-targets"
        element={
          <Gated autoSelectFirst>
            <UsageTargetsSettingsPage />
          </Gated>
        }
      />
      <Route path="settings/import" element={<RedirectTo to="/data/upload" />} />
      <Route
        path="settings/ai"
        element={
          <Gated>
            <AiSettingsPage />
          </Gated>
        }
      />
      <Route path="settings/brand" element={<RedirectTo to="/brands" />} />
      <Route path="upload" element={<RedirectTo to="/data/upload" />} />
      <Route path="import" element={<RedirectTo to="/data/upload" />} />
      <Route
        path="planning"
        element={<RedirectTo to="/products" preserveSearch />}
      />
      <Route
        path="design"
        element={<RedirectTo to="/products" preserveSearch />}
      />
      <Route path="md/price-compare" element={<PriceComparePage />} />
      <Route path="md" element={<RedirectTo to="/product-work/md" />} />
      <Route
        path="logistics"
        element={<RedirectTo to="/product-work/logistics" />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
)

export function CompanyWorkspaceRouteTree() {
  return companyWorkspaceRoutes
}
