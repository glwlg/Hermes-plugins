const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')

const pluginPath = path.join(__dirname, 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')

assert.match(source, /const THEME_REVISION = 17/, 'conversation canvas change must bump the theme revision so existing installs reapply')
assert.match(source, /label: 'Hermes Cold White'/)
assert.match(source, /const THEME_NAME = 'hermes-cold-white'/)

const conversationTokens = [
  "background: '#ffffff'",
  "'--background': '#ffffff'",
  "'--ui-chat-surface-background': '#ffffff'",
  "'--ui-editor-surface-background': '#ffffff'",
  "'--composer-fill': '#ffffff'",
  "userBubble: '#f3f4f5'"
]
for (const token of conversationTokens) {
  assert.ok(source.includes(token), `conversation surface must be pure white: ${token}`)
}

assert.equal((source.match(/background-color', '#ffffff'/g) || []).length >= 4, true, 'thread/message element overrides must paint pure white')
assert.doesNotMatch(source, /background-color', '#f8f9ff'/, 'thread/message element overrides must not keep the icy canvas')
assert.doesNotMatch(source, /background: '#f8f9ff'/, 'theme background must not stay icy')
assert.doesNotMatch(source, /'--ui-chat-surface-background': '#f8f9ff'/)
assert.doesNotMatch(source, /'--ui-editor-surface-background': '#f8f9ff'/)
assert.doesNotMatch(source, /'--background': '#f8f9ff'/)
assert.doesNotMatch(source, /'--dt-background': '#f8f9ff'/)
assert.doesNotMatch(source, /'--ui-bg-editor': '#f8f9ff'/)

const icyChrome = [
  "sidebarBackground: '#eff4ff'",
  "'--dt-sidebar-bg': '#eff4ff'",
  "'--ui-bg-sidebar': '#eff4ff'",
  "'--ui-sidebar-surface-background': '#eff4ff'",
  "muted: '#eff4ff'",
  "secondary: '#eff4ff'",
  "accent: '#e8efff'",
  "'--ui-inline-code-background': '#e8efff'",
  "'--ui-control-hover-background': '#e8efff'",
  "'--ui-row-hover-background': '#e8efff'",
  "'--ui-control-active-background': '#dfe8fa'",
  "'--ui-row-active-background': '#e7edf6'",
  "'--ui-stroke-quaternary': '#e6eeff'"
]
for (const token of icyChrome) {
  assert.equal(source.includes(token), false, `icy chrome wash must leave the rails: ${token}`)
}

const paperChrome = [
  "sidebarBackground: '#f5f5f7'",
  "'--dt-sidebar-bg': '#f5f5f7'",
  "'--ui-bg-sidebar': '#f5f5f7'",
  "'--ui-sidebar-surface-background': '#f5f5f7'",
  "muted: '#f5f5f7'",
  "secondary: '#f5f5f7'",
  "accent: '#ebebed'",
  "'--ui-bg-chrome': '#f5f5f7'",
  "'--ui-surface-background': '#f5f5f7'",
  "'--ui-inline-code-background': '#ececee'",
  "'--ui-control-hover-background': '#ececee'",
  "'--ui-row-hover-background': '#ececee'",
  "'--ui-control-active-background': '#e4e4e7'",
  "'--ui-row-active-background': '#e4e4e7'",
  "'--ui-stroke-quaternary': '#ececee'",
  "border: '#d4d4d8'",
  "sidebarBorder: '#d4d4d8'"
]
for (const token of paperChrome) {
  assert.ok(source.includes(token), `missing paper chrome token: ${token}`)
}

assert.match(source, /纸灰工作台，环绕纯白对话区/, 'description must name the split: paper chrome, white thread')
assert.doesNotMatch(source, /blue-gray structure/)
assert.doesNotMatch(source, /paper rails around a cold-white conversation/)

console.log('codex-studio chrome palette contract passed')
