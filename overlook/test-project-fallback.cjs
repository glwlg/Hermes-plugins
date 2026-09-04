const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8')

function extractFunction(name) {
  const starts = [`function ${name}(`, `async function ${name}(`]
  const start = starts.map(marker => source.indexOf(marker)).find(index => index >= 0) ?? -1
  assert.notEqual(start, -1, `missing function ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated function ${name}`)
}

// --- unknown-method detection ---------------------------------------------

const detectNames = ['isGatewayUnknownMethodError', 'projectSessionsUnsupportedMessage']
const detectContext = {}
vm.createContext(detectContext)
vm.runInContext(
  `${detectNames.map(extractFunction).join('\n')}\nglobalThis.api = { isGatewayUnknownMethodError, projectSessionsUnsupportedMessage }`,
  detectContext
)

// Old gateways answer JSON-RPC -32601 with "unknown method: <name>".
assert.equal(detectContext.api.isGatewayUnknownMethodError(new Error('unknown method: projects.project_sessions')), true)
assert.equal(detectContext.api.isGatewayUnknownMethodError(new Error('RPC error -32601: unknown method: projects.project_sessions')), true)
assert.equal(detectContext.api.isGatewayUnknownMethodError({ message: 'unknown method: projects.tree' }), true)
// Real failures must NOT be misclassified as unsupported.
assert.equal(detectContext.api.isGatewayUnknownMethodError(new Error('项目会话不存在。')), false)
assert.equal(detectContext.api.isGatewayUnknownMethodError(new Error('gateway unreachable')), false)
assert.equal(detectContext.api.isGatewayUnknownMethodError(new Error('session not found')), false)
assert.equal(detectContext.api.isGatewayUnknownMethodError(null), false)
assert.equal(detectContext.api.isGatewayUnknownMethodError('unknown method'), false, 'bare string without method name is ambiguous')
// Unsupported message must name the upgrade path.
assert.match(detectContext.api.projectSessionsUnsupportedMessage(), /升级|更新/)
assert.match(detectContext.api.projectSessionsUnsupportedMessage(), /Hermes/)

// --- fetch fallback: old gateway → preview sessions, cached as supported=false ---

const fetchNames = [
  'routeKey',
  'routeTargetProfile',
  'sessionBooleanValue',
  'normalizeSessionRecord',
  'sessionPinned',
  'sessionIsScheduled',
  'sessionActivityValue',
  'compareSessions',
  'normalizeProjectSessions',
  'flattenProjectNodeSessions',
  'isGatewayUnknownMethodError',
  'projectSessionsUnsupportedMessage',
  'gatewayProjectSessionsCacheKey',
  'clearGatewayProjectSessionsCache',
  'fetchGatewayProjectSessions'
]

function makeHost(impl) {
  return { requestProfile: impl }
}

const project = {
  key: 'remote::coder::p_ops',
  projectId: 'p_ops',
  profile: 'coder',
  route: { connectionId: 'remote', mode: 'remote', profile: 'coder', targetProfile: 'coder' },
  previewSessions: [{ id: 'preview-1', last_active: 5 }],
  prefetchedSessions: [{ id: 'pre-1', last_active: 3 }],
  sessions: [{ id: 'row-1', last_active: 1 }]
}

async function main() {
  // 1. Unknown-method gateway: falls back to preview sessions, caches the
  //    verdict, and never re-issues the RPC for that project.
  {
    let calls = 0
    const host = makeHost(async () => {
      calls += 1
      throw new Error('unknown method: projects.project_sessions')
    })
    const context = { host }
    vm.createContext(context)
    vm.runInContext(
      `const gatewayProjectSessionsCache = new Map()\n${fetchNames.map(extractFunction).join('\n')}\nglobalThis.api = { fetchGatewayProjectSessions }`,
      context
    )
    const sessions = await context.api.fetchGatewayProjectSessions(project)
    assert.equal(calls, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(sessions.map(s => s.id))), ['preview-1'], 'must fall back to preview sessions')
    // Second call must be served from the cached verdict without a new RPC.
    const again = await context.api.fetchGatewayProjectSessions(project)
    assert.equal(calls, 1, 'unsupported verdict must be cached, no retry storm')
    assert.deepEqual(JSON.parse(JSON.stringify(again.map(s => s.id))), ['preview-1'])
  }

  // 2. Transient failure: evicted, retried on next call.
  {
    let calls = 0
    const host = makeHost(async (_route, _method, _params) => {
      calls += 1
      if (calls === 1) throw new Error('gateway unreachable')
      return { project: { repos: [{ groups: [{ sessions: [{ id: 'full-1', last_active: 9 }] }] }] } }
    })
    const context = { host }
    vm.createContext(context)
    vm.runInContext(
      `const gatewayProjectSessionsCache = new Map()\n${fetchNames.map(extractFunction).join('\n')}\nglobalThis.api = { fetchGatewayProjectSessions }`,
      context
    )
    await assert.rejects(() => context.api.fetchGatewayProjectSessions(project), /unreachable/)
    const sessions = await context.api.fetchGatewayProjectSessions(project)
    assert.equal(calls, 2, 'transient failures must stay retryable')
    assert.deepEqual(JSON.parse(JSON.stringify(sessions.map(s => s.id))), ['full-1'])
  }

  // 3. Status bar partial-data hint: inbox summary exposes `partial`.
  {
    const summaryNames = ['sessionBooleanValue', 'sessionPinned', 'sessionIsScheduled', 'sessionActive', 'sessionUnread', 'gatewayInboxSummary']
    const context = {}
    vm.createContext(context)
    vm.runInContext(
      `${summaryNames.map(extractFunction).join('\n')}\nglobalThis.api = { gatewayInboxSummary }`,
      context
    )
    const groups = [
      { error: null, hasMore: true, sessions: [{ id: 'a', unread: true, last_active: 1 }] },
      { error: null, hasMore: false, sessions: [{ id: 'b', unread: false, last_active: 2 }] }
    ]
    const summary = context.api.gatewayInboxSummary(groups, true)
    assert.equal(summary.unread, 1)
    assert.equal(summary.partial, true, 'any group with hasMore must flag the summary as partial')
    const complete = context.api.gatewayInboxSummary(groups.map(g => ({ ...g, hasMore: false })), true)
    assert.equal(complete.partial, false)
    const failed = context.api.gatewayInboxSummary([{ error: new Error('x'), hasMore: true, sessions: [] }], true)
    assert.equal(failed.partial, false, 'errored groups are excluded from partial (they are reported as failed)')
  }

  console.log('overlook project fallback + partial summary contract passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
