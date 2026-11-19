import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Runs only in the caller's isolated PGlite database; no network or real acknowledgements.
export async function verifyLeaveNoticeSelfSession({ db, value, actor, company, other, id }) {
  const employee = id(80), peer = id(81), foreign = id(82), inactive = id(83)
  const sid = n => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const oauth = sid(1), otp = sid(2), password = sid(3), peerSession = sid(4), foreignSession = sid(5), inactiveSession = sid(6)
  await db.exec(`reset role;
    create table auth.mfa_amr_claims(session_id uuid references auth.sessions(id) on delete cascade, authentication_method text not null, unique(session_id,authentication_method));
    insert into public.profiles(id,company_id,status,display_name) values
      ('${employee}','${company}','active','본인 직원'),('${peer}','${company}','active','동료'),
      ('${foreign}','${other}','active','타사'),('${inactive}','${company}','disabled','비활성');
    insert into auth.sessions values
      ('${oauth}','${employee}'),('${otp}','${employee}'),('${password}','${employee}'),
      ('${peerSession}','${peer}'),('${foreignSession}','${foreign}'),('${inactiveSession}','${inactive}'),
      ('${sid(7)}','${employee}');
    insert into auth.mfa_amr_claims values
      ('${oauth}','oauth'),('${otp}','otp'),('${password}','password'),
      ('${peerSession}','oauth'),('${foreignSession}','oauth'),('${inactiveSession}','oauth');
    insert into public.impersonation_events(target_id) values('${employee}'),('${employee}');`)
  const base = sid(10), extra = sid(11), grant = sid(12)
  await db.query(`insert into public.leave_usage_notices(id,company_id,employee_id,recipient_name,hire_date,reset_date,expires_on,phase,scheduled_on,remaining_days,title,body)
    values($1,$2,$3,'본인 직원','2024-12-01','2027-12-01','2027-11-30','twoWeeks','2027-11-16',2,'원문 제목','보존할 기본 안내 원문')`, [base,company,employee])
  await db.query(`insert into app.employee_extra_leave(id,employee_id,company_id,days,expires_on,note,granted_on,created_by,updated_by,grant_source)
    values($1,$2,$3,0.5,'2027-11-29','생일 반차','2027-11-15',$4,$4,'birthday')`, [grant,employee,company,id(1)])
  await db.query(`insert into public.extra_leave_usage_notices(id,company_id,employee_id,grant_id,grant_version,notice_source,recipient_name,phase,scheduled_on,expires_on,starts_on,granted_days,remaining_days,reserved_days,reason,title,body)
    values($1,$2,$3,$4,1,'birthday','본인 직원','registered','2027-11-15','2027-11-29','2027-11-15',0.5,0.5,0,'생일 반차','원문 제목','보존할 생일 안내 원문')`, [extra,company,employee,grant])
  const rpc = (kind, action) => `select public.record_${kind === 'base' ? 'leave_usage' : 'extra_leave'}_notice($1,'${action}')`
  const reject = async (sql, args, code = '42501') => assert.rejects(() => db.query(sql,args), e => e.code === code)
  // Reproduce the defect with real old function bodies: a separate switch blocks OAuth.
  await actor(employee,oauth)
  for (const [kind,notice] of [['base',base],['extra',extra]]) await reject(rpc(kind,'view'),[notice])
  await db.exec('reset role')
  const dataHash = `select md5(jsonb_build_array(
    (select jsonb_agg(p order by id) from profiles p), (select jsonb_agg(r order by profile_id) from employee_roster r),
    (select jsonb_agg(g order by id) from app.employee_extra_leave g), (select jsonb_agg(e order by id) from impersonation_events e),
    (select jsonb_agg(n order by id) from leave_usage_notices n), (select jsonb_agg(n order by id) from extra_leave_usage_notices n))::text)`
  const before = await value(dataHash)
  const grantsHash = `select md5(coalesce(jsonb_agg(jsonb_build_array(proname,proacl,proowner,prosecdef,proconfig) order by proname)::text,''))
    from pg_proc where oid in ('app.record_leave_usage_notice(uuid,text)'::regprocedure,'app.record_extra_leave_notice(uuid,text)'::regprocedure)`
  const aclBefore = await value(grantsHash)
  const migration = await readFile('supabase/migrations/20261120090000_leave_notice_self_session.sql','utf8')
  await db.exec(migration)
  assert.equal(await value(dataHash),before,'적용은 직원·명부·연차·전환 감사·안내/확인 원본을 바꾸지 않음')
  assert.equal(await value(grantsHash),aclBefore,'소유자·실행 권한·security definer·search_path 유지')
  for (const [kind,notice] of [['base',base],['extra',extra]]) {
    const table = kind === 'base' ? 'leave_usage_notices' : 'extra_leave_usage_notices'
    await actor(employee,oauth)
    await assert.rejects(() => db.query(rpc(kind,'confirm'),[notice]), /먼저 열람/)
    await db.query(rpc(kind,'read'),[notice])
    assert.equal(await value(`select viewed_at from ${table} where id=$1`,[notice]),null,'읽음과 열람 분리')
    for (const [who,session] of [[employee,otp],[employee,sid(7)],[employee,sid(99)],[employee,null],[employee,'bad-uuid'],[peer,peerSession],[foreign,foreignSession],[inactive,inactiveSession],[peer,oauth]]) {
      await actor(who,session)
      for (const action of ['read','view','confirm']) await reject(rpc(kind,action),[notice])
    }
    // Neither editable metadata nor a made-up JWT AMR can turn OTP into employee OAuth.
    await db.exec(`reset role;select set_config('request.jwt.claims','${JSON.stringify({sub:employee,session_id:otp,amr:[{method:'oauth'}],user_metadata:{provider:'google'},app_metadata:{provider:'google'}})}',false);set role authenticated`)
    await reject(rpc(kind,'view'),[notice])
    await actor(employee,oauth)
    await db.query(rpc(kind,'view'),[notice])
    assert.equal(await value(`select confirmed_at from ${table} where id=$1`,[notice]),null,'열람은 본인 확인으로 처리하지 않음')
    await db.query(rpc(kind,'confirm'),[notice])
    const first = (await db.query(`select * from ${table} where id=$1`,[notice])).rows[0]
    await actor(employee,password)
    await db.query(rpc(kind,'confirm'),[notice])
    const again = (await db.query(`select * from ${table} where id=$1`,[notice])).rows[0]
    assert.deepEqual(again,first,'재시도·다른 본인 기기의 확인은 최초 세션/시각·원문을 유지')
    assert.equal(first.confirmed_session_id,oauth)
    await actor(employee,otp)
    await reject(rpc(kind,'confirm'),[notice])
    await reject('select * from auth.mfa_amr_claims',[])
    await reject("insert into auth.mfa_amr_claims values($1,'oauth')",[otp])
    await db.exec('reset role;set role anon')
    await reject(rpc(kind,'view'),[notice])
  }
  // Ending an audit must never authorize the previously issued OTP session.
  await db.exec(`reset role;update impersonation_events set ended_at=now() where target_id='${employee}'`)
  await actor(employee,otp)
  for (const kind of ['base','extra']) await reject(rpc(kind,'read'),[kind === 'base' ? base : extra])
  await actor(employee,password)
  await db.query(rpc('extra','confirm'),[extra])
  await db.exec(`reset role;delete from auth.sessions where id='${oauth}'`)
  await actor(employee,oauth)
  await reject(rpc('extra','confirm'),[extra])
  await db.exec('reset role')
  // A changed server function stops migration before either replacement.
  const installed = await value("select pg_get_functiondef('app.record_extra_leave_notice(uuid,text)'::regprocedure)")
  await assert.rejects(() => db.exec(migration), /준비한 기준과 다릅니다/)
  await db.exec('rollback')
  assert.equal(await value("select pg_get_functiondef('app.record_extra_leave_notice(uuid,text)'::regprocedure)"),installed)
  console.log('leave-notice-self-session: 기존 오류 재현·본인 OAuth/비밀번호 허용·전환 OTP/종료후/위조메타/잘못된 세션 차단·선행 열람/최초확인·타인/타사/비활성/익명 차단·원본/실행권한 보존·서버 정의 불일치 중단 통과')
}
