import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/input'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InvoiceBackedUpOrderDialog } from '@/features/logistics/InvoiceBackedUpOrderDialog'
import { InvoiceWorkHistoryPanel } from '@/features/logistics/InvoiceWorkHistoryPanel'

import { createGiftSeed } from '@/lib/invoice/gift-assign'
import { finalizeUnifiedGiftPlanForDownload } from '@/lib/invoice/gift-confirm'

import { formatOutboundReflectBlockReasons } from '@/lib/invoice/outbound-reflect-summary'

import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber } from '@/lib/utils'

import { InvoiceItemNameTransformPanel } from './InvoiceItemNameTransformPanel'

import { InvoiceOutputStepPanel } from './InvoiceOutputStepPanel'
import { InvoiceProductListStepPanel } from './InvoiceProductListStepPanel'
import { InvoiceStockHoldStepPanel } from './InvoiceStockHoldStepPanel'

import { InvoicePrefixStepPanel } from './InvoicePrefixStepPanel'
import { InvoiceGiftSetupDialog } from './InvoiceGiftSetupDialog'
import { InvoiceFileCheckMallWork, InvoiceFileCheckTransformWork } from './InvoiceFileCheckWork'
import { InvoiceMallResolutionDialog } from './InvoiceMallResolutionDialog'
import { InvoiceProductNameTransformPanel } from './InvoiceProductNameTransformPanel'

import { InvoiceWorkInstructionStepPanel } from './InvoiceWorkInstructionStepPanel'
import { SabangnetOrderTable } from './SabangnetOrderTable'

import type { InvoiceWorkModel } from './useInvoiceWorkController'
import { EMPTY_STYLE_REFS } from './invoice-work-steps'
import {
  SummaryItem,
  InvoiceViewTabs,
  WaitingOrdersPanel,
  RulesPanel,
  TodayStepProgress,
  StepCriteriaLoading,
  TodayStepBusyOverlay,
  StepCriteriaError,
  StepCriteriaNotice,
  TodayStepPanel,
  StepSnapshotButton,
} from './InvoiceWorkPanels'

