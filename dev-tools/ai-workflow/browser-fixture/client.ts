// Offline data adapter. Unexpected mutations fail; there is no remote client.
export const isSupabaseConfigured = () => true
export function getSupabase() {
  return {
    // Offline realtime subscriptions never emit events or open a connection.
    channel() {const channel={on:()=>channel,subscribe:()=>channel};return channel},
    removeChannel:async()=> 'ok',
    from(table: string) {
      const audit=window as unknown as {__atelierFixtureReads?:string[]}
      ;(audit.__atelierFixtureReads??=[]).push(table)
      const data = table === 'brands' ? [{ id: 'fixture-brand', slug: 'fixture', name: '검증 브랜드', name_ko: '검증 브랜드', color: '#222', founded_year: 2020 }] : []
      const chain: Record<string, unknown> = {}
      for (const name of ['select','eq','in','gte','lte','gt','lt','order','limit','is','neq','range','or']) chain[name] = () => chain
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
      return chain
    },
    rpc(name: string) {
      if (!name.startsWith('list_') && !name.startsWith('get_')) throw new Error(`Fixture forbids RPC mutation: ${name}`)
      return Promise.resolve({ data: [], error: null })
    },
  }
}
