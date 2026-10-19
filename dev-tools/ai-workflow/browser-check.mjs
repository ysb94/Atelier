import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import { runScenario } from './browser-scenarios.mjs'

export async function openFixture(root = process.cwd(),{scenario}={}) {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)),'browser-fixture')
  const entry=scenario==='members-department'?'members-entry.tsx':['navigation','brand-access','data-menu','brand-info','seasons-removal'].includes(scenario)?'navigation-entry.tsx':['documents','attendance-policy','profile'].includes(scenario)?'operations-entry.tsx':'entry.tsx'
  const server = await createServer({ root, configFile:false, envFile:false, logLevel:'error',
    plugins:[{name:'fixture-html',enforce:'pre',resolveId(source,importer){
      if(importer&&source.startsWith('.'))for(const name of ['auth','client']){
        const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'')
        if(target===path.join(root,'src/lib/supabase',name))return path.join(fixture,`${name}.ts`)
      }
    },configureServer(server){server.middlewares.use((req,res,next)=>{
      if(req.headers.accept?.includes('text/html')){
        server.transformIndexHtml(req.url,`<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}/${entry}"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next);return
      }next()
    })}},react(),tailwindcss()],
    resolve:{alias:[{find:'@/lib/supabase/auth',replacement:path.join(fixture,'auth.ts')},{find:'@/lib/supabase/client',replacement:path.join(fixture,'client.ts')},{find:'@',replacement:path.join(root,'src')}]},
    server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/dev-tools/ai-workflow/.state/**']},fs:{allow:[root,path.resolve(fixture,'..','..','..')]}},
  })
  await server.listen()
  let browser
  try {
    browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'/usr/bin/chromium',headless:true})
    const context=await browser.newContext({viewport:{width:1440,height:1100}})
    context.setDefaultTimeout(15000)
    context.setDefaultNavigationTimeout(60000)
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
    const page=await context.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    return {page,origin,errors,root,close:async()=>{await browser.close();await server.close()}}
  } catch(error){await browser?.close();await server.close();throw error}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const fixture=await openFixture(process.argv[3]||process.cwd(),{scenario:process.argv[2]})
  try {
    if(process.argv[2]) {
      await runScenario(process.argv[2],fixture)
    } else {
    await fixture.page.goto(fixture.origin+'/work-requests/design?mode=new')
    await fixture.page.locator('#work-request-title').waitFor()
    console.log(JSON.stringify({method:'offline actual-component browser fixture',text:(await fixture.page.locator('body').innerText()).slice(0,1800),errors:fixture.errors}))
    }
  } catch(error) {
    console.error(JSON.stringify({scenario:process.argv[2],url:fixture.page.url(),runtimeErrors:fixture.errors,screenText:(await fixture.page.locator('body').innerText().catch(()=>'' )).slice(-3500)}))
    throw error
  } finally {await fixture.close()}
}
