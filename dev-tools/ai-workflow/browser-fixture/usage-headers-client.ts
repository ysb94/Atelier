// Offline fixture: no remote client or credentials. All mutations are audited.
import { DEFAULT_USAGE_CODE_COLUMNS } from '../../../src/lib/codes/usage-code-columns'
const uuid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const brand = uuid(1),
  a = uuid(2),
  b = uuid(3),
  code = uuid(4),
  now = '2026-01-01T00:00:00Z'
const role = new URLSearchParams(location.search).get('role') ?? 'admin'
const missing = new URLSearchParams(location.search).has('missing')
const failSave = new URLSearchParams(location.search).has('fail')
const target = (id: string, name: string, order: number) => ({
  id,
  brand_id: brand,
  name,
  normalized_name: name,
  site_name: '',
  normalized_site_name: '',
  active: true,
  is_one_time: false,
  channel_type: 'online',
  shipping_method: 'parcel',
  folder_id: null,
  group_id: null,
  outbound_partner_groups: null,
  sort_order: order,
  created_at: now,
  updated_at: now,
})
const data: Record<string, any[]> = {
  code_usage_targets: [target(a, '무신사', 0), target(b, '다른업체', 1)],
  barcode_partner_display_settings: [
    {
      id: uuid(10),
      brand_id: brand,
      display_scope: 'own',
      barcode_partner_display_targets: [
        { usage_target_id: a },
        { usage_target_id: b },
      ],
    },
  ],
  product_codes: [
    {
      id: code,
      brand_id: brand,
      kind: 'own',
      usage_target_id: null,
      code: '8801234000015',
      name: '공통 바코드명',
      values: {},
      created_at: now,
      updated_at: now,
    },
  ],
  product_code_components: [
    {
      product_code_id: code,
      style_id: uuid(5),
      style_no: 'M001-BLACK-S',
      qty: 2,
      sort_order: 0,
    },
    {
      product_code_id: code,
      style_id: uuid(6),
      style_no: 'M002-BLACK-M',
      qty: 1,
      sort_order: 1,
    },
  ],
  styles: [
    {
      id: uuid(5),
      brand_id: brand,
      style_no: 'M001-BLACK-S',
      name: '공통 물류상품명 S',
      values: {},
      colors: [],
      created_at: now,
      updated_at: now,
    },
    {
      id: uuid(6),
      brand_id: brand,
      style_no: 'M002-BLACK-M',
      name: '공통 물류상품명 M',
      values: {},
      colors: [],
      created_at: now,
      updated_at: now,
    },
  ],
  code_usage_assignments: [a, b].map((target, i) => ({
    id: uuid(20 + i),
    brand_id: brand,
    usage_target_id: target,
    product_code_id: code,
    status: 'active',
    created_at: now,
    updated_at: now,
  })),
  usage_code_columns: DEFAULT_USAGE_CODE_COLUMNS.map((column) => ({
    id: column.id,
    brand_id: brand,
    system_key: column.sourceKey,
    label: column.label,
    sort_order: column.sortOrder,
  })),
  usage_partner_columns: [],
  usage_partner_values: [],
}
if (new URLSearchParams(location.search).has('grouped')) {
  data.code_usage_targets.forEach((target, index) =>
    Object.assign(target, {
      name: '무신사',
      group_id: uuid(80),
      outbound_partner_groups: { name: '무신사' },
      site_name: index ? '홍대' : '강남',
      normalized_site_name: index ? '홍대' : '강남',
    }),
  )
  data.product_codes.push({
    ...data.product_codes[0],
    id: uuid(44),
    code: '8801234000022',
    name: '두 번째 연결 전용 코드',
  })
  data.code_usage_assignments.push({
    ...data.code_usage_assignments[1],
    id: uuid(45),
    product_code_id: uuid(44),
  })
}
const audit: any[] = []
const fingerprint = () =>
  JSON.stringify(
    Object.fromEntries(
      [
        'styles',
        'product_codes',
        'product_code_components',
        'code_usage_assignments',
        'usage_code_columns',
      ].map((table) => [table, data[table]]),
    ),
  )
