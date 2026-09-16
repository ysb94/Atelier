/**
 * Firebase 스냅샷과 Supabase 적재 결과를 건수·FK·날짜·Storage 해시로 대조한다.
 * 하나라도 실패하면 종료 코드 1.
 *
 *   node scripts/masma-finder-migrate/verify-parity.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  ATELIER_BRAND_ID,
  countBy,
  duplicateKeys,
  expectedParityCounts,
  resolveSnapshotDir,
  sha256,
  writeJson,
} from './lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

async function fetchAll(client, table, columns, brandId) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq('brand_id', brandId)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

function failIf(failures, condition, message, extra) {
  if (condition) failures.push({ message, extra })
}

async function main() {
  const snapshotDir = resolveSnapshotDir(root)
  if (!snapshotDir) throw new Error('스냅샷이 없습니다.')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')

  const brandId = process.env.MASMA_FINDER_BRAND_ID || ATELIER_BRAND_ID
  const client = createClient(url, key, { auth: { persistSession: false } })
  const mapping = existsSync(path.join(snapshotDir, 'mapping.json'))
    ? readJson(path.join(snapshotDir, 'mapping.json'))
    : { counts: {}, users: {}, workTasks: {} }
  const storageManifest = existsSync(path.join(snapshotDir, 'storage', 'manifest.json'))
    ? readJson(path.join(snapshotDir, 'storage', 'manifest.json'))
    : { objects: [] }

  const firestoreFiles = {
    users: readJson(path.join(snapshotDir, 'firestore', 'users.json')),
    templates: readJson(path.join(snapshotDir, 'firestore', 'warehouses_works_templates.json')),
    workDays: readJson(path.join(snapshotDir, 'firestore', 'warehouses_works_daily.json')),
    incoming: readJson(path.join(snapshotDir, 'firestore', 'warehouse_incoming_lists.json')),
    drafts: readJson(path.join(snapshotDir, 'firestore', 'warehouses_move_drafts.json')),
    history: readJson(path.join(snapshotDir, 'firestore', 'warehouse_move_history.json')),
    scans: readJson(path.join(snapshotDir, 'firestore', 'label_scans.json')),
  }
  const authUsers = readJson(path.join(snapshotDir, 'auth-users.json')).users || []
  const expected = expectedParityCounts({
    authUsers,
    firestoreUsers: firestoreFiles.users.docs || [],
    templates: firestoreFiles.templates.docs || [],
    workDays: firestoreFiles.workDays.docs || [],
    incomingDays: firestoreFiles.incoming.docs || [],
    moveDrafts: firestoreFiles.drafts.docs || [],
    moveHistory: firestoreFiles.history.docs || [],
    labelScans: firestoreFiles.scans.docs || [],
    storageObjects: storageManifest.objects || [],
    taskIdByLegacy: mapping.workTasks || null,
  })

  const [
    users,
    templates,
    workDays,
    workTasks,
    attachments,
    incomingGroups,
    incomingItems,
    drafts,
    moveExports,
    moveExportRows,
    labelScans,
  ] = await Promise.all([
    fetchAll(client, 'masma_finder_users', 'id, email_normalized, legacy_firebase_uid, auth_user_id, status', brandId),
    fetchAll(client, 'masma_finder_work_templates', 'id, legacy_id', brandId),
    fetchAll(client, 'masma_finder_work_days', 'id, work_date', brandId),
    fetchAll(client, 'masma_finder_work_tasks', 'id, day_id, work_date, legacy_id', brandId),
    fetchAll(client, 'masma_finder_work_attachments', 'id, task_id, legacy_object_path, sha256, byte_size, storage_path', brandId),
    fetchAll(client, 'masma_finder_incoming_groups', 'id, work_date, legacy_group_id', brandId),
    fetchAll(client, 'masma_finder_incoming_items', 'id, group_id, work_date, legacy_id', brandId),
    fetchAll(client, 'masma_finder_move_drafts', 'id, finder_user_id', brandId),
    fetchAll(client, 'masma_finder_move_exports', 'id, work_date, legacy_id', brandId),
    fetchAll(client, 'masma_finder_move_export_rows', 'id, export_id', brandId),
    fetchAll(client, 'masma_finder_label_scans', 'id', brandId),
  ])

  const supabase = {
    users: users.length,
    templates: templates.length,
    workDays: workDays.length,
    workTasks: workTasks.length,
    attachments: attachments.length,
    incomingGroups: incomingGroups.length,
    incomingItems: incomingItems.length,
    drafts: drafts.length,
    moveExports: moveExports.length,
    moveExportRows: moveExportRows.length,
    labelScans: labelScans.length,
  }

  const failures = []
  const countKeys = [
    'templates',
    'workDays',
    'workTasks',
    'attachments',
    'incomingGroups',
    'incomingItems',
    'moveExports',
    'moveExportRows',
    'labelScans',
  ]
  for (const key of countKeys) {
    failIf(
      failures,
      supabase[key] < expected[key],
      `${key} 건수가 스냅샷보다 적습니다`,
      { expected: expected[key], supabase: supabase[key] },
    )
  }
  failIf(
    failures,
    supabase.users < expected.users,
    '사용자 이메일이 스냅샷보다 적습니다',
    { expected: expected.users, supabase: supabase.users },
  )

  const userEmails = new Set(users.map((row) => row.email_normalized))
  const missingEmails = []
  for (const user of authUsers) {
    const email = String(user.email || '').trim().toLowerCase()
    if (email && !userEmails.has(email)) missingEmails.push(email)
  }
  for (const doc of firestoreFiles.users.docs || []) {
    const email = String(doc.data?.email || '').trim().toLowerCase()
    if (email && !userEmails.has(email)) missingEmails.push(email)
  }
  failIf(failures, missingEmails.length > 0, '스냅샷 이메일이 Supabase에 없습니다', missingEmails.slice(0, 20))

  const dayIds = new Set(workDays.map((row) => row.id))
  const taskIds = new Set(workTasks.map((row) => row.id))
  const groupIds = new Set(incomingGroups.map((row) => row.id))
  const exportIds = new Set(moveExports.map((row) => row.id))
  const userIds = new Set(users.map((row) => row.id))

  const orphanTasks = workTasks.filter((row) => !dayIds.has(row.day_id))
  const orphanAttachments = attachments.filter((row) => !taskIds.has(row.task_id))
  const orphanItems = incomingItems.filter((row) => !groupIds.has(row.group_id))
  const orphanExportRows = moveExportRows.filter((row) => !exportIds.has(row.export_id))
  const orphanDrafts = drafts.filter((row) => !userIds.has(row.finder_user_id))

  failIf(failures, orphanTasks.length > 0, 'day_id FK가 없는 업무가 있습니다', orphanTasks.length)
  failIf(failures, orphanAttachments.length > 0, 'task_id FK가 없는 첨부가 있습니다', orphanAttachments.length)
  failIf(failures, orphanItems.length > 0, 'group_id FK가 없는 입고 항목이 있습니다', orphanItems.length)
  failIf(failures, orphanExportRows.length > 0, 'export_id FK가 없는 이동 행이 있습니다', orphanExportRows.length)
  failIf(failures, orphanDrafts.length > 0, 'finder_user_id FK가 없는 초안이 있습니다', orphanDrafts.length)

  const supabaseTasksByDate = countBy(workTasks, (row) => row.work_date)
  for (const [date, count] of Object.entries(expected.workTasksByDate)) {
    failIf(
      failures,
      (supabaseTasksByDate[date] || 0) < count,
      `${date} 업무 건수가 스냅샷보다 적습니다`,
      { expected: count, supabase: supabaseTasksByDate[date] || 0 },
    )
  }
  const supabaseIncomingByDate = countBy(incomingItems, (row) => row.work_date)
  for (const [date, info] of Object.entries(expected.incomingByDate)) {
    failIf(
      failures,
      (supabaseIncomingByDate[date] || 0) < info.items,
      `${date} 입고 항목이 스냅샷보다 적습니다`,
      { expected: info.items, supabase: supabaseIncomingByDate[date] || 0 },
    )
  }
  const supabaseExportsByDate = countBy(moveExports, (row) => row.work_date)
  for (const [date, info] of Object.entries(expected.moveExportsByDate)) {
    failIf(
      failures,
      (supabaseExportsByDate[date] || 0) < info.exports,
      `${date} 자리이동 이력이 스냅샷보다 적습니다`,
      { expected: info.exports, supabase: supabaseExportsByDate[date] || 0 },
    )
  }

  const duplicateAttachmentPaths = duplicateKeys(
    attachments,
    (row) => row.legacy_object_path,
  )
  failIf(
    failures,
    duplicateAttachmentPaths.length > 0,
    '같은 legacy_object_path 첨부가 두 행입니다',
    duplicateAttachmentPaths.slice(0, 20),
  )

  const byPath = new Map(
    attachments
      .filter((row) => row.legacy_object_path)
      .map((row) => [row.legacy_object_path, row]),
  )
  const hashMismatches = []
  for (const object of storageManifest.objects || []) {
    const taskLegacy = String(object.path || '').split('/')[1] || ''
    if (mapping.workTasks && !mapping.workTasks[taskLegacy]) continue
    const row = byPath.get(object.path)
    if (!row) {
      hashMismatches.push({ path: object.path, reason: 'missing-row' })
      continue
    }
    if (row.sha256 && row.sha256 !== object.sha256) {
      hashMismatches.push({ path: object.path, reason: 'hash' })
    }
    if (Number(row.byte_size) !== Number(object.size)) {
      hashMismatches.push({ path: object.path, reason: 'size' })
    }
    if (!row.storage_path) {
      hashMismatches.push({ path: object.path, reason: 'missing-storage-path' })
      continue
    }
    const { data, error } = await client.storage
      .from('masma-finder-works')
      .download(row.storage_path)
    if (error || !data) {
      hashMismatches.push({ path: object.path, reason: 'missing-object', storagePath: row.storage_path })
      continue
    }
    const buffer = Buffer.from(await data.arrayBuffer())
    const digest = sha256(buffer)
    if (digest !== object.sha256) {
      hashMismatches.push({
        path: object.path,
        reason: 'object-hash',
        expected: object.sha256,
        actual: digest,
      })
    }
    if (buffer.length !== Number(object.size)) {
      hashMismatches.push({
        path: object.path,
        reason: 'object-size',
        expected: object.size,
        actual: buffer.length,
      })
    }
  }
  failIf(failures, hashMismatches.length > 0, '첨부 해시/바이트가 원본과 다릅니다', hashMismatches.slice(0, 20))

  const report = {
    verifiedAt: new Date().toISOString(),
    snapshotDir,
    expected,
    supabase,
    imported: mapping.counts || {},
    storage: {
      snapshotObjects: (storageManifest.objects || []).length,
      snapshotBytes: (storageManifest.objects || []).reduce((sum, item) => sum + item.size, 0),
      hashMismatches: hashMismatches.length,
    },
    failures,
  }
  writeJson(path.join(snapshotDir, 'verify-report.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (failures.length > 0) {
    console.error('[masma-finder-verify] 실패', failures)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[masma-finder-verify] 실패', error)
  process.exit(1)
})
