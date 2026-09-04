const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`)
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

const context = {}
vm.createContext(context)
vm.runInContext(
  `${['sessionBooleanValue', 'sessionPinned', 'sessionActivityValue', 'compareSessions', 'stabilizeSessionOrder'].map(extractFunction).join('\n')}\nglobalThis.api = { stabilizeSessionOrder }`,
  context
)
const { stabilizeSessionOrder } = context.api

const mk = (id, active) => ({ id, last_active: active })
// vm-context arrays fail strict deepEqual across realms; normalize via JSON.
const ids = sessions => JSON.parse(JSON.stringify(sessions.map(s => s.id)))

// First paint (no previous ids) → live activity order.
const first = stabilizeSessionOrder([mk('a', 10), mk('b', 90), mk('c', 50)], [], { resort: false })
assert.deepEqual(ids(first), ['b', 'c', 'a'], 'first paint sorts by activity')

// Between epochs, a background last_active tick must NOT reshuffle rows.
const previousIds = ['b', 'c', 'a']
const ticked = [mk('a', 95), mk('b', 90), mk('c', 50)] // 'a' just became most active
const frozen = stabilizeSessionOrder(ticked, previousIds, { resort: false })
assert.deepEqual(
  ids(frozen),
  ['b', 'c', 'a'],
  'a background activity tick keeps the frozen order (no jump)'
)

// On resort (send/refresh/new-chat), live activity order applies again.
const resorted = stabilizeSessionOrder(ticked, previousIds, { resort: true })
assert.deepEqual(ids(resorted), ['a', 'b', 'c'], 'resort re-applies live activity')

// A brand-new session appends in activity order among newcomers, after frozen ones.
const withNew = [...ticked, mk('d', 80)]
const frozenWithNew = stabilizeSessionOrder(withNew, previousIds, { resort: false })
assert.deepEqual(
  ids(frozenWithNew),
  ['b', 'c', 'a', 'd'],
  'new sessions append after the frozen ones'
)

// Wiring: the projects memo uses stabilizeSessionOrder and tracks per-project ids.
assert.match(source, /sessionOrderIdsRef/, 'a ref tracks per-project session id order')
assert.match(source, /stabilizeSessionOrder\(project\.sessions/, 'sessions are frozen per project inside the memo')

console.log('overlook session order freeze contract passed')
