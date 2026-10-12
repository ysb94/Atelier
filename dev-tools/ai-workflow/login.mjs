import { spawn } from 'node:child_process'
import { settings,cursorCommand,projectRoot } from './settings.mjs'
const cli=cursorCommand(settings())
const child=spawn(cli.command,[...cli.args,'login'],{cwd:projectRoot,stdio:'inherit',windowsHide:true})
child.once('error',error=>{console.error('[ai-workflow] Cursor 로그인 실행 실패',error.message);process.exitCode=1})
child.once('exit',code=>{process.exitCode=code??1})
