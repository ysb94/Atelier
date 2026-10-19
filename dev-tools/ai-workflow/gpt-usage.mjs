import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EnvironmentError } from './errors.mjs'

export const GPT_BUDGET = Object.freeze({ planPromptChars: 100000, reviewPromptChars: 140000, maxCallsPerInput: 2 })

export function codexUsage(output) {
  const turns = []
  for (const line of String(output ?? '').split('\n')) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'turn.completed' && event.usage) turns.push(event.usage)
    } catch { /* Non-JSON CLI diagnostics carry no token usage. */ }
  }
  if (!turns.length) return null
  const sum = key => turns.reduce((n,item) => n + (Number.isFinite(item[key]) ? item[key] : 0),0)
  return { inputTokens:sum('input_tokens'), cachedInputTokens:sum('cached_input_tokens'), outputTokens:sum('output_tokens'), turns:turns.length }
}

export function appendGptUsage(outputFile, record) {
  fs.appendFileSync(path.join(path.dirname(outputFile),'gpt-usage.jsonl'), JSON.stringify({at:new Date().toISOString(),...record})+'\n')
}

// A durable pre-call reservation bounds retries even across crashes/restarts.
// Unknown usage is null, never zero. No prompt, model output or secrets go here.
export async function measuredGptCall({ command, args, options, outputFile, gpt, stage, inputKey, run }) {
  const inputChars = options.input.length, limit = stage === 'plan' ? GPT_BUDGET.planPromptChars : GPT_BUDGET.reviewPromptChars
  if (inputChars > limit) throw new EnvironmentError(`GPT ${stage} 입력이 절약 한도(${limit}자)를 넘었습니다: ${inputChars}자. 모델 호출 전에 멈췄습니다.`, { retry:false, code:'gpt_input_budget' })
  const attemptFile = `${outputFile}.attempts.json`
  const saved = fs.existsSync(attemptFile) ? JSON.parse(fs.readFileSync(attemptFile,'utf8')) : null
  const attempts = saved?.inputKey === inputKey ? saved.attempts : 0
  if (attempts >= GPT_BUDGET.maxCallsPerInput) throw new EnvironmentError('같은 GPT 입력이 두 번 실패하여 반복 소모를 막았습니다. 원인을 해결한 뒤 실행 기록의 호출 제한을 확인해야 합니다.', {retry:false,code:'gpt_retry_budget'})
  const callId = randomUUID(), started = Date.now()
  fs.writeFileSync(attemptFile,JSON.stringify({inputKey,attempts:attempts+1}))
  appendGptUsage(outputFile,{callId,stage,model:gpt?.model,effort:gpt?.effort,inputKey,inputChars,status:'started',usage:null})
  try {
    const result = await run(command,args,options)
    appendGptUsage(outputFile,{callId,stage,model:gpt?.model,effort:gpt?.effort,inputKey,inputChars,status:'completed',elapsedMs:Date.now()-started,usage:codexUsage(result.output)})
    return result
  } catch(error) {
    appendGptUsage(outputFile,{callId,stage,model:gpt?.model,effort:gpt?.effort,inputKey,inputChars,status:options.signal?.aborted?'aborted':'failed',elapsedMs:Date.now()-started,usage:codexUsage(error.commandResult?.output)})
    throw error
  }
}
