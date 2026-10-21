import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationPath, stageSql, digest, schemaFingerprintQuery } from './sql.mjs'
import { sandbox, fingerprints, metadata } from './sandbox.mjs'
import { transitionReport } from './model.ts'

export const root = path.resolve(import.meta.dirname,'../..')
export const defaultOutput = path.join(root,'.tmp/permission-rollout/package')

async function failsAtomically(db,sql) {
  let rejected = false
  try { await db.exec(sql.replace(/\ncommit;\s*$/, "\ndo $fault$ begin raise exception '의도한 로컬 장애'; end $fault$;\ncommit;")) }
  catch (error) { if (!String(error.message).includes('의도한 로컬 장애')) throw error; rejected=true }
  finally { await db.exec('rollback;') }
  assert.ok(rejected,'장애 주입 시 트랜잭션 실패')
}

export async function rehearse(snapshot,sql) {
  const db = await sandbox(snapshot)
  const checks=[]
  const pass = (name,detail) => checks.push({name,detail,passed:true,environment:'로컬 PostgreSQL/WASM'})
  try {
    const original=await fingerprints(db)
    assert.deepEqual(original,snapshot.fingerprints,'실제 스냅샷의 보호 대상 행을 로컬에 동일하게 재현')
    assert.equal((await db.query(schemaFingerprintQuery(snapshot))).rows[0].fingerprint,snapshot.schemaFingerprint,'기존 서버 함수·정책·실행 권한·트리거 재현')
    pass('기존 계정·승인자 사본 일치','사용자·승인 상태·승인자·역량·브랜드 연결·업체 담당·조직·Auth ID 지문 비교')
    const beforeMetadata=await metadata(db,snapshot)
    const stages=stageSql(sql,snapshot)
    await failsAtomically(db,stages.prepare)
    assert.equal((await db.query("select to_regclass('public.permission_grants') as id")).rows[0].id,null)
    assert.deepEqual(await metadata(db,snapshot),beforeMetadata)
    assert.deepEqual(await fingerprints(db),original)
    pass('준비 중 장애 복구','장애 발생 시 새 객체 생성도 취소되고 기존 함수·정책·승인 상태 유지')
    await db.exec(stages.prepare)
    assert.deepEqual(await metadata(db,snapshot),beforeMetadata,'준비 단계는 기존 권한 함수·정책·트리거를 바꾸지 않음')
    assert.equal(Number((await db.query('select count(*) as n from public.permission_grants')).rows[0].n),0)
    assert.equal((await db.query("select has_function_privilege('authenticated','public.set_permission_grant(uuid,text,text,uuid,boolean,text)','EXECUTE') as allowed")).rows[0].allowed,false)
    assert.deepEqual(await fingerprints(db),original)
    pass('준비 단계의 기존 동작 보존','기존 함수·접근 규칙·트리거 동일, 새 지정 저장 API 잠금, 사용자/승인자 쓰기 없음')
    await assert.rejects(db.exec(stages.activate),/호환 앱·서버·복구 준비 확인이 필요합니다/,'배포/복구 준비 확인값 없이는 전환 불가')
    await db.exec('rollback;')
    assert.deepEqual(await fingerprints(db),original)
    await db.query("select set_config('atelier.permission_release_ready',$1,false)",[digest(sql)])
    await failsAtomically(db,stages.activate)
    assert.deepEqual(await metadata(db,snapshot),beforeMetadata)
    assert.equal(Number((await db.query('select count(*) as n from public.permission_grants')).rows[0].n),0)
    assert.deepEqual(await fingerprints(db),original)
    pass('전환 중 장애 복구','호환 배포 확인 없으면 차단, 권한 이관·서버 교체 중 오류 시 함께 취소되어 준비 상태로 복귀')
    await db.exec(stages.activate)
    const seeded=(await db.query('select profile_id,permission,scope_kind,scope_id from public.permission_grants order by profile_id,permission,scope_kind,scope_id')).rows
    assert.deepEqual(await fingerprints(db),original,'전환 성공 후에도 원래 승인 상태·승인자·연결 유지')
    pass('전환 후 원본 보존','전환 성공 후에도 기존 사용자 및 승인자 원본 지문 동일')
    // Exercise the real new directory RPC with current active manager candidates; schema mismatch must fail here.
    const managers=seeded.filter(g=>g.permission==='permissions.manage')
    assert.ok(managers.length,'활성 권한 관리자 후보 필요')
    for(const m of managers) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[m.profile_id])
      await db.exec('set role authenticated;')
      const result=(await db.query('select public.permission_directory() as result')).rows[0].result
      assert.ok(result.profiles.some(p=>p.id===m.profile_id))
      await db.exec('reset role;')
    }
    pass('실제 구조로 중앙 조회 실행','현재 대화방 이름 열 및 기존 사용자 사본을 사용해 새 권한 조회 RPC 실행')
    const count=Number((await db.query('select count(*) as n from public.permission_grants')).rows[0].n)
    await db.exec(stages.rollback)
    assert.deepEqual(await metadata(db,snapshot),beforeMetadata,'복구 후 원래 함수 정의·EXECUTE ACL·정책·트리거 일치')
    assert.equal((await db.query(schemaFingerprintQuery(snapshot))).rows[0].fingerprint,snapshot.schemaFingerprint,'의존 함수와 RLS 설정까지 복구 기준과 일치')
    assert.deepEqual(await fingerprints(db),original)
    assert.equal(Number((await db.query('select count(*) as n from public.permission_grants')).rows[0].n),count,'새 지정 원본 보존')
    assert.equal((await db.query("select has_function_privilege('authenticated','public.list_my_permission_grants()','EXECUTE') as allowed")).rows[0].allowed,false)
    pass('전환 후 서버 복구','기존 함수·실행 권한·접근 규칙·트리거 복원, 사용자·승인자·새 지정 내역 보존, 새 RPC 잠금')
    return {checks,seeded,stages}
  } finally { await db.close() }
}

