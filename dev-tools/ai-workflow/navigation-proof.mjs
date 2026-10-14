import fs from 'node:fs'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

// Replace a brittle source spelling check only with a browser result tied to
// this exact task workspace and source hash. Every department/view contract stays enforced.
export function validateTabIdentityProof(proof,root,tabs) {
  assert.equal(proof.passed,true);assert.equal(fs.realpathSync(proof.sourceRoot),fs.realpathSync(root))
  assert.equal(proof.sourceHashes?.['src/components/layout/workspace-tabs.tsx'],createHash('sha256').update(tabs).digest('hex'),'브라우저 증거가 현재 코드와 다름')
  const cases=proof.results.workRequestTabIdentity,owners=['planning','design','md','logistics'],searches=['','?mode=new','?requestId=R1','?requestId=R1&mode=edit','?brand=fixture&requestId=R2'],ownerIds=new Set()
  assert.equal(cases.length,owners.length*searches.length)
  for(const owner of owners){
    const entries=cases.filter(v=>v.pathname==='/work-requests/'+owner),ids=new Set(entries.map(v=>v.result?.id))
    assert.equal(entries.length,searches.length);assert.deepEqual(entries.map(v=>v.search),searches);assert.equal(ids.size,1);assert.ok(!ids.has(undefined));ownerIds.add(entries[0].result.id)
    for(const v of entries){assert.equal(v.result.pathname,v.pathname);assert.equal(v.result.search,v.search)}
  }
  assert.equal(ownerIds.size,4,'부서별 탭 식별자가 충돌함')
}
