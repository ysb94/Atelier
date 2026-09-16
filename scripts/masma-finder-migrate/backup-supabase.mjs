/**
 * 현재 Atelier Supabase Finder 테이블·Storage 목록을 로컬에 백업한다.
 * 대상: masma_finder_work_tasks, masma_finder_incoming_groups,
 * masma_finder_move_exports, masma_finder_label_scans, masma-finder-works.
 * 원본 Firebase와 적재된 행을 지우지 않는다.
 *
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MASMA_FINDER_BRAND_ID   기본 atelier
 *
 *   node scripts/masma-finder-migrate/backup-supabase.mjs
 */
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATELIER_BRAND_ID,
  WORKS_TABLES,
  snapshotsRoot,
  stampNow,
  writeJson,
} from './lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function fetchAll(client, table, brandId) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('brand_id', brandId)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${table} 백업 실패: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function listStorage(client) {
  const objects = []
  const prefixes = ['brands']
  while (prefixes.length > 0) {
    const prefix = prefixes.shift()
    const { data, error } = await client.storage
      .from('masma-finder-works')
      .list(prefix, { limit: 1000, offset: 0 })
    if (error) {
      if (/not found/i.test(error.message || '')) return objects
      throw new Error(`Storage 목록 실패 ${prefix}: ${error.message}`)
    }
    for (const item of data || []) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id == null && item.metadata == null) {
        prefixes.push(fullPath)
        continue
      }
      objects.push({
        path: fullPath,
        size: Number(item.metadata?.size) || 0,
        contentType: item.metadata?.mimetype || '',
        updated: item.updated_at || item.updated || null,
      })
    }
  }
  return objects
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
  }

  const brandId = process.env.MASMA_FINDER_BRAND_ID || ATELIER_BRAND_ID
  const dest = path.join(snapshotsRoot(root), `${stampNow()}-supabase`)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const counts = {}

  for (const table of WORKS_TABLES) {
    const rows = await fetchAll(client, table, brandId)
    counts[table] = rows.length
    writeJson(path.join(dest, 'tables', `${table}.json`), {
      table,
      brandId,
      count: rows.length,
      rows,
    })
  }

  const storageObjects = await listStorage(client)
  writeJson(path.join(dest, 'storage', 'manifest.json'), {
    backedUpAt: new Date().toISOString(),
    objectCount: storageObjects.length,
    byteTotal: storageObjects.reduce((sum, item) => sum + item.size, 0),
    objects: storageObjects,
  })

  writeJson(path.join(dest, 'backup-summary.json'), {
    backedUpAt: new Date().toISOString(),
    brandId,
    counts,
    storageObjects: storageObjects.length,
  })

  console.log(`[masma-finder-backup] ${dest}`)
  console.log(JSON.stringify({ counts, storageObjects: storageObjects.length }, null, 2))
}

main().catch((error) => {
  console.error('[masma-finder-backup] 실패', error)
  process.exit(1)
})
