// Offline data adapter. Unexpected mutations fail; there is no remote client.
export const isSupabaseConfigured = () => true
const navigationFixture=['data-menu','brand-info'].includes(new URLSearchParams(location.search).get('fixture')??'')
const styleRow={id:'fixture-style',brand_id:'fixture-brand',season_id:null,style_no:'F-M001',name:'검증 상품',category:'상의',gender:'U',colors:[],target_cost:null,planned_qty:null,retail_price:null,status:'draft',thumbnail_color:'#222222',description:'합성 상품',values:{},custom_fields:{},created_at:'2020-01-01',updated_at:'2020-01-01'}
export function getSupabase() {
  return {
    auth:{getUser:async()=>({data:{user:{id:'fixture-user'}},error:null})},
    // Offline realtime subscriptions never emit events or open a connection.
    channel() {const channel={on:()=>channel,subscribe:()=>channel};return channel},
    removeChannel:async()=> 'ok',
    from(table: string) {
      const audit=window as unknown as {__atelierFixtureReads?:string[]}
      ;(audit.__atelierFixtureReads??=[]).push(table)
      const memberFixture=location.pathname==='/__fixture/members'
      const local=window as unknown as {__fixtureDepartments:Record<string,unknown>[];__fixtureDepartmentCalls:unknown[];__fixtureDepartmentFailure:boolean}
      const data = table === 'departments'&&memberFixture?local.__fixtureDepartments:table === 'brands' ? [{ id: 'fixture-brand', slug: 'fixture', name: '검증 브랜드', name_ko: '검증 브랜드', color: '#222', founded_year: 2020 }] : table==='styles'&&navigationFixture?[styleRow]:[]
      const chain: Record<string, unknown> = {}
      let single=false
      for (const name of ['select','eq','in','gte','lte','gt','lt','order','limit','is','neq','range','or']) chain[name] = () => chain
      for(const name of ['single','maybeSingle'])chain[name]=()=>{single=true;return chain}
      if(table==='departments'&&memberFixture){
        let inserted:Record<string,unknown>|null=null,patch:Record<string,unknown>|null=null,targetId:unknown
        chain.insert=(value:Record<string,unknown>)=>{inserted=value;return chain}
        chain.update=(value:Record<string,unknown>)=>{patch=value;return chain}
        chain.eq=(column:string,value:unknown)=>{if(column==='id')targetId=value;return chain}
        chain.then=(resolve:(value:unknown)=>unknown)=>{
          if((inserted||patch)&&local.__fixtureDepartmentFailure)return Promise.resolve({data:null,error:{message:'synthetic department failure'}}).then(resolve)
          let rows=local.__fixtureDepartments
          if(inserted){const row={id:'synthetic-'+rows.length,personnel_scope:null,...inserted};rows.push(row);local.__fixtureDepartmentCalls.push({kind:'insert',value:inserted});rows=[row]}
          if(patch){const row=rows.find(row=>row.id===targetId);if(!row)throw new Error('Unknown synthetic department');Object.assign(row,patch);local.__fixtureDepartmentCalls.push({kind:'update',id:targetId,value:patch});rows=[row]}
          return Promise.resolve({data:single?rows[0]??null:[...rows],count:rows.length,error:null}).then(resolve)
        }
        return chain
      }
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data:single?data[0]??null:data, count:data.length,error: null }).then(resolve)
      return chain
    },
    rpc(name: string,args?:Record<string,unknown>) {
      const fixture=window as unknown as {__fixtureDirectoryMode?:string;__fixtureRpcCalls?:unknown[]}
      if(name==='list_org_chart_members') {
        if(fixture.__fixtureDirectoryMode==='loading')return new Promise(()=>{})
        if(fixture.__fixtureDirectoryMode==='error')return Promise.resolve({data:null,error:{message:'synthetic directory failure'}})
        if(fixture.__fixtureDirectoryMode==='ready')return Promise.resolve({data:[{id:'member-0',display_name:'검증 사원',position:'사원',job_grade:'사원',department_id:'fixture-department',hire_date:'2020-01-01'}],error:null})
      }
      if(name==='save_attendance_start_settings'&&location.pathname.startsWith('/__fixture/')) {
        ;(fixture.__fixtureRpcCalls??=[]).push({name,args})
        return Promise.resolve({data:1,error:null})
      }
      if (!name.startsWith('list_') && !name.startsWith('get_')) throw new Error(`Fixture forbids RPC mutation: ${name}`)
      return Promise.resolve({ data: [], error: null })
    },
  }
}
