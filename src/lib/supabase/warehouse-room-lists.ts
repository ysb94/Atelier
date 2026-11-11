import { diagnosticOperation } from '@/lib/diagnostics'
import { tracedQuery, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'
import { fetchAllPages } from './paged-select'

export type WarehouseRoomListItem = [productName: string, quantity: string]

export type WarehouseRoomListFolder = {
  id: string
  brand_id: string
  title: string
  item_count: number
  created_by: string
  created_by_name: string
  created_at: string
}

const TABLE = 'warehouse_room_list_folders'
const FOLDER_COLUMNS = 'id, brand_id, title, item_count, created_by, created_by_name, created_at'

export function listWarehouseRoomListFolders(brandIds: string[]) {
  return diagnosticOperation('app', 'room_list_folders', trace =>
    trace.run('read_folders', async context => {
      const folders = await fetchAllPages<WarehouseRoomListFolder>({
        fetchPage: async (from, to, withCount) => {
          const query = getSupabase().from(TABLE).select(FOLDER_COLUMNS, withCount ? { count: 'exact' } : undefined)
            .in('brand_id', brandIds).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
          const { data, error, count } = await tracedQuery(query, context)
          if (error) throw error
          return { rows: data ?? [], count }
        },
      })
      return folders.sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
    }),
  )
}

export type CreateWarehouseRoomListFolder = {
  id: string
  brand_id: string
  title: string
  items: WarehouseRoomListItem[]
}

export function createWarehouseRoomListFolder(input: CreateWarehouseRoomListFolder) {
  return diagnosticOperation('app', 'room_list_folder_register', trace =>
    trace.run('save_folder', context => diagnosticQuery(
      'db', 'room_list_folder_insert',
      getSupabase().from(TABLE).upsert(input, { onConflict: 'id', ignoreDuplicates: true }),
      context,
    )),
  )
}

export type WarehouseRoomListFolderEdit = CreateWarehouseRoomListFolder & { revision: number }

export class WarehouseRoomListFolderChangedError extends Error {
  constructor() {
    super('Room list folder changed or is no longer editable.')
  }
}

export function readWarehouseRoomListFolderForEdit(folder: WarehouseRoomListFolder, userId: string) {
  return diagnosticQuery<WarehouseRoomListFolderEdit | null>(
    'db', 'room_list_folder_read_for_edit',
    getSupabase().from(TABLE).select('id, brand_id, title, items, revision')
      .eq('id', folder.id).eq('brand_id', folder.brand_id).eq('created_by', userId).maybeSingle(),
  )
}

export async function updateWarehouseRoomListFolder(input: WarehouseRoomListFolderEdit, context: DiagnosticContext) {
  const { id, brand_id, revision, title, items } = input
  const query = getSupabase().from(TABLE).update({ title, items })
    .eq('id', id).eq('brand_id', brand_id).eq('revision', revision).select('id').maybeSingle()
  const saved = await diagnosticQuery<{ id: string } | null>('db', 'room_list_folder_update', query, context)
  if (!saved) throw new WarehouseRoomListFolderChangedError()
}

export function readWarehouseRoomListItems(folders: WarehouseRoomListFolder[], brandIds: string[]) {
  return diagnosticOperation('app', 'room_list_open_folders', trace =>
    trace.run('read_selected_items', async context => {
      const itemsById = new Map<string, WarehouseRoomListItem[]>()
      for (let index = 0; index < folders.length; index += 40) {
        const ids = folders.slice(index, index + 40).map(folder => folder.id)
        const rows = await diagnosticQuery<{ id: string; items: WarehouseRoomListItem[] }[]>(
          'db', 'room_list_folder_items',
          getSupabase().from(TABLE).select('id, items').in('id', ids).in('brand_id', brandIds),
          context,
        )
        for (const row of rows) itemsById.set(row.id, row.items)
      }
      if (itemsById.size !== folders.length) throw new Error('Some selected room list folders are unavailable.')
      return folders.flatMap(folder => itemsById.get(folder.id) ?? [])
    }),
  )
}
