const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8')

// --- home project is customizable --------------------------------------------

// The home branch must route through the custom icon/color like any other
// project instead of a hardcoded unstyled home glyph.
const homeBranch = source.slice(source.indexOf('isHomeProject(project)'), source.indexOf(': remote', source.indexOf('isHomeProject(project)')))
assert.match(homeBranch, /style: iconStyle/, 'home project row applies the custom color')
assert.match(homeBranch, /projectAppearanceFor\(appearance, projectKey\)\?\.icon \? customIcon : 'home'/, 'home project uses the custom icon when set, else home')

// --- project color flows to session rows -------------------------------------

assert.match(source, /const projectColor = projectIconColor\(options\.appearance, project\.key\)/, 'session row derives the project color')
assert.match(source, /'--codex-project-color': projectColor \|\| undefined/, 'session row exposes the color as a CSS variable')
assert.match(source, /appearance: projectAppearance, indent: false, pinned: true/, 'pinned session rows receive the appearance map')
assert.match(source, /appearance: projectAppearance \}\)/, 'regular session rows receive the appearance map')

// The static left guide rail uses a restrained project tint with the creamy
// fallback, leaving the full project color to the running arc.
assert.match(source, /box-shadow:inset 1px 0 0 color-mix\(in srgb,var\(--codex-project-color, #ece5d8\) 30%,#ece5d8\)/, 'session guide rail uses a restrained project tint')

// The running border reuses the native Sessions arc and only mirrors its
// travel horizontally. Its native color ramp is fed by the project color.
assert.match(source, /className: 'arc-border arc-row codex-gateway-running-arc'/, 'session rows render the native Sessions arc')
assert.match(source, /\.codex-gateway-running-arc\{display:none;--arc-c1:var\(--codex-project-color, #1f2937\);--arc-duration:3s;--arc-radius:0\.75rem;transform:scaleX\(-1\)\}/, 'native arc is project-colored, slowed, radius-matched, and mirrored')
assert.match(source, /\.codex-gateway-session-row:has\(\[class~="bg-\(--ui-accent\)"\]\)>\.codex-gateway-running-arc,\.codex-gateway-session-row:has\(\[class~="border-\(--ui-accent\)"\]\)>\.codex-gateway-running-arc\{display:block\}/, 'native arc only appears for a running row')
assert.doesNotMatch(source, /--codex-gateway-arc-angle|codex-gateway-running-border|conic-gradient\(from var\(--codex-gateway-arc-angle/, 'the old plugin conic spinner is removed')

console.log('overlook project color flow contract passed')
