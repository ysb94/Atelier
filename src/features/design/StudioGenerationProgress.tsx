import { useEffect, useState } from 'react'
import { LoaderCircle, LockKeyhole } from 'lucide-react'

export function StudioGenerationProgress({ model, progress }: { model: string; progress: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <section className="cs-generation-progress" role="status" aria-label="이미지 생성 진행 상태">
    <div className="cs-generation-heading"><LoaderCircle className="cs-generation-spinner" size={30} aria-hidden="true" /><div><strong>{progress.startsWith('디렉터') ? '디렉터가 연출을 준비하고 있어요' : '이미지를 만들고 있어요'}</strong><span>{model} · {progress}</span></div><time aria-label="경과 시간">{seconds}초</time></div>
    <div className="cs-generation-track" aria-hidden="true"><span /></div>
    <p><LockKeyhole size={14} aria-hidden="true" />생성이 끝나면 요청창이 다시 열립니다. 이 화면을 닫거나 새로고침하지 마세요.</p>
  </section>
}
