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

assert.match(source, /PALETTE_AREA/, 'Codex Studio must register command-palette rows')
assert.match(source, /STATUSBAR_AREAS/, 'Codex Studio must register a status-bar inbox chip')
assert.match(source, /KEYBINDS_AREA/, 'Codex Studio must register a rebindable refresh keybind')
assert.match(source, /EmptyState/, 'empty pane states must use the SDK empty surface')
assert.match(source, /ErrorState/, 'failed pane states must use the SDK error surface')
assert.match(source, /function gatewayInboxSummary\(/, 'inbox counts must be a pure helper')
assert.match(source, /function refreshGatewaySessionQueries\(/, 'palette and pane refresh must share one helper')
assert.doesNotMatch(source, /ctx\.rest\(/, 'gateway sessions already use host RPC; do not add an unused plugin backend')
assert.doesNotMatch(source, /ctx\.socket\(/, 'gateway sessions already use host.onEvent; do not add an unused plugin socket')

const names = [
  'sessionBooleanValue',
  'sessionUnread',
  'sessionActive',
  'sessionPinned',
  'sessionIsScheduled',
  'gatewayInboxSummary'
]
const context = { HIDE_SCHEDULED_SESSIONS_DEFAULT: true }
vm.createContext(context)
vm.runInContext(
  `${names.map(extractFunction).join('\n')}\nglobalThis.api = { gatewayInboxSummary }`,
  context
)

const summary = context.api.gatewayInboxSummary([
  {
    error: null,
    sessions: [
      { id: 'a', unread: true, is_active: true, pinned: false, source: 'desktop' },
      { id: 'b', unread: false, is_active: false, pinned: true, source: 'desktop' },
      { id: 'cron', unread: true, is_active: true, pinned: false, source: 'cron' }
    ]
  },
  {
    error: 'offline',
    sessions: []
  }
], true)

assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
  failed: 1,
  loaded: 2,
  open: 1,
  pinned: 1,
  unread: 1
})

console.log('codex-studio inbox surfaces contract passed')
