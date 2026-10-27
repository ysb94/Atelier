import {liveFixture} from './work-live-auth'
const actor=()=>liveFixture.profile.id
async function request(path:string,body:unknown){const response=await fetch('/__work-test/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Actor':actor()},body:JSON.stringify(body)});return response.json()}
const channels=new Map<unknown,EventSource>()
export function getSupabase(){return {
 rpc:async(name:string,args:Record<string,unknown>={})=>request('rpc',{name,args}),
 from:(table:string)=>{const filters:{column:string;value:unknown;op:string}[]=[];let single=false;const query={select:()=>query,eq:(column:string,value:unknown)=>{filters.push({column,value,op:'eq'});return query},in:(column:string,value:unknown)=>{filters.push({column,value,op:'in'});return query},order:()=>query,range:()=>query,limit:()=>query,maybeSingle:()=>{single=true;return query},single:()=>{single=true;return query},then:(resolve:(value:unknown)=>unknown)=>request('table',{table,filters,single}).then(resolve)};return query},
 channel:()=>{const callbacks:(()=>void)[]=[];const channel={on:(_event:string,_filter:unknown,callback:()=>void)=>{callbacks.push(callback);return channel},subscribe:(status?:(value:string)=>void)=>{const events=new EventSource('/__work-test/events');events.onopen=()=>status?.('SUBSCRIBED');events.onmessage=()=>callbacks.forEach(callback=>callback());channels.set(channel,events);return channel}};return channel},
 removeChannel:async(channel:unknown)=>{channels.get(channel)?.close();channels.delete(channel)},
 storage:{from:(_bucket:string)=>({
  upload:async(path:string,file:File)=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return request('upload',{path,bytes:btoa(binary),size:file.size})},
  download:async(path:string)=>{const result=await request('download',{path});return result.error?result:{data:new Blob([Uint8Array.from(atob(result.data),(c:string)=>c.charCodeAt(0))]),error:null}},
  remove:async(paths:string[])=>request('remove',{paths})
 })}
}}
export const isSupabaseConfigured=()=>true
