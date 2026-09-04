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
vm.runInContext(`${extractFunction('shouldResortProjectsForUserInput')}\nglobalThis.fn = shouldResortProjectsForUserInput`, context)
const fn = context.fn

// Explicit reasons always resort.
assert.equal(fn({ reason: 'refresh' }), true, 'manual refresh resorts')
assert.equal(fn({ reason: 'new-chat' }), true, 'new chat resorts')

// A send in the session already in focus resorts: same id, busy rises.
assert.equal(
  fn({ previousBusy: false, busy: true, previousSessionId: 's1', sessionId: 's1' }),
  true,
  'sending in the focused session resorts'
)

// Switching to an already-busy session must NOT resort — id changed.
assert.equal(
  fn({ previousBusy: false, busy: true, previousSessionId: 's1', sessionId: 's2' }),
  false,
  'switching to a busy session does not resort'
)

// Background streaming in the focused session does not re-sort once already busy.
assert.equal(
  fn({ previousBusy: true, busy: true, previousSessionId: 's1', sessionId: 's1' }),
  false,
  'steady busy state does not resort'
)
assert.equal(
  fn({ previousBusy: true, busy: false, previousSessionId: 's1', sessionId: 's1' }),
  false,
  'busy falling does not resort'
)

// The wiring must track the focused session id, not just the busy flag.
assert.match(source, /previousFocusedSessionIdRef/, 'a ref tracks the previously focused session id')
assert.match(source, /previousSessionId: previousFocusedSessionIdRef\.current/, 'the effect passes the previous session id')
assert.match(source, /sessionId: focusedStoredSessionId/, 'the effect passes the current session id')

console.log('overlook project resort gating contract passed')
