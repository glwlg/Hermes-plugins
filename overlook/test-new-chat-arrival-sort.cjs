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
vm.runInContext(`${extractFunction('pendingNewChatAppeared')}\nglobalThis.fn = pendingNewChatAppeared`, context)
const appeared = context.fn
const projects = [
  { key: 'project:a', sessions: [{ id: 'old' }, { id: 'created' }] },
  { key: 'project:b', sessions: [{ id: 'created' }] }
]

assert.equal(appeared({ projectKey: 'project:a', sessionId: 'created' }, projects), true, 'created session appears in its owning project')
assert.equal(appeared({ projectKey: 'project:a', sessionId: 'missing' }, projects), false, 'missing created session does not consume the sort')
assert.equal(appeared({ projectKey: 'project:c', sessionId: 'created' }, projects), false, 'same id in another project does not consume the sort')
assert.equal(appeared(null, projects), false, 'no pending create means no resort')

const newChatStart = source.indexOf('  const newChat = async project => {')
const newChatEnd = source.indexOf('\n  const refresh =', newChatStart)
assert.notEqual(newChatStart, -1, 'missing newChat handler')
assert.notEqual(newChatEnd, -1, 'missing newChat handler boundary')
const newChatBody = source.slice(newChatStart, newChatEnd)
assert.match(newChatBody, /pendingNewChatRef\.current = \{ projectKey: project\.key, sessionId: stored \}/, 'new chat records the exact pending project/session pair')
assert.doesNotMatch(newChatBody, /setProjectSortEpoch/, 'new chat must not spend the sort epoch before refetched data arrives')
assert.match(source, /const pendingNewChatReady = pendingNewChatAppeared\(pendingNewChatRef\.current, unfilteredProjects\)/, 'project memo waits for the new session to become visible')
assert.match(source, /const resort = lastProjectSortEpochRef\.current !== projectSortEpoch \|\| previousKeys\.length === 0 \|\| pendingNewChatReady/, 'arrival of the created session triggers the allowed resort')
assert.match(source, /if \(pendingNewChatReady\) pendingNewChatRef\.current = null/, 'the one-shot resort is consumed after arrival')

console.log('overlook new-chat arrival sorting contract passed')