export async function prepare(snapshotFile,output=defaultOutput) {
  if (!path.resolve(output).startsWith(path.join(root,'.tmp')+path.sep)) throw new Error('개인별 전환표와 DB 정의는 .tmp 아래에만 저장합니다.')
  const snapshot=JSON.parse(await fs.readFile(snapshotFile,'utf8'))
  const sql=await fs.readFile(path.join(root,migrationPath),'utf8')
  if (snapshot.project!=='pmzgdqvtzwfwqmvhzcyo') throw new Error('Atelier 읽기 전용 스냅샷이 아닙니다.')
  if (snapshot.columns.some(c=>c.table==='chat_rooms'&&c.name==='title') || !snapshot.columns.some(c=>c.table==='chat_rooms'&&c.name==='name')) throw new Error('현재 DB 구조가 준비된 코드와 다릅니다.')
  const {checks,seeded,stages}=await rehearse(snapshot,sql)
  const report=transitionReport(snapshot,seeded,checks)
  await fs.mkdir(output,{recursive:true})
  for(const [name,content] of Object.entries({'01-prepare.sql':stages.prepare,'02-activate.sql':stages.activate,'03-rollback-after-activation.sql':stages.rollback,'00-preflight-readonly.sql':stages.preflight,'report.json':JSON.stringify(report,null,2)})) await fs.writeFile(path.join(output,name),content+'\n')
  const manifest={capturedAt:snapshot.capturedAt,generatedAt:report.generatedAt,sourceHash:digest(sql),snapshotHash:digest(snapshot),databaseChanged:false,requiresSeparateApproval:true,checks:checks.length,blockers:report.blockers.length}
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  const lines=report.people.map(p=>`| ${p.name.replaceAll('|','/')} | ${p.department} | ${p.position??'미지정'} | ${p.status} | ${p.previous.length} | ${p.next.length} | ${p.added.map(g=>g.label).join(', ')||'-'} | ${p.removed.map(g=>g.label).join(', ')||'-'} |`)
  await fs.writeFile(path.join(output,'transition.md'),`# 개인별 권한 전환 검토표\n\n운영 DB 변경 없음. 기준: ${snapshot.capturedAt}\n\n${report.comparisonLimit}\n\n| 이름 | 부서 | 직책 | 승인 상태(유지) | 기존 코드 권한 | 이관 예정 | 추가 예정 | 제외 예정 |\n|---|---|---|---|---:|---:|---|---|\n${lines.join('\n')}\n\n## 로컬 검증\n\n${checks.map(c=>`- 통과: ${c.name} — ${c.detail}`).join('\n')}\n`)
  return {report,manifest,output}
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const input=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11)??'.tmp/permission-rollout/source.json'
    const result=await prepare(path.resolve(root,input))
    console.log(JSON.stringify({output:result.output,counts:result.report.counts,localChecks:result.manifest.checks,reviewItems:result.manifest.blockers,databaseChanged:false},null,2))
  } catch(error) { console.error('[permission-rollout] 준비 실패',{message:error.message,code:error.code,detail:error.detail});process.exitCode=1 }
}
