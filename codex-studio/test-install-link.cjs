const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')

const pluginPath = path.join(__dirname, 'plugin.js')
const readmePath = path.join(__dirname, '..', 'README.md')
const readme = fs.readFileSync(readmePath, 'utf8')
const plugin = fs.readFileSync(pluginPath, 'utf8')

assert.equal(path.basename(__dirname), 'codex-studio', 'install probe uses the last subdir as the desktop-plugins folder name')
assert.ok(fs.existsSync(pluginPath), 'probe looks for plugin.js at the repo subdir root, not desktop/plugin.js')
assert.equal(fs.existsSync(path.join(__dirname, 'desktop', 'plugin.js')), false, 'do not nest a second desktop/ entry or the installer copies the wrong tree')

const installLink = 'hermes://plugin/install?repo=glwlg/Hermes-plugins/codex-studio'
assert.match(readme, /https:\/\/hermes-agent\.nousresearch\.com\/docs\/zh-Hans\/developer-guide\/desktop-plugin-sdk#install-link/, 'README must cite the Desktop Plugin SDK install-link section')
assert.match(readme, /hermes:\/\/plugin\/install\?repo=glwlg\/Hermes-plugins\/codex-studio/, 'README must ship the one-click install link with the plugin subdir')
assert.match(readme, /hermes:\/\/plugin\/install\?repo=glwlg\/Hermes-plugins\/codex-studio&force=1/, 'README must document force reinstall for an existing copy')
assert.match(readme, /\[Install Codex Studio in Hermes\]\(hermes:\/\/plugin\/install\?repo=glwlg\/Hermes-plugins\/codex-studio\)/)
assert.doesNotMatch(readme, /hermes:\/\/plugin\/install\?[^\s)]*enable=1/, 'enable=1 is an agent allow-list flag; Codex Studio is desktop-only')
assert.doesNotMatch(readme, /hermes:\/\/plugin\/install\?repo=glwlg\/Hermes-plugins(?:["'\s)]|&|$)/, 'a repo-root install link cannot see codex-studio/plugin.js')
assert.match(plugin, /id: ID/, 'installed plugin.js must keep the stable Codex Studio id')
assert.match(plugin, /const ID = 'codex-studio'/)

void installLink
console.log('codex-studio install link contract passed')
