import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 모든 화면의 소스를 조사한다. native top layer 동작은 별도 실제 브라우저 검증으로 확인한다.
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(path.join(directory, entry.name))
    : /\.(?:[cm]?[jt]sx?|css|html)$/.test(entry.name) ? [path.join(directory, entry.name)] : []))).flat()
}
const files = await filesIn('src')
const layers = [], nativeDialogs = [], popovers = [], unknown = []
for (const file of files) {
  const source = await readFile(file, 'utf8'), normalized = file.replaceAll('\\', '/')
  const line = index => source.slice(0, index).split('\n').length
  for (const match of source.matchAll(/\bz-(?:\[([^\]]+)\]|(\d+))|\bz-index\s*:\s*([^;}\n]+)|\bzIndex\s*:\s*([^,}\n]+)/g)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? match[4]).trim().replace(/^['"]|['"]$/g, '')
    if (/^-?\d+$/.test(raw)) layers.push({ file: normalized, line: line(match.index), value: Number(raw) })
    else if (raw !== 'auto') unknown.push({ file: normalized, line: line(match.index), raw })
  }
  for (const match of source.matchAll(/\.showModal\s*\(/g)) nativeDialogs.push({ file: normalized, line: line(match.index) })
  for (const match of source.matchAll(/\.showPopover\s*\(|\bpopover\s*=/g)) popovers.push({ file: normalized, line: line(match.index) })
}
const overlayFiles = new Set(['src/components/layout/WorkspaceHeaderActions.tsx', 'src/components/layout/use-workspace-overlay-host.ts'])
assert.deepEqual(unknown, [], '계산식으로 지정한 z-index는 겹침 검토가 필요합니다')
const pageLayers = layers.filter(layer => !overlayFiles.has(layer.file))
assert.ok(pageLayers.length > 0)
assert.ok(pageLayers.every(layer => layer.value < 200), `공통 패널보다 높은 페이지 레이어: ${JSON.stringify(pageLayers.filter(layer => layer.value >= 200))}`)
assert.ok(popovers.every(item => overlayFiles.has(item.file)), '새 native popover는 채팅·알림 위로 올라오는지 브라우저 검토가 필요합니다')
const map = JSON.parse(await readFile('dev-tools/structure-map/generated/structure.json', 'utf8'))
const report = { checkedAt: new Date().toISOString(), sourceFiles: files.length, routes: map.routes.map(route => route.path),
  maximumPageLayer: Math.max(...pageLayers.map(layer => layer.value)), layers, nativeDialogs, popovers }
await mkdir('.tmp', { recursive: true })
await writeFile('.tmp/workspace-overlay-audit.json', JSON.stringify(report, null, 2) + '\n')
console.log(`workspace-overlays-source: ${files.length}개 소스, ${report.routes.length}개 라우트; 페이지 z-index 최대 ${report.maximumPageLayer}, native 모달 ${nativeDialogs.length}곳/${new Set(nativeDialogs.map(item => item.file)).size}개 파일 점검`)
console.log('세부 목록: .tmp/workspace-overlay-audit.json (로컬 전용)')
