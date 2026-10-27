import type { SpinFrame, SpinSettings } from './spin-core'
import { spinQuality } from './spin-core'

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/** 완성 뷰어는 AI·서버·라이브러리 없이 동작한다. 제목은 HTML과 script 양쪽에서 이스케이프한다. */
export function spinViewerHtml(title: string, urls: string[]): string {
  const safeTitle = escapeHtml(title || '360도 제품 보기'), frames = JSON.stringify(urls).replaceAll('<', '\\u003c')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;background:white;color:#222}main{max-width:900px;margin:auto}.stage{position:relative;aspect-ratio:1;max-height:calc(100dvh - 100px);min-height:180px;overflow:hidden;touch-action:pan-y pinch-zoom;cursor:grab}.stage img{width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none}.hint{position:absolute;bottom:12px;left:0;right:0;text-align:center;color:#555;font-size:12px}.controls{display:flex;align-items:center;gap:12px;padding:12px}.controls input{min-width:0;flex:1}button{padding:8px 12px;cursor:pointer}#status{min-height:28px;padding:0 12px;font-size:12px}*:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style></head><body><main aria-label="${safeTitle}"><div class="stage" id="stage" role="slider" tabindex="0" aria-label="제품 회전" aria-valuemin="1" aria-valuemax="${urls.length}" aria-valuenow="1"><img id="image" alt="${safeTitle}" draggable="false"><span class="hint">좌우로 드래그 · 키보드 ← →</span></div><div class="controls"><button id="prev" aria-label="이전 각도">←</button><input id="range" aria-label="회전 프레임" type="range" min="0" max="${urls.length - 1}" value="0"><button id="next" aria-label="다음 각도">→</button><output id="counter"></output></div><p id="status" role="status">이미지를 준비하고 있습니다.</p></main>
<script>(()=>{'use strict';const urls=${frames},stage=document.getElementById('stage'),image=document.getElementById('image'),range=document.getElementById('range'),status=document.getElementById('status');let index=0,gesture=null;const cache=new Map();function show(next){index=((next%urls.length)+urls.length)%urls.length;image.src=urls[index];range.value=String(index);stage.setAttribute('aria-valuenow',String(index+1));document.getElementById('counter').textContent=String(index+1).padStart(2,'0')+' / '+urls.length;for(const offset of [-2,-1,1,2]){const i=((index+offset)%urls.length+urls.length)%urls.length;if(!cache.has(i)){const img=new Image();img.src=urls[i];cache.set(i,img);while(cache.size>12)cache.delete(cache.keys().next().value)}}}image.onload=()=>{status.textContent='좌우로 밀어 모든 방향을 확인하세요.'};image.onerror=()=>{status.textContent='이미지를 불러오지 못했습니다. frames 폴더와 HTML의 업로드 위치를 확인하세요.'};document.getElementById('prev').onclick=()=>show(index-1);document.getElementById('next').onclick=()=>show(index+1);range.oninput=()=>show(Number(range.value));stage.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();show(index+(e.key==='ArrowLeft'?-1:1))}else if(e.key==='Home'||e.key==='End'){e.preventDefault();show(e.key==='Home'?0:urls.length-1)}};stage.onpointerdown=e=>{if(!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,index,locked:false}};stage.onpointermove=e=>{if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(!gesture.locked&&Math.max(Math.abs(dx),Math.abs(dy))>7){if(Math.abs(dy)>Math.abs(dx)){gesture=null;return}gesture.locked=true;stage.setPointerCapture(e.pointerId)}if(gesture.locked){e.preventDefault();show(gesture.index+Math.round(dx/Math.max(1,stage.clientWidth)*urls.length))}};const stop=()=>{gesture=null};stage.onpointerup=stop;stage.onpointercancel=stop;stage.onlostpointercapture=stop;show(0)})();</script></body></html>`
}

export function spinEmbedCode(viewerUrl: string, title: string): string {
  if (!viewerUrl.trim()) return ''
  const url = new URL(viewerUrl)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('공개된 뷰어의 HTTPS 주소를 입력해 주세요.')
  return `<iframe src="${escapeHtml(url.href)}" title="${escapeHtml(title || '360도 제품 보기')}" width="100%" height="650" style="width:100%;height:min(125vw,750px);min-height:320px;border:0;display:block" loading="lazy"></iframe>`
}

const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('이미지를 HTML로 변환하지 못했습니다.')); reader.readAsDataURL(blob)
})

export async function standaloneSpinHtml(title: string, frames: readonly SpinFrame[]): Promise<Blob> {
  const urls: string[] = []
  for (const frame of frames) urls.push(await blobDataUrl(frame.blob))
  return new Blob([spinViewerHtml(title, urls)], { type: 'text/html;charset=utf-8' })
}

export async function spinZip(title: string, frames: readonly SpinFrame[], settings: SpinSettings, progress: (percent: number) => void): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip(), urls = frames.map((_, index) => `frames/${String(index + 1).padStart(3, '0')}.webp`)
  frames.forEach((frame, index) => zip.file(urls[index], frame.blob))
  zip.file('viewer.html', spinViewerHtml(title, urls))
  zip.file('manifest.json', JSON.stringify({ title, frameCount: frames.length, settings, frames: frames.map(({ time, sharpness }, index) => ({ file: urls[index], selectedTime: time, sharpness })), quality: spinQuality(frames) }, null, 2))
  zip.file('README.txt', '360 상세이미지 테스트 결과\n\nviewer.html과 frames 폴더를 같은 위치에 두고 viewer.html을 열어 보세요.\n쇼핑몰에는 이 폴더 전체를 HTTPS 이미지 호스팅에 올린 뒤 뷰어 주소로 iframe을 삽입합니다. 업로드는 자동으로 하지 않습니다.\nAI 배경 제거는 상품 디테일과 가는 끈을 지울 수 있으므로 70장 전체를 검수하세요.\n기준 각도를 지정하지 않은 구간은 일정한 회전 속도를 가정합니다. 3D 복원이나 정확한 각도 측정 결과가 아닙니다.\n\nAI 모델: BiRefNet_lite 512 (MIT), Copyright (c) 2024 ZhengPeng; Copyright (c) 2026 Studio Ludens V.O.F.\nhttps://huggingface.co/studioludens/birefnet-lite-512/blob/962e67969ec6acec9c19fab76acee4f5e22e990c/LICENSE\nRuntime: Transformers.js 3.8.1 (Apache-2.0), ONNX Runtime Web (MIT).\n')
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => progress(Math.round(metadata.percent)))
}
