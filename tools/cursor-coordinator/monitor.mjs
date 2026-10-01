import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';

const ROLES = ['IMPLEMENT', 'RESEARCH', 'VERIFY', 'REVIEW'];
const ROLE_LABELS = {
  IMPLEMENT: '구현',
  RESEARCH: '조사',
  VERIFY: '검증',
  REVIEW: '검토',
};
const REPORT_NAME = /^(.+)-(IMPLEMENT|RESEARCH|VERIFY|REVIEW)-(\d+)\.json$/u;
const HOST = '127.0.0.1';
const PORT = 5181;
const MAX_REPORT_FILES = 100;

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stateDir = path.join(workspace, '.cursor/coordinator-state');
const reportsDir = path.join(stateDir, 'reports');

const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

function reportMeta(filename) {
  const match = REPORT_NAME.exec(filename);
  if (!match) return null;
  return { taskId: match[1], role: match[2], timestamp: Number(match[3]), filename };
}

function extractResultText(runResult) {
  if (!runResult) return '';
  const inner = runResult.result;
  if (typeof inner === 'string') return inner;
  if (inner && typeof inner.text === 'string') return inner.text;
  if (inner == null) return '';
  // Parsed report objects are acyclic; JSON.stringify does not need a fallback catch.
  return JSON.stringify(inner, null, 2);
}

function roleStatus(role, activeLock, latestReport) {
  if (activeLock?.role === role) return 'running';
  if (!latestReport?.parsed) return 'idle';
  const status = latestReport.parsed.result?.status;
  if (status === 'finished') return 'done';
  if (status) return 'error';
  return 'idle';
}

const STATUS_LABEL = {
  idle: '대기',
  running: '실행 중',
  done: '완료',
  error: '오류',
};

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadMonitorState() {
  const readErrors = [];
  let rolesState = { workspace, roles: {} };
  let activeLock = null;

  try {
    rolesState = await readJsonFile(path.join(stateDir, 'roles.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[cursor-monitor] roles.json read failed', { code: error.code, message: error.message });
      readErrors.push({ file: 'roles.json', message: error.message });
    }
  }

  try {
    activeLock = await readJsonFile(path.join(stateDir, 'active.lock'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[cursor-monitor] active.lock read failed', { code: error.code, message: error.message });
      readErrors.push({ file: 'active.lock', message: error.message });
    }
  }

  const reportsByRole = {};
  for (const role of ROLES) reportsByRole[role] = null;

  let reportFiles = [];
  try {
    const names = await readdir(reportsDir);
    reportFiles = names
      .map(name => reportMeta(name))
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_REPORT_FILES);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[cursor-monitor] reports directory read failed', { code: error.code, message: error.message });
      readErrors.push({ file: 'reports/', message: error.message });
    }
  }

  const parsedReports = [];
  for (const meta of reportFiles) {
    const filePath = path.join(reportsDir, meta.filename);
    try {
      const parsed = await readJsonFile(filePath);
      const entry = { ...meta, parsed, readError: null };
      parsedReports.push(entry);
      const prev = reportsByRole[meta.role];
      if (!prev || meta.timestamp > prev.timestamp) reportsByRole[meta.role] = entry;
    } catch (error) {
      console.warn('[cursor-monitor] report parse failed', { file: meta.filename, message: error.message });
      readErrors.push({ file: meta.filename, message: error.message });
      parsedReports.push({ ...meta, parsed: null, readError: error.message });
    }
  }

  const roles = ROLES.map(role => {
    const config = rolesState.roles?.[role] ?? null;
    const latest = reportsByRole[role];
    const resultPayload = latest?.parsed?.result;
    const status = roleStatus(role, activeLock, latest);
    const isRunning = status === 'running';
    return {
      role,
      label: ROLE_LABELS[role],
      agentId: config?.agentId ?? null,
      modelId: config?.model?.id ?? null,
      status,
      statusLabel: STATUS_LABEL[status],
      taskId: isRunning && activeLock?.taskId
        ? activeLock.taskId
        : (latest?.parsed?.taskId ?? latest?.taskId ?? null),
      durationMs: resultPayload?.durationMs ?? null,
      totalTokens: resultPayload?.usage?.totalTokens ?? null,
      resultText: resultPayload ? extractResultText(resultPayload) : '',
      readError: latest?.readError ?? null,
    };
  });

  return {
    workspace,
    updatedAt: new Date().toISOString(),
    activeLock,
    readErrors,
    roles,
    recentReportCount: parsedReports.length,
  };
}

const monitorHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor 작업 모니터</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1117;
      --panel: #171b26;
      --border: #2a3142;
      --text: #e8ecf4;
      --muted: #9aa3b5;
      --accent: #6ea8fe;
      --ok: #3dd68c;
      --warn: #f5c542;
      --err: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
    }
    header {
      padding: 1.25rem 1.5rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    h1 { margin: 0 0 0.35rem; font-size: 1.35rem; }
    .sub { color: var(--muted); font-size: 0.92rem; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      font-size: 0.85rem;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .meta .ok { color: var(--ok); }
    .meta .bad { color: var(--err); }
    .banner {
      margin: 0.75rem 1.5rem;
      padding: 0.65rem 0.85rem;
      border: 1px solid var(--err);
      border-radius: 8px;
      color: var(--err);
      display: none;
    }
    .grid {
      display: grid;
      gap: 1rem;
      padding: 1rem 1.5rem 2rem;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    @media (max-width: 1100px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .grid { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem;
      min-height: 12rem;
    }
    .card h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      border: 1px solid var(--border);
      margin-bottom: 0.5rem;
    }
    .badge.idle { color: var(--muted); }
    .badge.running { color: var(--accent); border-color: var(--accent); }
    .badge.done { color: var(--ok); border-color: var(--ok); }
    .badge.error { color: var(--err); border-color: var(--err); }
    dl { margin: 0; font-size: 0.85rem; }
    dt { color: var(--muted); margin-top: 0.35rem; }
    dd { margin: 0.1rem 0 0; word-break: break-word; }
    details {
      margin-top: 0.75rem;
      border-top: 1px solid var(--border);
      padding-top: 0.5rem;
    }
    summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
    pre.result {
      margin: 0.5rem 0 0;
      padding: 0.65rem;
      background: #0c0e14;
      border-radius: 6px;
      font-size: 0.78rem;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 16rem;
      overflow: auto;
    }
  </style>
</head>
<body>
  <header>
    <h1>Cursor 작업 모니터</h1>
    <p class="sub">같은 Atelier 폴더 · SDK 대화 · 순차 실행</p>
  </header>
  <div class="meta">
    <span id="conn">연결: …</span>
    <span id="updated">업데이트: …</span>
  </div>
  <div id="banner" class="banner"></div>
  <main id="grid" class="grid"></main>
  <script>
    const grid = document.getElementById('grid');
    const conn = document.getElementById('conn');
    const updated = document.getElementById('updated');
    const banner = document.getElementById('banner');
    const detailsOpenState = new Map();

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function render(state) {
      grid.replaceChildren();
      for (const role of state.roles) {
        const card = el('article', 'card');
        const title = el('h2', null, role.label + ' (' + role.role + ')');
        const badge = el('span', 'badge ' + role.status, role.statusLabel);
        card.append(title, badge);

        const dl = document.createElement('dl');
        const addRow = (label, value) => {
          if (value == null || value === '') return;
          dl.append(el('dt', null, label), el('dd', null, String(value)));
        };
        addRow('모델', role.modelId);
        addRow('작업 ID', role.taskId);
        const running = role.status === 'running';
        if (role.durationMs != null) addRow(running ? '최근 완료 소요(ms)' : '소요(ms)', role.durationMs);
        if (role.totalTokens != null) addRow(running ? '최근 완료 토큰' : '토큰', role.totalTokens);
        if (role.readError) addRow('읽기 오류', role.readError);
        card.append(dl);

        const details = document.createElement('details');
        const defaultOpen = running;
        details.open = detailsOpenState.has(role.role)
          ? detailsOpenState.get(role.role)
          : defaultOpen;
        details.addEventListener('toggle', () => {
          detailsOpenState.set(role.role, details.open);
        });
        details.append(el('summary', null, running ? '직전 완료 결과' : '결과 본문'));
        const pre = el('pre', 'result');
        pre.textContent = role.resultText || '(결과 없음)';
        details.append(pre);
        card.append(details);
        grid.append(card);
      }
    }

    async function poll() {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const state = await res.json();
        conn.textContent = '연결: 정상';
        conn.className = 'ok';
        updated.textContent = '업데이트: ' + new Date(state.updatedAt).toLocaleString('ko-KR');
        banner.style.display = 'none';
        if (state.readErrors?.length) {
          banner.textContent = '일부 상태 파일을 읽지 못했습니다. 서버 콘솔의 [cursor-monitor] 로그를 확인하세요.';
          banner.style.display = 'block';
        }
        render(state);
      } catch (error) {
        console.warn('[cursor-monitor] API fetch failed', error);
        conn.textContent = '연결: 오류';
        conn.className = 'bad';
        banner.textContent = '모니터 API에 연결하지 못했습니다. node monitor.mjs 가 실행 중인지 확인하세요.';
        banner.style.display = 'block';
      }
    }

    poll();
    setInterval(poll, 2000);
  </script>
</body>
</html>
`;

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, { ...securityHeaders, ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') {
    send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
    return;
  }

  const url = req.url?.split('?')[0] ?? '/';

  if (url === '/') {
    send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, monitorHtml);
    return;
  }

  if (url === '/api/state') {
    try {
      const state = await loadMonitorState();
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(state));
    } catch (error) {
      console.warn('[cursor-monitor] state build failed', { message: error.message });
      send(res, 500, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
        error: error.message,
        readErrors: [{ file: 'state', message: error.message }],
      }));
    }
    return;
  }

  send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
});

server.on('error', (error) => {
  console.warn('[cursor-monitor] server error', { code: error.code, message: error.message });
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[cursor-monitor] http://${HOST}:${PORT}/ (workspace: ${workspace})`);
});
