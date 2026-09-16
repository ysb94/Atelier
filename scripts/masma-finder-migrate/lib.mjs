import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ATELIER_BRAND_ID = 'b0000000-0000-4000-8000-000000000001'
export const ATELIER_BRAND_SLUG = 'atelier'

export const FIRESTORE_ROOTS = [
  'users',
  'warehouses_works_templates',
  'warehouses_works_daily',
  'warehouse_incoming_lists',
  'warehouses_move_drafts',
  'warehouse_move_history',
  'label_scans',
]

export const WORKS_TABLES = [
  'masma_finder_users',
  'masma_finder_work_templates',
  'masma_finder_work_days',
  'masma_finder_work_tasks',
  'masma_finder_work_attachments',
  'masma_finder_incoming_groups',
  'masma_finder_incoming_items',
  'masma_finder_move_drafts',
  'masma_finder_move_exports',
  'masma_finder_move_export_rows',
  'masma_finder_label_scans',
  'masma_finder_ocr_usage',
]

export const STATUS_PRIORITY = {
  pending: 1,
  active: 2,
  revoked: 3,
}

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function stampNow() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function toIso(value) {
  if (value == null) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString()
  }
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

export function countBy(items, keyFn) {
  const map = new Map()
  for (const item of items) {
    const key = keyFn(item)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return Object.fromEntries(map)
}

export function uuidFromLegacy(namespace, legacyId) {
  const hash = createHash('sha1')
    .update(`${namespace}:${legacyId}`)
    .digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export function snapshotsRoot(repoRoot) {
  return path.join(repoRoot, 'outputs', 'masma-finder-snapshots')
}

export function listSnapshotDirs(repoRoot) {
  const base = snapshotsRoot(repoRoot)
  if (!existsSync(base)) return []
  return readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((item) => statSync(item).isDirectory())
    .sort()
}

export function resolveSnapshotDir(repoRoot, specified = process.env.MASMA_FINDER_SNAPSHOT) {
  if (specified) return path.resolve(specified)
  return listSnapshotDirs(repoRoot).at(-1) || null
}

export function newerIso(left, right) {
  const leftMs = Date.parse(left || '')
  const rightMs = Date.parse(right || '')
  if (Number.isNaN(leftMs)) return right || null
  if (Number.isNaN(rightMs)) return left || null
  return rightMs >= leftMs ? right : left
}

export function preferExistingIfNewer(existing, incoming, field = 'updated_at') {
  if (!existing) return incoming
  const existingMs = Date.parse(existing[field] || existing.created_at || '')
  const incomingMs = Date.parse(incoming[field] || incoming.created_at || '')
  if (!Number.isNaN(existingMs) && (Number.isNaN(incomingMs) || existingMs >= incomingMs)) {
    return { ...incoming, ...existing, id: existing.id }
  }
  return { ...existing, ...incoming, id: existing.id }
}

export function mergeFinderUserRow(existing, incoming) {
  if (!existing) return incoming
  const existingRank = STATUS_PRIORITY[existing.status] || 0
  const incomingRank = STATUS_PRIORITY[incoming.status] || 0
  return {
    ...incoming,
    id: existing.id,
    auth_user_id: existing.auth_user_id || incoming.auth_user_id || null,
    status: existingRank >= incomingRank ? existing.status : incoming.status,
    is_admin: existing.is_admin === true || incoming.is_admin === true,
    display_name: existing.display_name || incoming.display_name,
    photo_url: existing.photo_url || incoming.photo_url || null,
    last_login_at: newerIso(existing.last_login_at, incoming.last_login_at),
    created_at: existing.created_at || incoming.created_at,
    legacy_firebase_uid: existing.legacy_firebase_uid || incoming.legacy_firebase_uid || null,
  }
}

export function mergeFinderUsers(incomingRows, existingRows) {
  const existingByEmail = new Map(
    (existingRows || []).map((row) => [normalizeEmail(row.email_normalized), row]),
  )
  const idByEmail = new Map()
  const idByLegacyUid = {}
  const rows = []

  for (const incoming of incomingRows || []) {
    const email = normalizeEmail(incoming.email_normalized)
    if (!email) continue
    const existing = existingByEmail.get(email)
    const merged = mergeFinderUserRow(existing, incoming)
    existingByEmail.set(email, merged)
    idByEmail.set(email, merged.id)
    if (incoming.legacy_firebase_uid) {
      idByLegacyUid[incoming.legacy_firebase_uid] = merged.id
    }
    if (existing?.legacy_firebase_uid) {
      idByLegacyUid[existing.legacy_firebase_uid] = merged.id
    }
  }

  for (const row of existingByEmail.values()) {
    rows.push(row)
  }
  return { rows, idByEmail, idByLegacyUid }
}

export function mergeByNaturalKey(incomingRows, existingRows, keyFn) {
  const existingByKey = new Map((existingRows || []).map((row) => [keyFn(row), row]))
  const idByKey = {}
  const rows = (incomingRows || []).map((incoming) => {
    const key = keyFn(incoming)
    const existing = existingByKey.get(key)
    const merged = preferExistingIfNewer(existing, incoming)
    existingByKey.set(key, merged)
    idByKey[key] = merged.id
    return merged
  })
  return { rows, idByKey }
}

export function attachmentKind(pathName, extra) {
  if (extra?.kind) return extra.kind
  return /\/completion_/i.test(pathName || '') ? 'completion' : 'normal'
}

export function mergeAttachments({
  firestoreAttachments = [],
  storageObjects = [],
  existingByPath = new Map(),
  brandId,
  taskIdByLegacy = {},
}) {
  const rowsByKey = new Map()

  for (const object of storageObjects) {
    const taskLegacy = String(object.path || '').split('/')[1] || ''
    const taskId = taskIdByLegacy[taskLegacy]
    if (!taskId) continue
    const pathName = object.path
    const existing = existingByPath.get(pathName)
    const fileName = path.posix.basename(pathName)
    rowsByKey.set(pathName, {
      id: existing?.id || uuidFromLegacy('masma-finder-att-file', pathName),
      brand_id: brandId,
      task_id: taskId,
      kind: attachmentKind(pathName),
      original_name: fileName,
      byte_size: Number(object.size) || 0,
      content_type: object.contentType || 'application/octet-stream',
      storage_path: existing?.storage_path || '',
      legacy_object_path: pathName,
      sha256: object.sha256 || existing?.sha256 || null,
      created_by: existing?.created_by || null,
      created_by_name: existing?.created_by_name || '',
      created_at: object.updated || existing?.created_at || new Date().toISOString(),
    })
  }

  for (const item of firestoreAttachments) {
    const taskId = taskIdByLegacy[item.taskLegacyId]
    if (!taskId) continue
    const pathName = item.legacy_object_path || item.path || ''
    const key = pathName || `meta:${item.taskLegacyId}:${item.attachmentLegacyId}`
    const current = rowsByKey.get(key)
    if (current) {
      rowsByKey.set(key, {
        ...current,
        kind: item.kind || current.kind,
        original_name: item.original_name || current.original_name,
        created_by: item.created_by || current.created_by,
        created_by_name: item.created_by_name || current.created_by_name || '',
        created_at: item.created_at || current.created_at,
      })
      continue
    }
    const existing = pathName ? existingByPath.get(pathName) : null
    rowsByKey.set(key, {
      id:
        existing?.id ||
        uuidFromLegacy('masma-finder-att', `${item.taskLegacyId}:${item.attachmentLegacyId}`),
      brand_id: brandId,
      task_id: taskId,
      kind: item.kind || 'normal',
      original_name: item.original_name || 'attachment',
      byte_size: Number(item.byte_size) || 0,
      content_type: item.content_type || 'application/octet-stream',
      storage_path: existing?.storage_path || '',
      legacy_object_path: pathName || null,
      sha256: existing?.sha256 || null,
      created_by: item.created_by || null,
      created_by_name: item.created_by_name || '',
      created_at: item.created_at || new Date().toISOString(),
    })
  }

  return [...rowsByKey.values()]
}

export function walkDocs(docs, visit) {
  for (const doc of docs || []) visit(doc)
}

export function walkCount(docs, childName) {
  let total = 0
  for (const doc of docs || []) {
    total += (doc.children?.[childName] || []).length
    for (const child of Object.values(doc.children || {})) {
      if (Array.isArray(child)) total += walkCount(child, childName)
    }
  }
  return total
}

export function expectedParityCounts({
  authUsers = [],
  firestoreUsers = [],
  templates = [],
  workDays = [],
  incomingDays = [],
  moveDrafts = [],
  moveHistory = [],
  labelScans = [],
  storageObjects = [],
  taskIdByLegacy = null,
}) {
  const emails = new Set()
  for (const user of authUsers) {
    const email = normalizeEmail(user.email)
    if (email) emails.add(email)
  }
  for (const doc of firestoreUsers) {
    const email = normalizeEmail(doc.data?.email)
    if (email) emails.add(email)
  }

  let incomingGroups = 0
  let incomingItems = 0
  const incomingByDate = {}
  for (const day of incomingDays) {
    const groups = day.children?.groups || []
    const legacyItems = day.children?.items || []
    incomingGroups += groups.length + (legacyItems.length > 0 ? 1 : 0)
    const groupItems = groups.reduce(
      (sum, group) => sum + (group.children?.items || []).length,
      0,
    )
    incomingItems += groupItems + legacyItems.length
    incomingByDate[day.id] = {
      groups: groups.length + (legacyItems.length > 0 ? 1 : 0),
      items: groupItems + legacyItems.length,
    }
  }

  let moveExports = 0
  let moveExportRows = 0
  const moveExportsByDate = {}
  walkDocs(moveHistory, (year) => {
    for (const month of year.children?.months || []) {
      for (const day of month.children?.days || []) {
        for (const item of day.children?.exports || []) {
          moveExports += 1
          const rowCount = (item.children?.rows || []).length
          moveExportRows += rowCount
          const dateKey = item.data?.dateKey || `${year.id}-${month.id}-${day.id}`
          const current = moveExportsByDate[dateKey] || { exports: 0, rows: 0 }
          current.exports += 1
          current.rows += rowCount
          moveExportsByDate[dateKey] = current
        }
      }
    }
  })

  const workTasks = walkCount(workDays, 'tasks')
  const workTasksByDate = {}
  for (const day of workDays) {
    workTasksByDate[day.id] = (day.children?.tasks || []).length
  }

  const knownTaskLegacy = taskIdByLegacy
    ? new Set(Object.keys(taskIdByLegacy))
    : new Set(
        workDays.flatMap((day) => (day.children?.tasks || []).map((task) => task.id)),
      )
  const storagePaths = new Set()
  for (const object of storageObjects) {
    const taskLegacy = String(object.path || '').split('/')[1] || ''
    if (!knownTaskLegacy.has(taskLegacy)) continue
    storagePaths.add(object.path)
  }
  const firestorePaths = new Set()
  let firestoreMetaOnly = 0
  for (const day of workDays) {
    for (const task of day.children?.tasks || []) {
      for (const item of [...(task.data?.attachments || []), ...(task.data?.completionAttachments || [])]) {
        if (item?.path) firestorePaths.add(item.path)
        else firestoreMetaOnly += 1
      }
    }
  }

  return {
    users: emails.size,
    templates: templates.length,
    workDays: workDays.length,
    workTasks,
    attachments: new Set([...storagePaths, ...firestorePaths]).size + firestoreMetaOnly,
    incomingGroups,
    incomingItems,
    drafts: moveDrafts.filter((doc) => doc.id).length,
    moveExports,
    moveExportRows,
    labelScans: labelScans.length,
    workTasksByDate,
    incomingByDate,
    moveExportsByDate,
  }
}

export function duplicateKeys(rows, keyFn) {
  const seen = new Map()
  const duplicates = []
  for (const row of rows || []) {
    const key = keyFn(row)
    if (key == null || key === '') continue
    const count = (seen.get(key) || 0) + 1
    seen.set(key, count)
    if (count === 2) duplicates.push(key)
  }
  return duplicates
}
