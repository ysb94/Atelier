import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db = await PGlite.create()
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const employee=id(1), other=id(2), ops=id(3), outsider=id(4), request=id(10), pending=id(11), overnight=id(12), future=id(13), company=id(20), otherCompany=id(21)
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
const actor=async who=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${who}',false);set role authenticated`)
const save=(r=request,from='2020-01-02T18:30:00+09:00',to='2020-01-02T20:30:00+09:00',rest=15,revision=0)=>db.query('select save_overtime_actual($1,$2,$3,$4,$5)',[r,from,to,rest,revision])
try {
 await db.exec(`create role authenticated;create role anon;create schema auth;create schema app;grant usage on schema public,app,auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,company_id uuid,status text,operations boolean);
 insert into profiles values('${employee}','${company}','active',false),('${other}','${company}','active',false),('${ops}','${company}','active',true),('${outsider}','${otherCompany}','active',true);
 create table company_leave_requests(id uuid primary key,employee_id uuid,company_id uuid,kind text,status text,from_date date,to_date date,start_time time,end_time time,end_next_day boolean);
 insert into company_leave_requests values('${request}','${employee}','${company}','overtime','approved','2020-01-02','2020-01-02','18:00','22:00',false),('${pending}','${employee}','${company}','overtime','pending','2020-01-03','2020-01-03','18:00','22:00',false),('${overnight}','${employee}','${company}','overtime','approved','2020-01-04','2020-01-04','22:00','02:00',true),('${future}','${employee}','${company}','overtime','approved','2099-01-02','2099-01-02','18:00','22:00',false);
 alter table company_leave_requests enable row level security;grant select,update on company_leave_requests to authenticated;grant select on profiles to authenticated;
 create policy source_read on company_leave_requests for select to authenticated using (company_id=(select company_id from profiles where id=auth.uid()) and (employee_id=auth.uid() or (select operations from profiles where id=auth.uid())));
 -- Approved overtime cannot be updated by the employee. Reporting must not expand this policy.
 create policy source_update on company_leave_requests for update to authenticated using (employee_id=auth.uid() and status='pending');
 create table attendance_clock_ins(employee_id uuid,clock_out_at timestamptz);insert into attendance_clock_ins values('${employee}','2020-01-02T23:00:00+09:00');`)
 const source=await value('select md5(jsonb_agg(r order by id)::text) from company_leave_requests r')
 const clocks=await value('select md5(jsonb_agg(r)::text) from attendance_clock_ins r')
 const policies=await value("select md5(jsonb_agg(p order by policyname)::text) from pg_policies p where tablename='company_leave_requests'")
 await db.exec(await readFile('supabase/migrations/20261103074047_overtime_actual_reports.sql','utf8'))
 await actor(employee);await assert.rejects(()=>save(future,'2099-01-02T18:00:00+09:00','2099-01-02T19:00:00+09:00'));await save()
 assert.equal(Number(await value('select revision from overtime_actual_latest')),1)
 await assert.rejects(()=>save(),/변경/)
 await assert.rejects(()=>save(request,'2020-01-02T17:00:00+09:00','2020-01-02T20:00:00+09:00',0,1))
 await assert.rejects(()=>save(request,'2020-01-02T18:00:00+09:00','2020-01-02T23:00:00+09:00',0,1))
 await assert.rejects(()=>save(request,undefined,undefined,999,1))
 await assert.rejects(()=>save(request,'2020-01-02T18:00:30+09:00',undefined,0,1))
 await assert.rejects(()=>save(pending,'2020-01-03T18:00:00+09:00','2020-01-03T19:00:00+09:00'))
 await save(request,undefined,undefined,30,1)
 assert.equal(Number(await value('select count(*) from overtime_actual_reports')),2,'append-only revisions')
 assert.equal(Number(await value('select break_minutes from overtime_actual_latest')),30)
 await save(overnight,'2020-01-04T23:00:00+09:00','2020-01-05T01:30:00+09:00',15)
 await assert.rejects(()=>db.query('update overtime_actual_reports set break_minutes=0'))
 await assert.rejects(()=>db.query('delete from overtime_actual_reports'))
 await actor(other);assert.equal(Number(await value('select count(*) from overtime_actual_latest')),0);await assert.rejects(()=>save(request,undefined,undefined,0,2))
 await actor(ops);assert.equal(Number(await value('select count(*) from overtime_actual_latest')),2);await assert.rejects(()=>save(request,undefined,undefined,0,2))
 await actor(outsider);assert.equal(Number(await value('select count(*) from overtime_actual_latest')),0);await assert.rejects(()=>save())
 await db.exec('reset role');await db.query("update profiles set status='inactive' where id=$1",[employee]);await actor(employee)
 assert.equal(Number(await value('select count(*) from overtime_actual_latest')),0);await assert.rejects(()=>save(request,undefined,undefined,0,2))
 await db.exec('reset role');await db.query("update profiles set status='active' where id=$1",[employee])
 await db.query("update company_leave_requests set status='cancelled' where id=$1",[request]);await actor(employee);await assert.rejects(()=>save(request,undefined,undefined,0,2))
 await db.exec('reset role');await db.query("update company_leave_requests set status='approved' where id=$1",[request])
 assert.equal(await value('select md5(jsonb_agg(r order by id)::text) from company_leave_requests r'),source)
 assert.equal(await value('select md5(jsonb_agg(r)::text) from attendance_clock_ins r'),clocks)
 assert.equal(await value("select md5(jsonb_agg(p order by policyname)::text) from pg_policies p where tablename='company_leave_requests'"),policies)
 await db.exec('set role anon');await assert.rejects(()=>save());await assert.rejects(()=>db.query('select * from overtime_actual_latest'))
 console.info('Actual overtime DB: original requests/clocks/policies unchanged; own approved reports, CAS, history, bounds, breaks, midnight, revocation, operations read-only, other company and anon denial passed')
} finally { await db.close() }
