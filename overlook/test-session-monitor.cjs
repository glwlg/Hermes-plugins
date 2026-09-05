const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'desktop', 'plugin.js'), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `missing function ${name}`)
  const paren = source.indexOf('(', start)
  let depth = 0
  let closeParen = -1
  for (let index = paren; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') {
      depth -= 1
      if (depth === 0) {
        closeParen = index
        break
      }
    }
  }
  assert.notEqual(closeParen, -1, `missing parameter list for ${name}`)
  const open = source.indexOf('{', closeParen)
  depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated function ${name}`)
}

const context = {
  EXTERNAL_SESSION_SOURCES: new Set(['telegram', 'discord', 'slack', 'whatsapp']),
  MONITOR_TRANSCRIPT_LIMIT: 120,
  MONITOR_LAYOUTS: ['tile', 'compact', 'list'],
  MONITOR_KEY_LIST_MAX: 200
}
vm.createContext(context)
vm.runInContext(
  `${[
    'sessionBooleanValue',
    'sessionActive',
    'sessionIsExternalChannel',
    'sessionActivityValue',
    'normalizeStringKeyList',
    'monitorSessionCandidates',
    'monitorEligibleSessions',
    'monitorDisplayedCandidates',
    'monitorQueueCandidates',
    'monitorHideSessionKeys',
    'monitorParkSessionKeys',
    'normalizeMonitorLayout',
    'monitorSessionEntries',
    'stabilizeMonitorSlotKeys',
    'monitorSessionStatusLabel',
    'monitorSessionIndexLabel',
    'monitorScrollToBottom',
    'monitorContentText',
    'monitorMessageText',
    'normalizeMonitorTranscript',
    'monitorVisibleMessages',
    'monitorMessageIsToolActivity',
    'monitorWallMessages',
    'monitorToolCallLabel',
    'monitorThinkingText',
    'monitorMobileActivityKind',
    'monitorSubagentText',
    'monitorMobileMessages',
    'routeTargetProfile',
    'sessionRoute',
    'monitorTranscriptRequest'
  ].map(extractFunction).join('\n')}\nglobalThis.api = { monitorSessionCandidates, monitorSessionEntries, monitorEligibleSessions, monitorDisplayedCandidates, monitorQueueCandidates, monitorHideSessionKeys, monitorParkSessionKeys, normalizeMonitorLayout, stabilizeMonitorSlotKeys, monitorSessionStatusLabel, monitorSessionIndexLabel, monitorScrollToBottom, monitorVisibleMessages, monitorWallMessages, monitorMobileMessages, monitorTranscriptRequest, normalizeMonitorTranscript }`,
  context
)
const entries = context.api.monitorSessionEntries
const routeA = { connectionId: 'a', mode: 'local', profile: 'default', targetProfile: 'default' }
const routeB = { connectionId: 'b', mode: 'remote', profile: 'worker', targetProfile: 'worker' }
const session = (id, active, at, extra = {}) => ({ id, is_active: active, last_active: at, title: id, ...extra })
const projects = [
  {
    key: 'a::alpha',
    route: routeA,
    label: 'Alpha',
    prefetchedSessions: [
      session('telegram-live', true, 220, { source: 'telegram' }),
      session('slack-live', true, 210, { source: 'SLACK' }),
      session('telegram-handoff', true, 200, { source: 'desktop', handoff_platform: 'telegram', handoff_state: 'completed' }),
      session('a-old', true, 10),
      session('a-new', true, 90),
      session('idle', false, 100)
    ],
    sessions: [session('a-new', true, 90)]
  },
  {
    key: 'a::beta',
    route: routeA,
    label: 'Beta',
    prefetchedSessions: [session('a-mid', true, 70), session('a-fourth', true, 40), session('a-fifth', true, 20)],
    sessions: []
  },
  {
    key: 'b::remote',
    route: routeB,
    label: 'Remote',
    prefetchedSessions: [session('a-new', true, 80)],
    sessions: []
  }
]

const result = JSON.parse(JSON.stringify(entries(projects)))
assert.equal(result.length, 6, 'monitor shows every eligible active session instead of a four-seat cap')
assert.deepEqual(result.map(entry => entry.session.id), ['a-new', 'a-new', 'a-mid', 'a-fourth', 'a-fifth', 'a-old'], 'active sessions rank by latest activity across gateways')
assert.deepEqual(result.map(entry => entry.project.key), ['a::alpha', 'b::remote', 'a::beta', 'a::beta', 'a::beta', 'a::alpha'], 'same stored id on two gateways stays isolated')
assert.equal(result.some(entry => entry.session.id === 'idle'), false, 'inactive sessions never occupy a monitor tile')
assert.equal(result.some(entry => entry.session.id === 'telegram-live'), false, 'Telegram sessions are excluded from the monitor')
assert.equal(result.some(entry => entry.session.id === 'slack-live'), false, 'external source matching is case-insensitive')
assert.equal(result.some(entry => entry.session.id === 'telegram-handoff'), false, 'completed handoffs from Telegram stay excluded after their source becomes desktop')
assert.equal(result.filter(entry => entry.project.key === 'a::alpha' && entry.session.id === 'a-new').length, 1, 'duplicate rows inside one project collapse to one tile')

const allCandidates = JSON.parse(JSON.stringify(context.api.monitorSessionCandidates(projects)))
assert.deepEqual(allCandidates.map(entry => entry.session.id), ['a-new', 'a-new', 'a-mid', 'a-fourth', 'a-fifth', 'a-old'], 'every eligible active session is a wall candidate')
const initialSlots = JSON.parse(JSON.stringify(context.api.stabilizeMonitorSlotKeys([], allCandidates)))
assert.deepEqual(initialSlots, allCandidates.map(entry => entry.key), 'the initial load seats every eligible session in candidate order')
assert.equal(initialSlots.length, 6, 'the wall is not padded to four empty seats')

const reorderedCandidates = [allCandidates[3], allCandidates[1], allCandidates[0], allCandidates[2], allCandidates[5], allCandidates[4]]
const reorderedSlots = JSON.parse(JSON.stringify(context.api.stabilizeMonitorSlotKeys(initialSlots, reorderedCandidates)))
assert.deepEqual(reorderedSlots, initialSlots, 'activity updates never reorder occupied seats')

const removedKey = initialSlots[1]
const survivingCandidates = allCandidates.filter(entry => entry.key !== removedKey)
const seatsAfterRemoval = JSON.parse(JSON.stringify(context.api.stabilizeMonitorSlotKeys(initialSlots, survivingCandidates)))
assert.deepEqual(seatsAfterRemoval, [initialSlots[0], initialSlots[2], initialSlots[3], initialSlots[4], initialSlots[5]], 'removing one session compacts the flow without leaving a hole')

const newcomer = { key: 'new::session', project: { key: 'x' }, session: { id: 'brand-new' } }
const seatsAfterArrival = JSON.parse(JSON.stringify(context.api.stabilizeMonitorSlotKeys(seatsAfterRemoval, [...survivingCandidates, newcomer])))
assert.deepEqual(seatsAfterArrival, [...seatsAfterRemoval, 'new::session'], 'a newly eligible session appends without shifting survivors')

assert.equal(context.api.monitorSessionIndexLabel(0), '01')
assert.equal(context.api.monitorSessionIndexLabel(11), '12')
assert.equal(context.api.monitorSessionStatusLabel({ is_active: true }, [{ kind: 'status' }]), '执行中')
assert.equal(context.api.monitorSessionStatusLabel({ is_active: true }, [{ message: { role: 'user' } }]), '对话中')
assert.equal(context.api.monitorSessionStatusLabel({ is_active: false }, []), '就绪待命中')
assert.equal(context.api.normalizeMonitorLayout('list'), 'list')
assert.equal(context.api.normalizeMonitorLayout('weird'), 'tile')

const eligible = JSON.parse(JSON.stringify(context.api.monitorEligibleSessions(projects)))
assert.equal(eligible.some(entry => entry.session.id === 'idle'), true, 'the waiting queue can see idle desktop sessions')
assert.equal(eligible.some(entry => entry.session.id === 'telegram-live'), false, 'external sessions stay out of the queue')

const displayed = JSON.parse(JSON.stringify(context.api.monitorDisplayedCandidates(projects, [], [])))
assert.equal(displayed.length, 6, 'the wall still auto-seats every active session')
assert.equal(displayed.some(entry => entry.session.id === 'idle'), false, 'idle sessions wait in the queue until pulled')

const hiddenKey = displayed[0].key
const afterHide = JSON.parse(JSON.stringify(context.api.monitorDisplayedCandidates(projects, [hiddenKey], [])))
assert.equal(afterHide.some(entry => entry.key === hiddenKey), false, 'dismissing a card removes it from the wall')
const queue = JSON.parse(JSON.stringify(context.api.monitorQueueCandidates(projects, afterHide.map(entry => entry.key))))
assert.equal(queue.some(entry => entry.key === hiddenKey), true, 'a dismissed live session lands in the waiting queue')
assert.equal(queue.some(entry => entry.session.id === 'idle'), true, 'idle desktop sessions wait in the queue')

const idleKey = eligible.find(entry => entry.session.id === 'idle').key
const parked = JSON.parse(JSON.stringify(context.api.monitorDisplayedCandidates(projects, [], [idleKey])))
assert.equal(parked.some(entry => entry.session.id === 'idle'), true, 'pulling a queued session parks it on the wall')

const hiddenState = JSON.parse(JSON.stringify(context.api.monitorHideSessionKeys([], [idleKey], hiddenKey)))
assert.deepEqual(hiddenState.monitorHiddenKeys, [hiddenKey])
assert.deepEqual(hiddenState.monitorParkedKeys, [idleKey])
const parkedState = JSON.parse(JSON.stringify(context.api.monitorParkSessionKeys([hiddenKey], [], idleKey)))
assert.deepEqual(parkedState.monitorHiddenKeys, [hiddenKey])
assert.deepEqual(parkedState.monitorParkedKeys, [idleKey])

const fakeScroller = { scrollHeight: 640, scrollTop: 0 }
assert.equal(context.api.monitorScrollToBottom(fakeScroller), true, 'scroll helper accepts a mounted transcript')
assert.equal(fakeScroller.scrollTop, 640, 'scroll helper pins the transcript to its latest content')
assert.equal(context.api.monitorScrollToBottom(null), false, 'scroll helper safely ignores an unmounted transcript')

const transcriptRows = [
  { id: 1, role: 'system', content: 'internal prompt' },
  { id: 2, role: 'assistant', display_kind: 'hidden', content: 'hidden reasoning' },
  { id: 3, role: 'user', content: [{ type: 'text', text: 'Deploy now' }] },
  { id: 4, role: 'tool', tool_name: 'terminal', context: 'npm test' },
  { id: 5, role: 'assistant', display_content: 'Done **now**', content: 'raw fallback' }
]
const visible = JSON.parse(JSON.stringify(context.api.monitorVisibleMessages({ data: transcriptRows }, 12)))
assert.deepEqual(visible.map(row => [row.message.role, row.text]), [
  ['user', 'Deploy now'],
  ['assistant', 'Done **now**']
], 'monitor keeps only user and assistant text rows')
assert.equal(context.api.normalizeMonitorTranscript({ messages: transcriptRows }).length, transcriptRows.length, 'new messages response shape is accepted')
assert.equal(context.api.normalizeMonitorTranscript({ data: transcriptRows }).length, transcriptRows.length, 'legacy data response shape is accepted')

const toolOnlyRows = [
  { id: 10, role: 'tool', tool_name: 'terminal', context: 'npm test' },
  { id: 11, role: 'tool', tool_name: 'read_file', context: 'plugin.js' },
  { id: 12, role: 'assistant', tool_calls: [{ name: 'search_files' }], content: '' }
]
const toolOnlyWall = JSON.parse(JSON.stringify(context.api.monitorWallMessages(
  { messages: toolOnlyRows },
  { preview: 'Deploy the monitor wall' },
  12
)))
assert.deepEqual(toolOnlyWall.map(row => [row.message.role, row.kind || '', row.text]), [
  ['user', '', 'Deploy the monitor wall'],
  ['assistant', 'status', '正在执行任务…']
], 'a tool-only window still shows the latest user prompt and a working status instead of an empty card')

const userThenTools = JSON.parse(JSON.stringify(context.api.monitorWallMessages({
  messages: [
    { id: 20, role: 'user', content: 'Inspect the build' },
    { id: 21, role: 'tool', tool_name: 'terminal', context: 'npm test' }
  ]
}, { preview: 'Inspect the build' }, 12)))
assert.deepEqual(userThenTools.map(row => [row.message.role, row.kind || '', row.text]), [
  ['user', '', 'Inspect the build'],
  ['assistant', 'status', '正在执行任务…']
], 'user text stays visible while later tool calls collapse to a working status')

const completedTurn = JSON.parse(JSON.stringify(context.api.monitorWallMessages({
  messages: [
    { id: 30, role: 'user', content: 'Inspect the build' },
    { id: 31, role: 'tool', tool_name: 'terminal', context: 'npm test' },
    { id: 32, role: 'assistant', content: 'Tests passed.' }
  ]
}, { preview: 'Inspect the build' }, 12)))
assert.deepEqual(completedTurn.map(row => [row.message.role, row.text]), [
  ['user', 'Inspect the build'],
  ['assistant', 'Tests passed.']
], 'a completed assistant reply is not replaced by the working status')

const multiTurnWithPreview = JSON.parse(JSON.stringify(context.api.monitorWallMessages({
  messages: [
    { id: 1, role: 'user', content: 'Ancient first instruction' },
    { id: 2, role: 'assistant', content: 'Ancient reply' },
    { id: 80, role: 'user', content: 'Latest instruction from today' },
    { id: 81, role: 'assistant', content: 'Latest reply from today' }
  ]
}, { preview: 'Ancient first instruction' }, 2)))
assert.equal(multiTurnWithPreview.some(row => row.text === 'Ancient first instruction'), false, 'multi-turn conversations must show the latest user turn, never the ancient preview')

const mobileLive = JSON.parse(JSON.stringify(context.api.monitorMobileMessages({
  messages: [
    { id: 1, role: 'user', content: '查一下构建' },
    { id: 2, role: 'assistant', reasoning_content: '先读测试输出', content: '' },
    { id: 3, role: 'tool', tool_name: 'terminal', context: 'npm test' },
    { id: 4, role: 'assistant', content: '测试通过。' }
  ]
}, { preview: '查一下构建' }, 40)))
assert.deepEqual(mobileLive.map(row => [row.kind || row.role, row.tool || '', row.text]), [
  ['user', '', '查一下构建'],
  ['thinking', '', '先读测试输出'],
  ['tool', 'terminal', 'npm test'],
  ['assistant', '', '测试通过。']
], 'mobile timeline keeps thinking, tool calls, and the assistant reply instead of collapsing them')
assert.equal(mobileLive.some(row => row.text === '正在执行任务…'), false, 'mobile must not inject a working-status row')

const mobileActivity = JSON.parse(JSON.stringify(context.api.monitorMobileMessages({
  messages: [
    { id: 1, role: 'user', content: '派两个子代理' },
    { id: 2, role: 'tool', tool_name: 'todo_write', context: '- [ ] 读代码\n- [x] 写测试' },
    { id: 3, role: 'assistant', display_kind: 'async_delegation_complete', display_metadata: { task_count: 2, completed_count: 2 }, content: '' }
  ]
}, {}, 40)))
assert.equal(mobileActivity.some(row => row.kind === 'todo'), true, 'todo tool rows stay visible on mobile')
assert.equal(mobileActivity.some(row => row.kind === 'subagent'), true, 'subagent/delegation rows stay visible on mobile')
assert.ok(source.includes('monitorMobileMessages({ messages: raw }'), 'mobile bridge serializes the full live timeline, not the compact wall')
assert.equal(multiTurnWithPreview.some(row => row.text === 'Latest instruction from today'), true, 'latest user instruction remains visible')

const request = JSON.parse(JSON.stringify(context.api.monitorTranscriptRequest(
  { route: routeB },
  { id: 'stored id' }
)))
assert.deepEqual(request, {
  connectionId: 'b',
  path: '/api/sessions/stored%20id/messages?limit=120&offset=0&order=latest&include_compacted=true&profile=worker',
  profile: 'worker',
  timeoutMs: 15_000
}, 'transcript reads stay on the exact owning gateway/profile with 120 message limit')

// Production wiring: a dedicated workspace tab plus a route fallback for older
// Desktop builds. The monitor and stored-session tabs must never replace one
// another through normal navigation.
assert.match(source, /ROUTES_AREA,/, 'monitor keeps a compatibility route')
assert.doesNotMatch(source, /SIDEBAR_NAV_AREA/, 'path-only sidebar navigation must not replace the main workspace with the monitor')
assert.match(source, /Streamdown,/, 'monitor uses the SDK-exported Markdown preview renderer')
assert.match(source, /function SessionMonitorPage\(/, 'monitor page component exists')
assert.match(source, /function MonitorSessionCard\(/, 'monitor card component exists')
assert.match(extractFunction('MonitorSessionCard'), /monitorWallMessages\(\{ messages: transcript \}, session/, 'cards compose the visible wall from transcript plus session preview')
assert.doesNotMatch(source, /暂无可显示内容|暂无可展示内容/, 'cards never show an empty-content slogan')
assert.match(extractFunction('MonitorMessageRow'), /kind === 'status'/, 'working status uses a dedicated muted row rather than Markdown')
assert.match(source, /queryKey: \[\.\.\.MONITOR_QUERY_KEY, routeKey\(project\.route\), session\.id\]/, 'each transcript query is isolated by owner route and stored id')
assert.match(source, /refetchInterval: MONITOR_REFRESH_MS/, 'visible cards refresh their read-only transcript')
assert.match(source, /refetchIntervalInBackground: false/, 'monitor polling stops with the page in the background')
assert.match(source, /data: \{ path: MONITOR_ROUTE \}/, 'compatibility route remains registered')
assert.match(source, /'aria-label': '打开多会话看板'/, 'Overlook rail exposes a monitor shortcut')
const monitoredOpenSource = extractFunction('openMonitoredSession')
assert.match(monitoredOpenSource, /intent: 'in-place',[\s\S]{0,180}route: project\.route/, 'card opens or fronts the complete session in one native sidebar-style handoff')
assert.equal((monitoredOpenSource.match(/host\.openSession/g) || []).length, 1, 'one click must issue exactly one session open')
assert.match(monitoredOpenSource, /host\.navigate\(`\/\$\{encodeURIComponent\(session\.id\)\}`\)/, 'monitor hands the UI the canonical route immediately')
assert.ok(monitoredOpenSource.indexOf('host.openSession') < monitoredOpenSource.indexOf('host.navigate'), 'owner-aware open starts before presentation navigation')
assert.match(monitoredOpenSource, /Session open was superseded by a newer selection\./, 'rapid selection ignores the expected superseded-open rejection')
assert.doesNotMatch(monitoredOpenSource, /await host\.openSession|awaitHydration|expectHistory|hydrationTimeoutMs/, 'session navigation is never gated on hydration')
assert.doesNotMatch(monitoredOpenSource, /requestAnimationFrame|setTimeout/, 'session opening must not fake a second click with timing retries')

const openCalls = []
const monitoredOpenContext = {
  encodeURIComponent,
  host: {
    navigate(target) {
      openCalls.push(['navigate', target])
    },
    notify(message) {
      openCalls.push(['notify', message])
    },
    openSession(sessionId, options) {
      openCalls.push(['openSession', sessionId, options])
      return Promise.resolve()
    }
  }
}
vm.createContext(monitoredOpenContext)
vm.runInContext(`${monitoredOpenSource}\nglobalThis.openMonitoredSession = openMonitoredSession`, monitoredOpenContext)
monitoredOpenContext.openMonitoredSession({ route: routeB }, { id: 'stored id' })
assert.deepEqual(JSON.parse(JSON.stringify(openCalls)), [
  ['openSession', 'stored id', {
    intent: 'in-place',
    keepAllProfilesScope: true,
    profile: 'worker',
    route: routeB
  }],
  ['navigate', '/stored%20id']
], 'one monitor click starts the routed open and immediately hands off to the session route')

assert.match(source, /className: 'codex-monitor-grid'/, 'active sessions render in the monitoring grid')
const monitorPageSource = extractFunction('SessionMonitorPage')
assert.match(monitorPageSource, /useState\(\(\) => \[\]\)/, 'monitor starts with an empty flow, not four reserved seats')
assert.match(monitorPageSource, /monitorDisplayedCandidates\(projects, hiddenKeys, parkedKeys\)/, 'monitor keeps every eligible candidate available for the wall')
assert.match(monitorPageSource, /stabilizeMonitorSlotKeys\(current, candidates\)/, 'candidate refreshes reconcile without moving occupied seats')
assert.doesNotMatch(monitorPageSource, /MONITOR_SESSION_LIMIT/, 'the live wall no longer consults a four-seat cap')
assert.match(monitorPageSource, /MonitorNewSessionTile/, 'the flow ends with an explicit new-session tile')
assert.doesNotMatch(monitorPageSource, /MonitorEmptySlot/, 'unbounded flow does not reserve empty numbered seats')
assert.doesNotMatch(monitorPageSource, /monitorSessionEntries\(projects/, 'the live wall is not rebuilt from a newly sorted slice')
assert.match(source, /function MonitorNewSessionTile\(/, 'monitor has an explicit new-session tile')
assert.match(source, /开启新会话窗口/, 'the add tile matches the Stitch label')
assert.doesNotMatch(source, /固定 4 个卡座/, 'header copy no longer advertises four fixed seats')
assert.doesNotMatch(source, /const MONITOR_SESSION_LIMIT/, 'the four-seat constant is gone')
assert.match(source, /grid-template-columns:repeat\(auto-fill/, 'the wall uses a wrapping auto-fill grid')
assert.doesNotMatch(source, /grid-template-rows:repeat\(2/, 'the wall is no longer a fixed 2x2')
assert.match(source, /平铺流/, 'header exposes the tiled flow layout')
assert.match(source, /自适应网格/, 'header exposes the compact grid layout')
assert.match(source, /列表/, 'header exposes the list layout')
assert.match(source, /待命队列/, 'header exposes the waiting queue')
assert.match(source, /队列待命中/, 'footer reports the waiting-queue count')
assert.match(source, /从待命队列接入/, 'the add tile can pull a queued session')
assert.match(source, /function MonitorQueueSelectDialog\(/, 'monitor owns a waiting-queue selection dialog')
assert.match(monitorPageSource, /MonitorQueueSelectDialog/, 'SessionMonitorPage mounts the queue dialog')
assert.match(monitorPageSource, /setQueueOpen\(true\)/, 'clicking queue actions opens the selection dialog')
assert.match(source, /const MONITOR_TRANSCRIPT_LIMIT = 120/, 'monitor transcript limit is widened to 120 to capture recent turns')
assert.match(source, /user-select:text!important/, 'message text explicitly allows text selection')
assert.match(source, /data-selectable-text/, 'transcript container enables native text selection')
assert.match(extractFunction('MonitorSessionComposer'), /onPaste/, 'composer supports pasting image files from clipboard')
assert.match(extractFunction('MonitorSessionComposer'), /立即发送队列/, 'composer supports sending queued messages immediately')
assert.match(source, /stopMonitorSessionTask/, 'monitor provides session interruption helper')
assert.match(extractFunction('MonitorSessionComposer'), /'停止任务'/, 'send button becomes stop button during execution')
assert.match(source, /空白会话/, 'the add tile can open a blank create dialog')
assert.match(source, /移出监控室/, 'cards can leave the wall without closing the session')
assert.match(extractFunction('MonitorSessionComposer'), /'停止任务'/, 'send button becomes stop button during execution')
assert.match(extractFunction('MonitorCardModelPicker'), /placeholder: '搜索模型名称或提供商…'/, 'model picker supports search')
assert.match(extractFunction('MonitorSessionComposer'), /MONITOR_IMAGE_ACCEPT/, 'card composer can attach images')
assert.match(monitorPageSource, /data-layout/, 'the grid honors the selected layout')
assert.match(monitorPageSource, /normalizeMonitorLayout/, 'layout values are gated to the Stitch modes')
assert.match(monitorPageSource, /monitorQueueCandidates/, 'the page derives a waiting queue from sessions not on the wall')
assert.match(monitorPageSource, /monitorDisplayedCandidates/, 'the wall can include pulled idle sessions and skip dismissed ones')
assert.match(source, /function MonitorSessionComposer\(/, 'each card has a compact composer')
assert.match(source, /function submitMonitorPrompt\(/, 'card send uses a verified prompt helper')
assert.match(extractFunction('MonitorSessionCard'), /MonitorSessionComposer/, 'cards include the compact composer')
assert.match(extractFunction('MonitorSessionCard'), /monitorSessionStatusLabel/, 'cards expose a session-state pill')
assert.match(extractFunction('MonitorMessageRow'), /codex-monitor-message-user/, 'user rows stay right-aligned bubbles')
assert.match(extractFunction('MonitorMessageRow'), /MonitorImageThumbnail/, 'message rows render image thumbnails')
assert.match(source, /function MonitorImageThumbnail\(/, 'monitor defines image thumbnail component')
assert.match(source, /extractMonitorMessageImages/, 'message parser extracts image paths and strips directives')
assert.match(source, /codex-monitor-lightbox/, 'monitor supports lightbox image zoom')
assert.doesNotMatch(source, /\.codex-monitor-grid\[data-count="[12]"\]/, 'one or two sessions no longer collapse the geometry')
assert.match(source, /data-monitor-slot/, 'each card exposes its stable seat index')
assert.match(source, /function openSessionMonitorWorkspace\(/, 'monitor owns one workspace-tab opener')
assert.match(source, /host\.openWorkspace\('overlook-monitor'/, 'monitor opens through the public workspace-tab API')
assert.match(source, /dock: \{ pane: 'workspace', pos: 'center' \}/, 'monitor stacks as a sibling tab beside session tiles')
assert.match(source, /onClick: openSessionMonitorWorkspace/, 'Overlook rail fronts the dedicated monitor tab')
assert.match(source, /id: 'monitor-palette',[\s\S]{0,260}run: openSessionMonitorWorkspace/, 'command palette fronts the same monitor tab')
assert.match(source, /typeof host\.openWorkspace !== 'function'[\s\S]{0,100}host\.navigate\(MONITOR_ROUTE\)/, 'older Desktop builds retain the route fallback')
assert.doesNotMatch(source, /onClick: \(\) => host\.navigate\(MONITOR_ROUTE\)/, 'normal monitor entry does not navigate the shared workspace route')
assert.match(source, /const closeMonitor = monitorWorkspaceClose[\s\S]{0,100}closeMonitor\?\.\(\)/, 'plugin disposal closes its dynamic monitor tab')
assert.doesNotMatch(extractFunction('MonitorMessageRow'), /codex-monitor-message-tool/, 'monitor does not render tool-call rows')
assert.doesNotMatch(source, /codex-monitor-message-tool/, 'monitor has no leftover tool-row styles')
assert.match(source, /const contentRef = useRef\(null\)/, 'monitor tracks the rendered transcript content')
assert.match(source, /new ResizeObserver\(scrollToBottom\)/, 'monitor follows asynchronous Markdown height changes')
assert.match(source, /observer\.observe\(content\)/, 'monitor observes the content node rather than the fixed-height scroller')
assert.equal((source.match(/requestAnimationFrame\(scrollToBottom\)/g) || []).length >= 1, true, 'monitor schedules post-layout bottom alignment')
assert.match(source, /ref: contentRef/, 'the message stack owns the observed content ref')
assert.match(source, /function useGatewaySessionsQuery\(profileScopeOverride\)/, 'shared query accepts an explicit monitor scope')
assert.match(source, /const profileScope = profileScopeOverride === PROFILE_SCOPE_ALL \? PROFILE_SCOPE_ALL : prefs\.profileScope/, 'only the monitor can override the saved rail scope')
assert.match(source, /const \{ prefs, sessionsQuery \} = useGatewaySessionsQuery\(PROFILE_SCOPE_ALL\)/, 'monitor always aggregates every configured profile')
assert.match(source, /refetchQueries\(\{ queryKey: GATEWAY_SESSIONS_KEY, type: 'active' \}\)/, 'gateway events refresh every mounted scope including the monitor')
assert.match(source, /const EXTERNAL_SESSION_SOURCES = new Set\(\[/, 'external-channel ids live in one explicit allowlist')
assert.match(source, /'telegram'.*'discord'.*'slack'/s, 'external-channel allowlist includes the major messaging platforms')
assert.match(source, /sessionIsExternalChannel\(session\)/, 'monitor selection applies the external-channel filter')
assert.doesNotMatch(source, /ctx\.(?:rest|socket)\(/, 'monitor stays on public Desktop and gateway routing doors')

console.log('overlook session monitor selection contract passed')
