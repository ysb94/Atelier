(() => {
  'use strict'
  const data = JSON.parse(document.getElementById('structure-data').textContent)
  const byId = new Map(data.nodes.map(n => [n.id, n]))
  const domains = new Map(data.domains.map(d => [d.id, d]))
  const outgoing = new Map(), incoming = new Map()
  for (const e of data.edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, [])
    if (!incoming.has(e.to)) incoming.set(e.to, [])
    outgoing.get(e.from).push(e)
    incoming.get(e.to).push(e)
  }
  const layerNames = { screen: '화면 · 패널 · 훅', shared: '공통 코드 · 업무 로직', store: '데이터 접근', server: '서버 함수', resource: '테이블 · RPC · Storage' }
  const kindNames = { import: 'import', dynamic: '동적 import', worker: 'Web Worker', type: '타입', api: 'API 위임', table: '테이블', rpc: 'RPC', storage: 'Storage 버킷', function: 'Edge 호출', implementation: '함수 구현' }
  const $ = id => document.getElementById(id)
  const svg = $('map'), world = $('world')
  const tree = new Map()
  const parentOf = new Map()
  const expanded = new Set()
  const storageKey = `atelier:dev-structure:v1:${data.root}`
  let selected = null, focused = null, search = '', showTypes = false, showInfra = false
  let view = 'map', allExpanded = false, catalogScroll = 0
  let transform = { x: 0, y: 0, k: 1 }
  let positions = new Map(), bounds = null, toastTimer, redrawTimer
  let detailLimit = 40, searchLimit = 80
  const NS = 'http://www.w3.org/2000/svg'

  function html(tag, text, className) {
    const node = document.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    return node
  }
  function button(text, handler, className) {
    const node = html('button', text, className)
    node.type = 'button'
    node.addEventListener('click', handler)
    return node
  }
  function svgNode(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    return node
  }
  function timed(name, fn) {
    const start = performance.now()
    const result = fn()
    const elapsed = performance.now() - start
    if (elapsed >= 200) (elapsed >= 1000 ? console.warn : console.info)(`[structure-map] ${name}`, { elapsed: Math.round(elapsed), path: location.pathname, selected, lastInput: lastInput })
    return result
  }
  let lastInput = '열기'
  document.addEventListener('click', event => { lastInput = event.target.closest('button,summary,[role="button"]')?.textContent?.trim().slice(0, 100) ?? '지도' }, true)
  window.addEventListener('error', event => console.warn('[structure-map] 화면 오류', { message: event.message, path: location.pathname, lastInput }))
  window.addEventListener('unhandledrejection', event => console.warn('[structure-map] 비동기 작업 실패', { reason: event.reason, path: location.pathname, lastInput }))

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ selected, focused, expanded: [...expanded], branches: [...tree.values()].filter(n => n.children.length).map(n => n.id), showTypes, showInfra, transform, search, view, allExpanded, catalogScroll })) }
    catch (error) { console.warn('[structure-map] 보기 상태 저장 실패', error) }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (!saved) return false
      selected = byId.has(saved.selected) || domains.has(saved.selected) ? saved.selected : null
      focused = domains.has(saved.focused) ? saved.focused : null
      for (const id of saved.expanded ?? []) if (tree.has(id)) expanded.add(id)
      showTypes = !!saved.showTypes
      showInfra = !!saved.showInfra
      search = typeof saved.search === 'string' ? saved.search : ''
      view = saved.view === 'catalog' ? 'catalog' : 'map'
      allExpanded = !!saved.allExpanded
      if (allExpanded) {
        const previousBranches = new Set(saved.branches ?? saved.expanded ?? [])
        for (const node of tree.values()) if (node.children.length && !previousBranches.has(node.id)) expanded.add(node.id)
      }
      catalogScroll = Number.isFinite(saved.catalogScroll) ? Math.max(0, saved.catalogScroll) : 0
      if (saved.transform && Object.values(saved.transform).every(Number.isFinite) && saved.transform.k >= .01 && saved.transform.k <= 2.5) transform = saved.transform
      return true
    } catch (error) { console.warn('[structure-map] 보기 상태 복원 실패', error); return false }
  }
  function makeTree() {
    for (const d of data.domains) {
      const files = data.nodes.filter(n => n.domain === d.id)
      const domainNode = { id: d.id, label: d.label, kind: 'domain', domain: d.id, children: [], count: files.filter(n => n.kind === 'file').length }
      tree.set(d.id, domainNode)
      for (const layer of Object.keys(layerNames)) {
        const children = files.filter(n => n.layer === layer).sort((a, b) => {
          const routeScore = n => data.routes.some(r => r.targets.includes(n.id)) ? -1 : 0
          return routeScore(a) - routeScore(b) || a.label.localeCompare(b.label)
        })
        if (!children.length) continue
        const id = `${d.id}/${layer}`
        const category = { id, label: layerNames[layer], kind: 'layer', domain: d.id, layer, children: children.map(n => n.id), count: children.length }
        tree.set(id, category)
        parentOf.set(id, d.id)
        domainNode.children.push(id)
        for (const node of children) { tree.set(node.id, { ...node, children: [] }); parentOf.set(node.id, id) }
      }
    }
  }
  makeTree()
  const restored = restore()
  $('search').value = search
  $('types').checked = showTypes
  $('infra').checked = showInfra
  $('stats').textContent = `${data.stats.files}개 코드 파일 · ${data.stats.resources}개 데이터/서버 자원`
  $('generated').textContent = `분석: ${new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`

  const allowed = edge => (showTypes || edge.kind !== 'type') && (showInfra || !domains.get(byId.get(edge.from)?.domain)?.infrastructure && !domains.get(byId.get(edge.to)?.domain)?.infrastructure)
  function linksFor(id) {
    if (!domains.has(id)) return { out: (outgoing.get(id) ?? []).filter(allowed), in: (incoming.get(id) ?? []).filter(allowed) }
    const ids = new Set(data.nodes.filter(n => n.domain === id).map(n => n.id))
    return {
      out: data.edges.filter(e => ids.has(e.from) && !ids.has(e.to) && allowed(e)),
      in: data.edges.filter(e => ids.has(e.to) && !ids.has(e.from) && allowed(e)),
    }
  }
  function applyTransform() {
    world.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.k})`)
    $('zoom-value').textContent = `${Math.round(transform.k * 100)}%`
  }
  function fit() {
    if (!bounds) return
    const rect = svg.getBoundingClientRect()
    const paddingY = 150, paddingX = 50
    transform.k = Math.min(1.15, Math.max(allExpanded ? .01 : .12, Math.min((rect.width - paddingX) / bounds.width, (rect.height - paddingY) / bounds.height)))
    transform.x = rect.width / 2 - (bounds.minX + bounds.width / 2) * transform.k
    transform.y = (rect.height + 5) / 2 - (bounds.minY + bounds.height / 2) * transform.k
    applyTransform(); save()
  }
  function center(id) {
    const position = positions.get(id)
    if (!position) return
    const rect = svg.getBoundingClientRect()
    transform.k = Math.max(.85, transform.k)
    transform.x = rect.width / 2 - (position.x + position.width / 2) * transform.k
    transform.y = rect.height / 2 - (position.y + 32) * transform.k
    applyTransform(); save()
  }
  function nearestVisible(id) {
    let current = id
    while (current && !positions.has(current)) current = parentOf.get(current)
    return current
  }
  function draw() {
    applyView()
    if (view === 'catalog') { renderCatalog(); return }
    timed('지도 그리기', () => {
      world.replaceChildren()
      positions = new Map()
      const allDomains = data.domains.filter(d => tree.get(d.id).children.length)
      let left, right
      if (focused) {
        const links = linksFor(focused)
        const connected = new Set([...links.out, ...links.in].map(e => byId.get(e.from)?.domain === focused ? byId.get(e.to)?.domain : byId.get(e.from)?.domain))
        left = allDomains.filter(d => connected.has(d.id) && d.id !== focused).map(d => d.id)
        right = [focused]
      } else {
        const half = Math.ceil(allDomains.length / 2)
        left = allDomains.slice(0, half).map(d => d.id)
        right = allDomains.slice(half).map(d => d.id)
      }
      function height(id, forceClosed = false) {
        const node = tree.get(id)
        if (!node?.children.length || !expanded.has(id) || forceClosed) return 76
        return Math.max(76, displayedChildren(id).reduce((sum, child) => sum + height(child), 0))
      }
      function displayedChildren(id) {
        const node = tree.get(id)
        // Keep a selected file visible with collapsed surrounding layers instead of drawing
        // hundreds of unrelated sibling files. Choosing the domain restores its full tree.
        if (!allExpanded && node.kind === 'layer' && byId.get(selected)?.domain === node.domain && node.children.includes(selected)) return [selected]
        return node.children
      }
      const rootNode = { id: 'root', x: -105, y: -32, width: 210, label: 'Atelier', kind: 'root', sub: '개발 기능 · 코드 연결' }
      positions.set('root', rootNode)
      function place(id, side, depth, top, forceClosed = false) {
        const node = tree.get(id)
        const h = height(id, forceClosed)
        const width = 268
        const x = side > 0 ? 220 + (depth - 1) * 325 : -220 - width - (depth - 1) * 325
        positions.set(id, { ...node, x, y: top + h / 2 - 32, width, side })
        if (expanded.has(id) && !forceClosed) {
          let offset = top
          for (const child of displayedChildren(id)) { place(child, side, depth + 1, offset); offset += height(child) }
        }
      }
      for (const [ids, side] of [[left, -1], [right, 1]]) {
        const closed = !!focused && side < 0
        let top = -ids.reduce((sum, id) => sum + height(id, closed), 0) / 2
        for (const id of ids) { place(id, side, 1, top, closed); top += height(id, closed) }
      }
      const treeGroup = svgNode('g')
      world.append(treeGroup)
      function curve(from, to, dependency = false) {
        const fx = from.x + from.width / 2, tx = to.x + to.width / 2
        const forward = tx >= fx
        const x1 = from.x + (forward ? from.width : 0), x2 = to.x + (forward ? 0 : to.width)
        const y1 = from.y + 32, y2 = to.y + 32
        const bend = dependency ? Math.max(60, Math.abs(x2 - x1) * .38) : Math.abs(x2 - x1) / 2
        const delta = forward ? bend : -bend
        return `M${x1},${y1} C${x1 + delta},${y1} ${x2 - delta},${y2} ${x2},${y2}`
      }
      for (const position of positions.values()) {
        if (position.id === 'root') continue
        const parent = positions.get(parentOf.get(position.id)) ?? rootNode
        treeGroup.append(svgNode('path', { d: curve(parent, position), class: 'tree-link' }))
      }
      const related = new Set()
      if (selected) {
        const links = linksFor(selected)
        const combined = new Map()
        for (const [direction, edges] of [['out', links.out], ['in', links.in]]) for (const e of edges) {
          const fromId = domains.has(selected) && direction === 'out' ? selected : nearestVisible(e.from)
          const toId = domains.has(selected) && direction === 'in' ? selected : nearestVisible(e.to)
          const from = positions.get(fromId), to = positions.get(toId)
          if (!from || !to || fromId === toId) continue
          related.add(fromId); related.add(toId)
          const key = `${fromId}|${toId}|${direction}`
          if (!combined.has(key)) combined.set(key, { from, to, direction, count: 0, dashed: true })
          const link = combined.get(key)
          link.count++
          if (!['api', 'type'].includes(e.kind)) link.dashed = false
        }
        for (const link of combined.values()) {
          const line = svgNode('path', { d: curve(link.from, link.to, true), class: `dependency ${link.direction}${link.dashed ? ' dashed' : ''}` })
          const title = svgNode('title'); title.textContent = `${link.from.label} → ${link.to.label} · ${link.count}개 코드 연결`
          line.append(title); world.append(line)
        }
      }
      for (const position of positions.values()) {
        const group = svgNode('g', { transform: `translate(${position.x},${position.y})`, class: `node ${position.kind}${position.layer === 'resource' && position.kind !== 'layer' ? ' resource' : ''}${position.id === selected ? ' selected' : ''}${related.has(position.id) ? ' related' : ''}`, role: 'button', tabindex: '0', 'data-node-id': position.id, 'aria-label': position.label })
        group.append(svgNode('rect', { width: position.width, height: 64, rx: 10 }))
        const label = svgNode('text', { x: 16, y: 25 })
        const maxLabel = /[가-힣]/.test(position.label) ? 19 : 29
        label.textContent = position.label.length > maxLabel ? `${position.label.slice(0, maxLabel - 1)}…` : position.label
        const sub = svgNode('text', { x: 16, y: 46, class: 'subtext' })
        const shortRole = position.roleSummary?.length > 22 ? `${position.roleSummary.slice(0, 21)}…` : position.roleSummary
        sub.textContent = position.kind === 'domain' ? `${position.count}개 코드 파일 · ${expanded.has(position.id) ? '하위 분류 펼침' : '＋로 펼치기'}` : position.kind === 'layer' ? `${position.count}개 항목` : position.kind === 'root' ? position.sub : position.kind === 'file' ? shortRole ?? position.roleType : kindNames[position.kind] ?? position.kind
        group.append(label, sub)
        const title = svgNode('title'); title.textContent = position.role ?? position.label; group.append(title)
        const activate = () => position.id === 'root' ? overview() : choose(position.id)
        group.addEventListener('click', activate)
        group.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); activate() } })
        if (position.children?.length) {
          group.setAttribute('aria-expanded', String(expanded.has(position.id)))
          const mark = svgNode('text', { x: position.width - 29, y: 37, class: 'expand-mark' })
          mark.textContent = expanded.has(position.id) ? '−' : '+'
          group.append(mark)
          const expand = svgNode('rect', { x: position.width - 44, y: 0, width: 44, height: 64, class: 'expand-hit', role: 'button', tabindex: '0', 'aria-label': `${position.label} ${expanded.has(position.id) ? '접기' : '펼치기'}`, 'data-expand-id': position.id })
          const toggle = event => { event.stopPropagation(); toggleNode(position.id) }
          expand.addEventListener('click', toggle)
          expand.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); toggle(event) } })
          group.append(expand)
        }
        world.append(group)
      }
      const list = [...positions.values()]
      const minX = Math.min(...list.map(n => n.x)), maxX = Math.max(...list.map(n => n.x + n.width))
      const minY = Math.min(...list.map(n => n.y)), maxY = Math.max(...list.map(n => n.y + 64))
      bounds = { minX, minY, width: maxX - minX, height: maxY - minY }
      $('map-title').textContent = allExpanded ? '전체 구조 펼침' : focused ? domains.get(focused).label : '전체 기능'
      $('map-caption').textContent = allExpanded ? `${data.stats.files}개 파일 · ${data.stats.resources}개 자원 · 항목 선택 시 연결 표시` : byId.has(selected) ? '선택 파일 중심 · 접힌 대상은 상위 분류로 모아 표시' : selected ? '파랑: 사용하는 곳 · 주황: 이 항목을 사용하는 곳' : '기능 선택 → 연결 확인 · ＋ → 세부 코드'
      applyTransform()
    })
  }
  function toggleNode(id) {
    if (expanded.has(id)) expanded.delete(id)
    else {
      expanded.add(id)
      if (domains.has(id) && !allExpanded) focused = id
    }
    selected = domains.has(id) ? id : tree.get(id).domain; detailLimit = 40
    draw(); renderList(); renderDetail()
    if (domains.has(id)) fit()
    else center(id)
    save()
  }
  function choose(id, reveal = false) {
    view = 'map'
    if (tree.get(id)?.kind === 'layer') { toggleNode(id); return }
    selected = id; detailLimit = 40
    if (domains.has(id) && !allExpanded) focused = id
    if (byId.has(id)) {
      if (!allExpanded) {
        focused = byId.get(id).domain
        for (const layerId of tree.get(focused).children) expanded.delete(layerId)
      }
      let parent = parentOf.get(id)
      while (parent) { expanded.add(parent); parent = parentOf.get(parent) }
    }
    draw(); renderList(); renderDetail()
    if (reveal || byId.has(id)) center(id)
    else if (domains.has(id)) { if (allExpanded) center(id); else fit() }
    save()
  }
  function overview() {
    view = 'map'; allExpanded = false
    focused = null; selected = null; expanded.clear()
    draw(); renderList(); renderDetail(); fit(); save()
  }
  function applyView() {
    const catalog = view === 'catalog'
    document.querySelector('.map-panel').classList.toggle('catalog-mode', catalog)
    document.querySelector('.workspace').classList.toggle('overview-mode', catalog || !selected)
    $('catalog').hidden = !catalog
    $('map-view').setAttribute('aria-pressed', String(!catalog))
    $('catalog-view').setAttribute('aria-pressed', String(catalog))
  }
  function renderCatalog() {
    timed('전체 총람 만들기', () => {
      const container = $('catalog'); container.replaceChildren()
      const matches = data.nodes.filter(n => !search || matchNode(n))
      $('map-title').textContent = '전체 총람'
      $('map-caption').textContent = search ? `검색된 ${matches.length}개 항목 · 파일명도 검색 가능` : `${data.domains.length}개 기능 · ${data.stats.files}개 파일 · ${data.stats.resources}개 자원 · ${data.stats.edges}개 연결`
      const intro = html('div', undefined, 'catalog-intro')
      intro.append(html('h2', 'Atelier 전체 기능과 코드'), html('p', '공통 기반까지 모든 항목을 펼친 목록입니다. 한글 기능명과 역할을 쭉 읽고, 항목을 눌러 지도·파일 상세·연결 근거를 확인하세요.'))
      const jump = html('nav', undefined, 'catalog-jump'); jump.setAttribute('aria-label', '전체 총람 기능 바로가기')
      for (const d of data.domains.filter(d => matches.some(n => n.domain === d.id))) {
        const link = html('a', d.label); link.href = `#catalog-${d.id}`
        link.addEventListener('click', event => { event.preventDefault(); $(`catalog-${d.id}`).scrollIntoView({ block: 'start' }) })
        jump.append(link)
      }
      intro.append(jump); container.append(intro)
      for (const d of data.domains) {
        const nodes = matches.filter(n => n.domain === d.id)
        if (!nodes.length) continue
        const section = html('section', undefined, 'catalog-domain'); section.id = `catalog-${d.id}`
        const heading = html('div', undefined, 'catalog-heading')
        heading.append(html('h2', d.label), html('span', `${nodes.filter(n => n.kind === 'file').length}개 파일 · ${nodes.filter(n => n.kind !== 'file').length}개 자원`, 'badge'))
        section.append(heading, html('p', d.description))
        for (const layerId of tree.get(d.id).children) {
          const layer = tree.get(layerId), files = nodes.filter(n => n.layer === layer.layer)
          if (!files.length) continue
          section.append(html('h3', `${layer.label} (${files.length})`))
          const grid = html('div', undefined, 'catalog-grid')
          for (const node of files.sort((a, b) => a.label.localeCompare(b.label))) {
            const row = button('', () => choose(node.id, true), 'catalog-item'); row.dataset.catalogNode = node.id
            row.append(html('b', node.label), html('small', node.role ?? `${kindNames[node.kind]} · 소스에서 참조한 데이터/서버 자원`))
            grid.append(row)
          }
          section.append(grid)
        }
        container.append(section)
      }
      if (!matches.length) container.append(html('p', '일치하는 항목이 없습니다. 검색어를 지우면 전체가 표시됩니다.'))
      container.scrollTop = catalogScroll
    })
  }
  function catalogView() {
    view = 'catalog'; search = ''; $('search').value = ''; searchLimit = 80
    renderList(); renderDetail(); draw(); save()
  }
  function expandAll() {
    view = 'map'; allExpanded = true; focused = null; selected = null; expanded.clear()
    for (const node of tree.values()) if (node.children.length) expanded.add(node.id)
    renderList(); renderDetail(); draw(); fit(); save()
  }
  function matchNode(node) {
    const labels = data.routes.filter(r => r.targets.includes(node.id)).flatMap(r => [r.path, ...r.labels])
    const text = `${node.label} ${node.role ?? ''} ${node.path ?? ''} ${domains.get(node.domain)?.label ?? ''} ${labels.join(' ')} ${(node.exports ?? []).map(e => e.name).join(' ')}`.toLowerCase()
    return text.includes(search.toLowerCase())
  }
  function renderList() {
    const container = $('feature-list'); container.replaceChildren()
    if (search) {
      const matches = data.nodes.filter(matchNode)
      const domainMatches = data.domains.filter(d => `${d.label} ${d.description}`.toLowerCase().includes(search.toLowerCase()))
      $('list-caption').textContent = `검색 결과 ${matches.length + domainMatches.length}`
      for (const d of domainMatches) {
        const item = button(d.label, () => { focused = d.id; choose(d.id); fit() }, 'feature-item')
        item.classList.toggle('active', selected === d.id); container.append(item)
      }
      for (const node of matches.slice(0, searchLimit)) {
        const item = button('', () => choose(node.id, true), 'feature-item')
        const main = html('span', undefined, 'item-main')
        main.append(html('b', node.label), html('small', node.role ?? `${kindNames[node.kind]} · ${domains.get(node.domain)?.label}`))
        item.append(main); item.classList.toggle('active', selected === node.id); container.append(item)
      }
      if (!matches.length && !domainMatches.length) container.append(html('p', '일치하는 기능·코드가 없습니다.', 'no-results'))
      if (matches.length > searchLimit) container.append(button(`다음 80개 보기 (${matches.length - searchLimit}개 남음)`, () => { searchLimit += 80; renderList() }, 'show-more'))
      return
    }
    $('list-caption').textContent = '기능 목록'
    for (const d of data.domains) {
      const node = tree.get(d.id)
      if (!node.children.length) continue
      const item = button('', () => choose(d.id), `feature-item${d.infrastructure ? ' infrastructure' : ''}`)
      item.classList.toggle('active', selected === d.id || byId.get(selected)?.domain === d.id)
      item.append(html('span', '', 'feature-dot'), html('span', d.label, 'item-main'), html('span', String(node.count), 'item-count'))
      container.append(item)
    }
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false
    toastTimer = setTimeout(() => { $('toast').hidden = true }, 4500)
  }
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
      else {
        const area = html('textarea', text); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select()
        const ok = document.execCommand('copy'); area.remove()
        if (!ok) throw new Error('클립보드 접근 불가')
      }
      toast('경로와 줄 번호를 복사했습니다.')
    } catch (error) { console.warn('[structure-map] 경로 복사 실패', error); toast('클립보드에 접근할 수 없습니다. 표시된 경로를 직접 복사하세요.') }
  }
  function fileActions(container, file, line = 1) {
    const full = `${data.root}/${file}:${line}`
    const actions = html('div', undefined, 'path-actions')
    actions.append(button('경로 복사', () => copy(full)))
    const link = html('a', 'VS Code에서 열기'); link.href = `vscode://file/${encodeURI(`${data.root}/${file}`)}:${line}`; actions.append(link)
    container.append(actions)
  }
  function more(container, total, rerender = renderDetail) {
    if (total > detailLimit) container.append(button(`더 보기 (${total - detailLimit}개 남음)`, () => { detailLimit += 40; rerender() }, 'show-more'))
  }
  function routeList(container, routes) {
    for (const r of routes) {
      const item = html('div', undefined, 'route-item')
      item.append(html('code', r.path), html('small', r.redirect ? `리다이렉트 → ${r.redirect}` : r.labels.join(' / ') || r.components.join(', ')))
      container.append(item)
    }
  }
  function evidenceView(container, edge) {
    const details = html('details')
    const otherId = edge.from === selected ? edge.to : edge.from
    const node = byId.get(otherId)
    const summary = html('summary', `${node?.label ?? otherId} · ${kindNames[edge.kind] ?? edge.kind} (${edge.evidence.length})`)
    details.append(summary)
    const evidence = html('div', undefined, 'evidence')
    evidence.append(button(`지도에서 ${node?.label ?? '항목'} 보기 →`, () => choose(otherId, true)))
    for (const e of edge.evidence.slice(0, 16)) {
      const row = html('div')
      row.append(button(`${e.file}:${e.line}`, () => copy(`${data.root}/${e.file}:${e.line}`)))
      if (e.symbols || e.symbol) row.append(html('div', e.symbols || e.symbol))
      if (e.via) row.append(html('div', `경유: ${e.via}:${e.viaLine} → ${e.targetSymbol}`))
      if (e.specifier) row.append(html('div', e.specifier))
      evidence.append(row)
    }
    if (edge.evidence.length > 16) evidence.append(button(`전체 근거 ${edge.evidence.length}개 보기`, () => {
      evidence.replaceChildren()
      for (const e of edge.evidence) evidence.append(button(`${e.file}:${e.line}${e.symbol ? ` · ${e.symbol}` : ''}`, () => copy(`${data.root}/${e.file}:${e.line}`)))
    }))
    details.append(evidence); container.append(details)
  }
  function domainRelations(container, edges, direction) {
    const groups = new Map()
    for (const e of edges) {
      const peer = byId.get(direction === 'out' ? e.to : e.from)?.domain
      if (!groups.has(peer)) groups.set(peer, [])
      groups.get(peer).push(e)
    }
    if (!groups.size) container.append(html('p', '표시할 연결이 없습니다. 공통 기반·타입 연결을 켜서 추가 확인할 수 있습니다.'))
    for (const [id, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const details = html('details'), summary = html('summary', `${direction === 'out' ? '→' : '←'} ${domains.get(id)?.label ?? id} · ${list.length}개 연결`)
      details.append(summary)
      const evidence = html('div', undefined, 'evidence')
      evidence.append(button('연결 기능 선택 →', () => choose(id)))
      function appendLinks(limit) {
        for (const e of list.slice(0, limit)) {
          const row = html('div')
          row.append(button(`${byId.get(e.from)?.label} → ${byId.get(e.to)?.label}`, () => choose(direction === 'out' ? e.from : e.to, true)))
          row.append(html('div', `${kindNames[e.kind]} · ${e.evidence[0].file}:${e.evidence[0].line}`)); evidence.append(row)
        }
      }
      appendLinks(12)
      if (list.length > 12) evidence.append(button(`전체 ${list.length}개 연결 보기`, () => { evidence.replaceChildren(); appendLinks(list.length) }))
      details.append(evidence); container.append(details)
    }
  }
  function renderDetail() {
    const panel = $('detail'); panel.replaceChildren()
    document.querySelector('.workspace').classList.toggle('overview-mode', view === 'catalog' || !selected)
    if (!selected) {
      panel.append(html('div', 'DEVELOPMENT MAP', 'eyebrow'), html('h2', '어디를 바꿔야 할지\n연결부터 살펴보세요.'))
      panel.append(html('p', '왼쪽에서 기능을 고르거나 지도에서 노드를 선택하세요. 연결선과 코드 근거를 함께 확인할 수 있습니다.'))
      const steps = html('ol', undefined, 'intro-steps')
      for (const step of ['기능 선택: 사용하는 곳과 사용되는 곳', '＋ 펼치기: 화면 → 로직 → 데이터 접근', '파일 선택: import·API 위임·데이터 근거', '검색: 화면 이름·경로·함수·테이블 찾기']) steps.append(html('li', step))
      panel.append(steps, html('div', '메뉴 기준이 아닌 코드 기능 단위입니다. 한 기능이 여러 메뉴에서 사용될 수 있고, 파일 분류는 domains.json에서 조정할 수 있습니다.', 'hint-card'))
      panel.append(html('h3', '코드 변경 후 갱신'), html('code', 'npm run structure:map:watch'), html('p', '로컬 서버를 실행하면 2초 간격으로 소스 변경을 감지합니다. 별도 서비스나 DB 접근은 필요하지 않습니다.'))
      const diagnostics = html('details'); diagnostics.append(html('summary', `분석 범위와 누락 확인 · ${data.unresolved.length}건`))
      diagnostics.append(html('p', 'src 및 supabase/functions의 코드만 분석합니다. 테스트·검증 파일, 마이그레이션, 별도 도구, 동적 이름으로 호출한 자원과 SQL 내부 관계는 포함하지 않습니다. 아래는 정적으로 해석하지 못한 항목입니다.'))
      for (const e of data.unresolved) diagnostics.append(html('div', `${e.kind} · ${e.file}${e.line ? `:${e.line}` : ''}${e.specifier ? ` → ${e.specifier}` : ''}`, 'evidence'))
      panel.append(diagnostics)
      return
    }
    const domain = domains.get(selected)
    if (domain) {
      const files = data.nodes.filter(n => n.domain === selected && n.kind === 'file')
      const resources = data.nodes.filter(n => n.domain === selected && n.kind !== 'file')
      panel.append(html('div', '기능 단위', 'eyebrow'), html('h2', domain.label), html('p', domain.description))
      const badges = html('div', undefined, 'badge-row'); badges.append(html('span', `${files.length}개 코드 파일`, 'badge'), html('span', `${resources.length}개 자원`, 'badge')); panel.append(badges)
      panel.append(button('이 기능 중심으로 펼치기', () => { focused = selected; expanded.add(selected); draw(); fit(); save() }))
      const routeSet = data.routes.filter(r => r.targets.some(t => byId.get(t)?.domain === selected))
      if (routeSet.length) { panel.append(html('h3', `연결된 화면 경로 (${routeSet.length})`)); routeList(panel, routeSet) }
      const links = linksFor(selected)
      panel.append(html('h3', '사용하는 기능 →')); domainRelations(panel, links.out, 'out')
      panel.append(html('h3', '이 기능을 사용하는 곳 ←')); domainRelations(panel, links.in, 'in')
      panel.append(html('h3', `코드 파일 (${files.length})`))
      for (const file of files.slice(0, detailLimit)) {
        const row = html('div', undefined, 'relation-row'), action = button(file.label, () => choose(file.id, true))
        action.append(html('small', file.role)); row.append(action, html('span', file.roleType)); panel.append(row)
      }
      more(panel, files.length)
      return
    }
    const node = byId.get(selected)
    if (!node) return
    panel.append(html('div', `${domains.get(node.domain)?.label} / ${layerNames[node.layer]}`, 'eyebrow'), html('h2', node.label))
    if (node.path) {
      panel.append(html('p', node.role, 'file-role'))
      if (node.sections?.length) panel.append(html('p', `코드에서 확인한 화면 항목: ${node.sections.join(' · ')}`, 'source-sections'))
      const explanation = html('details', undefined, 'label-explanation')
      explanation.append(html('summary', '기능명·역할은 어떻게 정해졌나요?'), html('p', `기능명: ${node.labelSource}. 역할: ${node.roleSource}. 추정 설명은 코드 검토 시 확인하세요.`))
      if (node.labelEvidence) explanation.append(button(`이름 근거: ${node.labelEvidence.file}:${node.labelEvidence.line}`, () => copy(`${data.root}/${node.labelEvidence.file}:${node.labelEvidence.line}`)))
      if (node.untranslated?.length) explanation.append(html('p', `의미 확인이 필요한 이름 조각: ${node.untranslated.join(', ')}`))
      panel.append(explanation, html('h3', '코드 파일'), html('strong', node.fileName))
      panel.append(html('code', node.path, 'path')); fileActions(panel, node.path)
      panel.append(button('이 기능의 전체 코드 보기', () => { const id = node.domain; selected = id; choose(id); fit() }, 'show-more'))
      if (node.path === 'src/lib/api/index.ts') panel.append(html('div', '공개 API 허브 전체의 import 연결입니다. 특정 화면의 API 위임 연결을 선택하면 그 화면이 가져온 함수의 저장소만 확인할 수 있습니다.', 'hint-card'))
      const badges = html('div', undefined, 'badge-row'); badges.append(html('span', `${node.lines.toLocaleString()}줄`, 'badge'), html('span', `${node.exports.length}개 export`, 'badge')); panel.append(badges)
    } else panel.append(html('p', `${kindNames[node.kind] ?? node.kind} · 소스 코드에서 명시적으로 참조한 자원입니다. DB에서 존재 여부를 조회하지 않았습니다.`))
    const nodeRoutes = data.routes.filter(r => r.targets.includes(selected))
    if (nodeRoutes.length) { panel.append(html('h3', '연결된 화면 경로')); routeList(panel, nodeRoutes) }
    const links = linksFor(selected)
    // Inside a selected file, show its own dependencies even if its domain is infrastructure.
    const fileAllowed = e => showTypes || e.kind !== 'type'
    const order = { table: 0, rpc: 0, storage: 0, function: 0, implementation: 0, api: 1, worker: 2, dynamic: 3, import: 4, type: 5 }
    const sortLinks = list => list.filter(fileAllowed).sort((a, b) => order[a.kind] - order[b.kind])
    const directOut = sortLinks(outgoing.get(selected) ?? [])
    const directIn = sortLinks(incoming.get(selected) ?? [])
    panel.append(html('h3', `사용하는 코드 · 데이터 → (${directOut.length})`))
    for (const e of directOut.slice(0, detailLimit)) evidenceView(panel, e)
    if (!directOut.length) panel.append(html('p', '정적으로 확인한 내부 연결이 없습니다.'))
    panel.append(html('h3', `이 항목을 사용하는 곳 ← (${directIn.length})`))
    for (const e of directIn.slice(0, detailLimit)) evidenceView(panel, e)
    if (!directIn.length) panel.append(html('p', '정적으로 확인한 내부 참조가 없습니다.'))
    more(panel, Math.max(directOut.length, directIn.length))
    if (node.exports?.length) {
      const details = html('details'); details.append(html('summary', `공개 함수 · export (${node.exports.length})`))
      for (const e of node.exports) details.append(button(`${e.name}:${e.line}`, () => copy(`${data.root}/${node.path}:${e.line}`), 'show-more'))
      panel.append(details)
    }
    if (node.packages?.length) { panel.append(html('h3', '외부 패키지')); panel.append(html('code', node.packages.join(' · '), 'path')) }
    if (!links.out.length && !links.in.length && (directOut.length || directIn.length)) panel.append(html('p', '공통 기반 연결은 상세에 표시하지만 지도에서는 기본 숨깁니다. 상단의 공통 기반 연결을 켜면 선도 표시됩니다.'))
  }
  $('search').addEventListener('input', () => { search = $('search').value.trim(); searchLimit = 80; clearTimeout(redrawTimer); redrawTimer = setTimeout(() => { renderList(); if (view === 'catalog') { catalogScroll = 0; renderCatalog() } save() }, 120) })
  $('catalog-view').addEventListener('click', catalogView)
  $('map-view').addEventListener('click', () => { view = 'map'; renderDetail(); draw(); save() })
  $('expand-all').addEventListener('click', expandAll)
  $('catalog').addEventListener('scroll', () => { catalogScroll = $('catalog').scrollTop; save() }, { passive: true })
  $('collapse-all').addEventListener('click', overview)
  $('overview').addEventListener('click', overview)
  $('types').addEventListener('change', () => { showTypes = $('types').checked; draw(); renderDetail(); save() })
  $('infra').addEventListener('change', () => { showInfra = $('infra').checked; draw(); renderDetail(); save() })
  $('help-toggle').addEventListener('click', () => { $('help').hidden = !$('help').hidden; $('help-toggle').setAttribute('aria-expanded', String(!$('help').hidden)) })
  $('fit').addEventListener('click', fit)
  function zoom(factor, x, y) {
    const rect = svg.getBoundingClientRect()
    const cx = x ?? rect.width / 2, cy = y ?? rect.height / 2
    const next = Math.min(2.5, Math.max(allExpanded ? .01 : .12, transform.k * factor))
    const ratio = next / transform.k
    transform.x = cx - (cx - transform.x) * ratio; transform.y = cy - (cy - transform.y) * ratio; transform.k = next
    applyTransform(); save()
  }
  $('zoom-in').addEventListener('click', () => zoom(1.2))
  $('zoom-out').addEventListener('click', () => zoom(1 / 1.2))
  svg.addEventListener('wheel', event => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) { const rect = svg.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top) }
    else { transform.x -= event.deltaX; transform.y -= event.deltaY; applyTransform(); save() }
  }, { passive: false })
  let drag = null
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.node')) return
    drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }
    svg.setPointerCapture(event.pointerId); svg.classList.add('dragging')
  })
  svg.addEventListener('pointermove', event => { if (drag) { transform.x = drag.tx + event.clientX - drag.x; transform.y = drag.ty + event.clientY - drag.y; applyTransform() } })
  const stopDrag = () => { if (drag) { drag = null; svg.classList.remove('dragging'); save() } }
  svg.addEventListener('pointerup', stopDrag); svg.addEventListener('pointercancel', stopDrag)
  new ResizeObserver(() => { applyTransform() }).observe(svg)

  $('refresh').addEventListener('click', async () => {
    if (location.protocol === 'file:') { toast('터미널에서 npm run structure:map 실행 후 이 파일을 새로고침하세요.'); return }
    $('refresh').disabled = true
    try {
      const response = await fetch('/rebuild', { method: 'POST', headers: { 'X-Structure-Map': 'local-viewer' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      save(); location.reload()
    } catch (error) { console.warn('[structure-map] 갱신 요청 실패', error); toast('갱신에 실패했습니다. 로컬 서버 콘솔을 확인하세요.'); $('refresh').disabled = false }
  })
  if (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
    const events = new EventSource('/events')
    events.addEventListener('ready', event => {
      const state = JSON.parse(event.data)
      $('live-status').textContent = state.error ? '갱신 실패 · 콘솔 확인' : state.watch ? '코드 변경 감시 중' : '로컬 서버'
      $('live-status').className = `status ${state.error ? 'error' : 'live'}`
      if (state.fingerprint !== data.fingerprint) { save(); location.reload() }
    })
    events.addEventListener('updated', () => { save(); location.reload() })
    events.addEventListener('build-error', () => { $('live-status').textContent = '갱신 실패 · 콘솔 확인'; $('live-status').className = 'status error'; toast('분석 실패로 직전 구조도를 유지합니다. 로컬 서버 콘솔을 확인하세요.') })
    events.onerror = () => { $('live-status').textContent = '서버 연결 끊김 · 재연결 중'; $('live-status').className = 'status error' }
    window.addEventListener('pagehide', () => events.close())
  }
  timed('초기 화면', () => { renderList(); renderDetail(); draw() })
  if (!restored && view === 'map') requestAnimationFrame(fit)
})()
