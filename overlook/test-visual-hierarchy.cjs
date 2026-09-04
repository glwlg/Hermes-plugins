const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8')

// Static project ownership stays quiet; the native running arc keeps the full
// project color through --arc-c1.
assert.match(
  source,
  /box-shadow:inset 1px 0 0 color-mix\(in srgb,var\(--codex-project-color, #ece5d8\) 30%,#ece5d8\)/,
  'ordinary session guide rails use a restrained project tint'
)
assert.match(
  source,
  /--arc-c1:var\(--codex-project-color, #1f2937\)/,
  'the running arc keeps the full project color'
)

// Selection should remain legible without competing with the lifted project
// cards one level above it.
assert.match(
  source,
  /boxShadow: active \? 'inset 0 0 0 1px var\(--ui-stroke-secondary\), 0 1px 2px rgba\(120,104,80,0\.06\)'/,
  'selected session shadow is quieter than the project-card shadow'
)

// Every filter owns the same geometry; state changes paint the card without
// adding/removing a border or switching Button variants.
assert.match(source, /className: 'codex-gateway-filter-tab rounded-lg'/, 'filter tabs share one control class')
assert.match(source, /\.codex-gateway-filter-tab\{border:1px solid transparent!important;background:transparent!important;box-shadow:none!important;/, 'inactive filters reserve the card border')
assert.match(source, /\.codex-gateway-filter-tab\[aria-pressed="false"\]:hover\{background:#ffffff!important;border-color:#f0ebe2!important\}/, 'inactive filters get a quiet hover card')
assert.match(source, /\.codex-gateway-filter-tab\[aria-pressed="true"\]\{background:#ffffff!important;border-color:#e9e2d6!important;box-shadow:0 1px 2px rgba\(120,104,80,0\.06\)!important\}/, 'active filter gets the lifted card treatment')
assert.doesNotMatch(source, /style: activeFilter/, 'filter state must not add and remove border geometry inline')
assert.match(source, /variant: 'ghost',\n            children: label/, 'filter tabs keep one Button variant')

// Metadata recedes at rest and comes back on deliberate interaction; titles and
// native status dots are not dimmed.
assert.match(source, /\.codex-gateway-session-row \[data-session-time\]\{opacity:0\.78;transition:opacity 120ms ease\}/, 'session timestamps recede at rest')
assert.match(source, /\.codex-gateway-session-row:is\(:hover,:focus-within\) \[data-session-time\]\{opacity:1\}/, 'session timestamps recover on interaction')
assert.equal((source.match(/codex-gateway-project-meta/g) || []).length >= 4, true, 'project source and count share the metadata treatment')
assert.match(source, /\.codex-gateway-project-meta\{opacity:0\.72;transition:opacity 120ms ease\}/, 'project metadata recedes at rest')
assert.match(source, /\.codex-gateway-project-row:is\(:hover,:focus-within\) \.codex-gateway-project-meta\{opacity:1\}/, 'project metadata recovers on interaction')

// Tool/thinking scaffolding gets one contrast step back under Cold White while
// prose remains the strongest layer.
assert.match(source, /\[data-slot='aui_assistant-message-content'\] \[data-conversation-scaffold\]\{opacity:0\.78\}/, 'tool and thinking scaffolding is readable without matching prose contrast')

// The composer remains floating but its three shadow layers are 17–25% quieter.
assert.match(source, /const COMPOSER_SHADOW =\n  '0 0 0 1px rgba\(13, 28, 47, 0\.05\), 0 0\.25rem 0\.75rem rgba\(13, 28, 47, 0\.045\), 0 0\.875rem 2rem rgba\(13, 28, 47, 0\.06\)'/, 'composer shadow is softened without changing native geometry')
assert.match(source, /const THEME_REVISION = 18/, 'visual theme changes bump the revision')

console.log('overlook visual hierarchy contract passed')
