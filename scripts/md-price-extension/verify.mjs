import assert from 'node:assert/strict'
import {request} from 'node:http'
import {createProbeServer,validateProbeCapture} from './probe-server.mjs'

const value={version:1,url:'https://smartstore.naver.com/masmarulez/products/13243466853',title:'Tiny drop heart keyring',pageName:'Tiny drop heart keyring',visibleText:'Tiny drop heart keyring\n판매가 22,000원\n장바구니',controls:[{text:'장바구니',disabled:false}],httpStatus:200,scope:'smartstore-heading-purchase-panel',readMs:20,collectedAt:new Date().toISOString(),transport:'ordinary-chrome-extension'}
assert.deepEqual(validateProbeCapture(value),value)
for (const invalid of [
  {...value,url:'https://smartstore.naver.com.evil.example/masmarulez/products/13243466853'},
  {...value,url:'https://user:secret@smartstore.naver.com/masmarulez/products/13243466853'},
  {...value,url:'http://127.0.0.1/'}, {...value,url:'https://smartstore.naver.com/another/products/13243466853'},
  {...value,visibleText:'x'.repeat(22_001)}, {...value,visibleText:'Other item 100원 구매하기'},
  {...value,httpStatus:0}, {...value,readMs:-1}, {...value,controls:[{text:'구매',disabled:'false'}]},
]) assert.throws(()=>validateProbeCapture(invalid))
const received=[]
const origin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const server=createProbeServer({extensionOrigin:origin,token:'local-test-token',onCapture:async capture=>received.push(capture)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const endpoint=`http://127.0.0.1:${server.address().port}/capture`
const headers={'Content-Type':'application/json',Origin:origin,Authorization:'Bearer local-test-token'}
try {
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:JSON.stringify(value)})).status,403)
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Authorization:'Bearer wrong'},body:JSON.stringify(value)})).status,401)
  const wrongHostStatus = await new Promise((resolve,reject)=>{
    const req=request(endpoint,{method:'POST',headers:{...headers,Host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))})
    req.on('error',reject);req.end(JSON.stringify(value))
  })
  assert.equal(wrongHostStatus,403)
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:'x'.repeat(100_001)})).status,413)
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(value)})).status,200)
  assert.equal(received.length,1)
  assert.deepEqual(received[0],value)
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
console.log('PASS: extension probe URL/body limits, exact origin, token, host and loopback result delivery')
