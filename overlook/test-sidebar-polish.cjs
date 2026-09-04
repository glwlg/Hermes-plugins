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

assert.match(source, /placeholder: '搜索会话'/)
assert.match(source, /'aria-label': '搜索会话'/)
assert.doesNotMatch(source, /Search sessions|Search gateway sessions|Profile scope|Showing all profiles|Showing default profile/)
assert.match(source, /children: '默认'/)
assert.match(source, /children: '全部配置'/)
assert.match(source, /显示定时会话|隐藏定时会话/)
assert.doesNotMatch(source, /source\$\{unavailableSources\.length === 1 \? '' : 's'\} unavailable/)
assert.doesNotMatch(source, /['"](?:Try a different title|Create a chat from a project header|No matching sessions|No sessions found|Loading sessions|Reading sessions from every available gateway|Retry)['"]/)

assert.doesNotMatch(source, /}, 'filter-scope'\)/, 'the verbose loaded/total sentence must not occupy a permanent row')
assert.match(source, /sourcesIncomplete && \(search\.trim\(\) \|\| sessionFilter !== 'all'\)/, 'partial-search scope appears only when relevant')
assert.match(source, /filter\(project => project\.sessions\.length > 0 \|\| !filtering\)/, 'active filters must hide empty project shells')
assert.match(source, /children: totalProjectSessionCount/, 'header must show the project-tree total, not a duplicate loaded ratio')
assert.doesNotMatch(source, /children: 'Overlook'/, 'the sidebar header must not paint a nowrap Overlook label over the scope control')
assert.doesNotMatch(source, /children: hasExactSessionTotal && totalSessionCount > loadedSessionCount \? `\$\{loadedSessionCount\}\/\$\{totalSessionCount\}`/)

assert.match(source, /const rowClassName = `codex-gateway-session-row group relative h-8/, 'session rows must use compact single-line height')
assert.doesNotMatch(source, /children: session\.preview \|\| `\$\{session\.message_count \|\| 0\} messages`/, 'the permanent second preview line must be removed')
assert.match(source, /boxShadow: active \? 'inset 0 0 0 1px var\(--ui-stroke-secondary\)/, 'the selected session keeps a persistent outline without a new icon')
assert.match(source, /font-semibold text-foreground/, 'the selected session title needs stronger weight')
assert.match(source, /children: Math\.max\(project\.sessions\.length, Number\(project\.sessionCount\) \|\| 0\)/, 'project headers must show authoritative totals')
assert.doesNotMatch(source, /children: 'auto'/, 'automatic project metadata belongs in a tooltip, not a permanent badge')

const badgeContext = { HOME_PROJECT_KEY: '__no_project__', HOME_PROJECT_LABEL: '主页', PROFILE_SCOPE_DEFAULT: 'default' }
vm.createContext(badgeContext)
vm.runInContext(
  `${extractFunction('isHomeProject')}\n${extractFunction('projectRemoteLabel')}\n${extractFunction('projectSourceBadge')}\nglobalThis.api = { projectSourceBadge }`,
  badgeContext
)
assert.equal(badgeContext.api.projectSourceBadge({ profile: 'default', sourceLabel: 'This device', route: { mode: 'local' } }), '')
assert.equal(badgeContext.api.projectSourceBadge({ profile: 'default', sourceLabel: 'This device', route: {} }), '', 'unknown legacy routes must not be presented as remote')
assert.equal(badgeContext.api.projectSourceBadge({ profile: 'coder', sourceLabel: 'This device', route: { mode: 'local' } }), 'coder')
assert.equal(badgeContext.api.projectSourceBadge({ profile: 'default', sourceLabel: 'WSL', remoteLabel: 'ubuntu', route: { mode: 'remote' } }), 'WSL')
assert.equal(badgeContext.api.projectSourceBadge({ profile: 'coder', sourceLabel: 'WSL', remoteLabel: 'ubuntu', route: { mode: 'remote' } }), 'WSL · coder')

console.log('overlook sidebar polish contract passed')
