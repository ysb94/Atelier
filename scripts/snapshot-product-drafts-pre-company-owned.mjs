import { writeFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const xlsxPath = path.join(
  root,
  'docs',
  'backups',
  'product-drafts-pre-company-owned-20260908.xlsx',
)

const drafts = [
  {
    id: '1442572c-b8b2-4d57-9807-09ba9a96accb',
    brand_id: 'b0000000-0000-4000-8000-000000000001',
    season_id: null,
    draft_no: 'PL-0002',
    status: 'open',
    owner: '김기획',
    name_ko: '준영 레더 가방',
    name_en: "Joon's Leather",
    image_url: '[omitted data url]',
    sample_done: true,
    order_done: false,
    photo_sample_done: false,
    held: false,
    hold_reason: '',
    held_at: null,
    target_cost: null,
    cost_currency: 'CNY',
    cost_confirmed: false,
    retail_price: null,
    discount_price: null,
    origin_country: '중국 OEM',
    register_type: '모음등록',
    open_type: '단독오픈',
    open_type_detail: '자사몰',
    release_issue: '',
    has_options: false,
    note: '',
    promoted_style_id: null,
    created_at: '2026-09-07 07:13:12.447501+00',
    updated_at: '2026-09-07 07:16:17.434306+00',
  },
]

const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(drafts),
  'product_drafts',
)
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([{ _empty: true }]),
  'draft_colors',
)
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([{ _empty: true }]),
  'draft_options',
)
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      last_value: 2,
      updated_at: '2026-09-07 07:13:12.447501+00',
    },
  ]),
  'draft_sequences',
)

writeFileSync(xlsxPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
console.log(`wrote ${xlsxPath}`)
