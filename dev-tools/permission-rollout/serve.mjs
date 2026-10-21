import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDir=import.meta.dirname
const root=path.resolve(toolDir,'../..')
const defaultReport=path.join(root,'.tmp/permission-rollout/package/report.json')

/** Development-only, loopback-only, GET/HEAD viewer. No credentials or database client. */
export function startViewer({port=4321,reportFile=defaultReport}={}) {
  const files = new Map([
    ['/', ['viewer.html','text/html; charset=utf-8']],
    ['/viewer.mjs',['viewer.mjs','text/javascript; charset=utf-8']],
    ['/viewer.css',['viewer.css','text/css; charset=utf-8']],
  ])
  const server=http.createServer(async(request,response)=>{
    const actualPort=server.address()?.port
    if (![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(request.headers.host)) {response.writeHead(403).end('Host rejected');return}
    response.setHeader('Cache-Control','no-store')
    response.setHeader('X-Content-Type-Options','nosniff')
    response.setHeader('Referrer-Policy','no-referrer')
    response.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    if (!['GET','HEAD'].includes(request.method)) {response.setHeader('Allow','GET, HEAD');response.writeHead(405).end('Read only');return}
    const address=request.url?.split('?')[0]
    if (address==='/health') {response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({tool:'atelier-permission-rollout',readOnly:true}));return}
    const file=files.get(address)
    if (!file && address!=='/report.json') {response.writeHead(404).end('Not found');return}
    try {
      const body=await fs.readFile(address==='/report.json'?reportFile:path.join(toolDir,file[0]))
      response.writeHead(200,{'Content-Type':address==='/report.json'?'application/json; charset=utf-8':file[1]})
      response.end(request.method==='HEAD'?undefined:body)
    } catch(error) {
      console.warn('[permission-viewer] 자료 읽기 실패',{code:error.code,path:address})
      response.writeHead(error.code==='ENOENT'?503:500,{'Content-Type':'text/plain; charset=utf-8'}).end('권한 점검 자료가 없습니다. npm run permissions:plan으로 먼저 준비하세요.')
    }
  })
  server.listen(port,'127.0.0.1')
  return server
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.argv.find(v=>v.startsWith('--port='))?.slice(7)??4321)
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('포트는 1~65535 정수여야 합니다.')
  const server=startViewer({port})
  server.once('listening',()=>console.info(`[permission-viewer] 개발용 권한 점검: http://127.0.0.1:${port}/ (DB 연결 없음)`))
  server.once('error',error=>{console.error('[permission-viewer] 실행 실패',error.message);process.exitCode=1})
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close()})
}
