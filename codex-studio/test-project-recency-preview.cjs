const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const pluginPath = path.join(__dirname, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')

function extractFunction(name) {
  const starts = [`function ${name}(`, `async function ${name}(`]
  const start = starts.map(marker => source.indexOf(marker)).find(index => index >= 0) ?? -1
  assert.notEqual(start, -1, `missing function ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unterminated function ${name}`)
}

assert.match(source, /const PROJECT_SESSION_PREVIEW_LIMIT = 5/, 'preview must default to five sessions')
assert.match(source, /type: 'more'/, 'extra sessions must collapse behind a load-more row')
assert.match(source, /展开显示/, 'load-more control must match the Codex expand label')

const names = [
  'sessionBooleanValue',
  'sessionPinned',
  'sessionActivityValue',
  'compareSessions',
  'isHomeProject',
  'projectDisplayLabel',
  'projectRemoteLabel',
  'projectLatestActivity',
  'compareProjects',
  'gatewayRenderRows'
]
const context = {
  HOME_PROJECT_KEY: '__no_project__',
  HOME_PROJECT_LABEL: '主页',
  PROJECT_SESSION_PREVIEW_LIMIT: 5
}
vm.createContext(context)
vm.runInContext(
  `${names.map(extractFunction).join('\n')}\nglobalThis.api = { compareProjects, gatewayRenderRows, projectLatestActivity }`,
  context
)

const emptyA = { key: 'empty-a', sourceKey: 'project-tree:a', label: 'AAA', remoteLabel: '', profile: 'default', sessions: [] }
const emptyB = { key: 'empty-b', sourceKey: 'project-tree:b', label: 'BBB', remoteLabel: '', profile: 'default', sessions: [] }
const older = {
  key: 'older',
  sourceKey: 'project-tree:older',
  label: 'ZZZ',
  remoteLabel: '',
  profile: 'default',
  sessions: [{ id: 'old', last_active: 10 }]
}
const newer = {
  key: 'newer',
  sourceKey: 'project-tree:newer',
  label: 'MMM',
  remoteLabel: '',
  profile: 'default',
  sessions: [{ id: 'new', last_active: 50 }]
}
const homeBusy = {
  key: 'gateway::__no_project__',
  sourceKey: '__no_project__',
  label: '主页',
  remoteLabel: '',
  profile: 'default',
  sessions: [{ id: 'home', last_active: 40 }]
}

assert.deepEqual(
  JSON.parse(JSON.stringify([emptyA, older, newer, emptyB, homeBusy].sort(context.api.compareProjects).map(project => project.key))),
  ['newer', 'gateway::__no_project__', 'older', 'empty-a', 'empty-b'],
  'projects with sessions come first, then recency, then empty labels'
)

assert.equal(context.api.projectLatestActivity(newer), 50000)
assert.equal(context.api.projectLatestActivity(emptyA), 0)

const seven = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, last_active: 100 - index }))
const previewRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: seven }],
  new Set()
)
assert.deepEqual(
  JSON.parse(JSON.stringify(previewRows.map(row => [row.type, row.session?.id || row.remaining || '']))),
  [
    ['project', ''],
    ['session', 's0'],
    ['session', 's1'],
    ['session', 's2'],
    ['session', 's3'],
    ['session', 's4'],
    ['more', 2]
  ],
  'an expanded project must preview five sessions and hide the rest'
)

const revealedRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: seven }],
  new Set(),
  new Set(['p1'])
)
assert.deepEqual(
  JSON.parse(JSON.stringify(revealedRows.map(row => row.type))),
  ['project', 'session', 'session', 'session', 'session', 'session', 'session', 'session']
)
assert.equal(revealedRows.some(row => row.type === 'more'), false)

const collapsedRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: seven }],
  new Set(['p1'])
)
assert.deepEqual(JSON.parse(JSON.stringify(collapsedRows.map(row => row.type))), ['project'])

const stickyNames = [
  'sessionBooleanValue',
  'sessionPinned',
  'sessionActivityValue',
  'compareSessions',
  'isHomeProject',
  'projectDisplayLabel',
  'projectRemoteLabel',
  'projectLatestActivity',
  'compareProjects',
  'shouldResortProjectsForUserInput',
  'stabilizeProjectOrder'
]
const stickyContext = {
  HOME_PROJECT_KEY: '__no_project__',
  HOME_PROJECT_LABEL: '主页',
  PROJECT_SESSION_PREVIEW_LIMIT: 5
}
vm.createContext(stickyContext)
vm.runInContext(
  `${stickyNames.map(extractFunction).join('\n')}\nglobalThis.api = { compareProjects, shouldResortProjectsForUserInput, stabilizeProjectOrder }`,
  stickyContext
)

const quiet = { key: 'quiet', label: 'Quiet', remoteLabel: '', profile: 'default', sessions: [{ id: 'q', last_active: 80 }] }
const loud = { key: 'loud', label: 'Loud', remoteLabel: '', profile: 'default', sessions: [{ id: 'l', last_active: 10 }] }
const empty = { key: 'empty', label: 'Empty', remoteLabel: '', profile: 'default', sessions: [] }
const initial = stickyContext.api.stabilizeProjectOrder([empty, loud, quiet], [])
assert.deepEqual(
  JSON.parse(JSON.stringify(initial.map(project => project.key))),
  ['quiet', 'loud', 'empty'],
  'first paint still ranks busy projects by recency'
)

const louder = { ...loud, sessions: [{ id: 'l', last_active: 90 }] }
const background = stickyContext.api.stabilizeProjectOrder([empty, louder, quiet], initial.map(project => project.key))
assert.deepEqual(
  JSON.parse(JSON.stringify(background.map(project => project.key))),
  ['quiet', 'loud', 'empty'],
  'background activity must not reshuffle an already painted project list'
)

assert.equal(stickyContext.api.shouldResortProjectsForUserInput({ previousBusy: false, busy: true }), true)
assert.equal(stickyContext.api.shouldResortProjectsForUserInput({ previousBusy: true, busy: true }), false)
assert.equal(stickyContext.api.shouldResortProjectsForUserInput({ previousBusy: true, busy: false }), false)
assert.equal(stickyContext.api.shouldResortProjectsForUserInput({ reason: 'refresh' }), true)
assert.equal(stickyContext.api.shouldResortProjectsForUserInput({ reason: 'new-chat' }), true)

const afterSend = stickyContext.api.stabilizeProjectOrder(
  [empty, louder, quiet],
  background.map(project => project.key),
  { resort: stickyContext.api.shouldResortProjectsForUserInput({ previousBusy: false, busy: true }) }
)
assert.deepEqual(
  JSON.parse(JSON.stringify(afterSend.map(project => project.key))),
  ['loud', 'quiet', 'empty'],
  'a focused user send may re-rank projects by latest activity'
)

const stranger = { key: 'stranger', label: 'Stranger', remoteLabel: '', profile: 'default', sessions: [{ id: 's', last_active: 100 }] }
const withNewcomer = stickyContext.api.stabilizeProjectOrder(
  [empty, louder, quiet, stranger],
  background.map(project => project.key)
)
assert.deepEqual(
  JSON.parse(JSON.stringify(withNewcomer.map(project => project.key))),
  ['quiet', 'loud', 'empty', 'stranger'],
  'a newly seen project appends without reshuffling the painted order'
)

console.log('codex-studio project recency preview contract passed')
