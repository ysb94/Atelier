import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
const root=process.cwd()
const python=join(root,process.platform==='win32'?'.venv-md-price/Scripts/python.exe':'.venv-md-price/bin/python')
function run(command,args,env=process.env){
  const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true,env})
  if(result.error||result.status!==0)throw new Error(`${command} 실행 실패. Python 3.10 이상을 설치하거나 MD_PRICE_SETUP_PYTHON에 Python 경로를 지정해 주세요.`)
}
if(!existsSync(python))run(process.env.MD_PRICE_SETUP_PYTHON|| (process.platform==='win32'?'python':'python3'),['-m','venv','.venv-md-price'])
run(python,['-m','pip','install','-r','scripts/md-price-browser/requirements.txt'])
run(python,['-m','playwright','install','chromium'],{...process.env,PLAYWRIGHT_BROWSERS_PATH:join(root,'.tmp/md-price-browsers')})
console.log('가격 수집기 설치 완료. npm run dev에서 가격 최신화를 사용할 수 있습니다.')
