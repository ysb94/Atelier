import {
  overlayGiftSourceOnProductNames,
  catalogFromStyles,
  transformInvoiceProductNames,
  buildProductNameCandidateRowIndex,
  buildProductNameRowKeyIndex,
  snapshotProductNameMaps,
  type InvoiceProductNameTransformation,
  type ProductNameCandidateRowIndex,
  type ProductNameLookupIndex,
  type ProductNameMapSnapshot,
  type ProductNameRowKeyIndex,
  type ProductNameStyleCatalog,
} from '@/lib/invoice/product-name-transform'
import {
  transformInvoiceItemNames,
  type InvoiceItemNameTransformation,
  type ItemNameTransformIndex,
} from '@/lib/invoice/item-name-transform'
import type { GiftSourcePlan } from '@/lib/invoice/gift-source-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import type {
  InvoiceAccessoryRule,
  InvoiceItemNameRule,
  InvoiceOptionMap,
  InvoiceProductNameExclusion,
  InvoiceProductNameMap,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

export type InvoiceProductNameStepInput = {
  sourceRows: SabangnetOrderRow[]
  maps: InvoiceProductNameMap[]
  styles: StyleRef[]
  tagRoles: InvoiceProductNameTagRoleEntry[]
  exclusions: InvoiceProductNameExclusion[]
  giftSourcePlan: GiftSourcePlan
  productLookupIndex?: ProductNameLookupIndex
  productCatalog?: ProductNameStyleCatalog
}

export type InvoiceProductNameStepResult = {
  base: InvoiceProductNameTransformation
  product: InvoiceProductNameTransformation
  rowKeyIndex: ProductNameRowKeyIndex
  mapSnapshot: ProductNameMapSnapshot
  candidateRowIndex: ProductNameCandidateRowIndex
}

export type InvoiceItemNameStepInput = {
  sourceRows: SabangnetOrderRow[]
  optionMaps: InvoiceOptionMap[]
  productRows: InvoiceProductNameTransformRow[]
  itemNameRules: InvoiceItemNameRule[]
  accessoryRules: InvoiceAccessoryRule[]
  styles: StyleRef[]
  itemNameIndex?: ItemNameTransformIndex
}

export function runInvoiceProductNameStep(
  input: InvoiceProductNameStepInput,
): InvoiceProductNameStepResult {
  const catalog = input.productCatalog ?? catalogFromStyles(input.styles)
  const base = transformInvoiceProductNames(
    input.sourceRows,
    input.maps,
    catalog,
    input.tagRoles,
    input.exclusions,
    input.productLookupIndex,
  )
  return {
    base,
    product: overlayGiftSourceOnProductNames(base, input.giftSourcePlan),
    rowKeyIndex: buildProductNameRowKeyIndex(base.rows),
    mapSnapshot: snapshotProductNameMaps(input.maps, input.tagRoles),
    candidateRowIndex: buildProductNameCandidateRowIndex(base.rows),
  }
}

export function runInvoiceItemNameStep(
  input: InvoiceItemNameStepInput,
): InvoiceItemNameTransformation {
  return transformInvoiceItemNames(
    input.sourceRows,
    input.optionMaps,
    input.productRows,
    input.itemNameRules,
    input.accessoryRules,
    input.styles,
    input.itemNameIndex,
  )
}
