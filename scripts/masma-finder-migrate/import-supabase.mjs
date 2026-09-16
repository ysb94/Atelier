/**
 * Firebase 스냅샷을 기존 Atelier Finder 테이블·Storage로 병합 적재한다.
 * 사용자는 이메일, 업무 일자는 (brand_id, work_date), 첨부는
 * legacy_object_path/해시 기준으로 합친다. 기존 승인·auth_user_id는 유지한다.
 *
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MASMA_FINDER_SNAPSHOT   outputs/masma-finder-snapshots/<stamp>
 *   MASMA_FINDER_BRAND_ID   기본 atelier
 *
 *   node scripts/masma-finder-migrate/import-supabase.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  ATELIER_BRAND_ID,
  attachmentKind,
  mergeAttachments,
  mergeByNaturalKey,
  mergeFinderUsers,
  normalizeEmail,
  preferExistingIfNewer,
  resolveSnapshotDir,
  toIso,
  uuidFromLegacy,
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

async function upsert(client, table, rows, onConflict = 'id') {
  if (!rows.length) return 0
  const chunkSize = 200
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await client.from(table).upsert(chunk, { onConflict })
    if (error) throw new Error(`${table} 적재 실패: ${error.message}`)
  }
  return rows.length
}

function walkDocs(docs, visit) {
  for (const doc of docs || []) visit(doc)
}

function toIncomingItem(item, { brandId, groupId, workDate, isLegacyFlat, users }) {
  return {
    id: uuidFromLegacy('masma-finder-iitem', `${workDate}:${groupId}:${item.id}`),
    brand_id: brandId,
    group_id: groupId,
    work_date: workDate,
    is_legacy_flat: isLegacyFlat,
    product_name: item.data?.productName || '',
    model_name: item.data?.modelName || '',
    units_per_box: item.data?.unitsPerBox ?? null,
    box_count: item.data?.boxCount ?? null,
    total_quantity: item.data?.totalQuantity ?? null,
    location: item.data?.location || '',
    loading_method: item.data?.loadingMethod || '',
    memo: item.data?.memo || '',
    shipment_date: item.data?.shipmentDate || '',
    recent_location: item.data?.recentLocation || '',
    recent_location_box_count: item.data?.recentLocationBoxCount ?? null,
    edited_recent_location: item.data?.editedRecentLocation || '',
    edited_recent_location_box_count: item.data?.editedRecentLocationBoxCount ?? null,
    import_batch_id: item.data?.importBatchId || '',
    import_row: item.data?.importRow ?? null,
    split_from_id: item.data?.splitFromId || null,
    created_by: users[item.data?.createdByUid] || null,
    created_by_name: item.data?.createdByName || '',
    created_by_legacy_uid: item.data?.createdByUid || null,
    updated_by_name: item.data?.updatedByName || '',
    created_at: toIso(item.data?.createdAt) || new Date().toISOString(),
    updated_at: toIso(item.data?.updatedAt) || new Date().toISOString(),
    legacy_id: item.id,
  }
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  }

  const brandId = process.env.MASMA_FINDER_BRAND_ID || ATELIER_BRAND_ID
  const snapshotDir = resolveSnapshotDir(root)
  if (!snapshotDir || !existsSync(snapshotDir)) {
    throw new Error('스냅샷 폴더가 없습니다. 먼저 export-firebase.mjs를 실행하세요.')
  }
  const client = createClient(url, key, { auth: { persistSession: false } })

  const [
    existingUsers,
    existingDays,
    existingTasks,
    existingAttachments,
    existingGroups,
    existingItems,
    existingDrafts,
    existingExports,
    existingExportRows,
    existingTemplates,
    existingScans,
  ] = await Promise.all([
    fetchAll(client, 'masma_finder_users', '*', brandId),
    fetchAll(client, 'masma_finder_work_days', 'id, brand_id, work_date, created_at', brandId),
    fetchAll(client, 'masma_finder_work_tasks', 'id, brand_id, legacy_id, work_date, updated_at, created_at', brandId),
    fetchAll(client, 'masma_finder_work_attachments', 'id, brand_id, legacy_object_path, storage_path, sha256, created_by, created_by_name, created_at', brandId),
    fetchAll(client, 'masma_finder_incoming_groups', 'id, brand_id, work_date, legacy_group_id, updated_at, created_at', brandId),
    fetchAll(client, 'masma_finder_incoming_items', 'id, brand_id, legacy_id, group_id, work_date, updated_at, created_at', brandId),
    fetchAll(client, 'masma_finder_move_drafts', 'id, brand_id, finder_user_id, legacy_firebase_uid, updated_at', brandId),
    fetchAll(client, 'masma_finder_move_exports', 'id, brand_id, legacy_id, work_date, created_at', brandId),
    fetchAll(client, 'masma_finder_move_export_rows', 'id, export_id, sort_order, created_at', brandId),
    fetchAll(client, 'masma_finder_work_templates', 'id, legacy_id, updated_at, created_at', brandId),
    fetchAll(client, 'masma_finder_label_scans', 'id, created_at', brandId),
  ])

  const authUsers = readJson(path.join(snapshotDir, 'auth-users.json')).users || []
  const firestoreUsers = readJson(path.join(snapshotDir, 'firestore', 'users.json')).docs || []
  const userByUid = new Map(firestoreUsers.map((doc) => [doc.id, doc.data || {}]))

  const incomingUsers = []
  const seenEmail = new Set()
  const rememberUser = (uid, email, fields) => {
    if (!email) return
    incomingUsers.push({
      id: uuidFromLegacy('masma-finder-user', email),
      brand_id: brandId,
      auth_user_id: null,
      email_normalized: email,
      legacy_firebase_uid: uid || null,
      ...fields,
    })
  }

  for (const authUser of authUsers) {
    const firestore = userByUid.get(authUser.uid) || {}
    const email = normalizeEmail(firestore.email || authUser.email)
    if (!email || seenEmail.has(email)) {
      if (email && authUser.uid) {
        incomingUsers.push({
          id: uuidFromLegacy('masma-finder-user', email),
          brand_id: brandId,
          email_normalized: email,
          legacy_firebase_uid: authUser.uid,
          display_name: firestore.displayName || authUser.displayName || email,
          photo_url: firestore.photoURL || authUser.photoURL || null,
          status: firestore.masma_finder === true ? 'active' : 'pending',
          is_admin: firestore.masma_finder_administrator === true,
          last_login_at: toIso(firestore.lastLoginAt) || authUser.lastSignInAt,
          created_at: toIso(firestore.createdAt) || authUser.createdAt || new Date().toISOString(),
        })
      }
      continue
    }
    seenEmail.add(email)
    rememberUser(authUser.uid, email, {
      display_name: firestore.displayName || authUser.displayName || email,
      photo_url: firestore.photoURL || authUser.photoURL || null,
      status: firestore.masma_finder === true ? 'active' : 'pending',
      is_admin: firestore.masma_finder_administrator === true,
      last_login_at: toIso(firestore.lastLoginAt) || authUser.lastSignInAt,
      created_at: toIso(firestore.createdAt) || authUser.createdAt || new Date().toISOString(),
    })
  }
  for (const doc of firestoreUsers) {
    const email = normalizeEmail(doc.data?.email)
    if (!email) continue
    incomingUsers.push({
      id: uuidFromLegacy('masma-finder-user', email),
      brand_id: brandId,
      auth_user_id: null,
      email_normalized: email,
      legacy_firebase_uid: doc.id,
      display_name: doc.data?.displayName || email,
      photo_url: doc.data?.photoURL || null,
      status: doc.data?.masma_finder === true ? 'active' : 'pending',
      is_admin: doc.data?.masma_finder_administrator === true,
      last_login_at: toIso(doc.data?.lastLoginAt),
      created_at: toIso(doc.data?.createdAt) || new Date().toISOString(),
    })
  }

  const mergedUsers = mergeFinderUsers(incomingUsers, existingUsers)
  await upsert(client, 'masma_finder_users', mergedUsers.rows)

  const incomingTemplates = (readJson(path.join(snapshotDir, 'firestore', 'warehouses_works_templates.json')).docs || []).map((doc) => ({
    id: uuidFromLegacy('masma-finder-template', doc.id),
    brand_id: brandId,
    title: doc.data?.title || '',
    type: doc.data?.type === 'inbound' ? 'inbound' : 'daily',
    created_at: toIso(doc.data?.createdAt) || new Date().toISOString(),
    updated_at: toIso(doc.data?.updatedAt) || toIso(doc.data?.createdAt) || new Date().toISOString(),
    legacy_id: doc.id,
  }))
  const existingTemplateByLegacy = new Map(
    existingTemplates.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row]),
  )
  const templates = incomingTemplates.map((row) =>
    preferExistingIfNewer(existingTemplateByLegacy.get(row.legacy_id), row),
  )
  await upsert(client, 'masma_finder_work_templates', templates)

  const incomingDays = []
  const incomingTasks = []
  const firestoreAttachments = []
  walkDocs(readJson(path.join(snapshotDir, 'firestore', 'warehouses_works_daily.json')).docs || [], (day) => {
    incomingDays.push({
      id: uuidFromLegacy('masma-finder-day', day.id),
      brand_id: brandId,
      work_date: day.id,
      has_inbound: day.data?.hasInbound === true,
      created_at: toIso(day.data?.createdAt) || new Date().toISOString(),
    })
    for (const task of day.children?.tasks || []) {
      incomingTasks.push({
        id: uuidFromLegacy('masma-finder-task', `${day.id}:${task.id}`),
        brand_id: brandId,
        day_id: null,
        work_date: day.id,
        title: task.data?.title || '',
        type: task.data?.type || 'adhoc',
        status: task.data?.status || 'pending',
        due_date: task.data?.dueDate || null,
        is_urgent: task.data?.isUrgent === true,
        memo: task.data?.memo || null,
        memo_updated_at: toIso(task.data?.memoUpdatedAt),
        skip_reason: task.data?.skipReason || null,
        skipped_at: toIso(task.data?.skippedAt),
        started_at: toIso(task.data?.startedAt),
        started_by_name: task.data?.startedBy || '',
        started_by: mergedUsers.idByLegacyUid[task.data?.startedByUid] || null,
        started_by_legacy_uid: task.data?.startedByUid || null,
        completed_at: toIso(task.data?.completedAt),
        worker_name: task.data?.workerName || '',
        worker_id: mergedUsers.idByLegacyUid[task.data?.workerUid] || null,
        worker_legacy_uid: task.data?.workerUid || null,
        completion_note: task.data?.completionNote || null,
        completion_note_updated_at: toIso(task.data?.completionNoteUpdatedAt),
        created_by: mergedUsers.idByLegacyUid[task.data?.createdByUid] || null,
        created_by_name: task.data?.createdByName || '',
        created_by_legacy_uid: task.data?.createdByUid || null,
        created_at: toIso(task.data?.createdAt) || new Date().toISOString(),
        updated_at: toIso(task.data?.updatedAt) || toIso(task.data?.createdAt) || new Date().toISOString(),
        legacy_id: task.id,
        __dayKey: day.id,
      })
      const lists = [
        [task.data?.attachments, 'normal'],
        [task.data?.completionAttachments, 'completion'],
      ]
      for (const [items, kind] of lists) {
        for (const item of items || []) {
          firestoreAttachments.push({
            taskLegacyId: task.id,
            attachmentLegacyId: item.id || `${kind}:${item.path || item.name || 'unnamed'}`,
            kind,
            original_name: item.name || 'attachment',
            byte_size: Number(item.size) || 0,
            content_type: item.contentType || 'application/octet-stream',
            path: item.path || '',
            legacy_object_path: item.path || '',
            created_by: mergedUsers.idByLegacyUid[item.createdByUid] || null,
            created_by_name: item.createdBy || '',
            created_at: toIso(item.createdAt) || new Date().toISOString(),
          })
        }
      }
    }
  })

  const mergedDays = mergeByNaturalKey(
    incomingDays,
    existingDays,
    (row) => `${row.brand_id}:${row.work_date}`,
  )
  const workDays = mergedDays.rows
  const dayIdByDate = Object.fromEntries(
    workDays.map((row) => [row.work_date, row.id]),
  )
  await upsert(client, 'masma_finder_work_days', workDays)

  const existingTaskByLegacy = new Map(
    existingTasks.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row]),
  )
  const workTasks = incomingTasks.map((task) => {
    const merged = preferExistingIfNewer(existingTaskByLegacy.get(task.legacy_id), task)
    return {
      ...merged,
      day_id: dayIdByDate[task.__dayKey] || merged.day_id,
      __dayKey: undefined,
    }
  })
  const taskIdByLegacy = Object.fromEntries(workTasks.map((row) => [row.legacy_id, row.id]))
  await upsert(
    client,
    'masma_finder_work_tasks',
    workTasks.map(({ __dayKey, ...row }) => row),
  )

  const incomingGroups = []
  const incomingItems = []
  walkDocs(readJson(path.join(snapshotDir, 'firestore', 'warehouse_incoming_lists.json')).docs || [], (day) => {
    const groups = day.children?.groups || []
    for (const group of groups) {
      incomingGroups.push({
        id: uuidFromLegacy('masma-finder-igroup', `${day.id}:${group.id}`),
        brand_id: brandId,
        work_date: day.id,
        legacy_group_id: group.id,
        label: group.data?.label || group.data?.source || '입고 묶음',
        source: group.data?.source || group.data?.label || '',
        expected_time: group.data?.expectedTime || '',
        memo: group.data?.memo || '',
        status: group.data?.status || 'planned',
        kind: group.data?.kind || '',
        is_legacy: false,
        entry_completed: group.data?.entryCompleted === true,
        apply_completed: group.data?.applyCompleted === true,
        created_by: mergedUsers.idByLegacyUid[group.data?.createdByUid] || null,
        created_by_name: group.data?.createdByName || '',
        created_by_legacy_uid: group.data?.createdByUid || null,
        updated_by_name: group.data?.updatedByName || '',
        created_at: toIso(group.data?.createdAt) || new Date().toISOString(),
        updated_at: toIso(group.data?.updatedAt) || new Date().toISOString(),
      })
    }

    const legacyItems = day.children?.items || []
    if (legacyItems.length > 0) {
      incomingGroups.push({
        id: uuidFromLegacy('masma-finder-igroup', `${day.id}:__legacy__`),
        brand_id: brandId,
        work_date: day.id,
        legacy_group_id: '__legacy__',
        label: '기존 입고',
        source: '',
        expected_time: '',
        memo: '이전 형식의 입고 리스트입니다.',
        status: 'planned',
        kind: '',
        is_legacy: true,
        entry_completed: false,
        apply_completed: false,
        created_by_name: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  })

  const mergedGroups = mergeByNaturalKey(
    incomingGroups,
    existingGroups,
    (row) => `${row.brand_id}:${row.work_date}:${row.legacy_group_id || row.id}`,
  )
  await upsert(client, 'masma_finder_incoming_groups', mergedGroups.rows)
  const groupIdByKey = mergedGroups.idByKey

  walkDocs(readJson(path.join(snapshotDir, 'firestore', 'warehouse_incoming_lists.json')).docs || [], (day) => {
    for (const group of day.children?.groups || []) {
      const groupId = groupIdByKey[`${brandId}:${day.id}:${group.id}`]
      for (const item of group.children?.items || []) {
        incomingItems.push(toIncomingItem(item, {
          brandId,
          groupId,
          workDate: day.id,
          isLegacyFlat: false,
          users: mergedUsers.idByLegacyUid,
        }))
      }
    }
    const legacyItems = day.children?.items || []
    if (legacyItems.length > 0) {
      const groupId = groupIdByKey[`${brandId}:${day.id}:__legacy__`]
      for (const item of legacyItems) {
        incomingItems.push(toIncomingItem(item, {
          brandId,
          groupId,
          workDate: day.id,
          isLegacyFlat: true,
          users: mergedUsers.idByLegacyUid,
        }))
      }
    }
  })
  const existingItemByLegacy = new Map(
    existingItems.filter((row) => row.legacy_id).map((row) => [`${row.work_date}:${row.legacy_id}`, row]),
  )
  const items = incomingItems.map((row) =>
    preferExistingIfNewer(existingItemByLegacy.get(`${row.work_date}:${row.legacy_id}`), row),
  )
  await upsert(client, 'masma_finder_incoming_items', items)

  const incomingDrafts = (readJson(path.join(snapshotDir, 'firestore', 'warehouses_move_drafts.json')).docs || [])
    .map((doc) => ({
      id: uuidFromLegacy('masma-finder-draft', doc.id),
      brand_id: brandId,
      finder_user_id: mergedUsers.idByLegacyUid[doc.id] || null,
      legacy_firebase_uid: doc.id,
      items: Array.isArray(doc.data?.items) ? doc.data.items : [],
      updated_by_name: doc.data?.updatedByName || '',
      updated_at: toIso(doc.data?.updatedAt) || new Date().toISOString(),
    }))
    .filter((row) => row.finder_user_id)
  const existingDraftByUser = new Map(existingDrafts.map((row) => [row.finder_user_id, row]))
  const drafts = incomingDrafts.map((row) =>
    preferExistingIfNewer(existingDraftByUser.get(row.finder_user_id), row),
  )
  await upsert(client, 'masma_finder_move_drafts', drafts, 'brand_id,finder_user_id')

  const incomingExports = []
  const incomingExportRows = []
  walkDocs(readJson(path.join(snapshotDir, 'firestore', 'warehouse_move_history.json')).docs || [], (year) => {
    for (const month of year.children?.months || []) {
      for (const day of month.children?.days || []) {
        for (const item of day.children?.exports || []) {
          const dateKey = item.data?.dateKey || `${year.id}-${month.id}-${day.id}`
          incomingExports.push({
            id: uuidFromLegacy('masma-finder-export', item.id),
            brand_id: brandId,
            work_date: dateKey,
            filename: item.data?.filename || `자리이동_${dateKey}.csv`,
            created_by: mergedUsers.idByLegacyUid[item.data?.createdByUid] || null,
            created_by_name: item.data?.createdByName || '',
            created_by_legacy_uid: item.data?.createdByUid || null,
            exported_at_local: item.data?.exportedAtLocal || '',
            item_count: Number(item.data?.itemCount) || 0,
            row_count: Number(item.data?.rowCount) || 0,
            headers: item.data?.headers || [],
            status: item.data?.status || 'exported',
            sheet_synced: item.data?.sheetSynced === true,
            sheet_written: Number(item.data?.sheetWritten) || 0,
            sheet_matched: Number(item.data?.sheetMatched) || 0,
            sheet_appended: Number(item.data?.sheetAppended) || 0,
            created_at: toIso(item.data?.createdAt) || new Date().toISOString(),
            legacy_id: item.id,
          })
          for (const row of item.children?.rows || []) {
            incomingExportRows.push({
              id: uuidFromLegacy('masma-finder-erow', `${item.id}:${row.id}`),
              brand_id: brandId,
              export_id: uuidFromLegacy('masma-finder-export', item.id),
              sort_order: Number(row.data?.order) || 0,
              move_id: row.data?.moveId || '',
              source_item_id: row.data?.sourceItemId || '',
              move_status: row.data?.moveStatus || '',
              exported_at_local: row.data?.exportedAtLocal || '',
              worker_name: row.data?.workerName || '',
              product_name: row.data?.productName || '',
              location: row.data?.location || '',
              type: row.data?.type || '',
              move_box_count: row.data?.moveBoxCount ?? null,
              box_before: row.data?.boxBefore ?? null,
              box_after: row.data?.boxAfter ?? null,
              units_per_box: row.data?.unitsPerBox ?? null,
              arrival_before: row.data?.arrivalBefore || '',
              arrival_after: row.data?.arrivalAfter || '',
              document_id: row.data?.documentId || '',
              memo: row.data?.memo || '',
              created_by: mergedUsers.idByLegacyUid[row.data?.createdByUid] || null,
              created_by_name: row.data?.createdByName || '',
              created_at: toIso(row.data?.createdAt) || new Date().toISOString(),
              __legacyExportId: item.id,
            })
          }
        }
      }
    }
  })
  const existingExportByLegacy = new Map(
    existingExports.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row]),
  )
  const exports = incomingExports.map((row) =>
    preferExistingIfNewer(existingExportByLegacy.get(row.legacy_id), row, 'created_at'),
  )
  const exportIdByLegacy = Object.fromEntries(exports.map((row) => [row.legacy_id, row.id]))
  await upsert(client, 'masma_finder_move_exports', exports)
  const exportRows = incomingExportRows.map((row) => ({
    ...row,
    export_id: exportIdByLegacy[row.__legacyExportId] || row.export_id,
    __legacyExportId: undefined,
  })).map(({ __legacyExportId, ...row }) => row)
  await upsert(client, 'masma_finder_move_export_rows', exportRows)

  const incomingScans = (readJson(path.join(snapshotDir, 'firestore', 'label_scans.json')).docs || []).map((doc) => ({
    id: uuidFromLegacy('masma-finder-scan', doc.id),
    brand_id: brandId,
    number: doc.data?.number || '',
    product_name: doc.data?.productName || '',
    label_date: doc.data?.labelDate || '',
    quantity_per_box: Number(doc.data?.quantityPerBox) || 0,
    box_count: Number(doc.data?.boxCount) || 1,
    location: doc.data?.location || '',
    confidence: doc.data?.confidence || 'medium',
    status: doc.data?.status || 'reviewed',
    created_by: mergedUsers.idByLegacyUid[doc.data?.createdByUid] || null,
    created_by_name: doc.data?.createdByName || '',
    created_by_legacy_uid: doc.data?.createdByUid || null,
    created_at: toIso(doc.data?.createdAt) || new Date().toISOString(),
  }))
  const existingScanIds = new Set(existingScans.map((row) => row.id))
  const scans = incomingScans.map((row) =>
    existingScanIds.has(row.id)
      ? preferExistingIfNewer(existingScans.find((item) => item.id === row.id), row, 'created_at')
      : row,
  )
  await upsert(client, 'masma_finder_label_scans', scans)

  const storageManifestPath = path.join(snapshotDir, 'storage', 'manifest.json')
  const storageObjects = existsSync(storageManifestPath)
    ? readJson(storageManifestPath).objects || []
    : []
  const existingByPath = new Map(
    existingAttachments
      .filter((row) => row.legacy_object_path)
      .map((row) => [row.legacy_object_path, row]),
  )
  const attachments = mergeAttachments({
    firestoreAttachments,
    storageObjects,
    existingByPath,
    brandId,
    taskIdByLegacy,
  })

  let copied = 0
  for (const object of storageObjects) {
    const localPath = path.join(snapshotDir, 'storage', object.path)
    if (!existsSync(localPath)) continue
    const taskLegacy = object.path.split('/')[1] || 'unknown'
    const taskId = taskIdByLegacy[taskLegacy]
    if (!taskId) continue
    const row = attachments.find((item) => item.legacy_object_path === object.path)
    if (!row) continue
    const kind = row.kind || attachmentKind(object.path)
    const fileName = path.posix.basename(object.path)
    const storagePath = row.storage_path || `brands/${brandId}/works/${taskId}/${kind}/${row.id}/${fileName}`
    const buffer = readFileSync(localPath)
    const { error } = await client.storage
      .from('masma-finder-works')
      .upload(storagePath, buffer, {
        contentType: object.contentType || 'application/octet-stream',
        upsert: true,
      })
    if (error) throw new Error(`Storage 복사 실패 ${object.path}: ${error.message}`)
    row.storage_path = storagePath
    row.sha256 = object.sha256
    row.byte_size = object.size
    copied += 1
  }
  await upsert(client, 'masma_finder_work_attachments', attachments)

  writeJson(path.join(snapshotDir, 'mapping.json'), {
    importedAt: new Date().toISOString(),
    brandId,
    counts: {
      users: mergedUsers.rows.length,
      templates: templates.length,
      workDays: workDays.length,
      workTasks: workTasks.length,
      attachments: attachments.length,
      incomingGroups: mergedGroups.rows.length,
      incomingItems: items.length,
      drafts: drafts.length,
      moveExports: exports.length,
      moveExportRows: exportRows.length,
      labelScans: scans.length,
      storageCopied: copied,
    },
    users: mergedUsers.idByLegacyUid,
    workDays: dayIdByDate,
    workTasks: taskIdByLegacy,
    incomingGroups: groupIdByKey,
    moveExports: exportIdByLegacy,
  })

  console.log(`[masma-finder-import] ${snapshotDir}`)
  console.log(JSON.stringify({
    users: mergedUsers.rows.length,
    workTasks: workTasks.length,
    attachments: attachments.length,
    storageCopied: copied,
    incomingItems: items.length,
    moveExports: exports.length,
    labelScans: scans.length,
  }, null, 2))
}

main().catch((error) => {
  console.error('[masma-finder-import] 실패', error)
  process.exit(1)
})
