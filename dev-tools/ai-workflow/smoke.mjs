import { settings } from './settings.mjs'
import { Notion } from './notion.mjs'

// This command queues only the synthetic task created for this integration test.
// It never reads business tasks or asks Cursor to inspect database content.
const id='3f763ce0-dccd-813e-b5ac-d35563a7da97'
const notion=new Notion(settings())
const task=await notion.task(id)
const expectedRequest='dev-tools/ai-workflow/SMOKE_RESULT.md에 자동화 사용 안내를 한글로 작성한다. npm run dev로 개발 서버와 구조도 및 자동화 관리자가 함께 실행된다는 점, 설정 대기 시 확인할 항목, 노션에서 업무를 대기로 지정하는 방법을 설명한다. Cursor는 파일 편집만 수행하고 변경 범위 확인·검증 명령·구조도 갱신은 관리자가 수행한다는 설명을 유지한다. Cursor CLI 계정 로그인, 관리자용 NOTION_TOKEN, 개별 MCP OAuth 로그인이 서로 다른 설정임을 설명하고 npm run ai:mcp:status 및 npm run ai:mcp:login -- notion 또는 supabase를 안내한다. Cloudflare는 사용자의 요청으로 자동화 대상에서 제외됐음을 설명한다. 터미널 명령을 요청하지 않는다. 실제 실행 성공 여부를 지어내지 않는다. 이 문서 외 파일은 수정하지 않는다.'
if(task.title!=='자동화 연결 시험: 개발 도구 안내 문서 작성'||task.files!=='dev-tools/ai-workflow/SMOKE_RESULT.md'||task.request!==expectedRequest)throw new Error('시험 업무가 변경되었습니다. 내용을 확인한 뒤 직접 실행하세요.')
await notion.publish(id,{state:'대기',summary:'합성 시험 업무를 실행 대기열에 등록했습니다. 실제 Cursor 작업·Codex 검토 결과를 기다립니다.'})
console.info('[ai-workflow] 시험 업무 등록:',task.url)
