import { spawn } from 'node:child_process'
import { redact } from './settings.mjs'

// Agents receive only their own credentials, not the parent shell's unrelated secrets.
export function childEnv(extra = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)) delete env[key]
  return { ...env, ...extra }
}

export function runCommand(command, args, { cwd, input, timeoutMs = 120000, signal, env = childEnv(), acceptedCodes = [0], stopCheck } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false })
    let output = '', errorOutput = '', timedOut = false, stopReason=''
    const stop = () => child.kill('SIGTERM')
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const budgetTimer=stopCheck?setInterval(()=>{try{const reason=stopCheck();if(reason){stopReason=reason;stop()}}catch(error){stopReason=error.message;stop()}},1000):null
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', data => { output = (output + data).slice(-2000000) })
    child.stderr.on('data', data => { errorOutput = (errorOutput + data).slice(-200000) })
    child.once('error', error => { clearTimeout(timer);clearInterval(budgetTimer); signal?.removeEventListener('abort', stop); reject(error) })
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop)
      clearInterval(budgetTimer)
      const result = { code, output: redact(output, env), stderr: redact(errorOutput, env) }
      if(stopReason)return reject(Object.assign(new Error(stopReason),{commandResult:result}))
      if (timedOut || signal?.aborted) return reject(Object.assign(new Error(timedOut ? '실행 시간 제한 초과' : '작업 중지됨'), {commandResult:result}))
      if (!acceptedCodes.includes(code)) return reject(Object.assign(new Error(`명령 실패 (${code}): ${result.stderr.slice(-1800) || result.output.slice(-1800)}`), {commandResult:result}))
      resolve(result)
    })
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') console.warn('[ai-workflow] 입력 전달 실패', error.message) })
    child.stdin.end(input ?? '')
  })
}
