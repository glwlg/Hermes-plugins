const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const pluginPath = path.join(__dirname, 'desktop', 'plugin.js')
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
assert.match(source, /type: 'collapse'/, 'revealed projects must keep a collapse row under the extra sessions')
assert.match(source, /展开显示/, 'load-more control must match the native expand label')
assert.doesNotMatch(source, /: ' 更多'/, 'expand must not advertise leftover gateway pages as 更多')
assert.match(source, /收起/, 'revealed projects must expose a collapse control')
assert.match(source, /function gatewayProjectToggleRow\(/, 'expand and collapse must share one text-aligned row')
assert.match(source, /justify-start/, 'toggle control must align with session titles, not center across the rail')
assert.doesNotMatch(source, /justify-center rounded-md border border-\(--ui-stroke-tertiary\) bg-transparent text-\[0\.62rem\]/, 'the old full-width bordered expand button must not remain')
assert.match(source, /px-2 py-1\.5/, 'toggle padding must match the session title track')
assert.doesNotMatch(source, /function gatewayProjectMoreRow\(/)
assert.doesNotMatch(source, /加载更多（已加载/, 'global source pagination must not compete with per-project expand')
assert.doesNotMatch(source, /\$gatewaySessionLimit\.set\(nextSessionLimit\)/, 'the pane must not grow the shared session window from a footer button')
assert.match(source, /remaining > 0/, 'expand is shown only when the authoritative project count exceeds visible rows')
assert.match(source, /type: 'pinned-header'/, 'pinned sessions break out into a dedicated pinned section')
assert.match(source, /type: 'pinned-session'/, 'pinned sessions render in the pinned section')
assert.doesNotMatch(source, /type: 'pin-divider'/, 'the old in-project pin divider is gone once pinned sessions break out')
assert.match(source, /data-session-status/, 'status marks belong in the trailing action slot, not the title lead')
assert.match(source, /data-session-menu/, 'the kebab must occupy the same trailing slot as the status mark')
assert.match(source, /\[data-session-status\]:not\(:has\(\[role="status"\]\)\)\{display:none!important\}/, 'idle SessionStatusDot marks must not occupy the kebab slot')
assert.doesNotMatch(source, /sessionPinned\(session\) && jsx\(Codicon, \{ name: 'pin'/, 'pinned sessions must not keep a lead pin glyph')
assert.doesNotMatch(source, /jsx\(SessionStatusDot, \{ session, storedSessionId: session\.id \}, 'status'\)/)

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
  'gatewayPinnedSessionEntries',
  'gatewayRenderRows'
]
const context = {
  HOME_PROJECT_KEY: '__no_project__',
  HOME_PROJECT_LABEL: '主页',
  PROJECT_SESSION_PREVIEW_LIMIT: 5,
  GATEWAY_PINNED_SECTION_KEY: '__pinned__'
}
vm.createContext(context)
vm.runInContext(
  `${names.map(extractFunction).join('\n')}\nglobalThis.api = { compareProjects, compareSessions, gatewayRenderRows, projectLatestActivity }`,
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
assert.equal(context.api.projectLatestActivity({ sessions: [], lastActive: 90 }), 90000, 'tree lastActive must drive project rank even when only a preview is mounted')

const seven = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, last_active: 100 - index }))
const previewRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessionCount: 7, sessions: seven.slice(0, 5), loadStatus: 'idle' }],
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
  'an authoritative project preview must advertise its exact remaining count'
)

const loadingRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessionCount: 7, sessions: seven.slice(0, 5), loadStatus: 'loading' }],
  new Set(),
  new Set(['p1'])
)
assert.deepEqual(
  JSON.parse(JSON.stringify(loadingRows.map(row => row.type))),
  ['project', 'session', 'session', 'session', 'session', 'session', 'project-loading', 'collapse']
)

const errorRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessionCount: 7, sessions: seven.slice(0, 5), loadStatus: 'error' }],
  new Set(),
  new Set(['p1'])
)
assert.deepEqual(
  JSON.parse(JSON.stringify(errorRows.map(row => row.type))),
  ['project', 'session', 'session', 'session', 'session', 'session', 'project-error', 'collapse']
)

const revealedRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: seven }],
  new Set(),
  new Set(['p1'])
)
assert.deepEqual(
  JSON.parse(JSON.stringify(revealedRows.map(row => row.type))),
  ['project', 'session', 'session', 'session', 'session', 'session', 'session', 'session', 'collapse']
)
assert.equal(revealedRows.some(row => row.type === 'more'), false)
assert.equal(revealedRows.at(-1).type, 'collapse')

const five = Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, last_active: 50 - index }))
const fiveRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: five }],
  new Set()
)
assert.equal(fiveRows.some(row => row.type === 'more' || row.type === 'collapse'), false, 'five loaded sessions stay fully visible')

const twoWithMore = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: five.slice(0, 2), hasMore: true }],
  new Set()
)
assert.equal(twoWithMore.some(row => row.type === 'more'), false, 'a short project must not inherit a sibling source window as its own expand row')

const fiveWithMore = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: five, hasMore: true }],
  new Set()
)
assert.equal(fiveWithMore.some(row => row.type === 'more'), false, 'gateway leftovers must not mint an expand row when the project already shows every loaded session')

const fiveRevealedWithMore = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: five, hasMore: true, sourceTotal: 12 }],
  new Set(),
  new Set(['p1'])
)
assert.deepEqual(
  JSON.parse(JSON.stringify(fiveRevealedWithMore.map(row => row.type))),
  ['project', 'session', 'session', 'session', 'session', 'session', 'collapse'],
  'once a project is revealed, do not keep a dead expand row just because the gateway window has leftovers'
)

const twelve = Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, last_active: 120 - index }))
const twelveRevealedWithGatewayLeftovers = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: twelve, hasMore: true, sourceTotal: 40 }],
  new Set(),
  new Set(['p1'])
)
assert.deepEqual(
  JSON.parse(JSON.stringify(twelveRevealedWithGatewayLeftovers.map(row => row.type))),
  ['project', ...Array(12).fill('session'), 'collapse'],
  'a fully revealed project must not advertise expand-more from a sibling source window'
)
assert.equal(twelveRevealedWithGatewayLeftovers.some(row => row.type === 'more'), false)

const collapsedRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: seven }],
  new Set(['p1'])
)
assert.deepEqual(JSON.parse(JSON.stringify(collapsedRows.map(row => row.type))), ['project'])

const mixed = [
  { id: 'u1', last_active: 40, pinned: false },
  { id: 'p1', last_active: 10, pinned: true },
  { id: 'u2', last_active: 30, pinned: false },
  { id: 'p2', last_active: 20, pinned: true }
]
const mixedRows = context.api.gatewayRenderRows(
  [{ key: 'p1', sessions: mixed.sort(context.api.compareSessions) }],
  new Set()
)
assert.deepEqual(
  JSON.parse(JSON.stringify(mixedRows.map(row => [row.type, row.session?.id || '']))),
  [
    ['pinned-header', ''],
    ['pinned-session', 'p2'],
    ['pinned-session', 'p1'],
    ['project', ''],
    ['session', 'u1'],
    ['session', 'u2']
  ],
  'pinned sessions break out into a top section; unpinned stay under the project'
)

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

const variableNames = ['gatewayRowHeight', 'gatewayVirtualWindow']
const variableContext = { GATEWAY_VIRTUAL_OVERSCAN: 0 }
vm.createContext(variableContext)
vm.runInContext(
  `${variableNames.map(extractFunction).join('\n')}\nglobalThis.api = { gatewayRowHeight, gatewayVirtualWindow }`,
  variableContext
)
const variableRows = [
  { type: 'project' },
  { type: 'session' },
  { type: 'pinned-header' },
  { type: 'more' },
  { type: 'session' }
]
assert.deepEqual(variableRows.map(variableContext.api.gatewayRowHeight), [36, 36, 28, 28, 36])
assert.deepEqual(
  JSON.parse(JSON.stringify(variableContext.api.gatewayVirtualWindow(variableRows, 64, 30))),
  { bottom: 64, end: 3, start: 1, top: 36 }
)
assert.match(source, /gatewayVirtualWindow\(renderRows, scrollTop, viewportHeight\)/, 'virtualization must receive row types, not only a count')

console.log('overlook project recency preview contract passed')
