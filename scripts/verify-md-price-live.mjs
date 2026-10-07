// Opt-in live smoke: saves real observations and incurs configured AI usage; never writes product/URL sources.
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env.local',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const db=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY)
const {error:authError}=await db.auth.signInWithPassword({email:env.VITE_DEV_LOGIN_EMAIL,password:env.VITE_DEV_LOGIN_PASSWORD})
if(authError)throw authError
const args=process.argv.slice(2)
if(args.includes('--browser') && args.includes('--web-search'))throw new Error('Choose only one collection mode')
const domains=args.filter(a=>!a.startsWith('--'))
const codes=args.find(a=>a.startsWith('--codes='))?.slice('--codes='.length).split(',').filter(Boolean)
const limit=Math.max(1,Math.min(10,Number(args.find(a=>a.startsWith('--limit='))?.slice('--limit='.length) ?? 2)))
if(!domains.length)throw new Error('Specify shop domains for the live test')
let productIds
if(codes?.length){
 const {data,error}=await db.from('sabangnet_products').select('id').in('code',codes)
 if(error)throw error
 productIds=data.map(p=>p.id)
 if(!productIds.length)throw new Error('No matching registered Sabangnet codes')
}
for(const domain of domains){
 let query=db.from('sabangnet_mall_urls').select('id,url,mall_product_name,code_usage_targets!inner(active)').eq('code_usage_targets.active',true).ilike('url',`%://${domain}/%`).order('source_row')
 query=productIds ? query.in('product_id',productIds).limit(limit) : query.limit(limit)
 const {data:links,error}=await query
 if(error)throw error
 if(!links?.length){console.log(`${domain}: no registered URL`);continue}
 for(const link of links){
  const started=Date.now()
  let data,callError
  const body={urlId:link.id,mode:args.includes('--web-search') ? 'web-search' : 'page',context:{path:'/product-work/md',lastInput:'가격 수집 실검증'}}
  if(args.includes('--browser')){
    const {data:{session}}=await db.auth.getSession()
    const response=await fetch('http://localhost:5173/__md-price-refresh',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
    data=await response.json()
    if(!response.ok)throw new Error(data.error??'Browser collection failed')
  }else({data,error:callError}=await db.functions.invoke('md-price-refresh',{body}))
  if(callError){let detail=callError.message;try{detail=(await callError.context.json()).error??detail}catch(e){console.warn('Error response parsing failed',e.name)};throw new Error(detail)}
  if(!data?.ok)throw new Error(data?.error??'Invalid response')
  const c=data.check
  console.log(JSON.stringify({domain,name:link.mall_product_name,status:c.status,price:c.price,source:c.source,basis:c.basis,evidence:c.evidence,ruleState:c.rule_state,message:c.message,reused:data.reused,timing:data.timing,elapsedMs:Date.now()-started}))
 }
}
await db.auth.signOut({scope:'local'})
