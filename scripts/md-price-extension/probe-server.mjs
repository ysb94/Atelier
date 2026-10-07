// One-hour, loopback-only receiver for the opt-in ordinary Chrome experiment.
// No Supabase credentials, AI calls, shopping requests or business-data writes.
import {createServer} from 'node:http'
import {createHash,generateKeyPairSync,randomBytes,timingSafeEqual} from 'node:crypto'
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'

export function validateProbeCapture(value) {
  if (!value || typeof value !== 'object') throw new Error('본문 형식 오류')
  const url = new URL(value.url)
  if (url.origin !== 'https://smartstore.naver.com' || url.username || url.password || url.search || url.hash || !/^\/masmarulez\/products\/\d+\/?$/.test(url.pathname)) throw new Error('허용하지 않은 상품 주소')
  if (value.version !== 1 || value.transport !== 'ordinary-chrome-extension' || value.scope !== 'smartstore-heading-purchase-panel'
    || typeof value.visibleText !== 'string' || value.visibleText.length < 20 || value.visibleText.length > 22_000
    || typeof value.pageName !== 'string' || !value.pageName.trim() || value.pageName.length > 300 || !value.visibleText.replace(/\s+/g,'').includes(value.pageName.replace(/\s+/g,''))
    || typeof value.title !== 'string' || value.title.length > 1000
    || !Number.isFinite(value.readMs) || value.readMs < 0 || value.readMs > 60_000
    || !(value.httpStatus === null || Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)
    || typeof value.collectedAt !== 'string' || !Number.isFinite(Date.parse(value.collectedAt))) throw new Error('수집 본문 범위 오류')
  if (!Array.isArray(value.controls) || value.controls.length > 30 || value.controls.some(c=>!c || typeof c.text !== 'string' || c.text.length >= 100 || typeof c.disabled !== 'boolean')) throw new Error('구매 상태 형식 오류')
  return {version:1,url:url.href,title:value.title,pageName:value.pageName,visibleText:value.visibleText,controls:value.controls.map(c=>({text:c.text,disabled:c.disabled})),httpStatus:value.httpStatus,scope:value.scope,readMs:value.readMs,collectedAt:value.collectedAt,transport:value.transport}
}

export function createProbeServer({extensionOrigin,token,onCapture}) {
  const expected = Buffer.from(`Bearer ${token}`)
  let savedCount = 0
  const server = createServer(async(req,res)=>{
    const reply=(value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value))}
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin !== extensionOrigin) return reply({error:'허용하지 않은 요청 출처'},403)
    res.setHeader('Access-Control-Allow-Origin',extensionOrigin)
    if (req.url !== '/capture') return reply({error:'경로 없음'},404)
    if (req.method === 'OPTIONS') {res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');return reply({ok:true})}
    if (req.method !== 'POST') return reply({error:'POST만 지원'},405)
    const provided=Buffer.from(req.headers.authorization || '')
    if (provided.length !== expected.length || !timingSafeEqual(provided,expected)) return reply({error:'테스트 세션 인증 실패'},401)
    if (savedCount >= 5) return reply({error:'테스트 5건 완료. 수신기를 다시 시작해 주세요.'},429)
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply({error:'JSON 필요'},415)
    try {
      const chunks=[];let bytes=0
      for await (const chunk of req) {bytes+=chunk.length;if(bytes>100_000)return reply({error:'본문 크기 초과'},413);chunks.push(chunk)}
      const capture=validateProbeCapture(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      savedCount++
      await onCapture(capture,savedCount)
      reply({ok:true})
    } catch(error) {
      console.warn('[md-price] 확장 테스트 수신 실패',{message:error.message,path:'/capture',lastInput:'상품 본문 읽기'})
      reply({error:'테스트 결과 형식 또는 저장 오류'},400)
    }
  })
  server.requestTimeout=10_000
  server.headersTimeout=10_000
  return server
}

async function start() {
  const root=resolve(fileURLToPath(new URL('../../',import.meta.url)))
  const folder=join(root,'.tmp/md-smartstore-extension')
  const results=join(root,'.tmp/md-smartstore-extension-results')
  await mkdir(folder,{recursive:true});await mkdir(results,{recursive:true})
  const source=fileURLToPath(new URL('./',import.meta.url))
  const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'))
  try {manifest.key=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8')).key}
  catch(error) {if(error.code!=='ENOENT')throw error} // First run intentionally has no generated manifest.
  if (!manifest.key) manifest.key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64')
  const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('')
  const token=randomBytes(32).toString('hex')
  for (const name of ['popup.html','popup.css','popup.js','read-product.js']) await copyFile(join(source,name),join(folder,name))
  await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  const server=createProbeServer({extensionOrigin:`chrome-extension://${id}`,token,onCapture:async(capture,index)=>{
    const file=join(results,`${Date.now()}-${index}.json`)
    await writeFile(file,JSON.stringify(capture,null,2)+'\n')
    console.info('[md-price] 일반 Chrome 본문 수신',{file,name:capture.pageName,chars:capture.visibleText.length,httpStatus:capture.httpStatus,readMs:capture.readMs,path:'/capture',lastInput:'상품 본문 읽기'})
  }})
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen)})
  const endpoint=`http://127.0.0.1:${server.address().port}/capture`
  await writeFile(join(folder,'config.json'),JSON.stringify({endpoint,token})+'\n')
  await writeFile(join(results,'session.json'),JSON.stringify({extensionId:id,folder,results,startedAt:new Date().toISOString()},null,2)+'\n')
  console.info('[md-price] 확장 테스트 준비 완료',{folder,extensionId:id,results,expiresInMinutes:60,path:'/capture',lastInput:'테스트 수신기 시작'})
  const timeout=setTimeout(()=>server.close(),60*60*1000)
  server.once('close',()=>clearTimeout(timeout))
  process.once('SIGINT',()=>server.close())
  process.once('SIGTERM',()=>server.close())
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await start()
