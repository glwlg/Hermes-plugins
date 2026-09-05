const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'desktop', 'plugin.js'), 'utf8')

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

// --- prefs normalization keeps pinnedProjectKeys + projectAppearance -------

const prefNames = ['normalizeStringKeyList', 'normalizeMonitorLayout', 'normalizeProjectAppearance', 'normalizeGatewaySessionPreferences']
const prefContext = {
  DEFAULT_GATEWAY_SESSION_PREFERENCES: {
    collapsedKeys: [],
    hideScheduled: true,
    monitorHiddenKeys: [],
    monitorLayout: 'tile',
    monitorParkedKeys: [],
    profileScope: 'default',
    search: '',
    pinnedProjectKeys: [],
    projectAppearance: {}
  },
  PROFILE_SCOPE_ALL: 'all',
  PROFILE_SCOPE_DEFAULT: 'default',
  HIDE_SCHEDULED_SESSIONS_DEFAULT: true,
  MONITOR_LAYOUTS: ['tile', 'compact', 'list'],
  MONITOR_KEY_LIST_MAX: 200
}
vm.createContext(prefContext)
vm.runInContext(
  `${prefNames.map(extractFunction).join('\n')}\nglobalThis.api = { normalizeGatewaySessionPreferences }`,
  prefContext
)

const normalized = prefContext.api.normalizeGatewaySessionPreferences({
  pinnedProjectKeys: ['a::b::p1', 42, '  ', 'a::b::p2'],
  projectAppearance: { 'a::b::p1': { color: 'red', icon: 'rocket' }, bad: 'nope', 'x': { color: 5 } }
})
assert.deepEqual(JSON.parse(JSON.stringify(normalized.pinnedProjectKeys)), ['a::b::p1', 'a::b::p2'], 'pinned project keys keep only non-empty strings')
assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.projectAppearance)),
  { 'a::b::p1': { color: 'red', icon: 'rocket' } },
  'project appearance keeps only well-formed entries'
)
assert.deepEqual(JSON.parse(JSON.stringify(prefContext.api.normalizeGatewaySessionPreferences(null).pinnedProjectKeys)), [])
assert.deepEqual(JSON.parse(JSON.stringify(prefContext.api.normalizeGatewaySessionPreferences(undefined).projectAppearance)), {})

// --- project ordering: pinned projects first --------------------------------

const orderNames = [
  'sessionBooleanValue',
  'sessionPinned',
  'sessionActivityValue',
  'compareSessions',
  'isHomeProject',
  'projectDisplayLabel',
  'projectRemoteLabel',
  'projectLatestActivity',
  'compareProjects',
  'orderProjectsWithPins'
]
const orderContext = { HOME_PROJECT_KEY: '__no_project__', HOME_PROJECT_LABEL: '主页' }
vm.createContext(orderContext)
vm.runInContext(
  `${orderNames.map(extractFunction).join('\n')}\nglobalThis.api = { orderProjectsWithPins }`,
  orderContext
)

const mk = (key, active) => ({ key, label: key, remoteLabel: '', profile: 'default', sessions: [{ id: `${key}-s`, last_active: active }] })
// Input is already in the stabilized (frozen) order; orderProjectsWithPins only
// lifts pinned keys to the front WITHOUT re-sorting by live activity, so the
// rail stops jumping when a background session's last_active ticks.
const projects = [mk('a', 10), mk('b', 90), mk('c', 50)]
const pinned = new Set(['a'])
const ordered = orderContext.api.orderProjectsWithPins(projects, pinned)
assert.deepEqual(
  JSON.parse(JSON.stringify(ordered.map(p => p.key))),
  ['a', 'b', 'c'],
  'pinned projects lead; the rest keep the incoming frozen order'
)
assert.deepEqual(
  JSON.parse(JSON.stringify(orderContext.api.orderProjectsWithPins(projects, new Set()).map(p => p.key))),
  ['a', 'b', 'c'],
  'no pins → incoming frozen order preserved verbatim (no live re-sort)'
)
// A pinned project already at the back jumps to the front, others keep order.
assert.deepEqual(
  JSON.parse(JSON.stringify(orderContext.api.orderProjectsWithPins(projects, new Set(['c'])).map(p => p.key))),
  ['c', 'a', 'b'],
  'a pinned project is lifted to the front, preserving relative order of the rest'
)

// --- project hint (hover info) ----------------------------------------------

const hintNames = [
  'isHomeProject',
  'projectDisplayLabel',
  'projectRemoteLabel',
  'projectSourceBadge',
  'projectWorkspacePath',
  'projectInfoHint'
]
const hintContext = {
  HOME_PROJECT_KEY: '__no_project__',
  HOME_PROJECT_LABEL: '主页',
  PROFILE_SCOPE_DEFAULT: 'default'
}
vm.createContext(hintContext)
vm.runInContext(
  `${hintNames.map(extractFunction).join('\n')}\nglobalThis.api = { projectInfoHint }`,
  hintContext
)

const hintProject = {
  key: 'r::default::p1',
  label: 'OpsCore',
  path: '/home/luwei/workspace/OpsCore',
  remoteLabel: '192.168.1.10',
  sourceLabel: 'Debian 1',
  profile: 'default',
  sessionCount: 16,
  sessions: [],
  route: { connectionId: 'r', mode: 'remote', profile: 'default', targetProfile: 'default' }
}
const hint = hintContext.api.projectInfoHint(hintProject)
assert.match(hint, /OpsCore/, 'hint shows the project name')
assert.match(hint, /16/, 'hint shows the session count')
assert.match(hint, /\/home\/luwei\/workspace\/OpsCore/, 'hint shows the workspace path')
assert.match(hint, /Debian 1|192\.168\.1\.10/, 'hint shows the gateway/source')

// pinned toggle must persist through prefs, not backend
assert.match(source, /pinnedProjectKeys/, 'project pins persist in local prefs')
assert.match(source, /projectAppearance/, 'project appearance persists in local prefs')

console.log('overlook project pin + info contract passed')
