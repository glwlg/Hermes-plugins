const path = require('path')
const { spawnSync } = require('child_process')

const root = __dirname
const checks = [
  ['syntax', ['--check', path.join(root, 'plugin.js')]],
  ['project hydration', [path.join(root, 'test-project-hydration.cjs')]],
  ['project cache', [path.join(root, 'test-project-cache.cjs')]],
  ['project fallback + partial summary', [path.join(root, 'test-project-fallback.cjs')]],
  ['session delete consistency', [path.join(root, 'test-session-delete.cjs')]],
  ['pinned section', [path.join(root, 'test-pinned-section.cjs')]],
  ['project pin + info', [path.join(root, 'test-project-pin.cjs')]],
  ['project appearance', [path.join(root, 'test-project-appearance.cjs')]],
  ['liquid glass theme', [path.join(root, 'test-liquid-glass-theme.cjs')]],
  ['project recency and rows', [path.join(root, 'test-project-recency-preview.cjs')]],
  ['sidebar polish', [path.join(root, 'test-sidebar-polish.cjs')]],
  ['inbox surfaces', [path.join(root, 'test-inbox-surfaces.cjs')]],
  ['install link', [path.join(root, 'test-install-link.cjs')]],
  ['chrome palette', [path.join(root, 'test-chrome-palette.cjs')]]
]

for (const [label, args] of checks) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(`[FAIL] ${label}\n`)
    if (result.stdout) process.stderr.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status || 1)
  }
  process.stdout.write(`[PASS] ${label}\n`)
}
