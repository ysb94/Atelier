export const readable=value=>String(value??'').replace(/`[^`]+`/g,'관련 기능').replace(/(?:src|dev-tools|supabase)\/[\w./-]+/g,'관련 기능').replace(/\b(?:MCP|SQL|API|RLS|Cursor|Codex)\b/gi,'연결 기능').trim()

export function needsInputFeedback(task,message,explicitQuestion='') {
  const raw=String(message??''),title=String(task.title??'이 작업').slice(0,300)
  let reason,question,executorAction=false
  if(/자동화 검토 환경 준비 필요|app-server socket directory|bubblewrap|검토 환경 오류|검토 도구 실행 환경/i.test(raw)){
    executorAction=true
    reason='검토기가 실제 파일을 읽는 실행 환경에 오류가 있어 완료 검토를 진행하지 못했어요. 사용자 답변이 부족해서 멈춘 것이 아닙니다.'
    question=explicitQuestion||'추가 답변은 필요하지 않습니다. 자동화 실행기에서 검토기의 파일 읽기 환경을 복구하고, 보관된 작업 결과를 다시 검토해야 합니다. 같은 화면 확인 질문에 다시 답하거나 같은 작업을 반복할 필요는 없습니다.'
  }else if(/Codex.*(?:구독|API 키|과금)/.test(raw)){
    executorAction=true
    reason='추가 API 과금을 막기 위해 구독 계정 로그인 확인에서 멈췄어요.'
    question=explicitQuestion||'내 답변을 다시 적을 필요는 없습니다. 실행기가 있는 작업장에서 Codex를 ChatGPT 구독 계정으로 로그인한 뒤 이어서 진행해야 합니다. API 키로 전환하거나 유료 크레딧을 구매하지 않습니다.'
  }else if(/최신.*(?:답변|사용자 답변).*(?:계획|조사 결과)|검증 전용으로 되돌리는 계획/.test(raw)){
    executorAction=true
    reason='자동화가 저장된 답변에 맞는 작업 지시를 준비하지 못해 멈췄어요.'
    question=explicitQuestion||'내 답변은 저장되어 있어 다시 작성할 필요가 없습니다. 자동화의 지시 준비 단계를 확인한 뒤 다시 진행해야 합니다.'
  }else if(/(?:데이터베이스|\bDB\b|스키마|RLS|권한)[\s\S]{0,120}(?:승인|백업)/i.test(`${raw}\n${explicitQuestion}`)){
    reason='요청한 기능을 실제로 저장하려면 회사 데이터베이스와 접근 권한을 바꿔야 해서, 변경 승인과 사전 백업이 필요해요.'
    question=explicitQuestion||'기능을 저장할 공간과 열람·작성 규칙을 데이터베이스에 추가해도 되는지 알려주세요. 승인 범위를 확인하고 변경 전에 백업해야 합니다.'
  }else if(/면제|직책|회사\s*정책|출.?퇴근.*기준|정책.*미정/.test(raw)){
    reason='회사에서 정해야 하는 기준이 아직 확정되지 않아 자동으로 결정할 수 없어요.'
    question=explicitQuestion||'적용할 대상과 기준을 알려주세요. 예를 들어 어떤 직책·팀에 적용하고, 누가 제외되는지 적어주세요.'
  }else if(/브라우저|실제.*(?:화면|로그인|증거)|로그인한.*화면|화면.*(?:검증|확인).*(?:부족|없)/.test(raw)){
    executorAction=true
    reason='자동 검사만으로는 실제 로그인한 화면의 동작을 확인할 수 없어 멈췄어요.'
    question=explicitQuestion||(task.source?.answer?.trim()
      ? '이미 적은 화면 동작의 답변은 저장되어 있습니다. 같은 결과를 다시 적을 필요는 없습니다. 자동화 실행기에서 이번 변경을 확인할 개발 화면과 로그인·화면 검사 수단을 먼저 준비해야 합니다. 사용자에게 필요한 새 정보가 있으면 필요한 항목을 구체적으로 안내해야 합니다.'
      : `자동화 실행기에서 이번 변경을 확인할 로그인 개발 화면과 화면 검사 수단을 준비해야 합니다. 이전 화면 상태를 이번 변경의 검증 결과로 간주하지 않습니다.\n작업: ${title}`)
  }else if(/(?:DB|데이터베이스|스키마|RLS|권한).*(?:변경|승인)|(?:승인|변경).*(?:DB|권한)/i.test(raw)){
    reason='데이터나 접근 권한의 변경이 필요해 자동으로 처리할 수 있는 범위를 넘어요.'
    question=explicitQuestion||'누가 어떤 내용을 볼 수 있어야 하는지 적용 범위를 적어주세요. 설정을 직접 변경했다면 바꾼 내용도 알려주세요.'
  }else if(/변경.*(?:감지|중단)|(?:메모|설정|파일|코드).*(?:바뀌|변경)|허용.*범위.*밖|읽기 전용.*변경/.test(raw)){
    reason='진행 중 메모나 개발 내용이 바뀌어 기존 변경을 보호하려고 멈췄어요.'
    question=explicitQuestion||'변경한 내용을 이번 작업의 기준으로 사용해도 될까요? 의도한 변경과 이어서 진행할 방향을 알려주세요.'
  }else if(/화면과 영역|화면.*지정|원본|필수 정보|선행 조건|추가 정보/.test(raw)){
    reason=readable(raw).slice(0,700)||'작업할 대상이나 필요한 자료가 부족해요.'
    question=explicitQuestion||'작업할 화면과 원하는 동작, 필요한 원본 자료를 메모에 보완해 주세요.'
  }else if(/not authenticated|unauthenticated|로그인 필요|인증.*만료|OAuth/i.test(raw)){
    reason='작업에 필요한 서비스 인증을 사용할 수 없어요.'
    question=explicitQuestion||'해당 서비스의 연결 상태를 확인해 주세요. 다시 연결하거나 직접 처리했다면 결과를 알려주세요.'
  }else if(/검사.*통과하지|검증.*실패|총\s*\d+회|build|lint/i.test(raw)){
    reason='자동 보완으로도 요청한 조건을 모두 확인하지 못해 멈췄어요.'
    question=explicitQuestion||'반드시 충족해야 하는 동작과 우선순위를 구체적으로 적어주세요. 직접 수정했다면 수정한 내용도 알려주세요.'
  }else if(/at capacity|명령 실패|connection|Notion\s*\d|시간 제한|응답|ECONN|HTTP/i.test(raw)){
    reason='작업에 필요한 연결이나 실행 응답에 문제가 생겨 진행을 멈췄어요.'
    question=explicitQuestion||'다시 진행할 작업이면 내 답변에 재시도 요청을 적고 위치를 답변 완료로 옮겨 주세요. 직접 처리했다면 처리 결과를 적어주세요.'
  }else{
    reason=/[가-힣]/.test(raw)?readable(raw).slice(0,700):'자동으로 판단하기에 필요한 정보가 부족해요.'
    question=explicitQuestion||'진행 방향이나 직접 처리한 내용을 알려주세요. 부족한 자료가 있다면 원래 메모에 이어 적어주세요.'
  }
  const how=executorAction&&!explicitQuestion
    ? '현재는 자동화 실행기의 준비가 필요한 상태입니다. 기존 내 답변은 보존되어 있습니다. 실행 환경과 검증 수단을 준비한 뒤 재개해야 하며, 위치만 반복해서 옮겨도 이 원인은 해결되지 않습니다.'
    : '내 답변에 내용을 적거나 직접 처리한 결과를 남긴 뒤 위치를 답변 완료로 옮겨 주세요. 자동화가 최신 원문과 답변으로 다시 판단해 이어서 진행합니다.'
  return {summary:`멈춘 이유: ${reason}\n\n처리 방법: ${how}`.slice(0,1800),question:`${readable(question).slice(0,1300)}\n\n${how}`.slice(0,1800)}
}
