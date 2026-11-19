import { normalizeStyleNo } from '@/lib/import/transform'

export type PopularLocationProduct = { name: string; styleNo: string }

export function popularProductEntries(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
}

export function popularProductAvailability(entries: readonly string[], products: readonly PopularLocationProduct[]) {
  const styles = new Set(products.filter(product => product.styleNo).map(product => normalizeStyleNo(product.styleNo)))
  const names = new Set(products.filter(product => product.name).map(product => product.name.normalize('NFKC').trim()))
  return entries.map(entry => ({
    entry,
    available: styles.has(normalizeStyleNo(entry)) || names.has(entry.normalize('NFKC').trim()),
  }))
}
