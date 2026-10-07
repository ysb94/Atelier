import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import { corsHeaders } from '../_shared/cors.ts'
import { safeShopUrl, unknown } from '../_shared/md-price-core.ts'
import { shopProductId } from '../_shared/md-price-shops.ts'
import { page } from '../_shared/md-price-page.ts'
import { priceDocument } from '../_shared/md-price-document.ts'
import { TEXT_COLLECTOR, PRICE_TEXT_PROMPT, PRICE_TEXT_SCHEMA, validateTextPrice } from '../_shared/md-price-text.ts'
import { BROWSER_COLLECTOR, browserDocument } from '../_shared/md-price-browser.ts'
import { WEB_SEARCH_COLLECTOR, webSearchRequest, webSearchUsage, validateWebSearch } from '../_shared/md-price-web-search.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
// Keep the brand's configured model and existing usage accounting.
const FEATURE = 'md_price_rule_discovery'
const makeAdmin = () => createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders})
  if (req.method !== 'POST') return json({error:'POST만 지원합니다.'},405)
  const started = Date.now()
  const timing = {crawlMs:0,extractMs:0,aiMs:0,totalMs:0,inputChars:0,inputTokens:0,outputTokens:0,webSearchCalls:0,webToolCalls:0}
  let urlId = '', userId = '', lease = false
  let context = {path:'/product-work/md',lastInput:'가격 최신화'}
  let admin: ReturnType<typeof makeAdmin> | null = null
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 150_000) return json({error:'요청 크기 초과'},413)
    const authorization = req.headers.get('Authorization') ?? ''
    const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}})
    const {data:{user},error:authError} = await client.auth.getUser(authorization.replace(/^Bearer /,''))
    if (authError || !user) return json({error:'로그인이 필요합니다.'},401)
    userId = user.id
    const rawBody = await req.text()
    if (rawBody.length > 40_000) return json({error:'요청 크기 초과'},413)
    const body = JSON.parse(rawBody); urlId = String(body.urlId ?? '')
    context = {path:String(body.context?.path ?? context.path).slice(0,160),lastInput:String(body.context?.lastInput ?? context.lastInput).slice(0,240)}
    if (!/^[0-9a-f-]{36}$/i.test(urlId)) return json({error:'상품 URL 식별자 오류'},400)
    if (body.mode != null && !['page','web-search'].includes(body.mode)) return json({error:'지원하지 않는 수집 방식입니다.'},400)
    const webSearch = body.mode === 'web-search'
    if (webSearch && body.capture != null) return json({error:'웹 검색에는 브라우저 수집 본문을 보내지 않습니다.'},400)
    const {data:link,error:linkError} = await client.from('sabangnet_mall_urls').select('id,brand_id,target_id,url,mall_product_name').eq('id',urlId).maybeSingle()
    if (linkError || !link) return json({error:'이 상품 URL에 접근할 수 없습니다.'},403)
    const {data:allowed,error:permissionError} = await client.rpc('md_price_can_refresh',{p_brand_id:link.brand_id})
    if (permissionError || !allowed) return json({error:'가격 최신화 업무 권한이 필요합니다.'},403)
    const {data:target,error:targetError} = await client.from('code_usage_targets').select('active').eq('brand_id',link.brand_id).eq('id',link.target_id).maybeSingle()
    if (targetError) throw targetError
    if (!target?.active) return json({error:'해당 브랜드에서 비활성화된 업체입니다.'},409)
    const capture = body.capture == null ? null : browserDocument(body.capture,link.url)
    const collector = webSearch ? WEB_SEARCH_COLLECTOR : capture ? BROWSER_COLLECTOR : TEXT_COLLECTOR
    admin = makeAdmin()
    // Old rule observations must not masquerade as a fresh text/AI test.
    const {data:recent,error:recentError} = await admin.from('md_price_checks').select('*').eq('brand_id',link.brand_id).eq('url_id',urlId).eq('rule_state',collector).gte('checked_at',new Date(Date.now()-60_000).toISOString()).order('checked_at',{ascending:false}).limit(1)
    if (recentError) throw recentError
    if (recent?.length) return json({ok:true,check:recent[0],reused:true,timing:{...timing,totalMs:Date.now()-started}})
    const {data:claimed,error:claimError} = await admin.rpc('md_price_claim',{p_scope:`url:${urlId}`,p_seconds:120})
    if (claimError) throw claimError
    if (!claimed) return json({error:'다른 직원이 해당 링크를 확인 중입니다. 잠시 후 미확인만 재시도해 주세요.'},409)
    lease = true
    let result = unknown('수집하지 못했습니다.'), source = 'none'
    try {
      if (webSearch) {
        const {data:route,error:routeError} = await client.from('ai_feature_routes').select('provider,model_id,is_active').eq('brand_id',link.brand_id).eq('feature_key',FEATURE).maybeSingle()
        if (routeError) throw routeError
        const apiKey = Deno.env.get('OPENAI_API_KEY')
        if (!route?.is_active || route.provider !== 'openai' || !apiKey) result = unknown('AI 웹 검색 설정 또는 서버 API 키가 없습니다.')
        else {
          const request = webSearchRequest(route.model_id,link.url,link.mall_product_name ?? '')
          const aiStarted = Date.now()
          let usageStatus = 'error'
          source = 'ai'
          try {
            const response = await fetch('https://api.openai.com/v1/responses',{
              method:'POST',signal:AbortSignal.timeout(55_000),
              headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(request),
            })
            const payload = await response.json()
            Object.assign(timing,webSearchUsage(payload))
            if (!response.ok) {
              console.warn('[md-price] 웹 검색 API 오류',{urlId,status:response.status,code:payload.error?.code,param:payload.error?.param,...context})
              result = unknown(`AI 웹 검색 요청 실패 (${response.status}) · AI 모델의 검색 지원과 사용 한도를 확인해 주세요.`,'failed')
            } else {
              result = validateWebSearch(payload,link.url,context)
              usageStatus = payload.status === 'completed' ? 'ok' : 'error'
            }
          } finally {
            timing.aiMs = Date.now()-aiStarted
            const {error:usageError} = await client.from('ai_usage_logs').insert({brand_id:link.brand_id,user_id:userId,feature_key:FEATURE,provider:'openai',model_id:route.model_id,action:'web_search_price',status:usageStatus,input_tokens:timing.inputTokens,output_tokens:timing.outputTokens,resolution_source:'ai',latency_ms:timing.aiMs})
            if (usageError) console.warn('[md-price] 웹 검색 사용량 저장 실패',{urlId,code:usageError.code,...context})
          }
        }
      } else {
      const crawlStarted = Date.now()
      let fetched: Awaited<ReturnType<typeof page>>
      if(capture){fetched={html:'',status:capture.status,url:capture.url,domain:capture.url.hostname};timing.crawlMs=capture.crawlMs}
      else {try { fetched = await page(link.url) } finally { timing.crawlMs = Date.now()-crawlStarted }}
      const {html,status,url} = fetched
      if ([404,410].includes(status)) result = unknown('상품 페이지 없음 · 판매 종료 여부 확인 필요','ended')
      else if ([401,403,429].includes(status)) result = unknown(`접근 제한 (${status}) · 판매 종료로 판단하지 않습니다.`,'blocked')
      else if (status !== 200) result = unknown(status===0 ? '상품 화면을 불러오지 못했습니다. 접속 상태를 확인해 주세요.' : `쇼핑몰 응답 오류 (${status})`,'failed')
      else {
        const originalId = shopProductId(safeShopUrl(link.url))
        const extractStarted = Date.now()
        const document = capture?.document ?? priceDocument(html,context)
        timing.extractMs = Date.now()-extractStarted
        if (timing.extractMs >= 200) {
          const log = timing.extractMs >= 1000 ? console.warn : console.info
          log('[md-price] 느린 본문 정리',{urlId,elapsedMs:timing.extractMs,...context})
        }
        timing.inputChars = document.visibleText.length
        if (originalId && originalId !== shopProductId(url)) result = unknown('이동된 페이지의 상품 번호가 등록 URL과 다릅니다.')
        else if (document.blocked) result = unknown('접근 제한 페이지 · 운영 상태 미확인','blocked')
        else if (document.visibleText.length < 30 || !/\d[\d,]*\s*원|[₩]\s*\d|품절|판매\s*(종료|중지)|구매\s*불가/i.test(document.visibleText)) result = unknown('상품 가격·판매 상태가 수집 본문에 없습니다. 화면 실행이 필요한 페이지일 수 있습니다.')
        else {
          const {data:route,error:routeError} = await client.from('ai_feature_routes').select('provider,model_id,is_active').eq('brand_id',link.brand_id).eq('feature_key',FEATURE).maybeSingle()
          if (routeError) throw routeError
          const apiKey = Deno.env.get('OPENAI_API_KEY')
          if (!route?.is_active || route.provider !== 'openai' || !apiKey) result = unknown('AI 가격 분석 설정 또는 서버 API 키가 없습니다.')
          else {
            source = 'ai'
            const aiStarted = Date.now()
            let usageStatus = 'error'
            try {
              const response = await fetch('https://api.openai.com/v1/chat/completions',{
                method:'POST',signal:AbortSignal.timeout(45_000),
                headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
                body:JSON.stringify({model:route.model_id,max_completion_tokens:1600,
                  ...(/^gpt-(?:5|6)/.test(route.model_id) ? {reasoning_effort:'low'} : {}),
                  response_format:{type:'json_schema',json_schema:{name:'product_price',strict:true,schema:PRICE_TEXT_SCHEMA}},
                  messages:[{role:'system',content:PRICE_TEXT_PROMPT},{role:'user',content:JSON.stringify({url:url.href,collectionMode:collector,visibleText:document.visibleText,purchaseControls:capture?.controls ?? [],supplementaryMetadata:document.metadata})}],
                }),
              })
              if (!response.ok) { await response.body?.cancel(); result = unknown(`AI 요청 실패 (${response.status})`,'failed') }
              else {
                const payload = await response.json()
                timing.inputTokens = payload.usage?.prompt_tokens ?? 0; timing.outputTokens = payload.usage?.completion_tokens ?? 0
                const choice = payload.choices?.[0]
                if (choice?.finish_reason !== 'stop' || choice?.message?.refusal) result = unknown('AI 분석이 완료되지 않았습니다. 다시 확인해 주세요.')
                else {
                  const analysis=JSON.parse(choice.message.content)
                  result = validateTextPrice(analysis,document.visibleText)
                  if(analysis.status==='ok' && result.status!=='ok'){
                    console.info('[md-price] 가격 근거 검증 보류',{urlId,reason:result.message,
                      basis:String(analysis.basis??'').slice(0,40),conditions:String(analysis.conditions??'').slice(0,300),
                      priceEvidence:String(analysis.priceEvidence??'').slice(0,300),...context})
                  }
                  if(capture && result.status==='ok'){
                    const active=capture.controls.some(c=>!c.disabled&&/구매|장바구니/.test(c.text))
                    if(!active) result=unknown('활성 구매 버튼을 확인하지 못했습니다. 판매 상태 확인 필요')
                    else result.basis=result.basis.replace('AI 텍스트','브라우저 AI')
                  }
                  usageStatus = 'ok'
                }
              }
            } finally {
              timing.aiMs = Date.now()-aiStarted
              const {error:usageError} = await client.from('ai_usage_logs').insert({brand_id:link.brand_id,user_id:userId,feature_key:FEATURE,provider:'openai',model_id:route.model_id,action:'read_crawled_price_text',status:usageStatus,input_tokens:timing.inputTokens,output_tokens:timing.outputTokens,resolution_source:'ai',latency_ms:timing.aiMs})
              if (usageError) console.warn('[md-price] AI 사용량 저장 실패',{urlId,code:usageError.code,...context})
            }
          }
        }
      }
      }
    } catch (error) {
      console.warn('[md-price] 가격 수집 실패',{urlId,collector,name:error instanceof Error ? error.name : 'unknown',...context})
      const message = error instanceof Error ? error.message : '수집 처리 오류'
      result = unknown(/error sending request|tcp connect|tls|certificate/i.test(message) ? '쇼핑몰 서버에 연결하지 못했습니다. 운영 상태는 미확인입니다.' : /timeout|abort/i.test(message) ? '수집 또는 AI 분석 제한 시간 초과' : message,'failed')
    }
    const {data:check,error:saveError} = await admin.from('md_price_checks').insert({brand_id:link.brand_id,url_id:urlId,...result,source,rule_state:collector,option_verified:false}).select().single()
    if (saveError) throw saveError
    timing.totalMs = Date.now()-started+(capture?.crawlMs ?? 0)
    console.info('[md-price] 가격 분석 완료',{urlId,collector,status:result.status,source,...timing,...context})
    return json({ok:true,check,reused:false,timing})
  } catch (error) {
    console.warn('[md-price] 요청 실패',{urlId,userId,name:error instanceof Error ? error.name : 'unknown',detail:error instanceof Error ? error.message.slice(0,240) : String((error as {code?:string})?.code ?? 'unknown'),...context})
    return json({error:'가격 최신화 요청을 완료하지 못했습니다.'},500)
  } finally {
    if (lease && admin) {
      const {error} = await admin.from('md_price_collection_leases').update({expires_at:new Date().toISOString()}).eq('scope',`url:${urlId}`)
      if (error) console.warn('[md-price] 수집 잠금 해제 실패',{urlId,code:error.code,...context})
    }
  }
})
