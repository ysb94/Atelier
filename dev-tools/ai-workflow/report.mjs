export function koreanTime(instant) {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(instant))
}

export function validateCompletionReport(report) {
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1800
  if (!report || !['development','verification'].includes(report.deployment)||!['location','summary','howToUse','remaining'].every(key=>text(report[key]))
    || !['changes','checked'].every(key=>Array.isArray(report[key])&&report[key].length>0&&report[key].length<=12&&report[key].every(text))) throw new Error('작업 위치·변경 내용·사용 방법·확인 결과를 담은 완료 보고서가 필요합니다.')
  const all=[report.location,report.summary,report.howToUse,report.remaining,...report.changes,...report.checked].join('\n')
  if(/(?:\b(?:src|dev-tools|supabase)\/|\.(?:tsx?|mjs)\b|npm run|\b(?:MCP|SQL|Cursor|Codex)\b)/i.test(all))throw new Error('완료 보고서는 코드 경로나 개발 도구 설명을 사용자 화면의 쉬운 표현으로 바꿔야 합니다.')
  return report
}

function publicationLines(publication) {
  if(!publication.prUrl)return ['코드 변경 없이 확인 작업만 수행했습니다. 브랜치 게시나 검토 요청(PR)을 만들지 않았고 운영 사이트를 변경하지 않았습니다.']
  return [`작업 브랜치 ${publication.branch}에 저장하고 통합 브랜치 ${publication.integrationBranch} 대상 검토 요청(PR)을 만들었습니다: ${publication.prUrl}`,
    `기준: ${publication.baseBranch} @ ${publication.baseCommit.slice(0,12)} · 반영 상태: ${publication.reflection}`,
    '코드 작업은 완료되었고 사용자의 통합 선택을 기다립니다. 통합 브랜치와 main 반영은 사용자가 선택·승인한 뒤 진행하며 운영 사이트에는 게시하지 않았습니다.']
}

// `publication` (v2) describes the real branch/PR state instead of a development-screen merge.
export function completionReportBlock(task, report, completedAt, publication) {
  validateCompletionReport(report)
  if(!task.source?.screen||!Number.isFinite(Date.parse(completedAt)))throw new Error('완료 보고서에 실제 출처와 완료 시각이 필요합니다.')
  const rich = content => [{type:'text',text:{content}}]
  const paragraph = content => ({object:'block',type:'paragraph',paragraph:{rich_text:rich(content)}})
  const heading = content => ({object:'block',type:'heading_3',heading_3:{rich_text:rich(content)}})
  const bullet = content => ({object:'block',type:'bulleted_list_item',bulleted_list_item:{rich_text:rich(content)}})
  const header = `완료 보고서 · ${koreanTime(completedAt)}`
  return {object:'block',type:'callout',callout:{icon:{type:'emoji',emoji:'✅'},rich_text:rich(header),children:[
    paragraph(`메모 출처: ${task.source.area?`${task.source.area} → `:''}${task.source.screen}`),
    paragraph(`작업한 곳: ${report.location}`),paragraph(`완료 시각: ${koreanTime(completedAt)} (한국시간)`),
    paragraph(report.summary),heading('바뀐 점'),...report.changes.map(bullet),
    heading('사용 방법'),paragraph(report.howToUse),heading('확인한 결과'),...report.checked.map(bullet),
    heading('적용 상태와 남은 확인'),
    ...(publication?publicationLines(publication).map(paragraph):[paragraph(report.deployment==='development'?'개발 환경에 적용했습니다. 운영 사이트에 게시하지 않았습니다.':'확인 작업만 수행했습니다. 운영 사이트를 변경하지 않았습니다.')]),
    paragraph(report.remaining)
  ]}}
}
