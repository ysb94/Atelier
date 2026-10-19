import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { taskFiles } from './settings.mjs'
import { DB_APPROVAL_ID,isMigrationDraft,migrationDraftsApproved } from './migration-drafts.mjs'
import { validateGptPlan,gptPlanPrompt } from './gpt-planner.mjs'
import { permissionDecision } from './acp.mjs'

const draft='supabase/migrations/20261015100000_work_requests.sql'
test('migration source drafts require both operator capability and recorded consent',()=>{
 const config={v2:{migrationDrafts:{enabled:true,approvalId:DB_APPROVAL_ID}}}
 const task={source:{answer:`공통 승인 식별: ${DB_APPROVAL_ID}`}}
 assert.equal(migrationDraftsApproved(config,task),true)
 assert.equal(migrationDraftsApproved({},task),false)
 assert.equal(migrationDraftsApproved(config,{source:{answer:'승인'}}),false)
 assert.throws(()=>taskFiles(draft),/DB·백업/)
 assert.deepEqual(taskFiles(draft,{allowMigrationDrafts:true}),[draft])
 for(const file of ['supabase/config.toml','supabase/functions/run/index.ts','docs/backups/data.sql','supabase/migrations/../../config.toml'])
   assert.throws(()=>taskFiles(file,{allowMigrationDrafts:true}))
 assert.equal(isMigrationDraft('supabase/migrations/not_timestamp.sql'),false)
})

test('existing migrations remain protected while new source drafts are accepted',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-migration-plan-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{}}))
 const plan={decision:'execute',reason:'필요한 저장 구조를 설계한다',executionKind:'implementation',request:'신규 저장 구조 설계',criteria:'실제 적용 여부를 정확히 보고',instructions:'새 migration 설계 파일을 작성하되 실제 DB에는 실행하지 않는다.',files:[draft],verificationScripts:[]}
 assert.deepEqual(validateGptPlan(plan,root,{}, {allowMigrationDrafts:true,protectedMigrations:[]}).files,[draft])
 assert.throws(()=>validateGptPlan(plan,root,{}, {allowMigrationDrafts:true,protectedMigrations:[draft]}),/기존 migration/)
 assert.throws(()=>validateGptPlan(plan,root,{}),/DB·백업/)
})

test('resume prompt separates historic global pause from functional holds and SQL execution',()=>{
 const p=gptPlanPrompt({task:{},bundle:{method:'manager-read-source'},scripts:[],runtime:{enabled:true,allowMigrationDrafts:true}})
 assert.match(p,/그 문구만으로 다시 defer하지/)
 assert.match(p,/명시적 보류는 그대로 유지/)
 assert.match(p,/실제 SQL 실행은 허용하지/)
 assert.equal(permissionDecision({toolCall:{kind:'other',title:'supabase:execute_sql'}},[draft],'/tmp'),false)
 assert.equal(permissionDecision({toolCall:{kind:'other',title:'supabase:apply_migration'}},[draft],'/tmp'),false)
 assert.equal(permissionDecision({toolCall:{kind:'execute',title:'psql'}},[draft],'/tmp'),false)
})
