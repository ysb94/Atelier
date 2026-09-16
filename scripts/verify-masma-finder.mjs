import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  ['supabase/migrations/20260916180000_masma_finder_access.sql', [
    'masma_finder_users',
    'app.can_use_masma_finder',
    'app.can_access_warehouse_finder',
    'claim_masma_finder_session',
    'list_masma_finder_users',
    'set_masma_finder_user_status',
  ]],
  ['supabase/migrations/20260916181000_masma_finder_works.sql', [
    'masma_finder_work_tasks',
    'masma_finder_incoming_groups',
    'masma_finder_move_exports',
    'masma_finder_label_scans',
    'register_masma_finder_work_attachment',
    'lookup_masma_finder_style',
  ]],
  ['supabase/migrations/20260916182000_masma_finder_storage.sql', [
    'masma-finder-works',
    'brands/',
  ]],
  ['supabase/migrations/20260916183000_masma_finder_warehouse_access.sql', [
    'app.can_access_warehouse_finder',
  ]],
  ['scripts/masma-finder-migrate/mapping.md', [
    'legacy_firebase_uid',
    'works_attachments',
    'products.onhand',
    'legacy_object_path',
  ]],
  ['scripts/masma-finder-migrate/backup-supabase.mjs', [
    'masma_finder_work_tasks',
    'masma-finder-works',
  ]],
  ['scripts/masma-finder-migrate/verify-parity.mjs', [
    'hashMismatches',
    'day_id FK',
    'legacy_object_path',
  ]],
  ['masma_finder/src/lib/works/MasmaWorksDataProvider.js', [
    'WORKS_REALTIME_TABLES',
    'watchIncomingDate',
  ]],
  ['masma_finder/src/lib/works/realtime.js', [
    'masma-works-shared',
    'subscribe',
  ]],
  ['supabase/migrations/20260916184000_masma_finder_attachment_legacy_path.sql', [
    'masma_finder_work_attachments_legacy_path_uidx',
  ]],
  ['supabase/migrations/20260916185000_masma_finder_service_role.sql', [
    'service_role',
  ]],
]

let failed = false
for (const [relative, needles] of required) {
  const text = readFileSync(path.join(root, relative), 'utf8')
  const missing = needles.filter((needle) => !text.includes(needle))
  if (missing.length > 0) {
    failed = true
    console.error(`[masma-finder] ${relative} 누락: ${missing.join(', ')}`)
  }
}

if (failed) process.exit(1)
console.log('[masma-finder] 스키마·매핑 문구 확인')
