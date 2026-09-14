import { useState } from 'react'
import './studio-ai-map.css'

const AI_ROLES = [
  {
    id: 'background', step: 'A', task: '제품은 그대로, 배경만 연출', name: 'Photoroom', feature: 'AI Backgrounds', kind: '서비스 · 배경 생성 기능',
    summary: '이미 촬영한 제품 모습을 살려 판매용 연출컷을 만들 때',
    reason: '제품 영역을 유지하는 배경 작업을 맡기는 구성입니다. 원단·로고가 중요한 컷부터 시작하기 좋습니다.',
    input: '촬영한 제품 사진 + 원하는 배경 참고', output: '제품 각도를 유지한 배경 연출 시안',
    example: '이 가방은 그대로 두고, 햇빛이 드는 소파 배경으로 바꿔줘.',
    note: '제품 각도나 끈 모양까지 바꾸는 작업은 구도 생성·부분 수정으로 넘깁니다.',
  },
  {
    id: 'explore', step: 'B', task: '여러 구도와 새로운 연출 만들기', name: 'Nano Banana Pro', feature: 'Google 이미지 모델', kind: '모델 · 활용 서비스 예: Higgsfield',
    summary: '다양한 레퍼런스를 조합해 2~4개 시안을 골라보고 싶을 때',
    reason: '제품·구도·배경 참고를 함께 사용하는 생성 작업을 맡기는 구성입니다. 결과를 고르는 탐색 단계에 배치합니다.',
    input: '제품 사진 + 구도·배경·놓는 모습 참고', output: '서로 다른 구도의 독립 시안 2~4장',
    example: '제품은 같게 유지하면서 배경과 놓는 방향을 달리한 시안을 보여줘.',
    note: '새로 그린 제품의 원단·로고·끈 구조가 원본과 같은지 결과를 확인해야 합니다.',
  },
  {
    id: 'edit', step: 'C', task: '선택한 컷의 일부만 수정', name: 'Adobe Firefly', feature: 'Photoshop 생성형 채우기', kind: 'AI 기능 · Photoshop 편집 작업',
    summary: '마음에 드는 컷에서 끈·그림자·배경 일부를 다듬을 때',
    reason: '수정할 영역을 직접 지정하는 마무리 작업을 맡기는 구성입니다. 선택한 컷과 원본 제품을 나란히 확인합니다.',
    input: '선택한 결과 + 수정 영역 + 원본 제품 사진', output: '요청한 부분을 수정한 새 버전 1장',
    example: '배경과 제품은 유지하고, 표시한 바닥 그림자만 부드럽게 바꿔줘.',
    note: 'Photoshop 기능을 사이트 안에 그대로 연결할 수 있는지는 별도 검토가 필요합니다.',
  },
] as const

/** Presentation-only proposal: selection never affects drafts, files, or generation. */
export function StudioAiMap() {
  const [activeId, setActiveId] = useState<string>('background')
  const active = AI_ROLES.find((role) => role.id === activeId)!
  return <section className="studio-ai-map" aria-label="작업별 AI 배치안">
    <div className="studio-ai-map-heading"><div><span className="studio-step">AI WORKFLOW / PROPOSAL</span><h2>어떤 작업에 어떤 AI를 쓸까요?</h2><p>한 스튜디오에서 역할을 나누는 구성안입니다. 카드를 눌러 담당 작업을 살펴보세요.</p></div><span className="studio-ai-status">UI 구성안 · 전체 미연결</span></div>
    <div className="studio-ai-cards">{AI_ROLES.map((role) => <button type="button" key={role.id} className={`studio-ai-card ${activeId === role.id ? 'is-active' : ''}`} aria-pressed={activeId === role.id} onClick={() => setActiveId(role.id)}>
      <span className="studio-ai-card-top"><span>{role.step} / {role.task}</span><span className="studio-ai-dot">미연결</span></span>
      <strong>{role.name}</strong><span className="studio-ai-feature">{role.feature}</span><p>{role.summary}</p><small>{role.kind}</small>
    </button>)}</div>
    <div className="studio-ai-detail" aria-live="polite">
      <div className="studio-ai-reason"><span className="studio-step">이 작업을 맡기는 이유</span><h3>{active.name}</h3><p>{active.reason}</p></div>
      <div className="studio-ai-io"><div><span>사용할 자료</span><p>{active.input}</p></div><div><span>기대하는 결과</span><p>{active.output}</p></div><div><span>요청 예시</span><p>“{active.example}”</p></div></div>
      <p className="studio-ai-note">{active.note}</p>
    </div>
    <div className="studio-ai-flow"><span>공통 제품 자료</span><b>→</b><span><i>A</i> 배경 연출 <em>또는</em> <i>B</i> 구도 생성</span><b>→</b><span>결과 선택</span><b>→</b><span><i>C</i> 부분 수정</span><b>→</b><span>원본과 비교 · 최종 선택</span></div>
    <p className="studio-ai-footnote">추천 서비스·모델을 표시한 설계안입니다. 카드를 눌러도 AI 실행이나 요청서 변경은 일어나지 않습니다. 실제 연결 가능 여부와 품질은 연결 전에 확인합니다.</p>
  </section>
}
