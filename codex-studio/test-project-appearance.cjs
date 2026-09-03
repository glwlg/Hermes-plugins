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
  'projectAppearanceFor',
  'projectIconName',
  'projectIconColor'
]
const context = {
  PROJECT_APPEARANCE_COLORS: {
    red: '#e11d48',
    blue: '#2563eb'
  },
  PROJECT_APPEARANCE_ICONS: ['folder', 'repo', 'rocket', 'tools', 'database', 'cloud', 'code', 'package']
}
vm.createContext(context)
vm.runInContext(
  `${names.map(extractFunction).join('\n')}\nglobalThis.api = { projectAppearanceFor, projectIconColor, projectIconName }`,
  context
)

const appearance = {
  'r::default::p1': { color: 'red', icon: 'rocket' },
  'r::default::p2': { color: 'not-a-preset', icon: 'rocket' },
  'r::default::p3': { color: 'blue', icon: 'not-an-icon' },
  'r::default::p4': { icon: 'tools' },
  'r::default::p5': { color: 'blue' }
}

// projectAppearanceFor resolves the entry for a project key.
assert.deepEqual(
  JSON.parse(JSON.stringify(context.api.projectAppearanceFor(appearance, 'r::default::p1'))),
  { color: 'red', icon: 'rocket' }
)
assert.equal(context.api.projectAppearanceFor(appearance, 'missing'), null)
assert.equal(context.api.projectAppearanceFor(null, 'r::default::p1'), null)

// Icon name: only preset icons survive; default falls back to folder.
assert.equal(context.api.projectIconName(appearance, 'r::default::p1'), 'rocket')
assert.equal(context.api.projectIconName(appearance, 'r::default::p3'), 'folder', 'unknown icon falls back to folder')
assert.equal(context.api.projectIconName(appearance, 'r::default::p4'), 'tools')
assert.equal(context.api.projectIconName(appearance, 'missing'), 'folder')

// Color: only preset colors resolve to a hex; unknown → null (inherit theme).
assert.equal(context.api.projectIconColor(appearance, 'r::default::p1'), '#e11d48')
assert.equal(context.api.projectIconColor(appearance, 'r::default::p2'), null, 'unknown color is dropped')
assert.equal(context.api.projectIconColor(appearance, 'r::default::p5'), '#2563eb')
assert.equal(context.api.projectIconColor(appearance, 'missing'), null)

// Presets exist with the agreed 8 colors and 8 icons.
assert.match(source, /PROJECT_APPEARANCE_COLORS/, 'color presets are defined')
assert.match(source, /PROJECT_APPEARANCE_ICONS/, 'icon presets are defined')
const colorKeys = [...source.matchAll(/^\s{2}(\w+): '#[0-9a-fA-F]{6}'/gm)].map(m => m[1])
assert.ok(colorKeys.length >= 8, `expected at least 8 color presets, saw ${colorKeys.length}`)

// Editing must persist through prefs projectAppearance.
assert.match(source, /projectAppearance: \{/, 'appearance writes go through prefs')
assert.match(source, /onEditAppearance|editAppearance|appearanceEditor/, 'an appearance editor entry point exists')

console.log('codex-studio project appearance contract passed')
