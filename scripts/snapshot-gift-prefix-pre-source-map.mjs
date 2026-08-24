import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const snapshot = {
  invoice_prefix_requests: [
    {
      id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      note: '',
      title: '[카카오선물하기] 8월 위시나우 사은품 증정',
      ends_at: '2026-08-31T23:59:00',
      task_no: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_active: true,
      mall_name: '카카오톡선물하기',
      starts_at: '2025-01-13T00:00:00',
      created_at: '2026-08-13T01:07:24.912994+00:00',
      updated_at: '2026-08-13T06:30:02.398838+00:00',
      count_basis: 'per_quantity',
      merge_basis: 'per_order',
      uses_first_come: false,
      normalized_mall_name: '카카오톡선물하기',
      first_come_limit_mode: 'per_style',
      first_come_total_limit: null,
    },
  ],
  invoice_prefix_items: [
    {
      id: 'be1f73a9-6e13-463f-9389-74fc7c3894f1',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: true,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '[단독] 마스마룰즈 래빗 에코백_32타입 택1',
      outgoing_product_names: [],
      normalized_product_name: '[단독] 마스마룰즈 래빗 에코백_32타입 택1',
    },
    {
      id: 'adf29758-ecec-4d1d-ae06-cf86268d8c87',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: false,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '[신상]마스마룰즈 나일론 쓰리웨이 벨티드 미니 호보백_블랙',
      outgoing_product_names: [],
      normalized_product_name: '[신상]마스마룰즈 나일론 쓰리웨이 벨티드 미니 호보백_블랙',
    },
    {
      id: '78249c4e-2719-4be7-a249-73baf3bb8611',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: false,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '[신상]마스마룰즈 리리 미니 토트백_5컬러 택1',
      outgoing_product_names: [],
      normalized_product_name: '[신상]마스마룰즈 리리 미니 토트백_5컬러 택1',
    },
    {
      id: '4125e6fe-8eab-4fbd-8e62-38c65ec8605e',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: true,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '마스마룰즈 나일론 투웨이 셔링 호보 백_10컬러',
      outgoing_product_names: [],
      normalized_product_name: '마스마룰즈 나일론 투웨이 셔링 호보 백_10컬러',
    },
    {
      id: '21d041e2-8d99-4cc4-b253-69fa6568ed2b',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: true,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '마스마룰즈 미니 데일리 백팩_6컬러',
      outgoing_product_names: [],
      normalized_product_name: '마스마룰즈 미니 데일리 백팩_6컬러',
    },
    {
      id: '4cdd3bad-e3c1-414f-862d-86f53c31cd20',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: true,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '마스마룰즈 스낵 에코 크로스백_11타입 택1',
      outgoing_product_names: [],
      normalized_product_name: '마스마룰즈 스낵 에코 크로스백_11타입 택1',
    },
    {
      id: '2c219c55-b987-420e-89e7-27255ea5ae15',
      prefix: '',
      brand_id: 'b0000000-0000-4000-8000-000000000001',
      is_random: false,
      created_at: '2026-08-13T06:30:02.600938+00:00',
      request_id: '8ff92e6e-4b83-4c91-b864-c7c00d68268c',
      updated_at: '2026-08-13T06:30:02.600938+00:00',
      product_name: '마스마룰즈 짐색 스트링 백_12컬러',
      outgoing_product_names: [],
      normalized_product_name: '마스마룰즈 짐색 스트링 백_12컬러',
    },
  ],
  invoice_prefix_item_products: [
    ['7fe917af-7693-4f83-ab90-0f0dfae43348', 'be1f73a9-6e13-463f-9389-74fc7c3894f1', '67d567f7-2077-4af0-8379-42a87e7acf46', 0],
    ['48a5976e-d06f-4d1f-b433-994ff32956ec', 'be1f73a9-6e13-463f-9389-74fc7c3894f1', '0f1523a3-53e4-4481-9bdd-3d93a4ca8289', 1],
    ['e0720ccc-7af9-420e-ac32-5ea6af2ff475', 'adf29758-ecec-4d1d-ae06-cf86268d8c87', 'fa163082-75e4-4a72-9099-97862f66ba79', 0],
    ['34787ce1-bc20-4fc1-85e9-d153a0913858', '78249c4e-2719-4be7-a249-73baf3bb8611', 'fa163082-75e4-4a72-9099-97862f66ba79', 0],
    ['45a552de-8a49-484f-917c-a94b8749bacc', '4125e6fe-8eab-4fbd-8e62-38c65ec8605e', '67d567f7-2077-4af0-8379-42a87e7acf46', 0],
    ['7cdd7f92-ac7a-4a0e-b04e-84dfe81e0ed6', '4125e6fe-8eab-4fbd-8e62-38c65ec8605e', '0f1523a3-53e4-4481-9bdd-3d93a4ca8289', 1],
    ['25839acb-5953-4d26-af1d-b21ccc773a1d', '21d041e2-8d99-4cc4-b253-69fa6568ed2b', 'fdf78d1f-38c8-41a0-aaad-26509f326abf', 0],
    ['f0ac9aac-35e2-486d-9131-cb24479bf60a', '21d041e2-8d99-4cc4-b253-69fa6568ed2b', '5e985a99-1c59-4fe4-a82b-72c49c09d95b', 1],
    ['050e7d1e-6ed4-492d-a104-3511f841c87a', '21d041e2-8d99-4cc4-b253-69fa6568ed2b', 'f0f7b63a-4e28-4daf-b29a-ca0bb22c4bfc', 2],
    ['5afcb0d0-e3dc-4ef5-97ab-9890cb202f96', '21d041e2-8d99-4cc4-b253-69fa6568ed2b', '93f91c0f-d392-4cdd-ab96-c4f79ffcbd37', 3],
    ['30ba2ca0-8dbc-4655-8bb4-75a60e205f10', '4cdd3bad-e3c1-414f-862d-86f53c31cd20', 'a847e0c2-d368-4bf8-9e03-99b90912f907', 0],
    ['6eea736d-8294-4984-ac32-5ea6af2ff54d', '4cdd3bad-e3c1-414f-862d-86f53c31cd20', 'b282e10d-34b4-4a11-ac19-780837b1164f', 1],
    ['16993c20-4062-4b7c-97bc-6a959f327c38', '4cdd3bad-e3c1-414f-862d-86f53c31cd20', 'fae48a43-c742-4a4c-9191-14f423f28c22', 2],
    ['ca578f4f-c25d-43cb-b005-2fabfb86a7f4', '4cdd3bad-e3c1-414f-862d-86f53c31cd20', '38fb7c7a-e8cd-44b7-8a56-42d9103f06ff', 3],
    ['4c1b277b-f617-4d09-9c48-addef1fb0cfe', '4cdd3bad-e3c1-414f-862d-86f53c31cd20', '9d6ded9c-ae6a-4b2e-b140-bb99b6ed60ff', 4],
    ['ea674e8f-a271-4081-8597-28bbc941168d', '2c219c55-b987-420e-89e7-27255ea5ae15', 'fa163082-75e4-4a72-9099-97862f66ba79', 0],
  ].map(([id, item_id, style_id, sort_order]) => ({
    id,
    item_id,
    style_id,
    sort_order,
    brand_id: 'b0000000-0000-4000-8000-000000000001',
    created_at: '2026-08-13T06:30:02.681304+00:00',
  })),
  invoice_gift_quotas: [],
  invoice_gift_allocations: [],
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'backups')
mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'gift-prefix-pre-gift-source-map-20260824.xlsx')

const workbook = XLSX.utils.book_new()
for (const [name, rows] of Object.entries(snapshot)) {
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31))
}
const counts = XLSX.utils.aoa_to_sheet([
  ['table', 'rows'],
  ['invoice_prefix_requests', snapshot.invoice_prefix_requests.length],
  ['invoice_prefix_items', snapshot.invoice_prefix_items.length],
  ['invoice_prefix_item_products', snapshot.invoice_prefix_item_products.length],
  ['invoice_gift_quotas', snapshot.invoice_gift_quotas.length],
  ['invoice_gift_allocations', snapshot.invoice_gift_allocations.length],
  ['taken_at', '2026-08-24'],
])
XLSX.utils.book_append_sheet(workbook, counts, 'counts')
writeFileSync(outFile, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(
  path.join(outDir, 'gift-prefix-pre-gift-source-map-20260824.counts.json'),
  `${JSON.stringify(
    {
      invoice_prefix_requests: 1,
      invoice_prefix_items: 7,
      invoice_prefix_item_products: 16,
      invoice_gift_quotas: 0,
      invoice_gift_allocations: 0,
      takenAt: '2026-08-24',
    },
    null,
    2,
  )}\n`,
)
console.log(`wrote ${outFile}`)