// 송장작업 화면 구성. 작업 상태와 판단은 제어 훅에서 전달받는다.
export function InvoiceWorkView({ model }: { model: InvoiceWorkModel }) {
  useRenderWatch('InvoiceWorkView')
  const {
    workspaceActive,
    todayStepBusyLabel,
    uploadPipeline,
    isParsing,
    brand,
    activeView,
    selectView,
    stepIndex,
    maxStepIndex,
    isStepPending,
    changeTodayStep,
    activeStep,
    visitedStepsRef,
    inputRef,
    setIsDragging,
    handleFile,
    isDragging,
    error,
    inspection,
    fileName,
    setStep,
    fileReady,
    headerReady,
    mallPartnersReady,
    mallResolution,
    backupLookupBusy,
    productNameExclusionsQuery,
    backedUpLookupQuery,
    hasBackedUpMatch,
    backedUpMatch,
    backedUpExclusionAccepted,
    workRows,
    setBackupDialogOpen,
    mallCategory,
    usageTargetsQuery,
    usageAliasesQuery,
    usageFoldersQuery,
    setMallDialogOpen,
    resetFile,
    canLeaveFileCheck,
    goNextStep,
    backupDialogOpen,
    preConfirmReady,
    setBackedUpExclusionAccepted,
    giftQueriesReady,
    giftCompute,
    giftPlan,
    giftEligibilityPlan,
    giftRequestsError,
    giftSourceMapsError,
    giftSourceAllocationsError,
    giftRequestsQuery,
    giftAllocationsQuery,
    giftSourceMapsQuery,
    giftSourceAllocationsQuery,
    productNameTagRolesQuery,
    prefixRows,
    giftRequests,
    giftAllocations,
    giftResolutions,
    setGiftResolutions,
    giftSeed,
    excludedGiftStyleIds,
    setGiftSeed,
    setExcludedGiftStyleIds,
    workInstructionsQuery,
    workCompute,
    workPlan,
    workInstructionsError,
    processRows,
    workInstructions,
    reachedProduct,
    productStepBlock,
    productQueriesReady,
    productStepError,
    retryProductStep,
    productTransformation,
    productCompute,
    workGeneration,
    productRowKeyIndex,
    matchedProductTransformation,
    productAiAutoCollect,
    handleProductAiProgress,
    handleProductAiSettled,
    setProductSaveBlockCount,
    giftSourcePlan,
    handleOpenGiftSetup,
    productSaveBlockCount,
    nameTransformation,
    itemTransformation,
    computeItemTransformation,
    reachedItem,
    itemStepBlock,
    itemQueriesReady,
    itemStepError,
    retryItemStep,
    itemCompute,
    itemNameRules,
    accessoryRules,
    productStyleLookupQuery,
    reachedOutboundReflect,
    outboundBackupBusy,
    currentGenerationBackedUp,
    outboundReflectLedger,
    backupOutboundReflect,
    outboundBackupMessage,
    outboundBackupIsError,
    outboundReflectSummary,
    reachedStock,
    discontinuedStylesQuery,
    preorderHoldsQuery,
    stockHoldBundles,
    handleStockHoldExcludedChange,
    listCompute,
    optionMapsQuery,
    itemNameRulesQuery,
    workOptionMapsQuery,
    workItemNameRulesQuery,
    accessoryRulesQuery,
    outputCompute,
    workProductNameMapsQuery,
    excludedProductTransformation,
    campaignRows,
    deferredProductNameTagRoles,
    giftSourceSessionRuleMap,
    giftSourceSessionAllocationMap,
    giftSourceIgnoredKeySet,
    giftSourceEffectiveAppliedKeys,
    nameRules,
    nameRulesQuery,
    nameRulesError,
    optionMaps,
    optionMapsError,
    rulesProductNameMaps,
    rulesProductNameMapsQuery,
    rulesProductNameMapsError,
    giftSourceMaps,
    mallDialogOpen,
    mallCategoryKey,
    scopedUsageTargets,
    usageAliases,
    usageFolders,
    giftSetupGroup,
    giftSourceApplyingKey,
    giftSourceError,
    setGiftSourceError,
    setGiftSetupTarget,
    applyGiftSourceSession,
    applyGiftSourcePersist,
    mallCategoryLocked,
    setMallCategoryKey,
    mallCategories,
  } = model
  const mallCategorySelect = (
    <label className="block max-w-sm space-y-1.5 text-sm">
      <span className="font-medium">출고업체 분류</span>
      <Select
        className="w-full"
        aria-label="출고업체 분류"
        value={mallCategoryKey}
        disabled={isParsing || mallCategoryLocked || mallDialogOpen || outboundBackupBusy}
        onChange={(event) => setMallCategoryKey(event.target.value)}
      >
        <option value="">분류를 선택하세요</option>
        {mallCategories.map((category) => (
          <option key={category.key} value={category.key}>{category.name}</option>
        ))}
      </Select>
      <span className="block text-xs text-muted-foreground">
        선택한 분류의 업체·지점·별칭으로 쇼핑몰명을 연결합니다.
      </span>
    </label>
  )
  return (
    <div>
      {workspaceActive && todayStepBusyLabel ? (
        <TodayStepBusyOverlay
          label={todayStepBusyLabel}
          hint={
            uploadPipeline || isParsing
              ? '전 단계 계산과 AI 추천이 끝날 때까지 이 화면을 유지합니다. 자리를 비워도 됩니다.'
              : undefined
          }
        />
      ) : null}
      <PageHeader
        title="송장작업"
        description={`${brand.name} 사방넷 주문 파일을 확인하고 CJ 업로드용 엑셀로 바꾸는 작업 공간입니다.`}
      />

      <InvoiceViewTabs activeView={activeView} onChange={selectView} />

      {activeView === 'today' ? (
        <div className="space-y-4">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <TodayStepProgress
              stepIndex={stepIndex}
              maxStepIndex={maxStepIndex}
              pending={isStepPending}
              onChange={changeTodayStep}
            />
          </div>

          <TodayStepPanel
            active={activeStep === 'upload'}
            keepMounted={visitedStepsRef.current.has('upload')}
          >
            <Card>
              <CardHeader>
                <CardTitle>사방넷 파일 올리기</CardTitle>
                <CardDescription>
                  사방넷에서 받은 운송장출력용 엑셀을 수정하지 말고 그대로
                  올려주세요.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {mallCategorySelect}
                <div
                  role="button"
                  tabIndex={0}
                  aria-busy={isParsing}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      inputRef.current?.click()
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setIsDragging(false)
                    void handleFile(event.dataTransfer.files[0])
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/20 hover:bg-muted/40',
                  )}
                >
                  <div className="flex size-11 items-center justify-center rounded-full bg-muted">
                    <Upload className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {isParsing
                        ? '파일을 안전하게 확인하고 있습니다...'
                        : '엑셀 파일을 여기에 놓으세요'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      또는 눌러서 파일 선택 · XLSX, XLS · 최대 50MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isParsing}
                    onClick={(event) => {
                      event.stopPropagation()
                      inputRef.current?.click()
                    }}
                  >
                    <FileSpreadsheet className="size-4" />
                    {isParsing ? '읽는 중...' : '사방넷 파일 선택'}
                  </Button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm"
                    className="hidden"
                    onChange={(event) =>
                      void handleFile(event.target.files?.[0])
                    }
                  />
                </div>

                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  <p>
                    받는 분 이름·전화번호·주소는 서버에 올리거나 저장하지 않고
                    브라우저 메모리에서만 읽습니다.
                  </p>
                </div>

                {error ? (
                  <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}

                {inspection ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                      올린 파일 · {fileName}
                    </p>
                    <Button type="button" onClick={() => setStep('check')}>
                      파일 확인으로
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'check'}
            keepMounted={visitedStepsRef.current.has('check') && Boolean(inspection)}
          >
            {inspection ? (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>파일 점검 결과</CardTitle>
                    <Badge
                      variant={
                        fileReady
                          ? 'success'
                          : headerReady
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {fileReady
                        ? '원본 형식 확인 완료'
                        : headerReady
                          ? '일부 행 확인 필요'
                          : '다른 형식의 파일'}
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">
                    {fileName} · {inspection.sheetName} 시트 · 헤더{' '}
                    {inspection.headerRowNumber}행
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {mallCategorySelect}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryItem
                    label="불러온 상품 행"
                    value={`${formatNumber(inspection.rowCount)}행`}
                  />
                  <SummaryItem
                    label="고유 주문번호"
                    value={`${formatNumber(inspection.orderCount)}건`}
                    tone="success"
                  />
                  <SummaryItem
                    label="쇼핑몰명 연결 필요"
                    value={
                      mallPartnersReady
                        ? `${formatNumber(mallResolution.unresolvedCount)}곳`
                        : '…'
                    }
                    tone={
                      !mallPartnersReady
                        ? 'default'
                        : mallResolution.unresolvedCount > 0
                          ? 'warning'
                          : 'success'
                    }
                  />
                  <SummaryItem
                    label="배송 필수값 확인 필요"
                    value={`${formatNumber(inspection.blockingRowCount)}행`}
                    tone={
                      inspection.blockingRowCount > 0 ? 'danger' : 'success'
                    }
                  />
                </div>

                {backupLookupBusy ? (
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-4">
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                    <p className="text-sm">
                      {productNameExclusionsQuery.isFetching &&
                      !backedUpLookupQuery.isFetching
                        ? '상품 연결 예외 기준을 확인하고 있습니다. 확인이 끝나기 전에는 다음 단계로 갈 수 없습니다.'
                        : '이전 출고반영 백업과 같은 주문이 있는지 확인하고 있습니다. 확인이 끝나기 전에는 다음 단계로 갈 수 없습니다.'}
                    </p>
                  </div>
                ) : backedUpLookupQuery.isError ? (
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div>
                        <p className="text-sm font-medium text-danger">
                          이전 백업 주문을 확인하지 못했습니다.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {backedUpLookupQuery.error instanceof Error
                            ? backedUpLookupQuery.error.message
                            : '다시 확인한 뒤에 다음 단계로 갈 수 있습니다.'}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void backedUpLookupQuery.refetch()
                      }}
                    >
                      다시 확인
                    </Button>
                  </div>
                ) : productNameExclusionsQuery.isError ? (
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div>
                        <p className="text-sm font-medium text-danger">
                          상품 연결 예외 기준을 확인하지 못했습니다.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {productNameExclusionsQuery.error instanceof Error
                            ? productNameExclusionsQuery.error.message
                            : '다시 확인한 뒤에 다음 단계로 갈 수 있습니다.'}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void productNameExclusionsQuery.refetch()
                      }}
                    >
                      다시 확인
                    </Button>
                  </div>
                ) : hasBackedUpMatch && backedUpMatch ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          이전 백업 제외 {formatNumber(backedUpMatch.orderCount)}
                          건 · {formatNumber(backedUpMatch.rowCount)}행
                          {backedUpExclusionAccepted
                            ? ` / 작업 대상 ${formatNumber(workRows.length)}행`
                            : ` / 원본 ${formatNumber(inspection.rowCount)}행`}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {backedUpExclusionAccepted
                            ? workRows.length === 0
                              ? '이번 파일의 모든 주문이 이전 백업과 같습니다. 진행할 주문이 없습니다.'
                              : '제외한 주문은 이후 모든 단계에서 빼 둡니다. 같은 주문의 다른 상품 행과 같은 합포장의 상품 연결 예외 행도 함께 빠집니다.'
                            : '제외할지 확인하기 전에는 다음 단계로 갈 수 없습니다.'}
                        </p>
                      </div>
                      {!backedUpExclusionAccepted ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setBackupDialogOpen(true)}
                        >
                          제외 확인
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {inspection.missingHeaders.length > 0 ? (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div>
                        <p className="text-sm font-medium text-danger">
                          사방넷 필수 항목을 찾지 못했습니다.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          빠진 항목: {inspection.missingHeaders.join(', ')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : inspection.blockingRowCount > 0 ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                      <div>
                        <p className="text-sm font-medium">
                          배송 정보를 확인해주세요.
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          수령인 없음 {inspection.missingRecipientCount}행 ·
                          연락처 없음 {inspection.missingPhoneCount}행 · 주소
                          없음 {inspection.missingAddressCount}행 · 수량 오류{' '}
                          {inspection.invalidQuantityCount}행
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-4">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    <div>
                      <p className="text-sm font-medium text-success">
                        사방넷 원본 파일로 확인했습니다.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        13개 필수 열과 배송 필수값이 모두 있습니다. 같은
                        주문번호의 추가 상품 행은{' '}
                        {inspection.repeatedOrderRowCount}행입니다.
                      </p>
                    </div>
                  </div>
                )}

                {headerReady && mallCategory ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <InvoiceFileCheckTransformWork
                      missingProductCodeCount={
                        inspection.missingProductCodeCount
                      }
                      nextStepLabel="이후 품목명·내품명 변환"
                    />
                    <InvoiceFileCheckMallWork
                      resolution={mallResolution}
                      partnersReady={mallPartnersReady}
                      partnersError={Boolean(
                        usageTargetsQuery.error || usageAliasesQuery.error || usageFoldersQuery.error,
                      )}
                      blockLabel="사은품 추가로 갈 수 없습니다."
                      onOpen={() => setMallDialogOpen(true)}
                    />
                  </div>
                ) : headerReady ? (
                  <p className="text-sm text-warning">출고업체 분류를 선택해야 다음 단계로 갈 수 있습니다.</p>
                ) : null}

                <SabangnetOrderTable
                  rows={
                    backedUpExclusionAccepted ? workRows : inspection.rows
                  }
                  columnCount={inspection.columnCount}
                  sourceRowCount={inspection.rowCount}
                  excludedOrderCount={
                    backedUpExclusionAccepted
                      ? (backedUpMatch?.orderCount ?? 0)
                      : 0
                  }
                  excludedRowCount={
                    backedUpExclusionAccepted
                      ? (backedUpMatch?.rowCount ?? 0)
                      : 0
                  }
                />

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={resetFile}>
                      <RotateCcw className="size-4" />
                      다른 파일 선택
                    </Button>
                    <StepSnapshotButton
                      stage="check"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={
                        backedUpExclusionAccepted ? workRows : inspection.rows
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!canLeaveFileCheck}
                    onClick={() => goNextStep('gift')}
                  >
                    사은품 추가로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}

            {backupDialogOpen && backedUpMatch ? (
              <InvoiceBackedUpOrderDialog
                orderCount={backedUpMatch.orderCount}
                rowCount={backedUpMatch.rowCount}
                workRowCount={Math.max(
                  0,
                  (inspection?.rowCount ?? 0) - backedUpMatch.rowCount,
                )}
                ready={preConfirmReady}
                onCancel={() => setBackupDialogOpen(false)}
                onConfirm={() => {
                  setBackedUpExclusionAccepted(true)
                  setBackupDialogOpen(false)
                }}
              />
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'gift'}
            keepMounted={
              visitedStepsRef.current.has('gift') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>사은품 추가</CardTitle>
                <CardDescription>
                  원본 품목명으로 대상을 확인하고, 합포장별로 사은품 행을
                  만듭니다. 사은품 이름은 품목명에만 들어갑니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!giftQueriesReady ||
                giftCompute.status === 'computing' ||
                !giftPlan ||
                !giftEligibilityPlan ? (
                  giftRequestsError ||
                  giftSourceMapsError ||
                  giftSourceAllocationsError ||
                  giftCompute.error ? (
                    <StepCriteriaError
                      message={
                        giftRequestsError ||
                        giftSourceMapsError ||
                        giftSourceAllocationsError ||
                        giftCompute.error ||
                        '사은품 추가를 계산하지 못했습니다.'
                      }
                      onRetry={() => {
                        void giftRequestsQuery.refetch()
                        void giftAllocationsQuery.refetch()
                        void giftSourceMapsQuery.refetch()
                        void giftSourceAllocationsQuery.refetch()
                        void productNameTagRolesQuery.refetch()
                      }}
                    />
                  ) : (
                    <StepCriteriaLoading
                      label={
                        giftQueriesReady
                          ? '이 파일의 사은품 추가를 계산하고 있습니다.'
                          : '이 브랜드의 사은품 기준을 불러오고 있습니다.'
                      }
                    />
                  )
                ) : (
                <InvoicePrefixStepPanel
                  brandId={brand.id}
                  rows={prefixRows}
                  requests={giftRequests}
                  existingAllocations={giftAllocations}
                  prefixPlan={giftEligibilityPlan}
                  giftPlan={giftPlan}
                  loading={false}
                  error={giftRequestsError}
                  resolutions={giftResolutions}
                  onResolve={(key, requestId) =>
                    setGiftResolutions((current) => ({
                      ...current,
                      [key]: requestId,
                    }))
                  }
                  giftSeed={giftSeed}
                  excludedGiftStyleIds={excludedGiftStyleIds}
                  onRedrawGifts={() => setGiftSeed(createGiftSeed())}
                  onToggleExcludeGift={(styleId) =>
                    setExcludedGiftStyleIds((current) =>
                      current.includes(styleId)
                        ? current.filter((id) => id !== styleId)
                        : [...current, styleId],
                    )
                  }
                  sourceFileName={fileName}
                />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('check')}
                    >
                      <ArrowLeft className="size-4" />
                      파일 확인으로
                    </Button>
                    <StepSnapshotButton
                      stage="gift"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={workRows}
                      giftPlan={giftPlan}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!giftPlan}
                    onClick={() => goNextStep('instruction')}
                  >
                    작업 지시로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'instruction'}
            keepMounted={
              visitedStepsRef.current.has('instruction') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>작업 지시</CardTitle>
                <CardDescription>
                  활성 지시의 완전일치·시작어를 확인합니다. 항상이면 모든
                  주문에, 기간이면 주문일시가 그 안인 행에만 붙습니다. 표시
                  문구는 자체품번 변환이 끝난 최종 품목명 앞에 붙습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {workInstructionsQuery.isLoading ||
                workCompute.status === 'computing' ||
                !workPlan ? (
                  workInstructionsError || workCompute.error ? (
                    <StepCriteriaError
                      message={
                        workInstructionsError ||
                        workCompute.error ||
                        '작업 지시를 계산하지 못했습니다.'
                      }
                      onRetry={() => {
                        void workInstructionsQuery.refetch()
                      }}
                    />
                  ) : (
                    <StepCriteriaLoading
                      label={
                        workInstructionsQuery.isSuccess
                          ? '이 파일의 작업 지시를 계산하고 있습니다.'
                          : '이 브랜드의 작업 지시를 불러오고 있습니다.'
                      }
                    />
                  )
                ) : (
                <InvoiceWorkInstructionStepPanel
                  rows={processRows}
                  instructions={workInstructions}
                  workPlan={workPlan}
                  loading={false}
                  error={workInstructionsError}
                />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('gift')}
                    >
                      <ArrowLeft className="size-4" />
                      사은품 추가로
                    </Button>
                    <StepSnapshotButton
                      stage="instruction"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={workRows}
                      giftPlan={giftPlan}
                      workPlan={workPlan}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={!workPlan}
                    onClick={() => goNextStep('product')}
                  >
                    품목명 변환하기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'product'}
            keepMounted={
              reachedProduct && Boolean(inspection) && headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>품목명 변환</CardTitle>
                <CardDescription>
                  원본 품목명을 본품 공식명으로 바꿉니다. 품목명·품목명+내품명·
                  옵션 일부 결합 다음에 내품명 /·, 앞부분 단독을 보고, 내품명
                  전체 단독이 맞으면 내품명을 비웁니다. 앞부분 단독이 맞으면
                  남은 옵션만 다음 단계로 넘깁니다. 자체상품코드는 이 단계
                  조회 키로 쓰지 않습니다. 세트 구성품은 이 단계부터 행을
                  펼칩니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {productStepBlock === 'loading' ? (
                  <StepCriteriaLoading
                    label={
                      productQueriesReady
                        ? '이 파일의 품목명 변환을 계산하고 있습니다.'
                        : '이 브랜드의 품목명 변환 기준을 불러오고 있습니다.'
                    }
                  />
                ) : productStepBlock === 'error' ? (
                  <StepCriteriaError
                    message={
                      productStepError ||
                      '품목명 변환을 계산하지 못했습니다.'
                    }
                    onRetry={retryProductStep}
                  />
                ) : productTransformation ? (
                  <>
                    {productStepError ? (
                      <StepCriteriaNotice
                        message={productStepError}
                        onRetry={retryProductStep}
                      />
                    ) : productCompute.status === 'computing' ? (
                      <p className="text-sm text-muted-foreground">
                        품목명 변환을 다시 계산하고 있습니다.
                      </p>
                    ) : null}
                    <InvoiceProductNameTransformPanel
                      key={`${fileName}:${workGeneration}`}
                      brandId={brand.id}
                      transformation={productTransformation}
                      rowKeyIndex={productRowKeyIndex ?? undefined}
                      tagRows={matchedProductTransformation?.rows}
                      renderUi={activeStep === 'product' && workspaceActive}
                      autoCollect={productAiAutoCollect}
                      autoCollectKey={`${fileName}:${workGeneration}`}
                      onAutoCollectProgress={handleProductAiProgress}
                      onAutoCollectSettled={handleProductAiSettled}
                      onBlockingSaveCountChange={setProductSaveBlockCount}
                      giftGroups={giftSourcePlan.groups}
                      onOpenGiftSetup={handleOpenGiftSetup}
                    />
                  </>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={productSaveBlockCount > 0}
                      onClick={() => setStep('instruction')}
                    >
                      <ArrowLeft className="size-4" />
                      작업 지시로
                    </Button>
                    <StepSnapshotButton
                      stage="product"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={workRows}
                      giftPlan={giftPlan}
                      workPlan={workPlan}
                      nameTransformation={nameTransformation}
                      productTransformation={productTransformation}
                      itemTransformation={itemTransformation}
                      resolveItemTransformation={computeItemTransformation}
                      disabled={
                        !productTransformation || productSaveBlockCount > 0
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={
                      !productTransformation || productSaveBlockCount > 0
                    }
                    onClick={() => goNextStep('item')}
                  >
                    내품명 변환하기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'item'}
            keepMounted={reachedItem && Boolean(inspection) && headerReady}
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>내품명 변환</CardTitle>
                <CardDescription>
                  공통 규칙 또는 조회 키 선택 규칙으로 내품명을 지거나 구성품
                  공식명으로 바꿉니다. 품목명 원장이 내품명 전체로 본품을 찾은
                  행은 빈 값으로 정리되어 여기 검토 목록에 나오지 않습니다.
                  내품명 / 또는 , 앞부분만으로 본품을 찾은 행은 남은 옵션만
                  여기서 변환합니다. 예전 조합 원장은 호환용으로만 읽습니다.
                  내품명 규칙의 M번호는 공식 내품명과 출고구성에만 넣고,
                  실제 세트 구성만 최종 CJ 행에서 펼칩니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {itemStepBlock === 'loading' ? (
                  <StepCriteriaLoading
                    label={
                      itemQueriesReady
                        ? '이 파일의 내품명 변환을 계산하고 있습니다.'
                        : '이 브랜드의 내품명 변환 기준을 불러오고 있습니다.'
                    }
                  />
                ) : itemStepBlock === 'error' ? (
                  <StepCriteriaError
                    message={
                      itemStepError || '내품명 변환을 계산하지 못했습니다.'
                    }
                    onRetry={retryItemStep}
                  />
                ) : itemTransformation ? (
                  <>
                    {itemStepError ? (
                      <StepCriteriaNotice
                        message={itemStepError}
                        onRetry={retryItemStep}
                      />
                    ) : itemCompute.status === 'computing' ? (
                      <p className="text-sm text-muted-foreground">
                        내품명 변환을 다시 계산하고 있습니다.
                      </p>
                    ) : null}
                    <InvoiceItemNameTransformPanel
                      key={`${fileName}:${workGeneration}`}
                      brandId={brand.id}
                      brandName={brand.name}
                      transformation={itemTransformation}
                      itemNameRules={itemNameRules}
                      accessoryRules={accessoryRules}
                      styles={productStyleLookupQuery.data ?? EMPTY_STYLE_REFS}
                      renderUi={activeStep === 'item' && workspaceActive}
                    />
                  </>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('product')}
                    >
                      <ArrowLeft className="size-4" />
                      품목명 변환으로
                    </Button>
                    <StepSnapshotButton
                      stage="item"
                      brandName={brand.name}
                      sourceFileName={fileName}
                      sourceRows={workRows}
                      giftPlan={giftPlan}
                      workPlan={workPlan}
                      nameTransformation={nameTransformation}
                      productTransformation={productTransformation}
                      itemTransformation={itemTransformation}
                      disabled={!itemTransformation}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={
                      !itemTransformation || !workPlan || !giftPlan
                    }
                    onClick={() => goNextStep('outboundReflect')}
                  >
                    출고반영으로
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'outboundReflect'}
            keepMounted={
              reachedOutboundReflect && Boolean(inspection) && headerReady
            }
          >
            {inspection ? (
              <Card>
                <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>(임시) 출고반영</CardTitle>
                    <CardDescription>
                      품목명·내품명 변환에서 나온 본품·내품을 M번호로 합친
                      목록입니다. 백업하면 각 주문의 주문일·출고업체로 출고
                      데이터에 넣습니다.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    disabled={
                      outboundBackupBusy ||
                      currentGenerationBackedUp ||
                      productSaveBlockCount > 0 ||
                      !outboundReflectLedger?.ok
                    }
                    onClick={() => {
                      void backupOutboundReflect()
                    }}
                  >
                    {outboundBackupBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {outboundBackupBusy
                      ? '백업 중...'
                      : currentGenerationBackedUp
                        ? '백업 완료'
                        : '백업'}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-5">
                  {outboundBackupMessage ? (
                    <p
                      className={
                        outboundBackupIsError
                          ? 'text-sm text-danger'
                          : 'text-sm text-muted-foreground'
                      }
                    >
                      {outboundBackupMessage}
                    </p>
                  ) : outboundReflectLedger && !outboundReflectLedger.ok ? (
                    <p className="text-sm text-danger">
                      {formatOutboundReflectBlockReasons(
                        outboundReflectLedger.reasons,
                      )}
                    </p>
                  ) : null}
                  {!productTransformation || !itemTransformation ? (
                    <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                  ) : outboundReflectSummary ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="outline">
                          {formatNumber(outboundReflectSummary.styleCount)}종
                        </Badge>
                        <Badge variant="outline">
                          {formatNumber(outboundReflectSummary.totalQuantity)}개
                        </Badge>
                        {outboundReflectSummary.firstOrderedOn &&
                        outboundReflectSummary.lastOrderedOn ? (
                          <span>
                            주문일 {outboundReflectSummary.firstOrderedOn}
                            {outboundReflectSummary.firstOrderedOn ===
                            outboundReflectSummary.lastOrderedOn
                              ? null
                              : ` ~ ${outboundReflectSummary.lastOrderedOn}`}
                          </span>
                        ) : null}
                      </div>
                      {outboundReflectSummary.entries.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                          변환된 상품이 없습니다.
                        </div>
                      ) : (
                        <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
                          <table className="w-full min-w-[640px] border-collapse text-xs">
                            <thead className="sticky top-0 z-10 bg-muted/90">
                              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                                <th className="border-b border-border px-3 py-2">
                                  M번호
                                </th>
                                <th className="border-b border-border px-3 py-2">
                                  공식 상품명
                                </th>
                                <th className="border-b border-border px-3 py-2 text-right">
                                  총합
                                </th>
                                <th className="border-b border-border px-3 py-2">
                                  주문일 첫날
                                </th>
                                <th className="border-b border-border px-3 py-2">
                                  주문일 마지막
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {outboundReflectSummary.entries.map((entry) => (
                                <tr
                                  key={entry.styleNo}
                                  className="border-b border-border/70"
                                >
                                  <td className="px-3 py-1.5 font-medium tabular-nums">
                                    {entry.styleNo}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {entry.styleName}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">
                                    {formatNumber(entry.quantity)}
                                  </td>
                                  <td className="px-3 py-1.5 tabular-nums">
                                    {entry.firstOrderedOn || '—'}
                                  </td>
                                  <td className="px-3 py-1.5 tabular-nums">
                                    {entry.lastOrderedOn || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep('item')}
                    >
                      <ArrowLeft className="size-4" />
                      내품명 변환으로
                    </Button>
                    <Button
                      type="button"
                      onClick={() => goNextStep('stock')}
                    >
                      재고·예약 보기
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'stock'}
            keepMounted={
              reachedStock && Boolean(inspection) && headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>재고·예약</CardTitle>
                <CardDescription>
                  단종·재고부족·예약발송 상품을 모아 이번 송장에서 제외할지
                  유지할지 정합니다. 제외한 상품은 이후 상품 리스트와 최종
                  행에서 빠집니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!itemTransformation || !workPlan || !giftPlan ? (
                  <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                ) : discontinuedStylesQuery.error || preorderHoldsQuery.error ? (
                  <StepCriteriaError
                    message={
                      (discontinuedStylesQuery.error instanceof Error
                        ? discontinuedStylesQuery.error.message
                        : null) ||
                      (preorderHoldsQuery.error instanceof Error
                        ? preorderHoldsQuery.error.message
                        : null) ||
                      '단종·예발 기준을 불러오지 못했습니다.'
                    }
                    onRetry={() => {
                      void discontinuedStylesQuery.refetch()
                      void preorderHoldsQuery.refetch()
                    }}
                  />
                ) : (
                  <InvoiceStockHoldStepPanel
                    key={`${fileName}:${workGeneration}`}
                    bundles={stockHoldBundles}
                    loading={
                      discontinuedStylesQuery.isLoading ||
                      preorderHoldsQuery.isLoading
                    }
                    onExcludedRowNumbersChange={handleStockHoldExcludedChange}
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('outboundReflect')}
                  >
                    <ArrowLeft className="size-4" />
                    출고반영으로
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      !itemTransformation || !workPlan || !giftPlan
                    }
                    onClick={() => goNextStep('list')}
                  >
                    상품 리스트 보기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'list'}
            keepMounted={
              visitedStepsRef.current.has('list') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>상품 리스트</CardTitle>
                <CardDescription>
                  선택한 품목(본품·세트 구성)·내품·사은품·포장재를 M번호로
                  합친 뒤 출고창고용·박스창고용 자리로 나눕니다. 같은 M번호는
                  강제우선 → 입고일 → 마지막 위치 순으로 자리를 채우고,
                  자리번호 오름차순으로 보여 줍니다. 출력 전에 비슷한 위치를
                  동선으로 묶어 A4를 미리 봅니다. 연습 창고를 읽기만 하며
                  재고를 차감하지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {listCompute.status === 'computing' ? (
                  <StepCriteriaLoading label="상품 리스트를 계산하고 있습니다." />
                ) : listCompute.error ? (
                  <StepCriteriaError
                    message={listCompute.error}
                    onRetry={() => {
                      void optionMapsQuery.refetch()
                      void itemNameRulesQuery.refetch()
                      void workOptionMapsQuery.refetch()
                      void workItemNameRulesQuery.refetch()
                      void accessoryRulesQuery.refetch()
                    }}
                  />
                ) : listCompute.result &&
                  productTransformation &&
                  itemTransformation &&
                  workPlan &&
                  giftPlan ? (
                  <InvoiceProductListStepPanel
                    brandId={brand.id}
                    productTransformation={productTransformation}
                    itemTransformation={itemTransformation}
                    workPlan={workPlan}
                    giftPlan={giftPlan}
                    outgoingRows={listCompute.result}
                  />
                ) : (
                  <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('stock')}
                  >
                    <ArrowLeft className="size-4" />
                    재고·예약으로
                  </Button>
                  <Button
                    type="button"
                    disabled={!listCompute.result}
                    onClick={() => goNextStep('output')}
                  >
                    최종 행 보기
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>

          <TodayStepPanel
            active={activeStep === 'output'}
            keepMounted={
              visitedStepsRef.current.has('output') &&
              Boolean(inspection) &&
              headerReady
            }
          >
            {inspection ? (
            <Card>
              <CardHeader>
                <CardTitle>최종 행</CardTitle>
                <CardDescription>
                  품목명과 내품명은 각 단계 결과를 마지막에만 합칩니다. 내품명
                  규칙의 M번호는 CJ 행을 늘리지 않고 출고구성에 반영합니다. 실제
                  세트로 등록한 행만 구성품 수만큼 CJ 행을 펼치고, 수령인·주소·
                  전화·주문번호는 그대로 복사합니다. 수량은 원본 내품수량 × 구성
                  수량입니다. 내품명 전체로 본품을 찾은 행은 빈 내품명을 유지하고,
                  앞부분만 쓴 행은 남은 옵션을 유지합니다. 변환 내품명을 저장하지
                  않은 나머지 행은 유효 내품명을 유지합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {outputCompute.status === 'computing' ? (
                  <StepCriteriaLoading label="최종 행을 계산하고 있습니다." />
                ) : outputCompute.error ? (
                  <StepCriteriaError
                    message={outputCompute.error}
                    onRetry={() => {
                      void workProductNameMapsQuery.refetch()
                      void optionMapsQuery.refetch()
                      void workOptionMapsQuery.refetch()
                      void workItemNameRulesQuery.refetch()
                    }}
                  />
                ) : outputCompute.result &&
                  productTransformation &&
                  itemTransformation &&
                  workPlan &&
                  giftPlan ? (
                <InvoiceOutputStepPanel
                  brandId={brand.id}
                  brandName={brand.name}
                  sourceFileName={fileName}
                  rows={processRows}
                  giftRequests={giftRequests}
                  giftResolutions={giftResolutions}
                  giftSeed={giftSeed}
                  excludedGiftStyleIds={excludedGiftStyleIds}
                  productTransformation={productTransformation}
                  itemTransformation={itemTransformation}
                  workPlan={workPlan}
                  giftPlan={giftPlan}
                  giftSourcePlan={giftSourcePlan}
                  baseProductTransformation={
                    excludedProductTransformation ?? undefined
                  }
                  mallResolution={mallResolution}
                  previewRows={outputCompute.result}
                  finalizeUnified={
                    giftEligibilityPlan && excludedProductTransformation
                      ? () =>
                          finalizeUnifiedGiftPlanForDownload({
                            brandId: brand.id,
                            rows: workRows,
                            campaignRows,
                            prefixPlan: giftEligibilityPlan,
                            requests: giftRequests,
                            giftPlan,
                            giftSourcePlan,
                            seed: giftSeed,
                            excludedGiftStyleIds,
                            sourceFileName: fileName,
                            tagRoles: deferredProductNameTagRoles,
                            sessionRules: giftSourceSessionRuleMap,
                            sessionAllocations: giftSourceSessionAllocationMap,
                            ignoredKeys: giftSourceIgnoredKeySet,
                            appliedKeys: giftSourceEffectiveAppliedKeys,
                          })
                      : undefined
                  }
                />
                ) : (
                  <StepCriteriaLoading label="이전 단계 결과를 기다리고 있습니다." />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('list')}
                  >
                    <ArrowLeft className="size-4" />
                    상품 리스트로
                  </Button>
                  <Button type="button" variant="outline" onClick={resetFile}>
                    <RotateCcw className="size-4" />
                    다른 파일 선택
                  </Button>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </TodayStepPanel>
        </div>
      ) : activeView === 'waiting' ? (
        <WaitingOrdersPanel />
      ) : activeView === 'rules' ? (
        <RulesPanel
          brandId={brand.id}
          brandName={brand.name}
          nameRules={nameRules}
          nameRulesLoading={nameRulesQuery.isPending}
          nameRulesError={nameRulesError}
          optionMaps={optionMaps}
          optionMapsLoading={optionMapsQuery.isPending}
          optionMapsError={optionMapsError}
          productNameMaps={rulesProductNameMaps}
          productNameMapsLoading={rulesProductNameMapsQuery.isPending}
          productNameMapsError={rulesProductNameMapsError}
          giftRequests={giftRequests}
          giftRequestsLoading={giftRequestsQuery.isPending}
          giftRequestsError={giftRequestsError}
          giftSourceMaps={giftSourceMaps}
          giftSourceMapsLoading={giftSourceMapsQuery.isPending}
          giftSourceMapsError={giftSourceMapsError}
          workInstructions={workInstructions}
          workInstructionsLoading={workInstructionsQuery.isPending}
          workInstructionsError={workInstructionsError}
        />
      ) : (
        <InvoiceWorkHistoryPanel brandId={brand.id} />
      )}

      {workspaceActive && mallDialogOpen && inspection && mallCategory ? (
        <InvoiceMallResolutionDialog
          key={mallCategoryKey}
          categoryKey={mallCategoryKey}
          categoryName={mallCategory.name}
          brandId={brand.id}
          brandSlug={brand.slug}
          sites={mallResolution.sites}
          targets={scopedUsageTargets}
          aliases={usageAliases}
          folders={usageFolders}
          onClose={() => setMallDialogOpen(false)}
        />
      ) : null}

      {workspaceActive && giftSetupGroup ? (
        <InvoiceGiftSetupDialog
          brandId={brand.id}
          group={giftSetupGroup}
          applying={giftSourceApplyingKey === giftSetupGroup.key}
          error={giftSourceError}
          existingRequests={giftRequests}
          onClose={() => {
            if (giftSourceApplyingKey) return
            setGiftSourceError(null)
            setGiftSetupTarget(null)
          }}
          onApplySession={(rule) => applyGiftSourceSession(giftSetupGroup, rule)}
          onApplyPersist={(rule) => {
            void applyGiftSourcePersist(giftSetupGroup, rule)
          }}
        />
      ) : null}
    </div>
  )
}
