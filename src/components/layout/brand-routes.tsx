import { lazy, Suspense } from 'react'
import { Navigate, Route, useParams } from 'react-router-dom'
import { BrandHomePage } from '@/features/home/BrandHomePage'
import {
  DepartmentProductsPage,
  ProductsPage,
} from '@/features/products/ProductsPage'
import { ProductDetailDrawer } from '@/features/products/ProductDetailDrawer'
import {
  AllDraftsPage,
  SeasonDraftsPage,
} from '@/features/drafts/DraftsPage'
import { DraftEditPage } from '@/features/drafts/DraftEditPage'
import { DraftSeasonPickerPage } from '@/features/drafts/DraftSeasonPickerPage'
import { BarcodePage } from '@/features/codes/BarcodePage'
import { UsageCodePage } from '@/features/codes/UsageCodePage'
import { PartnerCodePage } from '@/features/codes/PartnerCodePage'
import { FieldsSettingsPage } from '@/features/settings/FieldsSettingsPage'
import { SeasonsSettingsPage } from '@/features/settings/SeasonsSettingsPage'
import { UsageTargetsSettingsPage } from '@/features/settings/UsageTargetsSettingsPage'
import { ImportSettingsPage } from '@/features/settings/ImportSettingsPage'
import { BrandSettingsPage } from '@/features/settings/BrandSettingsPage'
import { AiSettingsPage } from '@/features/settings/AiSettingsPage'
import { MembersPage } from '@/features/settings/MembersPage'
import { ProfileSettingsPage } from '@/features/settings/ProfileSettingsPage'
import { OrgChartPage } from '@/features/org/OrgChartPage'
import { DataSheetPage } from '@/features/data/DataSheetPage'
import { DataUploadPage } from '@/features/data/DataUploadPage'
import { InvoiceWorkPage } from '@/features/logistics/InvoiceWorkPage'
import { BarcodeOutboundDataEntryPage } from '@/features/logistics/BarcodeOutboundDataEntryPage'
import { BulkOutboundPage } from '@/features/logistics/BulkOutboundPage'
import { OutboundDataPage } from '@/features/logistics/OutboundDataPage'
import { WarehousePage } from '@/features/logistics/WarehousePage'
import { WorkRequestPage } from '@/features/work-requests/WorkRequestPage'

const DesignFileManagerPage = lazy(async () => {
  const mod = await import('@/features/design/file-manager/DesignFileManagerPage')
  return { default: mod.DesignFileManagerPage }
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

function RedirectTo({ to }: { to: string }) {
  const { brandSlug } = useParams()
  return <Navigate to={`/b/${brandSlug}/${to}`} replace />
}

function RedirectHome() {
  const { brandSlug } = useParams()
  return <Navigate to={`/b/${brandSlug}`} replace />
}

/** 브랜드 작업장 안쪽 화면. 탭 KeepAlive가 같은 트리로 여러 개를 띄운다. */
export function BrandWorkspaceRouteTree() {
  return (
    <>
      <Route index element={<BrandHomePage />} />
      <Route path="products" element={<ProductsPage />}>
        <Route path=":styleNo" element={<ProductDetailDrawer />} />
      </Route>
      <Route path="drafts" element={<DraftSeasonPickerPage />} />
      <Route path="drafts/all" element={<AllDraftsPage />} />
      <Route path="drafts/season/:seasonCode" element={<SeasonDraftsPage />} />
      <Route path="drafts/:draftId" element={<DraftEditPage />} />
      <Route path="work/:owner" element={<DepartmentProductsPage />}>
        <Route path=":styleNo" element={<ProductDetailDrawer />} />
      </Route>
      <Route path="work-requests/:owner" element={<WorkRequestPage />} />
      <Route path="logistics/invoices" element={<InvoiceWorkPage />} />
      <Route
        path="logistics/invoice-data-entry"
        element={<RedirectTo to="logistics/invoices" />}
      />
      <Route
        path="logistics/barcode-outbound-data-entry"
        element={<BarcodeOutboundDataEntryPage />}
      />
      <Route path="logistics/bulk-outbound" element={<BulkOutboundPage />} />
      <Route path="logistics/warehouses" element={<WarehousePage />} />
      <Route path="data" element={<RedirectTo to="data/all" />} />
      <Route path="data/upload" element={<DataUploadPage />} />
      <Route path="data/:owner" element={<DataSheetPage />}>
        <Route path=":styleNo" element={<ProductDetailDrawer />} />
      </Route>
      <Route path="barcodes" element={<BarcodePage />} />
      <Route path="usage-codes" element={<UsageCodePage />} />
      <Route path="partner-codes" element={<PartnerCodePage />} />
      <Route path="settings/profile" element={<ProfileSettingsPage />} />
      <Route path="org-chart" element={<OrgChartPage />} />
      <Route path="operations" element={<OutboundDataPage />} />
      <Route
        path="outbound-data"
        element={<RedirectTo to="operations" />}
      />
      <Route path="settings/fields" element={<FieldsSettingsPage />} />
      <Route path="settings/seasons" element={<SeasonsSettingsPage />} />
      <Route
        path="settings/usage-targets"
        element={<UsageTargetsSettingsPage />}
      />
      <Route path="settings/import" element={<ImportSettingsPage />} />
      <Route path="settings/members" element={<MembersPage />} />
      <Route path="settings/ai" element={<AiSettingsPage />} />
      <Route path="settings/brand" element={<BrandSettingsPage />} />
      <Route path="upload" element={<RedirectTo to="data/upload" />} />
      <Route path="import" element={<RedirectTo to="data/upload" />} />
      <Route path="planning" element={<RedirectTo to="work/planning" />} />
      <Route
        path="design/file-manager"
        element={<DesignFileManagerRoute />}
      />
      <Route path="design" element={<RedirectTo to="work/design" />} />
      <Route path="md" element={<RedirectTo to="work/md" />} />
      <Route path="logistics" element={<RedirectTo to="work/logistics" />} />
      <Route path="*" element={<RedirectHome />} />
    </>
  )
}
