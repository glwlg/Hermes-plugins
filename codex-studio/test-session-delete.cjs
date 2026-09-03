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

const names = [
  'sessionBooleanValue',
  'sessionPinned',
  'sessionIsScheduled',
  'sessionActivityValue',
  'compareSessions',
  'routeKey',
  'patchSessionRows',
  'patchProjectTreeSessions',
  'patchSessionInGroups'
]
const context = {}
vm.createContext(context)
vm.runInContext(
  `${names.map(extractFunction).join('\n')}\nglobalThis.api = { patchSessionInGroups, patchProjectTreeSessions }`,
  context
)

// A project tree whose preview still holds the session being deleted.
const tree = {
  projects: [
    {
      id: 'p1',
      label: 'casaos_app',
      path: '/srv/casaos_app',
      repos: [],
      sessionCount: 2,
      previewSessions: [
        { id: 'keep', last_active: 20 },
        { id: 'dead', last_active: 10 }
      ]
    }
  ]
}

const groups = [{
  key: 'conn-debian::default::default',
  route: { connectionId: 'conn-debian', mode: 'remote', profile: 'default', targetProfile: 'default' },
  sessions: [{ id: 'keep', last_active: 20 }, { id: 'dead', last_active: 10 }],
  total: 2,
  projectTree: tree
}]

const project = { key: 'conn-debian::default::default::p1', route: groups[0].route }
const deleted = { id: 'dead' }

// 1. patchProjectTreeSessions removes the row from tree previews.
const patchedTree = context.api.patchProjectTreeSessions(tree, deleted, null, 'DELETE', {})
const previews = patchedTree.projects[0].previewSessions.map(s => s.id)
assert.deepEqual(JSON.parse(JSON.stringify(previews)), ['keep'], 'delete must strip the row from tree preview sessions')
assert.equal(patchedTree.projects[0].sessionCount, 1, 'tree sessionCount must drop with the deletion')

// 2. patchSessionInGroups must patch BOTH the flat rows and the embedded tree,
//    otherwise projectGroupsForGatewayGroup resurrects the deleted row from the
//    preview on the next rebuild.
const patchedGroups = context.api.patchSessionInGroups(groups, project, deleted, null, 'DELETE', {})
const group = patchedGroups[0]
assert.deepEqual(JSON.parse(JSON.stringify(group.sessions.map(s => s.id))), ['keep'])
const treePreviews = group.projectTree.projects[0].previewSessions.map(s => s.id)
assert.deepEqual(JSON.parse(JSON.stringify(treePreviews)), ['keep'], 'the embedded project tree must be patched too')
assert.equal(group.total, 1)

// 3. Rename must flow into the tree preview as well.
const renamed = context.api.patchSessionInGroups(
  groups,
  project,
  { id: 'keep' },
  { title: '新名字' },
  'PATCH',
  { title: '新名字' }
)
assert.equal(renamed[0].projectTree.projects[0].previewSessions[0].title, '新名字', 'rename must reach the tree preview row')

// 4. The mutation handler must invalidate the project TREE cache on
//    delete/archive, not only the project sessions cache — otherwise the
//    refetch re-serves the stale preview and the row comes back.
const applyBlock = source.slice(source.indexOf('const applySessionChange'))
assert.match(applyBlock, /clearGatewayProjectTreeCache\(\)/, 'delete must invalidate the project tree cache before refetch')

console.log('codex-studio session delete consistency contract passed')
