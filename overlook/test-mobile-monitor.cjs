const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const vm = require('vm')

const htmlPath = path.join(__dirname, 'server', 'mobile.html')
const html = fs.readFileSync(htmlPath, 'utf8')

function assertIncludes(needle, label) {
  assert.ok(html.includes(needle), `mobile.html missing ${label}: ${needle}`)
}

function extractScript() {
  const start = html.lastIndexOf('<script>')
  const end = html.lastIndexOf('</script>')
  assert.notEqual(start, -1, 'missing script')
  assert.notEqual(end, -1, 'missing script close')
  return html.slice(start + '<script>'.length, end)
}

assertIncludes('id="focusCard"', 'focused session card')
assertIncludes('rel="manifest"', 'PWA web app manifest link')
assertIncludes('apple-mobile-web-app-capable', 'iOS web app standalone meta')
const manifestPath = path.join(__dirname, 'server', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
assert.equal(manifest.start_url, '/', 'PWA manifest start_url must be root / without session')
assert.equal(manifest.display, 'standalone', 'PWA display must be standalone')
assertIncludes('id="drawerPanel"', 'session rail drawer')
assertIncludes('<h1>Overlook</h1>', 'page is the Overlook session rail, not the monitor wall')
assert.ok(!html.includes('监控室'), 'mobile companion must not present itself as 监控室')
assertIncludes('会话', 'drawer trigger copy')
assertIncludes('id="drawerSearch"', 'sidebar search')
assertIncludes('data-filter="open"', 'open-session filter')
assertIncludes('向 Hermes 发送追加指令', 'composer placeholder')
assert.ok(!html.includes('id="enqueueBtn"'), 'enqueue control is removed; busy sends go to the queue')
assertIncludes('id="mainActionBtn"', 'send/stop control')
assert.ok(!html.includes('>打开<'), 'session rows themselves open the chat, no extra 打开 button')
assert.match(html, /session-row/, 'session blocks match the sidebar row treatment')
assert.match(html, /--codex-project-color/, 'project color flows into session rows')
assert.match(html, /置顶/, 'pinned sessions have a dedicated section like the sidebar')
assertIncludes('id="queueBanner"', 'queue banner')
assertIncludes('LIVE', 'live badge')
assertIncludes('id="lightbox"', 'image lightbox')
assert.match(html, /openLightbox\(this\.querySelector\('img'\)\.src\)/, 'lightbox reads the rendered img src instead of embedding a path in onclick')
assert.ok(!html.includes('id="sessionSwitcher"'), 'top session switcher should be removed')
assert.ok(!html.includes('aria-label="会话切换"'), 'top session switcher nav should be removed')
assert.ok(!html.includes('cdn.tailwindcss.com'), 'production page must not depend on Tailwind CDN')
assert.ok(!html.includes('googleapis.com/css2?family=Material+Symbols'), 'production page must not depend on Material Symbols CDN')
assert.match(html, /data.type === 'transcript_update'/, 'mobile client must apply live transcript_update frames')
assert.match(html, /appendLocalMessage\(/, 'sent prompts must appear immediately, not wait for a later fetch')
assert.match(html, /msg\.thinking/, 'thinking rows have a distinct style')
assert.match(html, /msg\.tool/, 'tool rows have a distinct style')
assert.match(html, /requestTranscript\(/, 'mobile client must re-request transcript after send and while running')
assert.match(html, /function renderMarkdown\(/, 'assistant bubbles render markdown')
assert.match(html, /<details/, 'thinking and tool rows collapse by default')
assert.ok(!html.includes('正在执行任务'), 'mobile must not show a working-status placeholder')
assertIncludes('id="modelBtn"', 'model switcher')
assertIncludes('id="attachBtn"', 'attachment picker')
assertIncludes('id="voiceBtn"', 'voice message control')
assertIncludes('id="fileInput"', 'file input')
assertIncludes('id="activityPanel"', 'todo / subagent / background panel')
assert.match(html, /touchstart|touchend/, 'swipe switches the active session')
assert.match(html, /<textarea id="promptInput"/, 'composer grows with wrapped lines')
assert.match(html, /Math\.abs\(dx\) < 140/, 'session swipe requires a deliberate flick')
assert.match(html, /slide-left/, 'session swipe animates the focused pane')
assert.match(html, /status-dot/, 'session status is a colored sidebar-style dot, not a text pill')
assert.match(html, /running-arc/, 'busy session rows render a spinning border like the sidebar')
assert.match(html, /@keyframes rail-spin/, 'busy border actually animates via transform, not @property')
assert.match(html, /思考中/, 'live thinking packs can still say 思考中')
assert.match(html, /class="ellipsis"/, 'live 思考中 ellipsis is a live animated element')
assert.match(html, /think-pack/, 'thinking and tool calls share an outer fold')
assert.match(html, /busy_update/, 'mobile applies live busy_update frames so the stop button and running arc stay in sync')
assert.match(html, /localBusyUntil/, 'a snapshot without busy must not clear a turn the phone just started')
assert.match(html, /: '思考'/, 'completed thinking packs collapse to 思考')

assert.match(html, /transcriptCache/, 'mobile caches transcripts per session so switching is instant')
assert.match(html, /preloadAdjacentTranscripts/, 'mobile preloads neighboring session transcripts in advance')
assert.match(html, /requestEarlierMessages/, 'mobile supports requesting earlier historical messages')
assert.match(html, /top-loader|topLoader/, 'transcript has a top loader for earlier messages')
assert.match(html, /mode === 'tail'/, 'transcript_update handles tail diffs instead of full payload every frame')
assert.match(html, /mode === 'prepend'/, 'transcript_update handles prepending earlier historical messages')
assert.match(html, /activity_update/, 'mobile receives independent live activity frames')
assert.match(html, /function applyActivityUpdate\(/, 'mobile applies subagent and background activity without waiting for transcript persistence')
const composerFloatIndex = html.indexOf('class="composer-float"')
const activityPanelIndex = html.indexOf('id="activityPanel"')
const composerIndex = html.indexOf('class="composer"', composerFloatIndex)
assert.ok(composerFloatIndex >= 0 && activityPanelIndex > composerFloatIndex && activityPanelIndex < composerIndex, 'activity stack is docked directly above the mobile composer')
assert.match(html, /加载中/, 'switching to an uncached session immediately shows loading skeleton instead of previous session text')

const script = extractScript()
const sent = []
const transcriptEl = { innerHTML: '', scrollTop: 0, scrollHeight: 120, addEventListener() {} }
const statusLabel = { innerText: '' }
const desktopStatus = { className: '' }
const queueBanner = { style: { display: 'none' } }
const queueText = { innerText: '' }
const promptInput = { value: '', addEventListener() {}, style: {} }
const mainActionBtn = { className: '', innerText: '' }
const liveCount = { textContent: '' }
const drawerCount = { textContent: '' }
const drawerList = { innerHTML: '' }
const drawerMeta = { textContent: '' }
const focusTitle = { textContent: '' }
const focusMeta = { textContent: '' }
const focusStatus = { dataset: {}, textContent: '', className: 'status-dot idle', title: '', setAttribute() {}, getAttribute() { return '' } }
const avatar = { textContent: '' }
const classList = {
  add() {},
  remove() {},
  toggle() {}
}
const elements = {
  desktopStatus,
  statusLabel,
  liveCount,
  transcript: transcriptEl,
  queueBanner,
  queueText,
  promptInput,
  mainActionBtn,
  drawerPanel: { classList },
  drawerBackdrop: { classList },
  drawerCount,
  drawerList,
  drawerMeta,
  drawerSearch: { value: '', addEventListener() {} },
  focusTitle,
  focusMeta,
  focusStatus,
  focusCard: { hidden: false, classList },
  emptyState: { hidden: true },
  lightbox: { style: { display: 'none' } },
  lightboxImg: { src: '' },
  refreshBtn: { addEventListener() {} },
  activityPanel: { innerHTML: '', hidden: false },
  modelBtn: { textContent: '', addEventListener() {} },
  modelPanel: { hidden: true, innerHTML: '' },
  modelSearch: { value: '', addEventListener() {} },
  attachBtn: { addEventListener() {} },
  voiceBtn: { className: '', textContent: '语音', addEventListener() {} },
  fileInput: { files: [], addEventListener() {}, click() {} },
  attachPreview: { innerHTML: '', hidden: true, className: '' },
  modelList: { innerHTML: '' }
}

const history = []
const locationState = {
  protocol: 'http:',
  host: '127.0.0.1:9999',
  pathname: '/',
  search: '',
  href: 'http://127.0.0.1:9999/'
}
function setLocation(search) {
  locationState.search = search
  locationState.href = `http://127.0.0.1:9999/${search}`
}
const windowObj = {
  __OVERLOOK_SKIP_CONNECT: true,
  location: locationState,
  history: {
    replaceState(_state, _title, url) {
      history.push(url)
      const parsed = new URL(url, 'http://127.0.0.1:9999/')
      locationState.search = parsed.search
      locationState.pathname = parsed.pathname
      locationState.href = parsed.href
    }
  },
  URL
}
const documentObj = {
  getElementById(id) { return elements[id] || null },
  querySelector(sel) { return sel === '.avatar' ? avatar : null },
  querySelectorAll() { return [] },
  addEventListener() {}
}
windowObj.document = documentObj

const context = {
  window: windowObj,
  document: documentObj,
  history: windowObj.history,
  location: locationState,
  URL,
  WebSocket: function FakeSocket() {},
  JSON,
  Date,
  Math,
  console,
  setTimeout() { return 0 },
  setInterval() { return 1 },
  clearInterval() {},
  encodeURIComponent,
  decodeURIComponent,
  Object,
  String,
  Boolean,
  Array,
  Number,
  FileReader: function FileReader() { this.readAsDataURL = function() {} },
  navigator: { mediaDevices: null }
}
context.WebSocket.OPEN = 1
vm.createContext(context)
vm.runInContext(script, context)
context.window.ws = { readyState: 1, send: payload => sent.push(JSON.parse(payload)) }

assert.equal(typeof context.window.applySnapshot, 'function', 'applySnapshot must be global for tests')
assert.equal(typeof context.window.selectSession, 'function', 'selectSession must be global')
assert.equal(typeof context.window.toggleDrawer, 'function', 'toggleDrawer must be global')
assert.equal(typeof context.window.handleEnqueue, 'function', 'handleEnqueue must be global')
assert.equal(typeof context.window.handleMainAction, 'function', 'handleMainAction must be global')

context.window.applySnapshot({
  projects: [{
    key: '__pinned__',
    label: '置顶',
    pinnedSection: true,
    icon: 'star',
    color: '#ca8a04',
    sessions: [
      { id: 's1', title: 'Overlook开发', model: 'xai/grok-4.6', gateway: 'This device', status: '对话中', isActive: true, lastActive: 200, pinned: true }
    ]
  }, {
    key: 'p-hermes',
    label: 'Hermes-plugins',
    gateway: 'This device',
    icon: 'rocket',
    color: '#2563eb',
    sessions: [
      { id: 's0', title: '友好问候 #3', model: 'flash', gateway: 'This device', status: '就绪待命中', lastActive: 10 }
    ]
  }, {
    key: 'p-wsl',
    label: 'ops',
    gateway: 'WSL',
    icon: 'gear',
    color: '#64748b',
    sessions: [
      { id: 's2', title: 'CI 工作流', model: 'DeepSeek', gateway: 'WSL', status: '执行中', lastActive: 300, busy: true }
    ]
  }],
  monitoredSessions: [
    { id: 's1', title: 'Overlook开发', model: 'xai/grok-4.6', gateway: 'This device', status: '对话中', isActive: true, lastActive: 200 },
    { id: 's0', title: '友好问候 #3', model: 'flash', gateway: 'This device', status: '就绪待命中', lastActive: 10 },
    { id: 's2', title: 'CI 工作流', model: 'DeepSeek', gateway: 'WSL', status: '执行中', lastActive: 300, busy: true }
  ],
  queues: {
    s2: [{ id: 'q1', prompt: '先排队这条' }]
  },
  busyBySession: { s2: true }
})

assert.match(drawerList.innerHTML, /Hermes-plugins/)
assert.match(drawerList.innerHTML, /Overlook开发/)
assert.match(drawerList.innerHTML, /status-dot talking/)
assert.match(drawerList.innerHTML, /status-dot working/)
assert.match(drawerList.innerHTML, /running-arc/)
assert.doesNotMatch(drawerList.innerHTML, />对话中</)
assert.doesNotMatch(drawerList.innerHTML, />执行中</)
assert.doesNotMatch(drawerList.innerHTML, />就绪待命中</)
assert.match(drawerList.innerHTML, /置顶/)
assert.match(drawerList.innerHTML, /session-row/)
assert.match(drawerList.innerHTML, /--codex-project-color/)
assert.doesNotMatch(drawerList.innerHTML, />打开</)

assert.match(drawerList.innerHTML, /CI 工作流/)
assert.match(drawerList.innerHTML, /This device|WSL/)
assert.equal(context.window.activeSessionId, 's2')
assert.equal(focusMeta.textContent, 'WSL', 'top header only displays gateway, not model name')
assert.doesNotMatch(focusMeta.textContent, /DeepSeek/, 'top header must not duplicate the model name')
assert.deepEqual(sent.find(msg => msg.type === 'get_transcript'), { type: 'get_transcript', sessionId: 's2' })
assert.match(history.at(-1) || locationState.href, /session=s2/)
assert.match(queueText.innerText, /消息队列 \(1\)/)
assert.equal(queueBanner.style.display, 'flex')
assert.match(liveCount.textContent, /3/)

context.window.applyActivityUpdate({
  sessionId: 's2',
  items: [
    { id: 'sa-1', kind: 'subagent', state: 'running', title: '检查子代理渲染', detail: 'terminal' },
    { id: 'bg-1', kind: 'background', state: 'running', title: '构建服务', detail: 'python server.py' },
    { id: 'todo-1', kind: 'todo', state: 'running', title: '验证移动端状态' }
  ]
})
assert.match(elements.activityPanel.innerHTML, /子代理/)
assert.match(elements.activityPanel.innerHTML, /检查子代理渲染/)
assert.match(elements.activityPanel.innerHTML, /后台/)
assert.match(elements.activityPanel.innerHTML, /构建服务/)
assert.match(elements.activityPanel.innerHTML, /Todo/)
assert.match(elements.activityPanel.innerHTML, /act-stop/)
context.window.stopActivityItem('bg-1')
assert.deepEqual(sent.filter(msg => msg.type === 'stop_background_task').at(-1), {
  type: 'stop_background_task', sessionId: 's2', processId: 'bg-1'
})

promptInput.value = '立刻处理'
context.window.isExecuting = true
context.window.handleMainAction()
assert.equal(promptInput.value, '')
assert.deepEqual(sent.filter(msg => msg.type === 'enqueue_prompt').at(-1), {
  type: 'enqueue_prompt',
  sessionId: 's2',
  prompt: '立刻处理'
})

promptInput.value = ''
context.window.isExecuting = true
context.window.updateActionBtn()
assert.match(String(mainActionBtn.innerHTML || mainActionBtn.innerText), /停止/)
context.window.handleMainAction()
assert.deepEqual(sent.filter(msg => msg.type === 'stop_task').at(-1), {
  type: 'stop_task',
  sessionId: 's2'
})

promptInput.value = '直接发送'
context.window.isExecuting = false
context.window.handleMainAction()
assert.deepEqual(sent.filter(msg => msg.type === 'send_prompt').at(-1), {
  type: 'send_prompt',
  sessionId: 's2',
  prompt: '直接发送',
  images: [],
  audio: null
})
assert.match(transcriptEl.innerHTML, /直接发送/)
assert.equal(Boolean(sent.find(msg => msg.type === 'get_transcript' && msg.sessionId === 's2')), true)
assert.equal(context.window.isExecuting, true)
context.window.applySnapshot({
  monitoredSessions: [
    { id: 's2', title: 'CI 工作流', status: '对话中', isActive: true, lastActive: 300, busy: false }
  ],
  busyBySession: {}
})
assert.equal(context.window.isExecuting, true, 'an empty busyBySession snapshot must not drop the in-flight turn')
assert.match(String(mainActionBtn.innerHTML || mainActionBtn.innerText), /停止/)
assert.match(drawerList.innerHTML, /running-arc/)
context.window.applyBusyUpdate({ sessionId: 's2', busy: false, busyBySession: {} })
assert.equal(context.window.isExecuting, false)

context.window.selectSession('s1')
assert.equal(context.window.activeSessionId, 's1')
assert.match(history.at(-1) || locationState.href, /session=s1/)

setLocation('?session=s1')
context.window.activeSessionId = null
sent.length = 0
context.window.applySnapshot({
  monitoredSessions: [
    { id: 's1', title: 'Overlook开发', updatedAt: 100 },
    { id: 's2', title: 'CI 工作流', updatedAt: 999 }
  ]
})
assert.equal(context.window.activeSessionId, 's1')
assert.deepEqual(sent.find(msg => msg.type === 'get_transcript'), { type: 'get_transcript', sessionId: 's1' })

context.window.renderTranscript([
  { role: 'user', text: '你好', images: [] },
  { role: 'assistant', text: '我是 Hermes Agent', images: ['data:image/png;base64,abc'] }
])
assert.match(transcriptEl.innerHTML, /你好/)
assert.match(transcriptEl.innerHTML, /我是 Hermes Agent/)
assert.match(transcriptEl.innerHTML, /openLightbox\(this\.querySelector\('img'\)\.src\)/)

context.window.renderTranscript([
  { role: 'user', text: '看图', images: ['C:\\Users\\luwei\\AppData\\Local\\hermes\\images\\upload.png'] }
])
assert.doesNotMatch(transcriptEl.innerHTML, /C:\\\\Users/)
assert.doesNotMatch(transcriptEl.innerHTML, /<img[^>]+src="C:/)
assert.doesNotMatch(transcriptEl.innerHTML, /upload\.png/)

context.window.renderTranscript([
  { role: 'user', text: '看图', images: ['data:image/png;base64,abc'] }
])
assert.match(transcriptEl.innerHTML, /data:image\/png;base64,abc/)
assert.match(transcriptEl.innerHTML, /class="thumb"/)

context.window.renderTranscript([
  { kind: 'thinking', role: 'thinking', text: '先看文件' },
  { kind: 'tool', role: 'tool', tool: 'read_file', text: 'plugin.js' },
  { role: 'assistant', text: '已读完' }
])
assert.match(transcriptEl.innerHTML, /思考/)
assert.match(transcriptEl.innerHTML, /先看文件/)
assert.match(transcriptEl.innerHTML, /工具/)
assert.match(transcriptEl.innerHTML, /read_file/)
assert.match(transcriptEl.innerHTML, /已读完/)
assert.match(transcriptEl.innerHTML, /msg thinking/)
assert.match(transcriptEl.innerHTML, /msg tool/)
assert.match(transcriptEl.innerHTML, /think-pack/)
assert.match(transcriptEl.innerHTML, /<summary>思考<\/summary>/)
assert.doesNotMatch(transcriptEl.innerHTML, /思考中/)
assert.doesNotMatch(transcriptEl.innerHTML, /class="ellipsis"/)
assert.match(transcriptEl.innerHTML, /<details/)
assert.doesNotMatch(transcriptEl.innerHTML, /<details[^>]*\sopen/)

context.window.isExecuting = false
context.window.renderTranscript([
  { kind: 'thinking', role: 'thinking', text: '先看文件' },
  { kind: 'tool', role: 'tool', tool: 'read_file', text: 'plugin.js' }
])
assert.match(transcriptEl.innerHTML, /think-pack live/)
assert.match(transcriptEl.innerHTML, /思考中/)
assert.match(transcriptEl.innerHTML, /class="ellipsis"/)

context.window.renderTranscript([
  { role: 'assistant', text: '**加粗** 和 `code`\n\n#### 小标题 4\n\n---\n\n| 表头1 | 表头2 |\n| --- | --- |\n| 单元格1 | 单元格2 |' }
])
assert.match(transcriptEl.innerHTML, /<strong>加粗<\/strong>/)
assert.match(transcriptEl.innerHTML, /<code>code<\/code>/)
assert.match(transcriptEl.innerHTML, /<h4>小标题 4<\/h4>/)
assert.match(transcriptEl.innerHTML, /<hr/)
assert.match(transcriptEl.innerHTML, /<table/)

context.window.renderTranscript([
  { kind: 'todo', role: 'todo', text: '- [ ] 读代码' },
  { kind: 'subagent', role: 'subagent', text: '2 个子代理完成' },
  { kind: 'background', role: 'background', text: '后台任务 running' },
  { kind: 'status', role: 'status', text: '正在执行任务…' }
])
assert.match(transcriptEl.innerHTML, /读代码/)
assert.match(transcriptEl.innerHTML, /子代理/)
assert.match(elements.activityPanel.innerHTML, /读代码/)
assert.doesNotMatch(transcriptEl.innerHTML, /正在执行任务/)

promptInput.value = '本地先上屏'
context.window.isExecuting = true
context.window.appendLocalMessage('user', '本地先上屏')
context.window.applyTranscriptUpdate('s1', [
  { kind: 'thinking', role: 'thinking', text: '正在读仓库' },
  { kind: 'tool', role: 'tool', tool: 'terminal', text: 'npm test' }
])
assert.match(transcriptEl.innerHTML, /本地先上屏/)
assert.match(transcriptEl.innerHTML, /正在读仓库/)
assert.match(transcriptEl.innerHTML, /terminal/)

// Test tail update: only tail is sent over WS without resending the entire transcript
context.window.applyTranscriptUpdate('s1', [
  { kind: 'assistant', role: 'assistant', text: '全部通过了' }
], { mode: 'tail', startIndex: 2 })
assert.match(transcriptEl.innerHTML, /正在读仓库/)
assert.match(transcriptEl.innerHTML, /全部通过了/)

// Test prepend earlier messages:
context.window.applyTranscriptUpdate('s1', [
  { kind: 'user', role: 'user', text: '更早的提问' },
  { kind: 'assistant', role: 'assistant', text: '更早的回复' }
], { mode: 'prepend', hasMore: true, offset: 2 })
assert.match(transcriptEl.innerHTML, /更早的提问/)
assert.match(transcriptEl.innerHTML, /更早的回复/)
assert.match(transcriptEl.innerHTML, /全部通过了/)

console.log('overlook mobile monitor contract passed')
