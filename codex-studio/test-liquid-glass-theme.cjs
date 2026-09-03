const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8')

function extractConst(name) {
  const marker = `const ${name} = `
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing const ${name}`)
  // Evaluate object/array literal by brace/bracket matching.
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

// --- theme object ------------------------------------------------------------

const context = { LIQUID_GLASS_THEME_NAME: 'hermes-liquid-glass' }
vm.createContext(context)
vm.runInContext(
  `${extractConst('LIQUID_GLASS_THEME')}\nLIQUID_GLASS_THEME.darkColors = LIQUID_GLASS_THEME.colors\nglobalThis.theme = LIQUID_GLASS_THEME`,
  context
)
const theme = context.theme

assert.equal(theme.name, 'hermes-liquid-glass', 'liquid glass theme name')
assert.notEqual(theme.name, 'hermes-cold-white', 'must not shadow the Cold White theme')
assert.ok(theme.label && theme.label.length > 0, 'has a display label')
assert.ok(theme.colors, 'has a color palette')

// Glass requires translucent-capable surfaces but Hermes colors are solid;
// the authored palette stays light and cool-toned.
for (const key of ['background', 'foreground', 'sidebarBackground', 'card', 'border', 'primary']) {
  assert.ok(theme.colors[key], `palette exposes ${key}`)
}
// Cool light foreground on near-white background → readable.
assert.match(theme.colors.background, /^#f/i, 'light background')
assert.doesNotMatch(theme.colors.foreground, /^#f/i, 'dark foreground')

// darkColors mirrors colors so the window stays light under a dark host pref.
assert.deepEqual(JSON.parse(JSON.stringify(theme.darkColors)), JSON.parse(JSON.stringify(theme.colors)))

// --- both themes are contributed --------------------------------------------

const registerBlock = source.slice(source.indexOf('ctx.register({'))
assert.match(registerBlock, /area: THEMES_AREA[\s\S]{0,120}data: CODEX_THEME/, 'Cold White still registered')
assert.match(source, /data: LIQUID_GLASS_THEME/, 'Liquid Glass registered alongside')

// --- scoped glass stylesheet -------------------------------------------------

assert.match(source, /liquidGlassStylesheet|LIQUID_GLASS_STYLE/, 'a liquid glass stylesheet exists')
assert.match(source, /data-hermes-theme="hermes-liquid-glass"|data-hermes-theme=\\"hermes-liquid-glass\\"|\$\{LIQUID_GLASS_THEME_NAME\}/, 'glass rules are scoped to the liquid glass theme attribute')
assert.match(source, /backdrop-filter:\s*blur/, 'glass uses backdrop blur')
assert.match(source, /-webkit-backdrop-filter/, 'glass includes the webkit backdrop prefix for Electron/Safari')
assert.match(source, /rgba\(255, 255, 255, 0\./, 'glass panels are translucent white')
assert.match(source, /inset 0 1px 0/, 'glass has a top inner highlight')

// The glass stylesheet must NOT be gated on Cold White — it is self-scoped by
// the data-hermes-theme attribute and only takes effect when that theme is on.
assert.match(source, /syncLiquidGlassStyles|liquidGlassStylesheet\(\)/, 'glass stylesheet is synced independently of Cold White')

// Cold White theme object is untouched.
assert.match(source, /name: THEME_NAME,\s*\n\s*label: 'Hermes Cold White'/, 'Cold White theme definition preserved')

console.log('codex-studio liquid glass theme contract passed')
