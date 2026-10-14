import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './process.mjs'
import { redact,toolDir } from './settings.mjs'
import { requireSubscriptionLogin, subscriptionCommand, toolFreeArgs, gptModelArgs } from './codex-subscription.mjs'
import { ModelUnavailable, modelProblem } from './errors.mjs'
import { digest } from './workspace.mjs'
import { measuredGptCall, appendGptUsage } from './gpt-usage.mjs'
import { READER_VERSION } from './source-reader.mjs'
import { EnvironmentError } from './errors.mjs'
import { runSourceSession } from './source-session.mjs'

export function codexFailure(error, gpt, signal) {
  if (!signal?.aborted && gpt && modelProblem(error?.message))
    return new ModelUnavailable(`GPT 모델 ${gpt.model}(${gpt.effort})을 사용할 수 없습니다: ${redact(error.message).slice(0, 600)}`, { provider: 'codex', model: gpt.model })
  return error
}

// Read-only Codex call with a scoped source reader on the ChatGPT subscription. Returns {report}
// like the Cursor investigator so callers parse and validate the answer themselves.
export async function runGptReadOnly({ config, root, gpt, prompt, schemaFile, outputFile, signal, run = runCommand, stage = 'plan', cacheContext = '', bundled = true, subscription, sourceManifest }) {
  if (subscription?.authMethod !== 'chatgpt' || subscription?.billing !== 'subscription') await requireSubscriptionLogin(config, { root, signal, run })
  const readerKey=sourceManifest?{version:READER_VERSION,implementationHash:digest(fs.readFileSync(path.join(toolDir,'source-reader.mjs'))),sessionHash:digest(fs.readFileSync(path.join(toolDir,'source-session.mjs'))),root:sourceManifest.root,stage:sourceManifest.stage,limits:sourceManifest.limits,changes:sourceManifest.changes,includedDiffs:sourceManifest.includedDiffs}:null
  const inputKey = digest(JSON.stringify(['compact-source-v2',gpt,prompt,schemaFile ? fs.readFileSync(schemaFile,'utf8') : null,cacheContext,bundled,readerKey]))
  const cacheFile = `${outputFile}.cache.json`
  const auditFile=`${outputFile}.read-audit.json`,manifestFile=`${outputFile}.sources.json`
  if (fs.existsSync(cacheFile) && fs.existsSync(outputFile)) {
    const cache = JSON.parse(fs.readFileSync(cacheFile,'utf8')), report = fs.readFileSync(outputFile,'utf8')
    if (cache.inputKey === inputKey && cache.outputHash === digest(report)&&(!sourceManifest||fs.existsSync(auditFile)&&cache.auditHash===digest(fs.readFileSync(auditFile)))) {
      appendGptUsage(outputFile,{stage,model:gpt?.model,effort:gpt?.effort,inputKey,inputChars:prompt.length,status:'cache_hit',usage:null})
      return {report:redact(report,config.env),cached:true,sourceAudit:sourceManifest?JSON.parse(fs.readFileSync(auditFile,'utf8')):null}
    }
  }
  fs.rmSync(outputFile, { force: true })
  if(sourceManifest){fs.writeFileSync(manifestFile,JSON.stringify(sourceManifest));fs.rmSync(auditFile,{force:true})}
  const cli = subscriptionCommand(config, [...(bundled ? toolFreeArgs : []), 'exec', ...gptModelArgs(gpt), '--sandbox', 'read-only', '--json',
    ...(schemaFile ? ['--output-schema', schemaFile] : []), '-o', outputFile, '-'])
  const stopCheck=sourceManifest?()=>{
    if(!fs.existsSync(auditFile))return null
    const audit=JSON.parse(fs.readFileSync(auditFile,'utf8'))
    return audit.exhausted?'GPT 자료 읽기 한도에 도달하여 반복 호출을 중지했습니다.':audit.invalidated?'읽기 도중 소스가 바뀌어 현재 세션을 중지했습니다.':null
  }:undefined
  try { const result=await measuredGptCall({...cli, options:{cwd:root,input:prompt,timeoutMs:config.agentTimeoutMs,signal,stopCheck},outputFile,gpt,stage,inputKey,run:sourceManifest&&run===runCommand?()=>runSourceSession({config,root,gpt,prompt,schemaFile,outputFile,manifest:sourceManifest,auditFile,signal}):run});if(sourceManifest)fs.writeFileSync(`${outputFile}.diagnostics.txt`,redact(result.stderr??'',config.env).slice(-12000)) }
  catch (error) {
    if(sourceManifest&&fs.existsSync(auditFile)&&JSON.parse(fs.readFileSync(auditFile,'utf8')).exhausted)throw new EnvironmentError('GPT 자료 읽기 한도에 도달하여 추가 소모를 중지했습니다.',{retry:false,code:'source_reader_budget'})
    if(sourceManifest&&fs.existsSync(auditFile)&&JSON.parse(fs.readFileSync(auditFile,'utf8')).invalidated)throw new EnvironmentError('읽기 도중 소스가 바뀌어 최신 코드로 다시 준비해야 합니다.',{retry:true,code:'workspace_changed'})
    throw codexFailure(error, gpt, signal)
  }
  if (!fs.existsSync(outputFile)) throw new Error('GPT 응답 파일이 만들어지지 않았습니다.')
  const raw = fs.readFileSync(outputFile,'utf8')
  // A partial/invalid JSON output must not be reused after interruption.
  let validJson = true
  try { JSON.parse(raw) } catch { validJson = false }
  if(sourceManifest&&!fs.existsSync(auditFile))throw new EnvironmentError('읽기 수집기가 시작되지 않았습니다. 도구 없이 생성한 계획·검토는 실행하지 않습니다.',{retry:false,code:'source_reader_start'})
  const sourceAudit=sourceManifest?JSON.parse(fs.readFileSync(auditFile,'utf8')):null
  if(sourceAudit?.exhausted)throw new EnvironmentError('GPT 자료 읽기 한도에 도달했습니다. 반복 호출을 중지했습니다.',{retry:false,code:'source_reader_budget'})
  if(sourceAudit)appendGptUsage(outputFile,{stage,model:gpt?.model,status:'source_reads',calls:sourceAudit.calls,responseChars:sourceAudit.responseChars})
  if (validJson) fs.writeFileSync(cacheFile,JSON.stringify({inputKey,outputHash:digest(raw),...(sourceManifest?{auditHash:digest(fs.readFileSync(auditFile))}:{})}))
  return { report: redact(raw, config.env),sourceAudit }
}
