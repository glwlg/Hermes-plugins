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

assert.match(source, /preview_limit: PROJECT_SESSION_PREVIEW_LIMIT/, 'projects.tree must request the same five-row preview the pane renders')
assert.doesNotMatch(source, /preview_limit: 3/, 'the old three-row tree preview must not remain')
assert.match(source, /'projects\.project_sessions'/, 'project expand must use the authoritative project drill-in RPC')
assert.match(source, /project_id: project\.projectId/, 'drill-in must preserve the authoritative project id')
assert.match(source, /type: 'project-loading'/, 'expanded projects need an inline loading row')
assert.match(source, /type: 'project-error'/, 'failed project hydration needs an inline retry row')
assert.match(source, /const gatewayProjectSessionsCache = new Map\(\)/, 'project hydration must cache by route/profile/project')

const helperNames = [
  'sessionBooleanValue',
  'normalizeSessionRecord',
  'sessionPinned',
  'sessionIsScheduled',
  'sessionActivityValue',
  'compareSessions',
  'normalizeProjectSessions',
  'flattenProjectNodeSessions',
  'patchSessionRows'
]
const context = {}
vm.createContext(context)
vm.runInContext(
  `${helperNames.map(extractFunction).join('\n')}\nglobalThis.api = { flattenProjectNodeSessions, normalizeProjectSessions, patchSessionRows }`,
  context
)

const hydrated = {
  previewSessions: [{ id: 'preview-only', last_active: 1 }],
  repos: [
    {
      groups: [
        {
          sessions: [
            { id: 'recent', last_active: 30, pinned: false },
            { id: 'pinned', last_active: 10, pinned: true },
            { id: 'cron', last_active: 50, source: 'cron' }
          ]
        },
        { sessions: [{ id: 'recent', last_active: 20 }] }
      ]
    }
  ]
}

assert.deepEqual(
  JSON.parse(JSON.stringify(context.api.flattenProjectNodeSessions(hydrated, 'default', true).map(session => session.id))),
  ['pinned', 'recent', 'preview-only'],
  'hydrated lanes flatten, dedupe, hide cron rows, and preserve pin-first ordering'
)
assert.deepEqual(
  JSON.parse(JSON.stringify(context.api.flattenProjectNodeSessions(hydrated, 'default', false).map(session => session.id))),
  ['pinned', 'cron', 'recent', 'preview-only'],
  'scheduled rows return when the calendar toggle is enabled'
)

const groupingNames = [
  'sessionBooleanValue',
  'normalizeSessionRecord',
  'sessionPinned',
  'sessionIsScheduled',
  'sessionActivityValue',
  'compareSessions',
  'projectPathKey',
  'projectPathContains',
  'projectTreeNodePaths',
  'projectTreeEntries',
  'normalizeProjectSessions',
  'flattenProjectNodeSessions',
  'directProjectDescriptor',
  'projectDescriptorForSession',
  'projectTreePathForDescriptor',
  'projectGroupsForGatewayGroup'
]
const groupingContext = {
  HOME_PROJECT_KEY: '__no_project__',
  HOME_PROJECT_LABEL: '主页',
  PROJECT_SESSION_PREVIEW_LIMIT: 5
}
vm.createContext(groupingContext)
vm.runInContext(
  `${groupingNames.map(extractFunction).join('\n')}\nglobalThis.api = { projectGroupsForGatewayGroup }`,
  groupingContext
)

const nestedTree = {
  projects: [
    { id: 'parent', label: 'Parent', path: '/work', repos: [], sessionCount: 0, previewSessions: [] },
    { id: 'child', label: 'Child', path: '/work/app', repos: [], sessionCount: 7, previewSessions: Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, cwd: '/work/app', last_active: 100 - index })) },
    { id: '__no_project__', label: 'Home', isNoProject: true, repos: [], sessionCount: 1, previewSessions: [{ id: 'home', last_active: 1 }] }
  ]
}
const grouped = groupingContext.api.projectGroupsForGatewayGroup({
  key: 'route',
  label: 'This device',
  remoteLabel: '',
  profile: 'default',
  route: { connectionId: 'local', profile: 'default', targetProfile: 'default' },
  projectTree: nestedTree,
  hasMore: true,
  sessions: [{ id: 'child-extra', cwd: '/work/app/src', last_active: 200 }]
}, false)
const childProject = grouped.find(project => project.projectId === 'child')
assert.equal(childProject.sessionCount, 7)
assert.equal(childProject.sessions.length, 5)
assert.equal(childProject.prefetchedSessions.some(session => session.id === 'child-extra'), true, 'nested path sessions must stay on the longest matching project')
assert.equal(grouped.find(project => project.projectId === 'parent').prefetchedSessions.length, 0)
assert.equal(grouped.find(project => project.projectId === '__no_project__').sourceKey, '__no_project__')

const patchedPin = context.api.patchSessionRows(
  [{ id: 'a', pinned: false, last_active: 30 }, { id: 'b', pinned: false, last_active: 20 }],
  { id: 'b' },
  { pinned: true },
  'PATCH',
  { pinned: true }
)
assert.deepEqual(JSON.parse(JSON.stringify(patchedPin.map(row => [row.id, row.pinned]))), [['b', true], ['a', false]])
assert.deepEqual(
  JSON.parse(JSON.stringify(context.api.patchSessionRows(patchedPin, { id: 'b' }, null, 'DELETE', {}).map(row => row.id))),
  ['a'],
  'delete/archive mutations must also leave hydrated project rows immediately'
)
assert.match(source, /setProjectLoads\(current =>/, 'session mutations must patch the expanded project cache')

console.log('overlook project hydration contract passed')
