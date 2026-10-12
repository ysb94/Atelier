import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from '../dev-tools/structure-map/analyze.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'dev-tools/structure-map/domains.json'), 'utf8'))
// Analyze current sources, rather than trusting a possibly stale generated snapshot.
const graph = analyze(root, config)
const dependencies = new Map()
for (const edge of graph.edges) {
  if (!['import', 'dynamic', 'worker'].includes(edge.kind)) continue
  const targets = dependencies.get(edge.from) ?? []
  targets.push(edge.to)
  dependencies.set(edge.from, targets)
}

function dependencyPath(from, to) {
  const queue = [[from]]
  const seen = new Set([from])
  for (let i = 0; i < queue.length; i++) {
    const chain = queue[i]
    for (const next of dependencies.get(chain.at(-1)) ?? []) {
      if (next === to) return [...chain, next]
      if (seen.has(next)) continue
      seen.add(next)
      queue.push([...chain, next])
    }
  }
  return null
}

const tabs = 'src/components/layout/workspace-tabs.tsx'
const routes = 'src/components/layout/company-routes.tsx'
const activity = 'src/components/layout/workspace-tab-activity.ts'
const overlay = 'src/components/layout/workspace-tab-overlay.tsx'
for (const id of [tabs, routes, activity, overlay]) {
  assert.ok(graph.nodes.some(node => node.id === id), `Missing workspace module: ${id}`)
}
assert.ok(dependencyPath(tabs, routes), 'Tab panels must still render the company route tree')
for (const [from, to] of [[routes, tabs], [activity, tabs], [activity, routes], [overlay, tabs], [overlay, routes]]) {
  const chain = dependencyPath(from, to)
  assert.equal(chain, null, `Workspace dependency boundary violated: ${chain?.join(' -> ')}`)
}

console.info('[workspace-tabs] 화면 경로의 탭 관리 역참조 없음; 탭 활성 상태 모듈 독립 확인')
