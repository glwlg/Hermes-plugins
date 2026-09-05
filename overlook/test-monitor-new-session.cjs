const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, 'desktop', 'plugin.js'), 'utf8')

function extractFunction(name) {
  const asyncNeedle = `async function ${name}`
  const plainNeedle = `function ${name}`
  const start = source.indexOf(asyncNeedle) >= 0 ? source.indexOf(asyncNeedle) : source.indexOf(plainNeedle)
  assert.notEqual(start, -1, `missing function ${name}`)
  const paren = source.indexOf('(', start)
  let depth = 0
  let closeParen = -1
  for (let index = paren; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') {
      depth -= 1
      if (depth === 0) {
        closeParen = index
        break
      }
    }
  }
  assert.notEqual(closeParen, -1, `missing parameter list for ${name}`)
  const open = source.indexOf('{', closeParen)
  depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated function ${name}`)
}

const calls = []
const route = { connectionId: 'remote-a', mode: 'remote', profile: 'worker', targetProfile: 'worker' }
const project = { key: 'remote-a::project-1', label: 'Alpha', path: 'P:/workspace/alpha', route }
const context = {
  host: {
    async retainProfile(value) {
      calls.push(['retain', value])
      return () => calls.push(['release'])
    },
    async requestProfile(owner, method, params) {
      calls.push([method, owner, params])
      if (method === 'model.options') {
        return {
          model: 'gpt-5.5',
          provider: 'openai-codex',
          providers: [
            { authenticated: true, models: ['gpt-5.4', 'gpt-5.5'], name: 'OpenAI', slug: 'openai-codex' },
            { authenticated: true, models: [{ id: 'claude-sonnet-4.6' }], name: 'Anthropic', slug: 'anthropic' },
            { authenticated: false, models: ['unavailable'], name: 'Unavailable', slug: 'missing' }
          ]
        }
      }
      if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      if (method === 'session.resume') return { session_id: 'runtime-resumed' }
      if (method === 'image.attach_bytes') return { attached: true, path: `/images/${params.filename}` }
      if (method === 'config.set') return { ok: true, key: params.key, value: params.value }
      if (method === 'session.interrupt') return { ok: true, status: 'interrupted' }
      if (method === 'prompt.submit') return { ok: true }
      if (method === 'session.close') return { ok: true }
      throw new Error(`unexpected method ${method}`)
    }
  },
  isHomeProject(value) {
    return value?.sourceKey === '__no_project__'
  },
  projectDisplayLabel(value) {
    return value.label
  },
  projectWorkspacePath(value) {
    return value.path || null
  },
  routeTargetProfile(value) {
    return String(value?.targetProfile || value?.profile || 'default')
  }
}
vm.createContext(context)
vm.runInContext(
  `${[
    'monitorModelChoiceKey',
    'monitorModelChoiceFromKey',
    'normalizeMonitorModelOptions',
    'fetchMonitorModelOptions',
    'monitorSessionCreateParams',
    'monitorImageAttachPayload',
    'createMonitorSession',
    'resolveMonitorRuntimeSessionId',
    'switchMonitorSessionModel',
    'stopMonitorSessionTask',
    'submitMonitorPrompt'
  ].map(extractFunction).join('\n')}\nglobalThis.api = { monitorModelChoiceKey, monitorModelChoiceFromKey, normalizeMonitorModelOptions, fetchMonitorModelOptions, monitorSessionCreateParams, monitorImageAttachPayload, createMonitorSession, resolveMonitorRuntimeSessionId, switchMonitorSessionModel, stopMonitorSessionTask, submitMonitorPrompt }`,
  context
)

async function main() {
  const rawOptions = await context.api.fetchMonitorModelOptions(project)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['model.options', route, { explicit_only: true, include_unconfigured: false }]
  ], 'model inventory is read from the selected project owner route')
  calls.length = 0

  const catalog = JSON.parse(JSON.stringify(context.api.normalizeMonitorModelOptions(rawOptions)))
  assert.deepEqual(catalog.choices.map(choice => [choice.provider, choice.model]), [
    ['openai-codex', 'gpt-5.4'],
    ['openai-codex', 'gpt-5.5'],
    ['anthropic', 'claude-sonnet-4.6']
  ], 'the picker flattens configured provider inventories and accepts legacy object model rows')
  assert.equal(catalog.defaultChoiceKey, context.api.monitorModelChoiceKey('openai-codex', 'gpt-5.5'), 'gateway model/provider seed the initial selection')
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.api.monitorModelChoiceFromKey(catalog.defaultChoiceKey))),
    { model: 'gpt-5.5', provider: 'openai-codex' },
    'combined picker values round-trip without lossy delimiter parsing'
  )

  const fallbackCatalog = JSON.parse(JSON.stringify(context.api.normalizeMonitorModelOptions({
    model: 'missing-model',
    provider: 'missing-provider',
    providers: [{ authenticated: true, models: ['first-model'], name: 'First', slug: 'first' }]
  })))
  assert.equal(fallbackCatalog.defaultChoiceKey, context.api.monitorModelChoiceKey('first', 'first-model'), 'an unavailable saved default falls back to the first usable model')

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.api.monitorSessionCreateParams(project, { model: 'gpt-5.5', provider: 'openai-codex' }))),
    {
      cols: 96,
      cwd: 'P:/workspace/alpha',
      model: 'gpt-5.5',
      profile: 'worker',
      provider: 'openai-codex',
      source: 'desktop'
    },
    'create payload binds cwd, target profile, and the selected per-session model'
  )

  const attach = JSON.parse(JSON.stringify(context.api.monitorImageAttachPayload(
    { dataUrl: 'data:image/png;base64,QUJDRA==', name: 'screen.png' },
    'runtime-1'
  )))
  assert.deepEqual(attach, {
    content_base64: 'QUJDRA==',
    filename: 'screen.png',
    session_id: 'runtime-1'
  }, 'image data URLs become the gateway image.attach_bytes payload')
  assert.throws(
    () => context.api.monitorImageAttachPayload({ dataUrl: 'data:text/plain;base64,QQ==', name: 'notes.txt' }, 'runtime-1'),
    /invalid image/i,
    'non-image data is rejected before an upload request'
  )

  const created = JSON.parse(JSON.stringify(await context.api.createMonitorSession({
    images: [
      { dataUrl: 'data:image/png;base64,QUJDRA==', name: 'screen.png' },
      { dataUrl: 'data:image/jpeg;base64,RUZHSA==', name: 'photo.jpg' }
    ],
    model: { model: 'gpt-5.5', provider: 'openai-codex' },
    project,
    prompt: '  inspect both images  '
  })))
  assert.deepEqual(created, { runtimeId: 'runtime-1', storedId: 'stored-1' })
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['retain', route],
    ['session.create', route, {
      cols: 96,
      cwd: 'P:/workspace/alpha',
      model: 'gpt-5.5',
      profile: 'worker',
      provider: 'openai-codex',
      source: 'desktop'
    }],
    ['image.attach_bytes', route, { content_base64: 'QUJDRA==', filename: 'screen.png', session_id: 'runtime-1' }],
    ['image.attach_bytes', route, { content_base64: 'RUZHSA==', filename: 'photo.jpg', session_id: 'runtime-1' }],
    ['prompt.submit', route, { session_id: 'runtime-1', text: 'inspect both images' }],
    ['release']
  ], 'one retained owner route carries create, ordered image staging, and the first prompt')

  const originalHost = context.host
  const failureCalls = []
  context.host = {
    async retainProfile() {
      failureCalls.push(['retain'])
      return () => failureCalls.push(['release'])
    },
    async requestProfile(owner, method, params) {
      failureCalls.push([method, owner, params])
      if (method === 'session.create') return { session_id: 'runtime-fail', stored_session_id: 'stored-fail' }
      if (method === 'image.attach_bytes') throw new Error('upload exploded with internal endpoint details')
      if (method === 'session.close') return { ok: true }
      throw new Error(`unexpected ${method}`)
    }
  }
  await assert.rejects(
    context.api.createMonitorSession({
      images: [{ dataUrl: 'data:image/png;base64,QUJDRA==', name: 'screen.png' }],
      model: { model: 'gpt-5.5', provider: 'openai-codex' },
      project,
      prompt: 'inspect'
    })
  )
  assert.deepEqual(failureCalls.map(call => call[0]), ['retain', 'session.create', 'image.attach_bytes', 'session.close', 'release'], 'a pre-submit failure closes the half-created runtime on the exact owner')

  context.host = originalHost
  calls.length = 0
  const submitted = await context.api.submitMonitorPrompt({
    project,
    prompt: 'continue from the wall',
    session: { id: 'stored-live' }
  })
  assert.equal(submitted.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['retain', route],
    ['session.resume', route, { session_id: 'stored-live', source: 'desktop', omit_messages: true, profile: 'worker' }],
    ['prompt.submit', route, { session_id: 'runtime-resumed', text: 'continue from the wall' }],
    ['release']
  ], 'card send resumes the live runtime before submitting the prompt')

  calls.length = 0
  const withImage = await context.api.submitMonitorPrompt({
    images: [{ dataUrl: 'data:image/png;base64,QUJDRA==', name: 'followup.png' }],
    project,
    prompt: 'look at this',
    session: { id: 'stored-live' }
  })
  assert.equal(withImage.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)).map(call => call[0]), [
    'retain',
    'session.resume',
    'image.attach_bytes',
    'prompt.submit',
    'release'
  ], 'a follow-up from the wall attaches images to the resumed runtime before submit')

  calls.length = 0
  const switched = await context.api.switchMonitorSessionModel(project, { id: 'stored-live' }, {
    model: 'claude-sonnet-4.6',
    provider: 'anthropic'
  })
  assert.equal(switched.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['retain', route],
    ['session.resume', route, { session_id: 'stored-live', source: 'desktop', omit_messages: true, profile: 'worker' }],
    ['config.set', route, { confirm_expensive_model: true, key: 'model', session_id: 'runtime-resumed', value: 'claude-sonnet-4.6 --provider anthropic --session' }],
    ['release']
  ], 'switching model on a monitored session applies session-scoped config.set on the resumed runtime')

  calls.length = 0
  await context.api.stopMonitorSessionTask(project, { id: 'stored-session-stop' })
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['retain', route],
    ['session.resume', route, { omit_messages: true, profile: 'worker', session_id: 'stored-session-stop', source: 'desktop' }],
    ['session.interrupt', route, { session_id: 'runtime-resumed' }],
    ['release']
  ], 'stopMonitorSessionTask resumes the runtime session and issues session.interrupt on its owning route')

  const cardSource = extractFunction('MonitorSessionCard')
  assert.match(source, /function MonitorCardModelPicker\(/, 'card header mounts an inline model picker')
  assert.match(cardSource, /MonitorCardModelPicker/, 'cards include the model picker')

  const dialogSource = extractFunction('MonitorNewSessionDialog')
  assert.match(source, /SelectContent,/, 'monitor create form uses the public SDK select')
  assert.match(source, /Textarea,/, 'monitor create form uses the public SDK textarea')
  assert.match(source, /function MonitorNewSessionDialog\(/, 'new-session dialog exists')
  assert.match(dialogSource, /fetchMonitorModelOptions\(selectedProject\)/, 'changing the owner loads that gateway/profile model catalog')
  assert.match(dialogSource, /normalizeMonitorModelOptions\(modelQuery\.data\)/, 'model picker is seeded from the gateway response')
  assert.match(dialogSource, /accept: MONITOR_IMAGE_ACCEPT/, 'file picker accepts supported image formats')
  assert.match(dialogSource, /multiple: true/, 'the first turn can carry multiple images')
  assert.match(dialogSource, /createMonitorSession\(/, 'dialog submit uses the verified create/attach/prompt transaction')
  assert.match(dialogSource, /children: '网关'/, 'dialog labels the gateway selector')
  assert.match(dialogSource, /children: '项目'/, 'dialog labels the project selector')
  assert.match(dialogSource, /children: '模型'/, 'dialog labels the model selector')
  assert.match(dialogSource, /children: '首条指令'/, 'dialog labels the first prompt field')
  assert.doesNotMatch(dialogSource, /window\.hermesDesktop|host\.newChat|ctx\.(?:rest|socket)/, 'dialog stays on browser FileReader plus public routed gateway calls')

  const monitorPageSource = extractFunction('SessionMonitorPage')
  assert.match(monitorPageSource, /'aria-label': '在监控室新建会话'/, 'monitor header exposes the create action')
  assert.match(monitorPageSource, /MonitorNewSessionDialog/, 'monitor owns the create dialog lifecycle')
  assert.match(monitorPageSource, /sessionsQuery.refetch\(\)/, 'successful creation refreshes the wall candidates')

  const connectSource = extractFunction('connectMobileBridge')
  const subscribeSource = extractFunction('subscribeGatewaySessionEvents')
  assert.match(source, /async function pushMobileTranscript\(/, 'desktop bridge owns a transcript pusher')
assert.match(extractFunction('pushMobileTranscript'), /resolveMobileMessageImages/, 'mobile transcript images must be inlined, not raw disk paths')
assert.match(source, /function resolveMobileImageSrc\(/, 'desktop converts local image paths before the phone sees them')
assert.match(source, /readFileDataUrl/, 'local images are read through the Desktop file bridge')
  assert.match(connectSource, /pushMobileTranscript\(/, 'send_prompt must push the live transcript back to mobile')
  assert.match(connectSource, /msg.type === 'set_model'/, 'mobile can switch the focused session model')
  assert.match(connectSource, /msg.type === 'get_models'/, 'mobile can load the gateway model catalog')
  assert.match(connectSource, /msg.type === 'get_earlier_messages'/, 'mobile can load earlier historical messages')
  assert.match(source, /function pushEarlierMobileTranscript\(/, 'desktop pushes earlier historical messages on demand')
  assert.match(source, /mode: 'tail'|mode: 'full'/, 'desktop distinguishes tail streaming pushes from full snapshot pushes')
  assert.match(connectSource, /msg\.images/, 'mobile send_prompt forwards image attachments')
  assert.match(subscribeSource, /scheduleMobileTranscriptPush\(/, 'gateway events must push the focused session transcript to mobile')
  assert.doesNotMatch(subscribeSource, /syncMobileBridgeSnapshot\(\)/, 'message events must not flood the phone with session-list snapshots')
  assert.match(source, /tool\.start/, 'mobile live timeline follows tool calls')
  assert.match(source, /thinking\.delta/, 'mobile live timeline follows thinking')
  assert.ok(source.includes('ws://127.0.0.1:9999/ws?client=desktop'), 'desktop bridge prefers the fixed LAN relay')

  console.log('overlook monitor new-session contract passed')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
