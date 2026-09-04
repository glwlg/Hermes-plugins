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

const names = [
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
  'gatewayProjectSessionsCacheKey',
  'clearGatewayProjectSessionsCache',
  'fetchGatewayProjectSessions'
]

let calls = 0
const host = {
  requestProfile: async (_route, method, params) => {
    calls += 1
    assert.equal(method, 'projects.project_sessions')
    assert.equal(params.project_id, 'p_ops')
    assert.equal(params.profile, 'coder')
    await Promise.resolve()
    return {
      project: {
        repos: [{ groups: [{ sessions: [{ id: 's1', last_active: 10 }] }] }]
      }
    }
  }
}
const context = { host }
vm.createContext(context)
vm.runInContext(
  `const gatewayProjectSessionsCache = new Map()\n${names.map(extractFunction).join('\n')}\nglobalThis.api = { clearGatewayProjectSessionsCache, fetchGatewayProjectSessions }`,
  context
)

const project = {
  projectId: 'p_ops',
  profile: 'coder',
  route: { connectionId: 'remote', mode: 'remote', profile: 'coder', targetProfile: 'coder' }
}

async function main() {
  const [first, second] = await Promise.all([
    context.api.fetchGatewayProjectSessions(project),
    context.api.fetchGatewayProjectSessions(project)
  ])
  assert.equal(calls, 1, 'concurrent expands must share one RPC')
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)))

  await context.api.fetchGatewayProjectSessions(project)
  assert.equal(calls, 1, 'ready project sessions must come from cache')

  context.api.clearGatewayProjectSessionsCache(project)
  await context.api.fetchGatewayProjectSessions(project)
  assert.equal(calls, 2, 'explicit invalidation must allow a fresh RPC')

  console.log('overlook project cache contract passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
