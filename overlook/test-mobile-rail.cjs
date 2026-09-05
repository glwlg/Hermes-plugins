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

assert.match(source, /const MOBILE_SNAPSHOT_EVENT_TYPES = new Set/, 'session-list snapshots must be gated on a small event set')
assert.match(source, /function scheduleMobileBridgeSnapshot\(/, 'session-list snapshots must be debounced')
assert.match(source, /function buildMobileRailSnapshot\(/, 'mobile snapshot must reuse the sidebar project rail')
assert.match(source, /function serializeMobileRailSession\(/, 'mobile rows must carry sidebar status fields')
assert.match(source, /function readCachedGatewaySessionGroups\(/, 'snapshot must read the cached rail instead of refetching on every event')

assert.match(source, /function rememberMobileSessionRuntime\(/, 'desktop must map runtime session ids back to stored ids')
assert.match(source, /function canonicalMobileSessionId\(/, 'live events must be rewritten onto the stored session the phone is watching')
assert.match(source, /function pushMobileBusyUpdate\(/, 'turn busy must be pushed independently of the 2s roster snapshot')
assert.match(source, /const MOBILE_ACTIVITY_EVENT_TYPES = new Set/, 'mobile companion tracks subagent and background activity separately from transcript rows')
assert.match(source, /function pushMobileActivityUpdate\(/, 'live activity state has an explicit compact websocket frame')
assert.match(source, /subagent\.start/, 'native subagent lifecycle events are bridged to mobile')
assert.match(source, /function refreshMobileBackgroundActivity\(/, 'background process state is queried for the watched mobile session')
assert.match(source, /busyBySession/, 'the rail snapshot must carry a stored-id busy map')

assert.match(source, /function autoFlushNextQueuedPrompt\(/, 'desktop must auto-send queued messages when turn completes')
assert.match(extractFunction('noteMobileTurnComplete'), /autoFlushNextQueuedPrompt/, 'completing a turn auto-sends the next queued prompt')
assert.match(extractFunction('resolveTargetSession'), /projectGroupsForGatewayGroup/, 'resolveTargetSession must search project session trees')

const subscribeSource = extractFunction('subscribeGatewaySessionEvents')
assert.doesNotMatch(subscribeSource, /syncMobileBridgeSnapshot\(\)/, 'gateway events must not push the full session list on every tick')
assert.match(subscribeSource, /scheduleMobileBridgeSnapshot\(/, 'roster changes may schedule a rare snapshot')
assert.match(subscribeSource, /MOBILE_SNAPSHOT_EVENT_TYPES/, 'only roster events may touch the session list')
assert.match(subscribeSource, /MOBILE_ACTIVITY_EVENT_TYPES/, 'subagent/todo/background events have a separate mobile activity path')
assert.match(subscribeSource, /applyMobileActivityEvent\(/, 'live activity is forwarded without waiting for a persisted transcript row')
assert.match(subscribeSource, /mobileWatchedSessionIds/, 'live transcript pushes follow the session the phone is watching')
const bridgeSource = extractFunction('connectMobileBridge')
assert.match(bridgeSource, /refreshMobileBackgroundActivity\(/, 'watching a session immediately restores its background-process stack')
assert.match(bridgeSource, /stop_background_task/, 'mobile background rows can stop their owned process')

assert.match(extractFunction('pushMobileTranscript'), /sessionId: storedId/, 'transcript frames must use the stored session id, not the runtime id')
assert.match(extractFunction('subscribeGatewaySessionEvents'), /canonicalMobileSessionId/, 'gateway events must remap runtime ids before pushing to mobile')
assert.match(extractFunction('syncMobileBridgeSnapshot'), /collectMobileBusyByStored|busyBySession/, 'roster snapshots include the stored-id busy map')
assert.match(extractFunction('connectMobileBridge'), /mobileWatchedSessionIds/, 'get_transcript must remember the focused mobile session')
assert.match(extractFunction('connectMobileBridge'), /noteMobileTurnActivity/, 'send_prompt must mark the stored session busy immediately')
assert.match(extractFunction('connectMobileBridge'), /rememberMobileSessionRuntime/, 'watching a session must bind its runtime id')

const helperNames = [
  'sessionBooleanValue',
  'sessionPinned',
  'sessionUnread',
  'sessionActive',
  'sessionRowTitle',
  'monitorSessionStatusLabel',
  'serializeMobileRailSession',
  'sessionIsScheduled',
  'sessionActivityValue',
  'compareSessions',
  'projectPathKey',
  'projectPathContains',
  'projectTreeNodePaths',
  'projectTreeEntries',
  'normalizeSessionRecord',
  'normalizeProjectSessions',
  'flattenProjectNodeSessions',
  'directProjectDescriptor',
  'projectDescriptorForSession',
  'projectTreePathForDescriptor',
  'isHomeProject',
  'projectDisplayLabel',
  'projectRemoteLabel',
  'projectLatestActivity',
  'compareProjects',
  'projectAppearanceFor',
  'projectIconName',
  'projectIconColor',
  'projectGroupsForGatewayGroup',
  'buildMobileRailSnapshot'
]

const context = {
  HOME_PROJECT_KEY: '__no_project__',
  HOME_PROJECT_LABEL: '主页',
  PROJECT_SESSION_PREVIEW_LIMIT: 5,
  PROFILE_SCOPE_DEFAULT: 'default',
  RECENT_SESSION_WINDOW_MS: 24 * 60 * 60_000,
  PROJECT_APPEARANCE_COLORS: { blue: '#2563eb', green: '#16a34a', yellow: '#ca8a04' },
  PROJECT_APPEARANCE_ICONS: ['folder', 'rocket', 'star', 'home']
}
vm.createContext(context)
vm.runInContext(
  `${helperNames.map(extractFunction).join('\n')}\nglobalThis.api = { serializeMobileRailSession, buildMobileRailSnapshot, monitorSessionStatusLabel }`,
  context
)

const talking = JSON.parse(JSON.stringify(context.api.serializeMobileRailSession({
  id: 'dev',
  title: 'Overlook开发',
  is_active: true,
  model: 'xai/grok-4.6',
  last_active: 99,
  preview: '刚才把函数补回来'
}, { gateway: 'This device', projectKey: 'p1', projectLabel: 'Hermes-plugins' })))
assert.equal(talking.status, '对话中', 'an open sidebar session stays 对话中 on mobile, not 就绪待命')
assert.equal(talking.title, 'Overlook开发')
assert.equal(talking.isActive, true)
assert.equal(talking.busy, false)

const running = JSON.parse(JSON.stringify(context.api.serializeMobileRailSession({
  id: 'dev',
  title: 'Overlook开发',
  is_active: true,
  is_running: true,
  model: 'xai/grok-4.6',
  last_active: 99
}, { gateway: 'This device' })))
assert.equal(running.busy, true, 'an in-turn session is busy on the mobile rail')
assert.equal(running.status, '执行中')

const snapshot = JSON.parse(JSON.stringify(context.api.buildMobileRailSnapshot([
  {
    key: 'local::default::default',
    label: 'This device',
    remoteLabel: '',
    profile: 'default',
    route: { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' },
    hasMore: false,
    projectTree: {
      projects: [{
        id: 'hermes',
        label: 'Hermes-plugins',
        path: 'P:/workspace/glwlg/ai/Hermes-plugins',
        sessionCount: 2,
        previewSessions: [
          { id: 'old', title: '友好问候 #3', last_active: 10, is_active: false, model: 'flash' },
          { id: 'dev', title: 'Overlook开发', last_active: 99, is_active: true, model: 'xai/grok-4.6' }
        ]
      }]
    },
    sessions: [
      { id: 'old', title: '友好问候 #3', last_active: 10, is_active: false, model: 'flash', cwd: 'P:/workspace/glwlg/ai/Hermes-plugins' },
      { id: 'dev', title: 'Overlook开发', last_active: 99, is_active: true, model: 'xai/grok-4.6', cwd: 'P:/workspace/glwlg/ai/Hermes-plugins' }
    ]
  }
], { hideScheduled: true }, {}, { dev: true })))

const hermes = snapshot.projects.find(project => project.label === 'Hermes-plugins')
assert.ok(hermes, 'mobile roster groups by project like the sidebar')
assert.deepEqual(hermes.sessions.map(row => row.title), ['Overlook开发', '友好问候 #3'], 'sessions inside a project sort by freshness')
assert.equal(hermes.sessions[0].status, '执行中')
assert.equal(hermes.sessions[0].busy, true)
assert.equal(snapshot.busyBySession.dev, true)
assert.equal(hermes.sessions[0].id, snapshot.monitoredSessions.find(row => row.id === 'dev')?.id)

const pinnedSnap = JSON.parse(JSON.stringify(context.api.buildMobileRailSnapshot([
  {
    key: 'local::default::default',
    label: 'This device',
    remoteLabel: '',
    profile: 'default',
    route: { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' },
    hasMore: false,
    projectTree: {
      projects: [{
        id: 'hermes',
        label: 'Hermes-plugins',
        path: 'P:/workspace/glwlg/ai/Hermes-plugins',
        sessionCount: 2,
        previewSessions: [
          { id: 'old', title: '友好问候 #3', last_active: 10, is_active: false, model: 'flash' },
          { id: 'dev', title: 'Overlook开发', last_active: 99, is_active: true, model: 'xai/grok-4.6', pinned: true }
        ]
      }]
    },
    sessions: [
      { id: 'old', title: '友好问候 #3', last_active: 10, is_active: false, model: 'flash', cwd: 'P:/workspace/glwlg/ai/Hermes-plugins' },
      { id: 'dev', title: 'Overlook开发', last_active: 99, is_active: true, model: 'xai/grok-4.6', pinned: true, cwd: 'P:/workspace/glwlg/ai/Hermes-plugins' }
    ]
  }
], {
  hideScheduled: true,
  projectAppearance: { 'local::default::default::project-tree:hermes': { color: 'blue', icon: 'rocket' } }
}, {})))
const pinned = pinnedSnap.projects.find(project => project.pinnedSection)
assert.ok(pinned, 'pinned sessions break out into a 置顶 section like the sidebar')
assert.equal(pinned.label, '置顶')
assert.deepEqual(pinned.sessions.map(row => row.id), ['dev'])
assert.equal(pinnedSnap.projects.find(project => project.label === 'Hermes-plugins').sessions.some(row => row.id === 'dev'), false, 'pinned sessions do not repeat under their project')
const colored = pinnedSnap.projects.find(project => project.label === 'Hermes-plugins')
assert.equal(colored.icon, 'rocket')
assert.equal(colored.color, '#2563eb')

console.log('overlook mobile rail contract passed')