const baseline = fingerprint()
Object.assign(window, {
  __usageFixture: { data, a, b, brand, code, audit, baseline, fingerprint },
})
export const isSupabaseConfigured = () => true
export function getSupabase() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: uuid(90) } }, error: null }),
    },
    from(table: string) {
      let rows = [...(data[table] ?? [])],
        single = false,
        start = 0,
        end = Infinity
      const q: any = {
        select: () => q,
        order: () => q,
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value)
          return q
        },
        in: (key: string, values: any[]) => {
          rows = rows.filter((row) => values.includes(row[key]))
          return q
        },
        range: (from: number, to: number) => {
          start = from
          end = to
          return q
        },
        limit: (limit: number) => {
          end = limit - 1
          return q
        },
        maybeSingle: () => {
          single = true
          return q
        },
        single: () => {
          single = true
          return q
        },
      }
      for (const method of ['insert', 'update', 'delete', 'upsert'])
        q[method] = () => {
          throw new Error(
            `Shared or unaudited table mutation forbidden: ${table}.${method}`,
          )
        }
      q.then = (resolve: any, reject: any) =>
        Promise.resolve(
          missing && table.startsWith('usage_partner_')
            ? {
                data: null,
                error: { code: '42P01', message: 'fixture schema not applied' },
              }
            : {
                data: single ? (rows[0] ?? null) : rows.slice(start, end + 1),
                count: rows.length,
                error: null,
              },
        ).then(resolve, reject)
      return q
    },
    async rpc(name: string, args: any) {
      if (name === 'get_usage_partner_access')
        return missing
          ? {
              data: null,
              error: { code: 'PGRST202', message: 'fixture RPC missing' },
            }
          : {
              data: {
                canRead: true,
                canEdit: role !== 'reader',
                canManage: role === 'admin',
                editorIds: [uuid(90)],
              },
              error: null,
            }
      if (name === 'get_usage_partner_manager_candidates')
        return {
          data: [
            { id: uuid(90), display_name: '검증 담당자' },
            { id: uuid(91), display_name: '검증 동료' },
          ],
          error: null,
        }
      if (name.startsWith('save_usage_partner_')) {
        if (failSave)
          return { data: null, error: { message: '검증용 저장 실패' } }
        if (role === 'reader' || missing)
          return { data: null, error: { message: 'fixture denies write' } }
        audit.push({ name, args: structuredClone(args) })
        if (name === 'save_usage_partner_columns') {
          data.usage_partner_columns = data.usage_partner_columns.filter(
            (row) => row.usage_target_id !== args.p_target_id,
          )
          data.usage_partner_columns.push(
            ...args.p_columns.map((column: any) => ({
              id: column.id,
              brand_id: brand,
              usage_target_id: args.p_target_id,
              kind: column.kind,
              source_key: column.sourceKey,
              label: column.label,
              description: column.description,
              value_type: column.valueType,
              visible: column.visible,
              sort_order: column.sortOrder,
            })),
          )
        } else if (name === 'save_usage_partner_values') {
          for (const [fieldId, value] of Object.entries(args.p_values)) {
            const old = data.usage_partner_values.find(
              (row) =>
                row.usage_target_id === args.p_target_id &&
                row.product_code_id === args.p_code_id &&
                row.field_id === fieldId,
            )
            if (old) old.value = value
            else
              data.usage_partner_values.push({
                brand_id: brand,
                usage_target_id: args.p_target_id,
                product_code_id: args.p_code_id,
                field_id: fieldId,
                value,
              })
          }
        } else if (name !== 'save_usage_partner_editors')
          throw new Error('Unknown fixture mutation')
        return { data: null, error: null }
      }
      if (!name.startsWith('get_') && !name.startsWith('list_'))
        throw new Error(`Fixture forbids RPC: ${name}`)
      return { data: [], error: null }
    },
    channel() {
      const c = { on: () => c, subscribe: () => c }
      return c
    },
    removeChannel: async () => 'ok',
  }
}
