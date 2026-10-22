export type WorkState = 'todo' | 'doing' | 'feedback' | 'done'
export type WorkItem = {
  id: string; title: string; source: 'assigned' | 'self'; status: WorkState
  assignee: string; requester: string; due: string; priority: boolean; description: string
  steps: { id: string; title: string; done: boolean }[]
  messages: { author: string; text: string; time: string }[]
}
export const WORK_STATES: { id: WorkState; label: string; hint: string }[] = [
  { id: 'todo', label: '할 일', hint: '다음으로 시작할 업무' },
  { id: 'doing', label: '진행 중', hint: '지금 하고 있는 업무' },
  { id: 'feedback', label: '피드백 대기', hint: '확인과 답변을 기다리는 업무' },
  { id: 'done', label: '완료', hint: '마무리한 업무' },
]
// 사용자가 요청한 UI 시안의 예시입니다. 실사용 업무 기록이 아닙니다.
export function createPreviewWork(): WorkItem[] {
  const row = (id: string, title: string, status: WorkState, assignee: string, requester: string, due: string, source: 'assigned' | 'self' = 'assigned'): WorkItem => ({id,title,status,assignee,requester,due,source,priority:false,description:'업무를 작은 할 일로 나누고 진행 상황과 피드백을 함께 살펴보세요.',steps:[],messages:[]})
  return [
    {...row('detail','가을 신상품 상세페이지 제작','doing','me','기획팀 · 박서연','오늘'), priority:true, description:'촬영 이미지와 기획 문구를 정리해 신상품 상세페이지를 완성합니다.',steps:[{id:'photo',title:'촬영 이미지 선별',done:true},{id:'copy',title:'상품 설명 문구 정리',done:true},{id:'layout',title:'상세페이지 레이아웃 작업',done:false},{id:'check',title:'최종 이미지 확인',done:false}],messages:[{author:'박서연 · 기획팀',text:'소재감이 잘 보이는 사진을 먼저 배치해 주세요.',time:'09:20'},{author:'나',text:'이미지 선별은 끝났고 레이아웃 작업 중입니다.',time:'10:15'}]},
    {...row('reference','다음 시즌 디자인 레퍼런스 정리','doing','me','직접 추가','이번 주','self'),steps:[{id:'collect',title:'참고 이미지 모으기',done:true},{id:'sort',title:'컬러와 소재별로 정리',done:false}]},
    {...row('banner','기획전 배너 시안 확인','feedback','me','MD팀 · 이준호','오늘'),description:'시안을 전달했습니다. 색상과 문구에 대한 담당자의 피드백을 기다리고 있어요.',steps:[{id:'draft',title:'배너 시안 제작',done:true},{id:'send',title:'시안 전달',done:true}],messages:[{author:'나',text:'배너 시안을 전달드립니다. 문구와 색상 확인 부탁드려요.',time:'11:05'}]},
    row('label','신규 상품 라벨 이미지 작업','todo','me','기획팀 · 박서연','내일'),
    row('library','공용 디자인 폴더 정리','todo','me','직접 추가','기한 없음','self'),
    {...row('thumbnail','신상품 썸네일 수정','done','me','MD팀 · 이준호','완료'),messages:[{author:'이준호 · MD팀',text:'수정 이미지 확인했습니다. 감사합니다.',time:'어제'}]},
    {...row('lookbook','가을 룩북 이미지 보정','doing','김민지','기획팀 · 박서연','오늘'),priority:true,steps:[{id:'tone',title:'기본 색감 보정',done:true},{id:'retouch',title:'세부 보정',done:false},{id:'export',title:'이미지 내보내기',done:false}]},
    {...row('package','패키지 스티커 시안 검토','feedback','김민지','운영지원팀 · 정하늘','내일'),messages:[{author:'김민지 · 디자인팀',text:'시안 확인 부탁드립니다. 두 번째 안을 추천합니다.',time:'10:40'}]},
    row('social','주간 콘텐츠 이미지 준비','doing','정하늘','MD팀 · 이준호','내일'),
    row('icons','공통 아이콘 정리','todo','정하늘','직접 추가','이번 주','self'),
  ]
}