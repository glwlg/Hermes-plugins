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

// The left guide rail uses the project color with the creamy fallback.
assert.match(source, /box-shadow:inset 1px 0 0 var\(--codex-project-color, #ece5d8\)/, 'session guide rail uses the project color')

// The running border uses the project color instead of fixed dark tones.
assert.match(source, /conic-gradient\(from var\(--codex-gateway-arc-angle,0deg\),transparent 0deg,transparent 258deg,var\(--codex-project-color, #1f2937\) 286deg/, 'running border leading stop uses the project color')
assert.doesNotMatch(source, /258deg,#1f2937 286deg,#64748b 326deg/, 'running border no longer hardcodes dark slate')

console.log('codex-studio project color flow contract passed')
