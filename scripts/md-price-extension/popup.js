import {readSmartstoreProduct} from './read-product.js'

const button = document.querySelector('#capture')
const status = document.querySelector('#status')
const result = document.querySelector('#result')
button.addEventListener('click',async()=>{
  button.disabled = true
  result.hidden = true
  status.textContent = '상품 본문을 읽는 중입니다…'
  const context = {path:'extension/popup',lastInput:'상품 본문 읽기'}
  try {
    const config = await (await fetch('config.json')).json()
    const endpoint = new URL(config.endpoint)
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/capture') throw new Error('테스트 수신기 주소가 올바르지 않습니다.')
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true})
    if (!tab?.id || !/^https:\/\/smartstore\.naver\.com\/masmarulez\/products\/\d+\/?(?:[?#]|$)/.test(tab.url || '')) throw new Error('마스마룰즈 스마트스토어 상품 상세페이지를 열고 실행해 주세요.')
    const captures = await chrome.scripting.executeScript({target:{tabId:tab.id},func:readSmartstoreProduct})
    const capture = captures[0]?.result
    if (!capture || capture.error) throw new Error(capture?.error || '상품 본문을 읽지 못했습니다.')
    result.textContent = `${capture.pageName}\n\n${capture.visibleText}`
    result.hidden = false
    status.textContent = '본문 읽기 성공 · 이 PC에 결과 저장 중…'
    const response = await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},body:JSON.stringify(capture),signal:AbortSignal.timeout(5000),credentials:'omit'})
    const saved = await response.json()
    if (!response.ok || !saved.ok) throw new Error(saved.error || '테스트 결과 저장 실패')
    status.textContent = `테스트 결과 저장 완료 · ${capture.visibleText.length.toLocaleString()}자 · ${capture.readMs}ms`
    console.info('[md-price] 확장 본문 읽기 완료',{chars:capture.visibleText.length,readMs:capture.readMs,...context})
  } catch (error) {
    console.warn('[md-price] 확장 읽기 테스트 실패',{message:error.message,...context})
    status.textContent = `확인 필요: ${error.message}`
  } finally {button.disabled = false}
})
