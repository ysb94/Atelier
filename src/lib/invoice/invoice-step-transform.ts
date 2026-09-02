import {
  overlayGiftSourceOnProductNames,
  catalogFromStyles,
  transformInvoiceProductNames,
  type InvoiceProductNameTransformation,
} from '@/lib/invoice/product-name-transform'
import { transformInvoiceItemNames, type InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
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
}

export type InvoiceProductNameStepResult = {
  base: InvoiceProductNameTransformation
  product: InvoiceProductNameTransformation
}

export type InvoiceItemNameStepInput = {
  sourceRows: SabangnetOrderRow[]
  optionMaps: InvoiceOptionMap[]
  productRows: InvoiceProductNameTransformRow[]
  itemNameRules: InvoiceItemNameRule[]
  accessoryRules: InvoiceAccessoryRule[]
  styles: StyleRef[]
}

export function runInvoiceProductNameStep(
  input: InvoiceProductNameStepInput,
): InvoiceProductNameStepResult {
  const base = transformInvoiceProductNames(
    input.sourceRows,
    input.maps,
    catalogFromStyles(input.styles),
    input.tagRoles,
    input.exclusions,
  )
  return {
    base,
    product: overlayGiftSourceOnProductNames(base, input.giftSourcePlan),
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
  )
}
