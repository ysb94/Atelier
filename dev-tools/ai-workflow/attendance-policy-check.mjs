import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {runCommand} from './process.mjs'
import {digest} from './workspace.mjs'

const root=fs.realpathSync(process.argv[2]),relative='src/features/operations-support/attendance-start-settings.verify.ts',file=path.join(root,relative)
const source=fs.readFileSync(file,'utf8'),moduleFile=path.join(root,'src/features/operations-support/attendance-start-settings.ts')
const policy=await import(pathToFileURL(moduleFile).href)
assert.equal(policy.ATTENDANCE_GRACE_MINUTES,5,'사용자가 정한 5분 정책과 다름')
const old="assert.equal(resolveAttendanceStart(index,'employee','visual','2026-09').grace,3)",replacement=old.replace('.grace,3)','.grace,5)')
const legacy=await runCommand(process.execPath,['--experimental-strip-types',file],{cwd:root,acceptedCodes:[0,1]})
let updated=source,legacyResult={passed:legacy.code===0,exitCode:legacy.code}
if(source.includes(old)) {
  assert.equal(source.split(old).length,2,'알 수 없는 검사 변경')
  assert.equal(legacy.code,1);assert.match(legacy.stderr,/5 !== 3|actual: 5[\s\S]*expected: 3/,'3분 기대값 이외의 실패를 대체하지 않습니다.')
  updated=source.replace(old,replacement)
}else assert.equal(legacy.code,0,'정책과 무관한 기존 검사가 실패했습니다.')
updated=updated.replace("'./attendance-start-settings.ts'",JSON.stringify(pathToFileURL(moduleFile).href))
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-attendance-policy-'))
try {
  const check=path.join(dir,'policy.verify.ts');fs.writeFileSync(check,updated)
  const verified=await runCommand(process.execPath,['--experimental-strip-types',check],{cwd:root})
  console.log(JSON.stringify({method:'Original assertions executed against actual task module; only obsolete grace=3 expectation is updated to explicitly requested grace=5.',targetRoot:root,originalTest:{path:relative,sha256:digest(source),...legacyResult},replacement:source.includes(old)?{before:old,after:replacement}:null,policy:5,passed:true,output:verified.output}))
}finally{fs.rmSync(dir,{recursive:true,force:true})}
