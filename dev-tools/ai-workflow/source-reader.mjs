import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { inside } from './settings.mjs'
import { digest, readFile, isManagerArtifact } from './workspace.mjs'
import { excludedFromWorkspace } from './isolation.mjs'
import { sourceRequest, sourceSlice } from './source-slices.mjs'

export const READER_VERSION='paged-source-v1'
export const READER_LIMITS=Object.freeze({chunkChars:10000,totalChars:160000,maxCalls:40})
const integer=(v,fallback,min=1,max=1000000)=>Number.isInteger(v)?Math.max(min,Math.min(max,v)):fallback
const textFile=file=>/\.(?:[cm]?[jt]sx?|css|json|md|txt|sql|ya?ml|toml|html)$/.test(file)

export class SourceReader {
  constructor(manifest,{auditFile}={}) {
    this.manifest=manifest;this.root=fs.realpathSync(manifest.root);this.auditFile=auditFile
    this.limits={...READER_LIMITS,...manifest.limits}
    this.audit={version:READER_VERSION,calls:0,responseChars:0,reads:[],diffReads:[]}
    this.inventory=Object.keys(manifest.snapshot??{}).filter(file=>!excludedFromWorkspace(file)&&file!=='dev-tools/ai-workflow/config.local.json'&&!isManagerArtifact(file)&&textFile(file))
    this.cache=new Map()
  }
  save(){if(this.auditFile){const temp=`${this.auditFile}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(this.audit));fs.renameSync(temp,this.auditFile)}}
  source(file) {
    const normalized=String(file??'').replaceAll('\\','/')
    inside(this.root,normalized)
    if(excludedFromWorkspace(normalized)||normalized==='dev-tools/ai-workflow/config.local.json')throw Error('비공개 경로는 읽을 수 없습니다.')
    if(isManagerArtifact(normalized))throw Error('생성 구조도 전체 대신 structure_evidence 도구로 필요한 파일·연결을 조회하세요.')
    if(!textFile(normalized))throw Error('읽기 수집기는 코드·문서 텍스트만 제공합니다.')
    if(!(normalized in (this.manifest.snapshot??{})))return {path:normalized,missing:true,suggestions:this.inventory.filter(p=>p.endsWith('/'+path.posix.basename(normalized))).slice(0,10)}
    const body=readFile(this.root,normalized),hash=body===null?null:digest(body)
    if(hash!==(this.manifest.snapshot[normalized]??null)){this.audit.invalidated=true;this.save();throw Error(`검증/계획 이후 소스가 바뀌었습니다: ${normalized}`)}
    return {path:normalized,body,hash,lines:body?.split('\n')??[]}
  }
  page(lines,start,end,maxChars=this.limits.chunkChars) {
    if(start>lines.length)return {start,totalLines:lines.length,content:'',nextLine:null,outOfRange:true}
    const remaining=this.limits.totalChars-this.audit.responseChars-(this.pendingChars??0)
    if(remaining<1024){this.audit.exhausted=true;throw Error('자료 읽기 한도에 도달했습니다. 근거 없이 합격시키지 마세요.')}
    maxChars=Math.min(maxChars,Math.floor((remaining-768)/2))
    const parts=[];let chars=0,last=start-1
    for(let i=start-1;i<Math.min(end,lines.length);i++){
      const line=lines[i]
      if(chars+line.length+1>maxChars)break
      parts.push(line);chars+=line.length+1;last=i+1
    }
    if(!parts.length)throw Error('한 줄이 페이지 한도보다 큽니다. JSON 생성물은 structure_evidence로 조회하세요.')
    return {start,end:last,totalLines:lines.length,content:parts.join('\n'),nextLine:last<Math.min(end,lines.length)?last+1:null}
  }
  readSource(args) {
    const request=sourceRequest(args.path)
    if(isManagerArtifact(request.path))return this.structureEvidence({paths:this.manifest.taskFiles??[],query:args.query??''})
    const s=this.source(request.path)
    if(s.missing)return s
    if(s.body===null)return {path:s.path,sha256:null,deleted:true}
    const start=integer(args.startLine,request.range?.[0]??1),end=integer(args.endLine,request.range?.[1]??s.lines.length)
    const page=this.page(s.lines,start,end)
    if(page.end)this.audit.reads.push({path:s.path,sha256:s.hash,start:page.start,end:page.end})
    return {path:s.path,sha256:s.hash,complete:page.start===1&&page.end===s.lines.length,...page}
  }
  findSource(args) {
    const query=String(args.query??'').slice(0,160).toLowerCase(),prefix=String(args.pathPrefix??'')
    const files=this.inventory.filter(file=>file.startsWith(prefix)&&file.toLowerCase().includes(query))
    const offset=integer(args.offset,0,0),limit=integer(args.limit,25,1,40)
    return {files:files.slice(offset,offset+limit),total:files.length,nextOffset:offset+limit<files.length?offset+limit:null}
  }
  searchSource(args) {
    const query=String(args.query??'').slice(0,160)
    if(!query.trim())throw Error('검색어가 비어 있습니다.')
    const files=args.path?[sourceRequest(args.path).path]:this.inventory.filter(file=>file.startsWith(String(args.pathPrefix??'src/')))
    const offset=integer(args.offset,0,0),lineOffset=integer(args.lineOffset,1),matches=[]
    let inspected=0
    for(const file of files.slice(offset,offset+60)){
      inspected++;const s=this.source(file);if(s.missing||s.body===null)continue
      for(let i=inspected===1?lineOffset-1:0;i<s.lines.length;i++)if(s.lines[i].toLowerCase().includes(query.toLowerCase())){
        matches.push({path:file,line:i+1,text:s.lines[i].slice(0,350)})
        if(matches.length>=20)return {matches,nextFileOffset:offset+inspected-1,nextLineOffset:i+2,moreMatches:true}
      }
    }
    return {matches,nextFileOffset:offset+inspected<files.length?offset+inspected:null}
  }
  structureEvidence(args) {
    const file='dev-tools/structure-map/generated/structure.json',absolute=inside(this.root,file)
    if(!fs.existsSync(absolute))return {missing:true,reason:'구조도 없음'}
    const real=fs.realpathSync(absolute);inside(this.root,path.relative(this.root,real))
    if(fs.statSync(real).size>30000000)throw Error('구조도 분석 파일이 비정상적으로 큽니다.')
    const map=JSON.parse(fs.readFileSync(real,'utf8')),query=String(args.query??'').slice(0,160).toLowerCase()
    const paths=Array.isArray(args.paths)?args.paths.slice(0,30):(this.manifest.taskFiles??[]).slice(0,30)
    const nodes=map.nodes.filter(n=>paths.includes(n.path)||(query&&JSON.stringify([n.path,n.label]).toLowerCase().includes(query))).slice(0,30)
    const selected=new Set([...paths,...nodes.map(n=>n.path)]),edges=map.edges.filter(e=>selected.has(e.from??e.source)||selected.has(e.to??e.target))
    const offset=integer(args.offset,0,0)
    return {method:'filtered-static-structure',sha256:digest(fs.readFileSync(real)),generatedAt:map.generatedAt,
      nodes:nodes.map(({path:source,label,exports,sections})=>({path:source,label,exports,sections})),
      routes:(map.routes??[]).filter(r=>(r.targets??[]).some(p=>selected.has(p))),
      edges:edges.slice(offset,offset+30),nextOffset:offset+30<edges.length?offset+30:null,
      note:'정적 구조도이며 실제 소스의 줄·구현을 별도로 확인해야 합니다. 생성 JSON 전체는 모델에 보내지 않습니다.'}
  }
  readDiff(args) {
    const index=integer(args.index,0,0),change=(this.manifest.changes??[])[index]
    if(!change)return {missing:true,changes:(this.manifest.changes??[]).map((c,i)=>({index:i,path:c.file,chars:c.diff?.length??0}))}
    if(change.file&&change.file in (this.manifest.snapshot??{}))this.source(change.file)
    const lines=String(change.diff??'').split('\n'),page=this.page(lines,integer(args.startLine,1),integer(args.endLine,lines.length))
    this.audit.diffReads.push({index,start:page.start,end:page.end,sha256:digest(change.diff??'')})
    return {index,path:change.file,diffHash:digest(change.diff??''),...page}
  }
  coverage() {
    const missing=[]
    for(let index=0;index<(this.manifest.changes??[]).length;index++){
      const change=this.manifest.changes[index]
      if(!change.diff||this.manifest.includedDiffs?.includes(index))continue
      const total=change.diff.split('\n').length,reads=this.audit.diffReads.filter(r=>r.index===index).sort((a,b)=>a.start-b.start)
      let next=1
      for(const r of reads){if(r.start>next)break;next=Math.max(next,r.end+1)}
      if(next<=total)missing.push({index,path:change.file,nextLine:next,totalLines:total})
    }
    return {missingDiffs:missing,callsRemaining:this.limits.maxCalls-this.audit.calls,readCharsRemaining:this.limits.totalChars-this.audit.responseChars}
  }
  call(name,args={}) {
    if(this.audit.calls>=this.limits.maxCalls){this.audit.exhausted=true;this.save();throw Error('읽기 호출 한도에 도달했습니다. 조사 범위를 좁히고 근거 없이 합격시키지 마세요.')}
    const readCount=this.audit.reads.length,diffCount=this.audit.diffReads.length
    this.audit.calls++
    try {
    let result
    if(name==='read_source')result=this.readSource(args)
    else if(name==='read_sources'){
      if(!Array.isArray(args.requests)||!args.requests.length||args.requests.length>6)throw Error('묶음 조회는 독립된 소스 요청 1~6개여야 합니다.')
      const files=[];let pendingRequests=[];this.pendingChars=0
      try{for(let i=0;i<args.requests.length;i++){
        const remaining=this.limits.totalChars-this.audit.responseChars-this.pendingChars
        // Keep already collected pages when a later file cannot fit. Only
        // delivered files count as read; the caller can request the rest.
        if(files.length&&remaining<Math.max(2048,JSON.stringify(args.requests.slice(i)).length+1024)){
          pendingRequests=args.requests.slice(i);break
        }
        const value=this.readSource(args.requests[i]);files.push(value);this.pendingChars+=JSON.stringify(value).length+64
      }}finally{this.pendingChars=0}
      result={files,...(pendingRequests.length?{pendingRequests,budgetLimited:true}: {})}
    }
    else if(name==='find_sources')result=this.findSource(args)
    else if(name==='search_source')result=this.searchSource(args)
    else if(name==='source_outline'){
      const s=this.source(args.path)
      result=s.missing?s:{path:s.path,sha256:s.hash,totalLines:s.lines.length,outline:sourceSlice(s.path,s.body,{maxChars:12000}).outline??[],note:'소스 원문은 read_source로 줄 범위를 읽으세요.'}
    }
    else if(name==='structure_evidence')result=this.structureEvidence(args)
    else if(name==='read_diff')result=this.readDiff(args)
    else if(name==='review_coverage')result=this.coverage()
    else throw Error('지원하지 않는 읽기 도구입니다.')
    result.budget={callsRemaining:this.limits.maxCalls-this.audit.calls,readCharsRemaining:this.limits.totalChars-this.audit.responseChars}
    let output=JSON.stringify(result)
    for(let i=0;i<3;i++){result.budget.readCharsRemaining=this.limits.totalChars-this.audit.responseChars-output.length;output=JSON.stringify(result)}
    if(output.length>(name==='read_sources'?64000:20000))throw Error('조회 결과가 큽니다. 경로·검색어 또는 페이지 범위를 더 좁혀 주세요.')
    if(this.audit.responseChars+output.length>this.limits.totalChars){if(this.limits.totalChars-this.audit.responseChars<1024)this.audit.exhausted=true;throw Error('조회 결과가 남은 자료 읽기 한도보다 큽니다. 더 좁은 줄 범위를 요청하세요.')}
    this.audit.responseChars+=output.length;this.save()
    return result
    } catch(error){
      // A response that was not delivered must never satisfy review coverage.
      this.audit.reads.length=readCount;this.audit.diffReads.length=diffCount;this.save();throw error
    }
  }
}

const schema=properties=>({type:'object',properties,additionalProperties:false})
const str={type:'string'},num={type:'integer',minimum:0}
export const SOURCE_TOOLS=[
  {name:'read_source',description:'작업 브랜치의 실제 소스를 10,000자 이하 페이지로 읽습니다. 큰 요청은 nextLine으로 이어 읽으세요. #L시작-L끝 또는 startLine/endLine 지원. 구조도 생성 파일은 필터된 연결 근거로 변환합니다.',inputSchema:{...schema({path:str,startLine:num,endLine:num}),required:['path']}},
  {name:'read_sources',description:'서로 독립인 파일 구간 1~6개를 한 번에 조회하여 반복 입력 소모를 줄입니다. 각 파일 최대 10,000자입니다. nextLine은 이어 읽을 줄이며, pendingRequests는 잔여 한도 때문에 아직 제공하지 않은 파일입니다.',inputSchema:{...schema({requests:{type:'array',minItems:1,maxItems:6,items:{...schema({path:str,startLine:num,endLine:num}),required:['path']}}}),required:['requests']}},
  {name:'find_sources',description:'검증 시점의 실제 파일 경로 목록에서 검색합니다. 없는 경로를 추측하지 마세요.',inputSchema:schema({query:str,pathPrefix:str,offset:num,limit:num})},
  {name:'search_source',description:'실제 코드·문서에서 문자열 위치를 찾습니다. 결과의 정확한 줄을 read_source로 확인하세요.',inputSchema:{...schema({query:str,path:str,pathPrefix:str,offset:num,lineOffset:num}),required:['query']}},
  {name:'source_outline',description:'큰 파일의 함수·타입 위치를 찾습니다. 원문 검토를 대신하지 않습니다.',inputSchema:{...schema({path:str}),required:['path']}},
  {name:'structure_evidence',description:'거대한 구조도 JSON 대신 필요한 경로·라우트·import 연결만 페이지로 조회합니다.',inputSchema:schema({paths:{type:'array',items:str,maxItems:30},query:str,offset:num})},
  {name:'read_diff',description:'프롬프트에 다 들어가지 않은 실제 변경 diff를 페이지로 읽습니다. nextLine이 있으면 이어 읽으세요.',inputSchema:schema({index:num,startLine:num,endLine:num})},
  {name:'review_coverage',description:'검수 합격 전 변경 diff의 누락 구간과 자료 읽기 잔여 한도를 확인합니다.',inputSchema:schema({})},
]

export function serveSourceReader(manifestFile,auditFile) {
  const reader=new SourceReader(JSON.parse(fs.readFileSync(manifestFile,'utf8')),{auditFile})
  reader.save()
  const lines=createInterface({input:process.stdin})
  lines.on('line',line=>{
    let request
    try{request=JSON.parse(line)}catch{return}
    if(request.id===undefined)return
    let result,error
    try {
      if(request.method==='initialize')result={protocolVersion:request.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'atelier-read-only-sources',version:READER_VERSION}}
      else if(request.method==='tools/list')result={tools:SOURCE_TOOLS.map(tool=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}))}
      else if(request.method==='tools/call'){
        try{result={content:[{type:'text',text:JSON.stringify(reader.call(request.params.name,request.params.arguments))}]}}
        catch(problem){result={isError:true,content:[{type:'text',text:problem.message}]}}
      }
      else if(request.method==='ping')result={}
      else error={code:-32601,message:'Method not found'}
    }catch(problem){error={code:-32603,message:problem.message}}
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,...(error?{error}:{result})})+'\n')
  })
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))serveSourceReader(process.argv[2],process.argv[3])
