const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8')

function extractConst(name) {
  const marker = `const ${name} = `
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing const ${name}`)
  const open = source.indexOf(source[start + marker.length] === '[' ? '[' : '{', start)
  const openChar = source[open]
  const closeChar = openChar === '[' ? ']' : '}'
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === openChar) depth += 1
    if (source[index] === closeChar) {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated const ${name}`)
}

const context = {}
vm.createContext(context)
vm.runInContext(
  `${extractConst('PROJECT_APPEARANCE_COLORS')}\n${extractConst('PROJECT_APPEARANCE_ICONS')}\nglobalThis.colors = PROJECT_APPEARANCE_COLORS\nglobalThis.icons = PROJECT_APPEARANCE_ICONS`,
  context
)

// --- expanded palette ---------------------------------------------------------

const colorCount = Object.keys(context.colors).length
assert.ok(colorCount >= 16, `palette offers at least 16 colors, got ${colorCount}`)
for (const [name, hex] of Object.entries(context.colors)) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `color ${name} is a hex value`)
}

// --- expanded icon set --------------------------------------------------------

assert.ok(context.icons.length >= 20, `icon set offers at least 20 icons, got ${context.icons.length}`)
assert.equal(new Set(context.icons).size, context.icons.length, 'icons are unique')
for (const icon of context.icons) {
  assert.match(icon, /^[a-z][a-z0-9-]*$/, `icon ${icon} is a codicon-style name`)
}
// Original eight remain so existing appearances keep resolving.
for (const original of ['folder', 'repo', 'rocket', 'tools', 'database', 'cloud', 'code', 'package']) {
  assert.ok(context.icons.includes(original), `keeps original icon ${original}`)
}

// --- sidebar depth ------------------------------------------------------------

// Project rows carry their own hook class + a row-kind marker.
assert.match(source, /codex-gateway-project-row/, 'project rows have a dedicated hook class')
assert.match(source, /data-row-kind': 'project'|"data-row-kind": "project"|'data-row-kind': 'project'/, 'project rows expose a row-kind attribute')

// The stylesheet lifts project headers above session rows: a filled surface,
// a hairline border, a soft shadow, and a bolder label.
assert.match(source, /\.codex-gateway-project-row\{[^}]*box-shadow/, 'project header casts a soft shadow')
assert.match(source, /\.codex-gateway-project-row\{[^}]*border:1px solid/, 'project header has a hairline border')
assert.match(source, /\.codex-gateway-project-row \{?[^}]*font-weight:600|codex-project-label\{font-weight:600/, 'project label is bolder than sessions')

// Session rows are visually nested: indented with a guide rail on the left.
assert.match(source, /\.codex-gateway-session-row\{[^}]*margin-left:1\.5rem/, 'session rows stay indented under the project')
assert.match(source, /\.codex-gateway-session-row\{[^}]*border-left:1px solid/, 'session rows get a left guide rail')

console.log('codex-studio sidebar depth contract passed')
