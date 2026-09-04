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

const names = [
  'sessionBooleanValue',
  'sessionPinned',
  'sessionIsScheduled',
  'sessionActivityValue',
  'compareSessions',
  'gatewayRenderRows',
  'gatewayPinnedSessionEntries'
]
const context = {
  PROJECT_SESSION_PREVIEW_LIMIT: 5,
  GATEWAY_PINNED_SECTION_KEY: '__pinned__'
}
vm.createContext(context)
vm.runInContext(
  `${names.map(extractFunction).join('\n')}\nglobalThis.api = { gatewayRenderRows, gatewayPinnedSessionEntries }`,
  context
)

const makeProject = (key, sessions, extra = {}) => ({
  key,
  displayLabel: `P-${key}`,
  remoteLabel: '',
  sessions,
  sessionCount: Array.isArray(sessions) ? sessions.length : 0,
  loadStatus: 'idle',
  ...extra
})

// Two projects with pinned + unpinned sessions mixed.
const projectA = makeProject('a', [
  { id: 'a-pinned', pinned: true, last_active: 50 },
  { id: 'a-normal', pinned: false, last_active: 40 }
])
const projectB = makeProject('b', [
  { id: 'b-pinned', pinned: true, last_active: 90 },
  { id: 'b-normal', pinned: false, last_active: 80 }
])

// --- pinned section extraction ---------------------------------------------

const pinnedEntries = context.api.gatewayPinnedSessionEntries([projectA, projectB])
assert.deepEqual(
  JSON.parse(JSON.stringify(pinnedEntries.map(entry => entry.session.id))),
  ['b-pinned', 'a-pinned'],
  'pinned sessions are collected across projects, most recent first'
)
assert.equal(pinnedEntries[0].project.key, 'b', 'pinned entry keeps its owning project')

// --- render rows: pinned section first, projects no longer repeat pinned ---

const rows = context.api.gatewayRenderRows([projectA, projectB], new Set(), new Set())
const types = rows.map(row => row.type)

// A dedicated pinned header row exists and leads the list.
assert.equal(types[0], 'pinned-header', 'pinned section header leads the rail')

// Pinned sessions render as 'pinned-session' rows inside the section.
const pinnedSessionIds = rows.filter(row => row.type === 'pinned-session').map(row => row.session.id)
assert.deepEqual(JSON.parse(JSON.stringify(pinnedSessionIds)), ['b-pinned', 'a-pinned'])

// Pinned sessions must NOT also appear as project session rows (跳出 = no duplicate).
const projectSessionIds = rows.filter(row => row.type === 'session').map(row => row.session.id)
assert.equal(projectSessionIds.includes('a-pinned'), false, 'pinned session must not repeat under its project')
assert.equal(projectSessionIds.includes('b-pinned'), false, 'pinned session must not repeat under its project')
assert.equal(projectSessionIds.includes('a-normal'), true, 'unpinned sessions stay under their project')
assert.equal(projectSessionIds.includes('b-normal'), true)

// The old in-project pin-divider is gone once pinned sessions leave the project.
assert.equal(types.includes('pin-divider'), false, 'no in-project pin divider once pinned sessions break out')

// No pinned sessions → no pinned section at all.
const noPinned = context.api.gatewayRenderRows(
  [makeProject('c', [{ id: 'c1', pinned: false, last_active: 1 }])],
  new Set(),
  new Set()
)
assert.equal(noPinned.some(row => row.type === 'pinned-header'), false, 'pinned section hidden when nothing is pinned')

// Pinned entries helper: scheduled sessions are already filtered upstream,
// but the helper must tolerate projects with no sessions array.
assert.doesNotThrow(() => context.api.gatewayPinnedSessionEntries([makeProject('d', null)]))

// Pinned section must respect collapsed state of the section itself.
const collapsedPinned = context.api.gatewayRenderRows([projectA, projectB], new Set(['__pinned__']), new Set())
assert.equal(collapsedPinned.some(row => row.type === 'pinned-header'), true, 'pinned header still shows when collapsed')
assert.equal(collapsedPinned.some(row => row.type === 'pinned-session'), false, 'pinned rows hide when the section is collapsed')

console.log('overlook pinned section contract passed')
