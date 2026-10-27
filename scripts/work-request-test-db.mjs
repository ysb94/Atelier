import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const company='e0000000-0000-4000-8000-000000000001',brand='b0000000-0000-4000-8000-000000000001'
export const ids={planner:'10000000-0000-4000-8000-000000000001',planner2:'10000000-0000-4000-8000-000000000002',md:'10000000-0000-4000-8000-000000000003',logistics:'10000000-0000-4000-8000-000000000004',design:'10000000-0000-4000-8000-000000000005',china:'10000000-0000-4000-8000-000000000006',manager:'10000000-0000-4000-8000-000000000007',ordinary:'10000000-0000-4000-8000-000000000008',outsider:'10000000-0000-4000-8000-000000000009',developer:'d0000000-0000-4000-8000-000000000001',delegate:'a5afdd00-4a61-44dc-a1a3-082fa8a1345d',ceo:'56074867-fdc2-4ce5-8e97-cea431decc36'}
export const departments={planning:'ced99f89-ea80-4eeb-8f03-272bf72f5db1',design:'7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1',md:'919b2c44-afb6-4d7e-a5b8-b7203df9cef9',logistics:'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e',china:'bf926822-910c-422f-9c17-5fd3d8ddb3ba'}

export async function createWorkTestDb(){const db=await PGlite.create();try {
 await db.exec(await readFile('supabase/tests/department_work_fixture.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261027044909_department_work_access.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261027044916_work_requests_storage.sql','utf8'))
 await db.query('insert into public.companies(id) values($1)',[company])
 await db.query('insert into public.brands(id,company_id) values($1,$2)',[brand,company])
 for(const [domain,id] of Object.entries(departments))await db.query('insert into public.departments(id,company_id,name,is_active) values($1,$2,$3,true)',[id,company,domain])
 for(const [key,id] of Object.entries(ids)) {
  const domain=key.startsWith('planner')?'planning':key==='manager'?'design':key
  await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')",[id,key==='outsider'?'e0000000-0000-4000-8000-000000000002':company,departments[domain]??null,key==='planner2'?'planner':key])
 }
 await db.query("insert into public.permission_grants(id,profile_id,company_id,permission,scope_kind,scope_id) values(gen_random_uuid(),$1,$2,'work.manage','department',$3)",[ids.manager,company,departments.design])

return db
}catch(error){await db.close();throw error}}
