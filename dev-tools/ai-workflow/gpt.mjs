import fs from 'node:fs'
import { runCommand } from './process.mjs'
import { redact } from './settings.mjs'
import { requireSubscriptionLogin, subscriptionCommand, toolFreeArgs, gptModelArgs } from './codex-subscription.mjs'
import { ModelUnavailable, modelProblem } from './errors.mjs'

export function codexFailure(error, gpt, signal) {
  if (!signal?.aborted && gpt && modelProblem(error?.message))
    return new ModelUnavailable(`GPT 모델 ${gpt.model}(${gpt.effort})을 사용할 수 없습니다: ${redact(error.message).slice(0, 600)}`, { provider: 'codex', model: gpt.model })
  return error
}

// Generic tool-free, read-only Codex call on the ChatGPT subscription. Returns {report}
// like the Cursor investigator so callers parse and validate the answer themselves.
export async function runGptReadOnly({ config, root, gpt, prompt, schemaFile, outputFile, signal, run = runCommand }) {
  await requireSubscriptionLogin(config, { root, signal, run })
  fs.rmSync(outputFile, { force: true })
  const cli = subscriptionCommand(config, [...toolFreeArgs, 'exec', ...gptModelArgs(gpt), '--sandbox', 'read-only', '--json',
    ...(schemaFile ? ['--output-schema', schemaFile] : []), '-o', outputFile, '-'])
  try { await run(cli.command, cli.args, { cwd: root, input: prompt, timeoutMs: config.agentTimeoutMs, signal }) }
  catch (error) { throw codexFailure(error, gpt, signal) }
  if (!fs.existsSync(outputFile)) throw new Error('GPT 응답 파일이 만들어지지 않았습니다.')
  return { report: redact(fs.readFileSync(outputFile, 'utf8'), config.env) }
}
