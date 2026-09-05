/**
 * Overlook — appearance and cross-gateway session panel plugin for Hermes Desktop.
 *
 * Adds a small cross-gateway session rail while keeping Hermes's existing
 * workflow and applies the Cold White visual system through the Desktop Plugin
 * SDK:
 *
 *   - sidebar, title bar, and status chrome: paper gray
 *   - conversation, assistant messages, dialogs, and composer: pure white
 *
 * The Overlook pane is a genuine `area: 'panes'` contribution. It
 * aggregates credential-free profile routes, reads each source's persisted
 * sessions through the owning connection, and opens a row with that exact
 * route. The pane is intentionally separate from Hermes's native $sessions
 * tree; no React-owned sidebar nodes are mutated.
 *   - user message bubble: cool paper gray
 *   - code blocks: graphite; inline code: pale zinc
 *   - message/composer column: 46rem (~736px), centered in the main pane
 *   - composer: keeps Hermes's measured empty/text/attachment heights, with a
 *     rounded surface and a soft floating shadow
 *   - user bubbles: content-sized, right-aligned, and capped at 70% of column
 *
 * The element-level token bridge is needed because the current Hermes stylesheet
 * declares composer and code-card variables on their own elements. It touches
 * stable public data-slot hooks and restores every inline value when the plugin
 * is disabled or reloaded. Hermes core files are not modified.
 *
 * The Overlook pane uses only credential-free route metadata plus the
 * SDK's source-scoped session read/open methods. It never persists or displays
 * endpoints, tokens, passwords, or other connection secrets. Gateway data stays
 * on `host.request` / `host.onEvent`; there is no `plugin_api.py` because that
 * backend is a local-gateway HTTP namespace, not a cross-gateway session bus.
 *
 * Extra SDK surfaces on top of the pane:
 *   - ⌘K palette: refresh sessions, apply Hermes Cold White
 *   - rebindable keybind: mod+alt+g refreshes the same query
 *   - status-bar chip: unread / failed-source count, click to refresh
 *
 * Save location:
 *   <HERMES_HOME>/desktop-plugins/overlook/plugin.js
 *
 * Plain ESM: loaded uncompiled; UI uses jsx() calls rather than JSX syntax.
 * The only imports are the SDK, React, and React's supported JSX runtime.
 */

import {
  atom,
  Button,
  cn,
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  GlyphSpinner,
  host,
  Input,
  KEYBINDS_AREA,
  PALETTE_AREA,
  queryClient as pluginQueryClient,
  relativeTime,
  ROUTES_AREA,
  RowButton,
  requestTheme,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SessionStatusDot,
  STATUSBAR_AREAS,
  Streamdown,
  THEMES_AREA,
  Textarea,
  Tip,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'overlook'
const THEME_NAME = 'hermes-cold-white'
const THEME_REVISION = 18
const MESSAGE_COLUMN_WIDTH = '46rem'
const USER_MESSAGE_MAX_WIDTH = '70%'
const COMPOSER_RADIUS = '1.25rem'
const USER_MESSAGE_RADIUS = '1.125rem'
const COMPOSER_SHADOW =
  '0 0 0 1px rgba(13, 28, 47, 0.05), 0 0.25rem 0.75rem rgba(13, 28, 47, 0.045), 0 0.875rem 2rem rgba(13, 28, 47, 0.06)'
const MODERN_ICON_STROKE = '1.8'
const GATEWAY_SESSIONS_KEY = ['overlook', 'gateway-sessions']
const MONITOR_ROUTE = '/overlook/monitor'
const MONITOR_QUERY_KEY = ['overlook', 'session-monitor']
const MONITOR_TRANSCRIPT_LIMIT = 120
const MONITOR_REFRESH_MS = 2_000
const MONITOR_LAYOUTS = ['tile', 'compact', 'list']
const MONITOR_KEY_LIST_MAX = 200
const MONITOR_IMAGE_MAX_BYTES = 25 * 1024 * 1024
const MONITOR_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'
const MONITOR_IMAGE_MIME_BY_EXTENSION = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}
const EXTERNAL_SESSION_SOURCES = new Set([
  'telegram', 'discord', 'slack', 'mattermost', 'matrix', 'signal', 'whatsapp',
  'bluebubbles', 'photon', 'homeassistant', 'email', 'sms', 'webhook', 'api_server',
  'weixin', 'wecom', 'qqbot', 'yuanbao', 'dingtalk', 'feishu'
])
const GATEWAY_SESSIONS_LIMIT = 80
const GATEWAY_SESSIONS_LIMIT_MAX = 500
// Do not poll gateway/profile state from a sidebar contribution. The public
// profileRoutes() API refreshes the host's profile roster, and a poll can make a
// reconnect/re-home visible in the main chat while the user is typing. Refresh
// remains available through the explicit button; discovery is cached below.
const GATEWAY_SESSIONS_REFRESH_MS = false
const GATEWAY_ROUTE_CACHE_MS = 10 * 60_000
const GATEWAY_PROJECT_TREE_CACHE_MS = 10 * 60_000
const HIDE_SCHEDULED_SESSIONS_DEFAULT = true
const PROFILE_SCOPE_DEFAULT = 'default'
const PROFILE_SCOPE_ALL = '__all_profiles__'
const HOME_PROJECT_KEY = '__no_project__'
const HOME_PROJECT_LABEL = '主页'
const GATEWAY_SESSIONS_PREFS_KEY = 'gateway-sessions-preferences-v1'
const GATEWAY_VIRTUALIZE_THRESHOLD = 120
const GATEWAY_VIRTUAL_OVERSCAN = 8
const PROJECT_SESSION_PREVIEW_LIMIT = 5
const SESSION_FRESHNESS_EVENT_TYPES = new Set([
  'message.complete',
  'message.start',
  'session.info',
  'session.reclaimed',
  'session.title',
  'sessions.changed'
])
const MOBILE_TRANSCRIPT_EVENT_TYPES = new Set([
  'message.start',
  'message.delta',
  'message.interim',
  'message.complete',
  'thinking.delta',
  'reasoning.delta',
  'reasoning.available',
  'tool.start',
  'tool.progress',
  'tool.complete',
  'status.update',
  'todo.updated'
])
const MOBILE_ACTIVITY_EVENT_TYPES = new Set([
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.thinking',
  'subagent.tool',
  'subagent.progress',
  'subagent.complete',
  'todo.updated',
  'tool.start',
  'tool.progress',
  'tool.complete',
  'message.complete'
])
const MOBILE_BACKGROUND_REFRESH_EVENT_TYPES = new Set([
  'tool.complete',
  'message.complete'
])
const MOBILE_ACTIVITY_TERMINAL_LINGER_MS = 8_000
const MOBILE_BACKGROUND_POLL_MS = 5_000
const MOBILE_SNAPSHOT_EVENT_TYPES = new Set([
  'sessions.changed',
  'session.title',
  'session.info',
  'session.reclaimed'
])
const PATCHABLE_SESSION_EVENT_TYPES = new Set(['message.complete', 'message.start'])
const GATEWAY_EVENT_REFRESH_DEBOUNCE_MS = 900
const RECENT_SESSION_WINDOW_MS = 24 * 60 * 60_000
const DEFAULT_GATEWAY_SESSION_PREFERENCES = {
  collapsedKeys: [],
  hideScheduled: HIDE_SCHEDULED_SESSIONS_DEFAULT,
  monitorHiddenKeys: [],
  monitorLayout: 'tile',
  monitorParkedKeys: [],
  pinnedProjectKeys: [],
  profileScope: PROFILE_SCOPE_DEFAULT,
  projectAppearance: {},
  search: ''
}

// Set by register() and cleared on dispose. The pane receives this namespace
// explicitly, but the fallback keeps hot-reload/remount paths harmless when an
// older Desktop host renders a contribution one tick after registration.
let gatewaySessionStorage = null
let gatewaySessionStorageOwner = null
let monitorWorkspaceClose = null
let mobileBridgeWs = null
let mobileBridgeTimer = null
let mobileWatchedSessionIds = new Set()
const mobileRuntimeToStored = new Map()
const mobileStoredToRuntime = new Map()
const mobileBusyByStoredId = new Map()
const mobileTurnCompleteTimers = new Map()
const lastSentTranscriptBySession = new Map()
const inflightUserPromptBySession = new Map()
const mobileActivityByStoredId = new Map()
const mobileActivityExpiryTimers = new Map()
const mobileBackgroundPollTimers = new Map()
const mobileBackgroundRefreshInFlight = new Set()

function rememberMobileSessionRuntime(storedId, runtimeId) {
  const stored = String(storedId || '').trim()
  const runtime = String(runtimeId || '').trim()
  if (!stored || !runtime || stored === runtime) return
  mobileRuntimeToStored.set(runtime, stored)
  mobileStoredToRuntime.set(stored, runtime)
  mobileRuntimeToStored.set(stored, stored)
}

function canonicalMobileSessionId(sessionId) {
  const id = String(sessionId || '').trim()
  if (!id) return ''
  return mobileRuntimeToStored.get(id) || id
}

function collectMobileBusyByStored() {
  const map = {}
  for (const [id, busy] of mobileBusyByStoredId) {
    if (busy) map[id] = true
  }
  try {
    const raw = host?.state?.busyBySession?.get?.()
    if (raw && typeof raw === 'object') {
      for (const [runtimeId, busy] of Object.entries(raw)) {
        if (!busy) continue
        const stored = canonicalMobileSessionId(runtimeId)
        if (stored) map[stored] = true
      }
    }
  } catch {}
  return map
}

function pushMobileBusyUpdate(sessionId) {
  if (!mobileBridgeWs || mobileBridgeWs.readyState !== WebSocket.OPEN) return
  const busyBySession = collectMobileBusyByStored()
  const id = canonicalMobileSessionId(sessionId)
  mobileBridgeWs.send(JSON.stringify({
    type: 'busy_update',
    sessionId: id || '',
    busy: Boolean(id && busyBySession[id]),
    busyBySession
  }))
}

function markMobileSessionBusy(sessionId, busy) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return
  const next = Boolean(busy)
  if (mobileBusyByStoredId.get(id) === next) return
  mobileBusyByStoredId.set(id, next)
  pushMobileBusyUpdate(id)
  scheduleMobileBridgeSnapshot()
}

function noteMobileTurnActivity(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return
  const timer = mobileTurnCompleteTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    mobileTurnCompleteTimers.delete(id)
  }
  markMobileSessionBusy(id, true)
}

function noteMobileTurnComplete(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return
  inflightUserPromptBySession.delete(id)
  const prev = mobileTurnCompleteTimers.get(id)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    mobileTurnCompleteTimers.delete(id)
    markMobileSessionBusy(id, false)
    const queue = $monitorMessageQueueBySession.get()[id] || []
    if (queue.length > 0) {
      void autoFlushNextQueuedPrompt(id)
    }
  }, 600)
  mobileTurnCompleteTimers.set(id, timer)
}

function mobileEventSessionId(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null
  const raw = String(
    payload?.stored_session_id
    || event?.stored_session_id
    || event?.session_id
    || event?.sessionId
    || payload?.session_id
    || payload?.sessionId
    || ''
  ).trim()
  return canonicalMobileSessionId(raw)
}

function mobileActivityState(value, fallback = 'running') {
  const status = String(value || '').trim().toLowerCase()
  if (['failed', 'error', 'timeout', 'interrupted', 'cancelled', 'canceled'].includes(status)) return 'failed'
  if (['completed', 'complete', 'done', 'exited', 'success'].includes(status)) return 'done'
  if (['queued', 'pending', 'waiting'].includes(status)) return 'queued'
  return status === 'running' || status === 'active' || status === 'in_progress' ? 'running' : fallback
}

function mobileActivityText(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function mobileActivityBucket(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return null
  let bucket = mobileActivityByStoredId.get(id)
  if (!bucket) {
    bucket = new Map()
    mobileActivityByStoredId.set(id, bucket)
  }
  return bucket
}

function mobileActivityItems(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  const bucket = id ? mobileActivityByStoredId.get(id) : null
  if (!bucket) return []
  const now = Date.now()
  for (const [key, item] of bucket) {
    if (item.expiresAt && item.expiresAt <= now) bucket.delete(key)
  }
  if (!bucket.size) {
    mobileActivityByStoredId.delete(id)
    return []
  }
  const rank = { todo: 0, subagent: 1, background: 2 }
  return [...bucket.values()]
    .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || Number(a.updatedAt || 0) - Number(b.updatedAt || 0))
    .slice(0, 12)
    .map(({ expiresAt, ...item }) => item)
}

function scheduleMobileActivityExpiry(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return
  const prior = mobileActivityExpiryTimers.get(id)
  if (prior) clearTimeout(prior)
  mobileActivityExpiryTimers.delete(id)
  const bucket = mobileActivityByStoredId.get(id)
  if (!bucket) return
  const now = Date.now()
  let nextExpiry = 0
  for (const item of bucket.values()) {
    const expiry = Number(item.expiresAt) || 0
    if (expiry > now && (!nextExpiry || expiry < nextExpiry)) nextExpiry = expiry
  }
  if (!nextExpiry) return
  const timer = setTimeout(() => {
    mobileActivityExpiryTimers.delete(id)
    mobileActivityItems(id)
    pushMobileActivityUpdate(id)
    scheduleMobileActivityExpiry(id)
  }, Math.max(0, nextExpiry - now) + 25)
  mobileActivityExpiryTimers.set(id, timer)
}

function pushMobileActivityUpdate(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id || !mobileWatchedSessionIds.has(id) || !mobileBridgeWs || mobileBridgeWs.readyState !== WebSocket.OPEN) return
  mobileBridgeWs.send(JSON.stringify({
    type: 'activity_update',
    sessionId: id,
    items: mobileActivityItems(id)
  }))
}

function writeMobileActivityItems(sessionId, kind, nextItems) {
  const id = canonicalMobileSessionId(sessionId)
  const bucket = mobileActivityBucket(id)
  if (!bucket) return
  const now = Date.now()
  const incoming = new Map()
  for (const raw of Array.isArray(nextItems) ? nextItems : []) {
    const itemId = mobileActivityText(raw?.id, 120)
    const title = mobileActivityText(raw?.title, 180)
    if (!itemId || !title) continue
    const state = mobileActivityState(raw?.state)
    const details = raw?.fullCommand || raw?.output || raw?.detail || title || ''
    incoming.set(`${kind}:${itemId}`, {
      detail: mobileActivityText(raw?.detail, 120),
      id: itemId,
      kind,
      state,
      title,
      fullCommand: raw?.fullCommand,
      output: raw?.output,
      details,
      updatedAt: now,
      ...(state === 'done' || state === 'failed' ? { expiresAt: now + MOBILE_ACTIVITY_TERMINAL_LINGER_MS } : {})
    })
  }
  for (const key of [...bucket.keys()]) {
    if (key.startsWith(`${kind}:`) && !incoming.has(key)) bucket.delete(key)
  }
  for (const [key, item] of incoming) bucket.set(key, item)
  if (!bucket.size) mobileActivityByStoredId.delete(id)
  pushMobileActivityUpdate(id)
  scheduleMobileActivityExpiry(id)
}

function upsertMobileActivityItem(sessionId, raw) {
  const id = canonicalMobileSessionId(sessionId)
  const kind = String(raw?.kind || '').trim()
  const itemId = mobileActivityText(raw?.id, 120)
  const title = mobileActivityText(raw?.title, 180)
  if (!id || !kind || !itemId || !title) return
  const bucket = mobileActivityBucket(id)
  if (!bucket) return
  const now = Date.now()
  const state = mobileActivityState(raw?.state)
  const key = `${kind}:${itemId}`
  const previous = bucket.get(key)
  bucket.set(key, {
    ...previous,
    detail: mobileActivityText(raw?.detail, 120),
    id: itemId,
    kind,
    state,
    title,
    updatedAt: now,
    ...(state === 'done' || state === 'failed' ? { expiresAt: now + MOBILE_ACTIVITY_TERMINAL_LINGER_MS } : { expiresAt: undefined })
  })
  pushMobileActivityUpdate(id)
  scheduleMobileActivityExpiry(id)
}

function mobileEventPayload(event) {
  const payload = event?.payload
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
}

function mobileSubagentActivity(event) {
  const payload = mobileEventPayload(event)
  const eventType = String(event?.type || '')
  const index = Math.max(0, Number(payload.task_index) || 0)
  const id = mobileActivityText(payload.subagent_id || `${payload.delegation_id || 'task'}:${index}`, 120)
  const terminal = eventType === 'subagent.complete'
  const state = mobileActivityState(payload.status, terminal ? 'done' : 'running')
  const detail = terminal
    ? (state === 'failed' ? '未完成' : '已完成')
    : mobileActivityText(payload.tool_name || payload.tool_preview || (eventType === 'subagent.thinking' ? '思考中' : '运行中'), 120)
  return {
    id,
    kind: 'subagent',
    state,
    title: mobileActivityText(payload.goal || `子代理 ${index + 1}`, 180),
    detail
  }
}

function mobileTodoActivities(event) {
  const payload = mobileEventPayload(event)
  let source = payload.todos ?? payload.result
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = [] }
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) source = source.todos
  if (!Array.isArray(source)) return []
  return source.slice(0, 12).map((todo, index) => ({
    id: mobileActivityText(todo?.id || `todo-${index}`, 120),
    kind: 'todo',
    state: mobileActivityState(todo?.status, 'running'),
    title: mobileActivityText(todo?.content || todo?.title || todo?.text || `任务 ${index + 1}`, 180),
    detail: ''
  }))
}

function applyMobileActivityEvent(event, sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id || !mobileWatchedSessionIds.has(id)) return
  const type = String(event?.type || '')
  if (type.startsWith('subagent.')) {
    upsertMobileActivityItem(id, mobileSubagentActivity(event))
  } else if (type === 'todo.updated') {
    writeMobileActivityItems(id, 'todo', mobileTodoActivities(event))
  }
  if (MOBILE_BACKGROUND_REFRESH_EVENT_TYPES.has(type)) scheduleMobileBackgroundRefresh(id, 1500)
}

function scheduleMobileBackgroundRefresh(sessionId, delay = MOBILE_BACKGROUND_POLL_MS) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id || !mobileWatchedSessionIds.has(id)) return
  const prior = mobileBackgroundPollTimers.get(id)
  if (prior) clearTimeout(prior)
  const timer = setTimeout(() => {
    mobileBackgroundPollTimers.delete(id)
    void refreshMobileBackgroundActivity(id)
  }, Math.max(0, Number(delay) || 0))
  mobileBackgroundPollTimers.set(id, timer)
}

function extractLiveDomBackgroundActivities() {
  if (typeof document === 'undefined') return []
  const stack = document.querySelector("[data-slot='composer-status-stack']")
  if (!stack) return []
  const items = []
  const rows = stack.querySelectorAll('.group\\/status-row')
  rows.forEach((row, idx) => {
    const textEl = row.querySelector('.truncate.leading-4') || row
    const fullText = (textEl.getAttribute('title') || textEl.textContent || '').trim()
    if (fullText) {
      const isFailed = row.querySelector('.text-destructive') !== null
      const isDone = row.querySelector('.text-emerald-500') !== null
      const state = isFailed ? 'failed' : (isDone ? 'done' : 'running')
      const firstLine = fullText.split('\n')[0].trim()
      items.push({
        id: `dom-task-${idx}`,
        kind: 'background',
        state,
        title: firstLine || '后台任务',
        detail: fullText !== firstLine ? fullText : '',
        fullCommand: fullText,
        details: fullText
      })
    }
  })
  return items
}

async function refreshMobileBackgroundActivity(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id || !mobileWatchedSessionIds.has(id) || mobileBackgroundRefreshInFlight.has(id)) return
  mobileBackgroundRefreshInFlight.add(id)
  let release = null
  try {
    const domTasks = extractLiveDomBackgroundActivities()
    if (domTasks.length > 0) {
      writeMobileActivityItems(id, 'background', domTasks)
      scheduleMobileBackgroundRefresh(id)
      return
    }

    const target = await resolveTargetSession(id)
    if (!target || typeof host.requestProfile !== 'function') return
    if (typeof host.retainProfile === 'function') release = await host.retainProfile(target.project.route)
    let runtimeId = mobileStoredToRuntime.get(id)
    if (!runtimeId || runtimeId === id) {
      try {
        runtimeId = await resolveMonitorRuntimeSessionId(target.project.route, target.session.id)
      } catch {}
    }
    if (!runtimeId || runtimeId === id) return
    rememberMobileSessionRuntime(target.session.id, runtimeId)
    const response = await host.requestProfile(target.project.route, 'process.list', { session_id: runtimeId })
    const processes = Array.isArray(response?.processes)
      ? response.processes
      : (Array.isArray(response?.result?.processes) ? response.result.processes : [])
    const items = processes.map((process, index) => {
      const command = String(process?.command || '').trim()
      const firstLine = command.split('\n')[0].trim()
      return {
        id: mobileActivityText(process?.session_id || `process-${index}`, 120),
        kind: 'background',
        state: mobileActivityState(process?.status, 'running'),
        title: firstLine || command || '后台任务',
        detail: mobileActivityText(
          process?.status === 'running'
            ? `运行 ${Math.max(0, Number(process?.uptime_seconds) || 0)} 秒`
            : (Number.isFinite(Number(process?.exit_code)) && Number(process.exit_code) !== 0 ? `退出码 ${process.exit_code}` : '已结束'),
          120
        ),
        fullCommand: command || undefined,
        output: typeof process?.output_tail === 'string' ? process.output_tail : undefined
      }
    })
    writeMobileActivityItems(id, 'background', items)
    if (items.some(item => item.state === 'running' || item.state === 'queued')) {
      scheduleMobileBackgroundRefresh(id)
    }
  } catch {
    // A transient or old-gateway process.list failure must not erase a live row.
  } finally {
    mobileBackgroundRefreshInFlight.delete(id)
    try { release?.() } catch {}
  }
}

async function stopMobileBackgroundActivity(sessionId, processId) {
  const id = canonicalMobileSessionId(sessionId)
  const target = await resolveTargetSession(id)
  const process = mobileActivityText(processId, 120)
  if (!id || !process || !target || typeof host.requestProfile !== 'function') return
  const runtimeId = mobileStoredToRuntime.get(id)
    || await resolveMonitorRuntimeSessionId(target.project.route, target.session.id)
  await host.requestProfile(target.project.route, 'process.kill', { process_id: process, session_id: runtimeId })
  await refreshMobileBackgroundActivity(id)
}

function resolveMobileImageSrc(path) {
  const raw = String(path || '').trim()
  if (!raw) return Promise.resolve('')
  if (/^(?:data:|https?:)/i.test(raw)) return Promise.resolve(raw)
  if (!resolveMobileImageSrc.cache) resolveMobileImageSrc.cache = new Map()
  if (resolveMobileImageSrc.cache.has(raw)) return Promise.resolve(resolveMobileImageSrc.cache.get(raw) || '')
  const read = typeof window !== 'undefined' ? window.hermesDesktop?.readFileDataUrl : null
  if (typeof read !== 'function') {
    resolveMobileImageSrc.cache.set(raw, '')
    return Promise.resolve('')
  }
  return Promise.resolve(read(raw)).then(url => {
    const src = /^(?:data:|https?:)/i.test(String(url || '').trim()) ? String(url).trim() : ''
    resolveMobileImageSrc.cache.set(raw, src)
    if (resolveMobileImageSrc.cache.size > 48) {
      const first = resolveMobileImageSrc.cache.keys().next().value
      resolveMobileImageSrc.cache.delete(first)
    }
    return src
  }).catch(() => {
    resolveMobileImageSrc.cache.set(raw, '')
    return ''
  })
}

async function resolveMobileMessageImages(paths) {
  const list = Array.isArray(paths) ? paths : []
  const out = []
  for (const path of list) {
    const src = await resolveMobileImageSrc(path)
    if (src) out.push(src)
  }
  return out
}

async function pushMobileTranscript(sessionId, options) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id || !mobileBridgeWs || mobileBridgeWs.readyState !== WebSocket.OPEN) return
  const target = await resolveTargetSession(id)
  if (!target) return
  if (target.session?.runtime_id && target.session.runtime_id !== target.session.id) {
    rememberMobileSessionRuntime(target.session.id, target.session.runtime_id)
  }
  const storedId = String(target.session.id || id).trim()
  const raw = await fetchMonitorTranscript(target.project, target.session, options)
  const inflight = inflightUserPromptBySession.get(storedId)
  if (inflight && inflight.prompt && Array.isArray(raw)) {
    const hasPrompt = raw.some(r => r.role === 'user' && (r.content === inflight.prompt || r.text === inflight.prompt))
    if (!hasPrompt) {
      raw.push({
        id: `inflight-${storedId}-${inflight.timestamp}`,
        role: 'user',
        content: inflight.prompt,
        text: inflight.prompt,
        timestamp: Math.floor(inflight.timestamp / 1000)
      })
    } else {
      inflightUserPromptBySession.delete(storedId)
    }
  }
  const limit = options?.limit || 60
  const msgs = monitorMobileMessages({ messages: raw }, target.session, limit)
  const messages = []
  for (const m of msgs) {
    const parsed = extractMonitorMessageImages(m.text)
    messages.push({
      role: m.role || m.message?.role || 'assistant',
      kind: m.kind || m.role || m.message?.role || 'assistant',
      tool: m.tool || '',
      text: parsed.cleanedText || m.text,
      images: await resolveMobileMessageImages(parsed.imagePaths)
    })
  }

  const prev = lastSentTranscriptBySession.get(storedId)
  if (!options && Array.isArray(prev) && prev.length > 0 && messages.length >= prev.length) {
    let diffIndex = -1
    for (let i = 0; i < messages.length; i++) {
      const a = messages[i]
      const b = prev[i]
      if (!b || a.text !== b.text || a.kind !== b.kind || a.tool !== b.tool || a.role !== b.role || (a.images?.length || 0) !== (b.images?.length || 0)) {
        diffIndex = i
        break
      }
    }
    if (diffIndex >= 0 && diffIndex >= messages.length - 8) {
      lastSentTranscriptBySession.set(storedId, messages)
      mobileBridgeWs.send(JSON.stringify({
        type: 'transcript_update',
        sessionId: storedId,
        mode: 'tail',
        startIndex: diffIndex,
        messages: messages.slice(diffIndex),
        totalCount: messages.length
      }))
      return
    }
  }

  lastSentTranscriptBySession.set(storedId, messages)
  mobileBridgeWs.send(JSON.stringify({
    type: 'transcript_update',
    sessionId: storedId,
    mode: 'full',
    messages,
    totalCount: messages.length,
    hasMore: raw.length >= limit
  }))
}

async function pushEarlierMobileTranscript(sessionId, offset, limit) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id || !mobileBridgeWs || mobileBridgeWs.readyState !== WebSocket.OPEN) return
  const target = await resolveTargetSession(id)
  if (!target) return
  const storedId = String(target.session.id || id).trim()
  const raw = await fetchMonitorTranscript(target.project, target.session, { offset, limit, order: 'latest' })
  const msgs = monitorMobileMessages({ messages: raw }, target.session, limit, { isEarlier: true })
  const messages = []
  for (const m of msgs) {
    const parsed = extractMonitorMessageImages(m.text)
    messages.push({
      role: m.role || m.message?.role || 'assistant',
      kind: m.kind || m.role || m.message?.role || 'assistant',
      tool: m.tool || '',
      text: parsed.cleanedText || m.text,
      images: await resolveMobileMessageImages(parsed.imagePaths)
    })
  }
  mobileBridgeWs.send(JSON.stringify({
    type: 'transcript_update',
    sessionId: storedId,
    mode: 'prepend',
    offset,
    hasMore: raw.length >= limit,
    messages
  }))
}

function scheduleMobileTranscriptPush(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return
  if (scheduleMobileTranscriptPush.timers?.has(id)) return
  if (!scheduleMobileTranscriptPush.timers) scheduleMobileTranscriptPush.timers = new Map()
  const timer = setTimeout(() => {
    scheduleMobileTranscriptPush.timers.delete(id)
    void pushMobileTranscript(id)
  }, 120)
  scheduleMobileTranscriptPush.timers.set(id, timer)
}

async function autoFlushNextQueuedPrompt(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  if (!id) return
  const currentAll = $monitorMessageQueueBySession.get()
  const queue = currentAll[id] || []
  if (!queue.length) return
  const first = queue[0]
  const target = await resolveTargetSession(id)
  if (!target) return
  $monitorMessageQueueBySession.set({
    ...currentAll,
    [id]: queue.slice(1)
  })
  syncMobileBridgeSnapshot()
  try {
    noteMobileTurnActivity(id)
    if (first.prompt) {
      inflightUserPromptBySession.set(id, {
        prompt: first.prompt,
        images: first.images || [],
        timestamp: Date.now()
      })
    }
    await submitMonitorPrompt({ images: first.images || [], project: target.project, prompt: first.prompt, session: target.session })
    pluginQueryClient?.invalidateQueries?.({ queryKey: [...MONITOR_QUERY_KEY, routeKey(target.project.route), target.session.id] })
    pluginQueryClient?.invalidateQueries?.({ queryKey: GATEWAY_SESSIONS_KEY })
    syncMobileBridgeSnapshot()
    await pushMobileTranscript(id)
    scheduleMobileTranscriptPush(id)
  } catch (err) {
    console.error('[Overlook Desktop] Failed to flush queued message:', err)
    noteMobileTurnComplete(id)
  }
}

async function resolveTargetSession(sessionId) {
  const id = canonicalMobileSessionId(sessionId)
  let groups = readCachedGatewaySessionGroups()
  if (!groups.length) {
    try {
      const fetched = await fetchGatewaySessionGroups(PROFILE_SCOPE_ALL, $gatewaySessionLimit.get())
      if (fetched?.groups?.length) groups = fetched.groups
    } catch {}
  }
  for (const g of (groups || [])) {
    const hit = g.sessions?.find(s => s.id === id || s.id === sessionId || s.session_id === id || s.runtime_id === id)
    if (hit) {
      return { project: { key: g.projectKey || g.key, route: g.route }, session: hit }
    }
    for (const project of projectGroupsForGatewayGroup(g, false)) {
      const pSessions = [...(project.prefetchedSessions || []), ...(project.sessions || [])]
      const pHit = pSessions.find(s => s.id === id || s.id === sessionId || s.session_id === id || s.runtime_id === id)
      if (pHit) {
        return { project: { key: project.key, route: g.route }, session: pHit }
      }
    }
  }
  return null
}
async function resolveMobileBridgeWsUrl() {
  return 'ws://127.0.0.1:9999/ws?client=desktop'
}

async function connectMobileBridge() {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  if (mobileBridgeWs && (mobileBridgeWs.readyState === WebSocket.OPEN || mobileBridgeWs.readyState === WebSocket.CONNECTING)) {
    return
  }
  try {
    const wsUrl = await resolveMobileBridgeWsUrl()
    const ws = new WebSocket(wsUrl)
    mobileBridgeWs = ws

    ws.onopen = () => {
      $mobileBridgeStatus.set(true)
      // 连接建立，立即推送最新会话与队列快照
      syncMobileBridgeSnapshot()
    }

    ws.onmessage = async event => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'send_prompt') {
          const { sessionId, prompt } = msg
          const target = await resolveTargetSession(sessionId)
          if (target) {
            const incoming = Array.isArray(msg.images) ? msg.images : []
            if (msg.audio && msg.audio.dataUrl) incoming.push(msg.audio)
            const images = incoming.filter(item => /^data:image\//i.test(String(item?.dataUrl || '')))
            const extras = incoming.filter(item => !/^data:image\//i.test(String(item?.dataUrl || '')))
            const text = [String(prompt || '').trim(), ...extras.map(item => `[附件: ${item.name || 'file'}]`)].filter(Boolean).join('\n')
            noteMobileTurnActivity(sessionId)
            if (prompt) {
              inflightUserPromptBySession.set(sessionId, {
                prompt,
                images: incoming,
                timestamp: Date.now()
              })
            }
            await submitMonitorPrompt({ images, project: target.project, prompt: text, session: target.session })
            pluginQueryClient?.invalidateQueries?.({ queryKey: [...MONITOR_QUERY_KEY, routeKey(target.project.route), target.session.id] })
            pluginQueryClient?.invalidateQueries?.({ queryKey: GATEWAY_SESSIONS_KEY })
            await pushMobileTranscript(sessionId)
            scheduleMobileTranscriptPush(sessionId)
          }
        } else if (msg.type === 'stop_task') {
          const { sessionId } = msg
          const target = await resolveTargetSession(sessionId)
          if (target) {
            await stopMonitorSessionTask(target.project, target.session)
            markMobileSessionBusy(sessionId, false)
            pluginQueryClient?.invalidateQueries?.({ queryKey: [...MONITOR_QUERY_KEY, routeKey(target.project.route), target.session.id] })
            await pushMobileTranscript(sessionId)
          }
        } else if (msg.type === 'stop_background_task') {
          const id = canonicalMobileSessionId(msg.sessionId)
          await stopMobileBackgroundActivity(id, msg.processId)
        } else if (msg.type === 'enqueue_prompt') {
          const id = canonicalMobileSessionId(msg.sessionId)
          const { prompt } = msg
          const currentAll = $monitorMessageQueueBySession.get()
          const currentQueue = currentAll[id] || []
          $monitorMessageQueueBySession.set({
            ...currentAll,
            [id]: [
              ...currentQueue,
              {
                id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                images: [],
                prompt,
                queuedAt: Date.now()
              }
            ]
          })
          syncMobileBridgeSnapshot()
        } else if (msg.type === 'send_queue_now') {
          const id = canonicalMobileSessionId(msg.sessionId)
          await autoFlushNextQueuedPrompt(id)
        } else if (msg.type === 'get_transcript') {
          const id = String(msg.sessionId || '').trim()
          if (id) {
            mobileWatchedSessionIds.add(id)
            if (mobileWatchedSessionIds.size > 8) {
              const first = mobileWatchedSessionIds.values().next().value
              mobileWatchedSessionIds.delete(first)
              mobileActivityByStoredId.delete(first)
              const pollTimer = mobileBackgroundPollTimers.get(first)
              if (pollTimer) clearTimeout(pollTimer)
              mobileBackgroundPollTimers.delete(first)
              const expiryTimer = mobileActivityExpiryTimers.get(first)
              if (expiryTimer) clearTimeout(expiryTimer)
              mobileActivityExpiryTimers.delete(first)
            }
            if (!mobileStoredToRuntime.has(id)) {
              try {
                const target = await resolveTargetSession(id)
                if (target) {
                  const runtimeId = await resolveMonitorRuntimeSessionId(target.project.route, id)
                  rememberMobileSessionRuntime(id, runtimeId)
                }
              } catch {}
            }
            await pushMobileTranscript(id)
            pushMobileActivityUpdate(id)
            void refreshMobileBackgroundActivity(id)
          }
        } else if (msg.type === 'get_earlier_messages') {
          const id = canonicalMobileSessionId(msg.sessionId)
          const offset = Math.max(0, Number(msg.offset) || 0)
          const limit = Math.min(100, Math.max(10, Number(msg.limit) || 40))
          await pushEarlierMobileTranscript(id, offset, limit)
        } else if (msg.type === 'get_models') {
          const id = String(msg.sessionId || '').trim()
          const target = await resolveTargetSession(id)
          if (target && mobileBridgeWs?.readyState === WebSocket.OPEN) {
            const catalog = normalizeMonitorModelOptions(await fetchMonitorModelOptions(target.project))
            mobileBridgeWs.send(JSON.stringify({
              type: 'models_update',
              sessionId: id,
              choices: catalog.choices
            }))
          }
        } else if (msg.type === 'set_model') {
          const id = String(msg.sessionId || '').trim()
          const target = await resolveTargetSession(id)
          if (target) {
            await switchMonitorSessionModel(target.project, target.session, {
              model: msg.model,
              provider: msg.provider
            })
            scheduleMobileBridgeSnapshot()
          }
        }
      } catch (err) {
        console.error('[Overlook Desktop] Error handling bridge message:', err)
      }
    }

    ws.onclose = () => {
      mobileBridgeWs = null
      $mobileBridgeStatus.set(false)
      scheduleMobileBridgeReconnect()
    }

    ws.onerror = () => {
      try { ws.close() } catch {}
    }
  } catch {
    scheduleMobileBridgeReconnect()
  }
}

function scheduleMobileBridgeReconnect() {
  if (mobileBridgeTimer) return
  mobileBridgeTimer = setTimeout(() => {
    mobileBridgeTimer = null
    connectMobileBridge()
  }, 5000)
}

async function syncMobileBridgeSnapshot() {
  if (!mobileBridgeWs || mobileBridgeWs.readyState !== WebSocket.OPEN) return
  try {
    let groups = readCachedGatewaySessionGroups()
    if (!groups.length) {
      try {
        const fetched = await fetchGatewaySessionGroups(PROFILE_SCOPE_ALL, $gatewaySessionLimit.get())
        if (fetched?.groups?.length) groups = fetched.groups
      } catch {}
    }
    const payload = buildMobileRailSnapshot(groups, $gatewaySessionPrefs.get(), $monitorMessageQueueBySession.get(), collectMobileBusyByStored())
    mobileBridgeWs.send(JSON.stringify({
      type: 'snapshot',
      payload
    }))
  } catch {}
}

function scheduleMobileBridgeSnapshot() {
  if (scheduleMobileBridgeSnapshot.timer) return
  scheduleMobileBridgeSnapshot.timer = setTimeout(() => {
    scheduleMobileBridgeSnapshot.timer = 0
    void syncMobileBridgeSnapshot()
  }, 2000)
}

function readCachedGatewaySessionGroups() {
  const client = pluginQueryClient
  if (!client?.getQueryData) return []
  const prefs = typeof $gatewaySessionPrefs?.get === 'function' ? $gatewaySessionPrefs.get() : null
  const keys = [
    [...GATEWAY_SESSIONS_KEY, PROFILE_SCOPE_ALL],
    [...GATEWAY_SESSIONS_KEY, prefs?.profileScope || PROFILE_SCOPE_DEFAULT],
    GATEWAY_SESSIONS_KEY
  ]
  for (const key of keys) {
    const groups = client.getQueryData(key)?.groups
    if (Array.isArray(groups) && groups.length) return groups
  }
  const matches = typeof client.getQueriesData === 'function' ? client.getQueriesData({ queryKey: GATEWAY_SESSIONS_KEY }) : []
  for (const entry of matches) {
    const groups = entry?.[1]?.groups
    if (Array.isArray(groups) && groups.length) return groups
  }
  return []
}

function serializeMobileRailSession(session, extra) {
  extra = extra && typeof extra === 'object' ? extra : {}
  const busy = Boolean(
    extra.busy
    || session.is_running
    || session.busy
    || session.status === 'running'
    || session.status === 'working'
  )
  return {
    id: session.id,
    title: sessionRowTitle(session),
    model: String(session.model || '').trim(),
    gateway: extra.gateway || '',
    projectKey: extra.projectKey || '',
    projectLabel: extra.projectLabel || '',
    status: busy ? '执行中' : monitorSessionStatusLabel(session, []),
    busy,
    lastActive: session.last_active || session.updated_at || session.started_at || session.created_at || 0,
    preview: String(session.preview || '').slice(0, 160),
    unread: sessionUnread(session),
    pinned: sessionPinned(session),
    isActive: sessionActive(session),
    runtimeId: String(session.runtime_id || extra.runtimeId || '').trim()
  }
}

function buildMobileRailSnapshot(groups, prefs, queues, busyBySession) {
  prefs = prefs && typeof prefs === 'object' ? prefs : {}
  queues = queues && typeof queues === 'object' ? queues : {}
  busyBySession = busyBySession && typeof busyBySession === 'object' ? busyBySession : {}
  const hideScheduled = prefs.hideScheduled !== false
  const appearance = prefs.projectAppearance && typeof prefs.projectAppearance === 'object' ? prefs.projectAppearance : {}
  const projects = []
  const busyMap = { ...busyBySession }
  for (const group of groups || []) {
    const gateway = String(group.remoteLabel || group.label || '').trim()
    for (const project of projectGroupsForGatewayGroup(group, hideScheduled)) {
      const sessions = normalizeProjectSessions(
        [...(project.prefetchedSessions || []), ...(project.sessions || [])],
        project.profile,
        hideScheduled
      ).map(session => {
        const busy = Boolean(busyMap[session.id] || session.is_running || session.busy)
        if (busy) busyMap[session.id] = true
        return serializeMobileRailSession(session, {
          busy,
          gateway,
          projectKey: project.key,
          projectLabel: projectDisplayLabel(project)
        })
      })
      const custom = projectAppearanceFor(appearance, project.key)
      const icon = isHomeProject(project)
        ? (custom?.icon && PROJECT_APPEARANCE_ICONS.includes(custom.icon) ? custom.icon : 'home')
        : projectIconName(appearance, project.key)
      projects.push({
        key: project.key,
        label: projectDisplayLabel(project),
        gateway,
        icon,
        color: projectIconColor(appearance, project.key) || '',
        lastActive: projectLatestActivity(project),
        sessionCount: Math.max(sessions.length, Number(project.sessionCount) || 0),
        sessions
      })
    }
  }
  projects.sort(compareProjects)
  const pinnedRows = []
  for (const project of projects) {
    const rest = []
    for (const session of project.sessions) {
      if (session.pinned) {
        pinnedRows.push({
          ...session,
          color: project.color,
          projectKey: project.key,
          projectLabel: project.label
        })
      } else {
        rest.push(session)
      }
    }
    project.sessions = rest
  }
  const visible = projects.filter(project => project.sessions.length > 0)
  if (pinnedRows.length) {
    visible.unshift({
      key: '__pinned__',
      label: '置顶',
      gateway: '',
      icon: 'star',
      color: '#ca8a04',
      pinnedSection: true,
      lastActive: pinnedRows[0].lastActive,
      sessionCount: pinnedRows.length,
      sessions: pinnedRows
    })
  }
  return {
    hideScheduled,
    queues,
    busyBySession: busyMap,
    projects: visible,
    monitoredSessions: visible.flatMap(project => project.sessions)
  }
}
const $gatewaySessionLimit = atom(GATEWAY_SESSIONS_LIMIT)
const $gatewaySessionPrefs = atom(DEFAULT_GATEWAY_SESSION_PREFERENCES)
const $gatewayProjectDataRevision = atom(0)
const $monitorMessageQueueBySession = atom({})
const $mobileBridgeStatus = atom(false)
const sessionDataRevision = { current: 0 }

function normalizeStringKeyList(value, max) {
  const limit = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : MONITOR_KEY_LIST_MAX
  const seen = new Set()
  const keys = []
  for (const item of Array.isArray(value) ? value : []) {
    const key = String(item || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
    if (keys.length >= limit) break
  }
  return keys
}

function normalizeMonitorLayout(value) {
  return MONITOR_LAYOUTS.includes(value) ? value : 'tile'
}

function normalizeProjectAppearance(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const result = {}
  for (const [key, entry] of Object.entries(source)) {
    const id = String(key || '').trim()
    if (!id || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const color = typeof entry.color === 'string' && entry.color.trim() ? entry.color.trim() : ''
    const icon = typeof entry.icon === 'string' && entry.icon.trim() ? entry.icon.trim() : ''
    if (!color && !icon) continue
    result[id] = {
      ...(color ? { color } : {}),
      ...(icon ? { icon } : {})
    }
  }
  return result
}

function normalizeGatewaySessionPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : DEFAULT_GATEWAY_SESSION_PREFERENCES
  return {
    collapsedKeys: Array.isArray(source.collapsedKeys) ? source.collapsedKeys : [],
    hideScheduled: typeof source.hideScheduled === 'boolean' ? source.hideScheduled : HIDE_SCHEDULED_SESSIONS_DEFAULT,
    monitorHiddenKeys: normalizeStringKeyList(source.monitorHiddenKeys, MONITOR_KEY_LIST_MAX),
    monitorLayout: normalizeMonitorLayout(source.monitorLayout),
    monitorParkedKeys: normalizeStringKeyList(source.monitorParkedKeys, MONITOR_KEY_LIST_MAX),
    pinnedProjectKeys: Array.isArray(source.pinnedProjectKeys)
      ? source.pinnedProjectKeys.filter(key => typeof key === 'string').map(key => key.trim()).filter(Boolean)
      : [],
    profileScope: source.profileScope === PROFILE_SCOPE_ALL ? PROFILE_SCOPE_ALL : PROFILE_SCOPE_DEFAULT,
    projectAppearance: normalizeProjectAppearance(source.projectAppearance),
    search: typeof source.search === 'string' ? source.search : ''
  }
}

function readGatewaySessionPreferences() {
  const stored = gatewaySessionStorage?.get?.(GATEWAY_SESSIONS_PREFS_KEY, DEFAULT_GATEWAY_SESSION_PREFERENCES)
  return normalizeGatewaySessionPreferences(stored)
}

function writeGatewaySessionPreferences(next) {
  const normalized = normalizeGatewaySessionPreferences(next)
  $gatewaySessionPrefs.set(normalized)
  gatewaySessionStorage?.set?.(GATEWAY_SESSIONS_PREFS_KEY, normalized)
  return normalized
}

const OVERLOOK_THEME = {
  name: THEME_NAME,
  label: 'Hermes Cold White',
  description: '明亮的纸灰工作台，环绕纯白对话区，配以墨色控件和石墨色代码表面。',
  colors: {
    background: '#ffffff',
    foreground: '#0d1c2f',
    card: '#ffffff',
    cardForeground: '#0d1c2f',
    muted: '#f5f5f7',
    mutedForeground: '#68717a',
    popover: '#ffffff',
    popoverForeground: '#0d1c2f',
    primary: '#20262a',
    primaryForeground: '#ffffff',
    secondary: '#f5f5f7',
    secondaryForeground: '#34465e',
    accent: '#ebebed',
    accentForeground: '#0d1c2f',
    border: '#d4d4d8',
    input: '#d4d4d8',
    ring: '#0d1c2f',
    midground: '#0d1c2f',
    midgroundForeground: '#ffffff',
    composerRing: '#20262a',
    destructive: '#b64b4b',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#fbfbfe',
    sidebarBorder: '#d4d4d8',
    userBubble: '#f3f4f5',
    userBubbleBorder: '#d4d4d8'
  },
  typography: {
    fontSans: '"Hanken Grotesk", "Segoe UI", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", "Cascadia Code", Consolas, monospace'
  }
}

// Cold White intentionally exposes one bright palette. Supplying the same
// colors for the host's dark preference prevents Desktop from synthesizing a
// different variant while renderedModeFor keeps the actual window light.
OVERLOOK_THEME.darkColors = OVERLOOK_THEME.colors

// Public semantic tokens already consumed by Hermes Desktop. The theme
// contribution supplies the authored palette; these values remove normal
// translucency/mix rounding so the requested RGB levels are exact.
const LIGHT_ROOT_TOKENS = {
  '--background': '#ffffff',
  '--foreground': '#0d1c2f',
  '--composer-fill': '#ffffff',

  '--dt-background': '#ffffff',
  '--dt-card': '#ffffff',
  '--dt-popover': '#ffffff',
  '--dt-sidebar-bg': '#f5f5f7',
  '--dt-user-bubble': '#f3f4f5',
  '--dt-user-bubble-border': '#d4d4d8',
  '--ui-bg-card': '#ffffff',
  '--ui-bg-chrome': '#f5f5f7',
  // Keep the inherited editor surface white; fenced code cards receive
  // their graphite treatment at the stable [data-slot='code-card'] below.
  '--ui-bg-editor': '#ffffff',
  '--ui-bg-elevated': '#ffffff',
  '--ui-bg-input': '#ffffff',
  '--ui-bg-sidebar': '#fbfbfe',
  '--ui-chat-bubble-background': '#ffffff',
  '--ui-chat-bubble-opaque-background': '#ffffff',
  '--ui-chat-surface-background': '#ffffff',
  '--ui-editor-surface-background': '#ffffff',
  '--ui-inline-code-background': '#ececee',
  '--ui-inline-code-foreground': '#0d1c2f',
  '--ui-sidebar-surface-background': '#fbfbfe',
  '--ui-surface-background': '#fbfbfe',
  '--ui-widget-surface-background': '#ffffff',
  '--ui-stroke-primary': '#c4c4c8',
  '--ui-stroke-secondary': '#d0d0d4',
  '--ui-stroke-tertiary': '#d4d4d8',
  '--ui-stroke-quaternary': '#ececee',
  '--ui-text-quaternary': '#68717a',
  '--ui-control-hover-background': '#ececee',
  '--ui-control-active-background': '#e4e4e7',
  '--ui-row-hover-background': '#ececee',
  '--ui-row-active-background': '#e4e4e7'
}

// Small Lucide/Tabler-like line drawings for the most visible Hermes chrome.
// These path definitions are rendered through CSS masks so React retains
// ownership of every icon node. Unknown or animated Codicons are intentionally
// left alone.
const MODERN_ICON_PATHS = {
  add: ['M5 12h14', 'M12 5v14'],
  'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
  'arrow-swap': ['M7 7h13l-3-3', 'm20 7-3 3', 'M17 17H4l3 3', 'm4 17 3-3'],
  'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
  book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z', 'M4 5.5v16', 'M8 7h8'],
  bug: ['M9 9a3 3 0 0 1 6 0v1a3 3 0 0 1-6 0V9Z', 'M7 11H4', 'M20 11h-3', 'M7 15H4', 'M20 15h-3', 'M8 7 6 5', 'm16 7 2-2', 'M8 18a5 5 0 0 0 8 0'],
  check: ['m5 12 4 4L19 6'],
  'check-all': ['m4 12 3 3 6-6', 'm11 16 2 2 7-7'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-left': ['m15 6-6 6 6 6'],
  'chevron-right': ['m9 6 6 6-6 6'],
  'chevron-up': ['m6 15 6-6 6 6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  cloud: ['M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.1 8.4 4 4 0 0 0 7 18Z'],
  'cloud-download': ['M7 17h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.1 7.4 4 4 0 0 0 7 17Z', 'M12 11v7', 'm9 15 3 3 3-3'],
  comment: ['M20 11.5a8 8 0 0 1-8 8 8.5 8.5 0 0 1-3.2-.6L4 20l1.1-4.3A8 8 0 1 1 20 11.5Z'],
  'comment-discussion': ['M7 16a6 6 0 1 1 5-9 6 6 0 0 1 5 9l1 3-3.2-1.1A6 6 0 0 1 7 16Z', 'M15 7a5 5 0 0 1 5 5 5 5 0 0 1-1 3'],
  diff: ['M5 5h14', 'M5 9h9', 'M5 13h14', 'M5 17h7'],
  code: ['M8 4 3 12l5 8', 'M16 4l5 8-5 8', 'm14 3-4 18'],
  'arrow-left': ['M19 12H5', 'm12 19-7-7 7-7'],
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-small-right': ['M5 12h14', 'm13 6 6 6-6 6'],
  'file-code': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z', 'M14 2v6h6', 'm10 13-2 2 2 2', 'm14 13 2 2-2 2'],
  'file-binary': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z', 'M14 2v6h6', 'M8 13h2', 'M14 13h2', 'M8 17h2', 'M14 17h2'],
  'file-text': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6'],
  'folder': ['M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z'],
  'ellipsis': ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  'external-link': ['M14 5h5v5', 'm19 5-8 8', 'M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
  files: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6'],
  'filter': ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  'folder-opened': ['M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 1.9 2.6l-1.7 6A2 2 0 0 1 17.2 17H5a2 2 0 0 1-1.9-2.6L5 9'],
  'git-branch': ['M6 3v12a3 3 0 1 0 3 3', 'M18 3v6a3 3 0 0 1-3 3H9', 'M6 6h.01', 'M18 6h.01'],
  home: ['m3 11 9-8 9 8', 'M5 10v10h14V10', 'M9 20v-6h6v6'],
  info: ['M12 10v6', 'M12 7h.01', 'M5 21h14a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.3 18A2 2 0 0 0 5 21Z'],
  layout: ['M4 4h16v16H4Z', 'M4 10h16', 'M10 10v10'],
  'layout-sidebar-left': ['M4 4h16v16H4Z', 'M9 4v16'],
  'layout-sidebar-right': ['M4 4h16v16H4Z', 'M15 4v16'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  'list-filter': ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  'list-unordered': ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  'settings-gear': ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.5v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8.6 15a1.7 1.7 0 0 0-1.5-1H7v-2.5h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.5v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z'],
  mic: ['M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3', 'M8 21h8'],
  monitor: ['M4 5h16v11H4Z', 'M8 20h8', 'M12 16v4'],
  package: ['m16.5 9.4 3.5-2', 'M12 22V12', 'm3.5 7.6 8.5 4.9 8.5-4.9V6.4L12 2 3.5 6.4v11.2Z', 'm3.5 6.4 8.5 4.9 8.5-4.9'],
  palette: ['M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10h-4Z', 'M7 10h.01', 'M9 6h.01', 'M14 6h.01'],
  person: ['M19 21a7 7 0 0 0-14 0', 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  pin: ['m12 17 5 4-1.7-6.3L20 11l-5-.4L12 5l-3 5.6-5 .4 4.7 3.7L7 21l5-4Z'],
  play: ['m8 5 11 7-11 7V5Z'],
  project: ['M4 5h6l2 2h8v12H4V5Z', 'M4 10h16'],
  refresh: ['M20 11a8 8 0 0 0-14.9-4', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.9 4', 'M20 20v-4h-4'],
  rocket: ['m14 4 6 6-8.5 8.5-4-2-2-4L14 4Z', 'M7.5 16.5 4 20', 'M8 6 4 10l4 2', 'M18 16l-4 4-2-4', 'M15 9h.01'],
  search: ['m21 21-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z'],
  send: ['m21 3-7 18-4-7-7-4 18-7Z', 'M10 14l4-4'],
  square: ['M5 5h14v14H5Z'],
  terminal: ['m5 7 5 5-5 5', 'M12 17h7'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  unmute: ['M4 10v4h3l5 4V6l-5 4H4Z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a8 8 0 0 1 0 11'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M5 20h14'],
  users: ['M16 20a4 4 0 0 0-8 0', 'M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M19 20a3 3 0 0 0-2.2-2.9', 'M17 11a2.5 2.5 0 1 0 0-5'],
  volume: ['M4 10v4h3l5 4V6l-5 4H4Z', 'M16 9a4 4 0 0 1 0 6'],
  warning: ['M12 4 3 20h18L12 4Z', 'M12 10v4', 'M12 17h.01'],
  zap: ['m13 2-9 12h7l-1 8 9-12h-7l1-8Z']
}

const MODERN_ICON_STYLE_ID = `${ID}-modern-icon-style`
const CODE_CARD_CONTRAST_STYLE_ID = `${ID}-code-card-contrast-style`
let modernIconStylesheetCache = null

function modernIconMask(paths, viewBox = '0 0 24 24') {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="black" stroke-width="${MODERN_ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">`,
    ...paths.map(d => `<path d="${d}"/>`),
    '</svg>'
  ].join('')

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const MODERN_BRAND_PATHS = [
  'M24 5c7.2 0 13 5.9 13 13.2S31.2 31.5 24 31.5 11 25.6 11 18.2 16.8 5 24 5Z',
  'M7 12c5.5 0 10.8 3.1 17 8.2S34.5 28.5 41 28.5',
  'M7 30c5.5 0 10.8-3.1 17-8.2S34.5 13.5 41 13.5',
  'M24 31.5v7.5'
]

function modernIconStylesheet() {
  const iconRules = Object.entries(MODERN_ICON_PATHS)
    .map(([name, paths]) => {
      const mask = modernIconMask(paths)

      return `i.codicon.codicon-${name}:not(.codicon-modifier-spin){display:inline-block!important;width:1em!important;height:1em!important;font-family:initial!important;font-style:normal!important;line-height:1!important;vertical-align:middle!important}i.codicon.codicon-${name}:not(.codicon-modifier-spin)::before{content:""!important;display:block!important;width:100%!important;height:100%!important;background-color:currentColor!important;-webkit-mask-image:${mask}!important;mask-image:${mask}!important;-webkit-mask-position:center!important;mask-position:center!important;-webkit-mask-repeat:no-repeat!important;mask-repeat:no-repeat!important;-webkit-mask-size:contain!important;mask-size:contain!important}`
    })
    .join('')

  const brandMask = modernIconMask(MODERN_BRAND_PATHS, '0 0 48 48')

  return `${iconRules}span:has(> img[src*="nous-girl.jpg"]){position:relative!important;background-color:var(--ui-bg-elevated)!important}span:has(> img[src*="nous-girl.jpg"])>img[src*="nous-girl.jpg"]{opacity:0!important}span:has(> img[src*="nous-girl.jpg"])::after{content:"";position:absolute;inset:20%;display:block;background-color:var(--ui-accent);-webkit-mask-image:${brandMask};mask-image:${brandMask};-webkit-mask-position:center;mask-position:center;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain}
[data-slot='aui_assistant-message-content'] [data-conversation-scaffold]{opacity:0.78}
.codex-monitor-page{display:flex;min-height:0;height:100%;flex-direction:column;background-color:#f8fafc;background-image:radial-gradient(rgba(100,116,139,0.12) 1px,transparent 1px);background-size:16px 16px;color:#1e293b}
.codex-monitor-topbar{display:flex;height:4rem;flex-shrink:0;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid #e2e8f0;background:rgba(255,255,255,0.95);padding:0 1.25rem;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
.codex-monitor-live{display:inline-flex;align-items:center;gap:0.35rem;border:1px solid #a7f3d0;border-radius:0.25rem;background:#ecfdf5;padding:0.1rem 0.5rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:500;color:#047857}
.codex-monitor-live-dot{width:0.375rem;height:0.375rem;border-radius:999px;background:#10b981}
.codex-monitor-grid{display:grid;min-height:0;flex:1;align-content:start;gap:1rem;overflow:auto;padding:1rem;grid-template-columns:repeat(auto-fill,minmax(22rem,1fr));grid-auto-rows:minmax(28rem,auto)}
.codex-monitor-grid[data-layout='compact']{grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));grid-auto-rows:minmax(22rem,auto)}
.codex-monitor-grid[data-layout='list']{grid-template-columns:minmax(0,1fr);grid-auto-rows:minmax(14rem,auto)}
.codex-monitor-card{position:relative;display:flex;min-height:28rem;max-height:36rem;overflow:hidden;flex-direction:column;border:1px solid #e2e8f0;border-radius:0.75rem;background:#ffffff;box-shadow:0 1px 2px rgba(15,23,42,0.05)}
.codex-monitor-grid[data-layout='compact'] .codex-monitor-card,.codex-monitor-grid[data-layout='compact'] .codex-monitor-new-tile{min-height:22rem;max-height:26rem}
.codex-monitor-grid[data-layout='list'] .codex-monitor-card,.codex-monitor-grid[data-layout='list'] .codex-monitor-new-tile{min-height:14rem;max-height:18rem}
.codex-monitor-card:hover{border-color:color-mix(in srgb,var(--monitor-project-color,#10b981) 55%,#e2e8f0);box-shadow:0 8px 18px rgba(15,23,42,0.06)}
.codex-monitor-new-tile{display:flex;min-height:28rem;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;border:2px dashed #cbd5e1;border-radius:0.75rem;background:rgba(255,255,255,0.6);padding:1.5rem;text-align:center;cursor:pointer;color:#64748b}
.codex-monitor-new-tile:hover{border-color:#34d399;background:#ffffff;color:#047857}
.codex-monitor-new-tile-icon{display:flex;width:3.5rem;height:3.5rem;align-items:center;justify-content:center;border:1px solid #e2e8f0;border-radius:1rem;background:#f1f5f9}
.codex-monitor-new-tile:hover .codex-monitor-new-tile-icon{border-color:#a7f3d0;background:#ecfdf5}
.codex-monitor-index{display:flex;width:1.75rem;height:1.75rem;flex-shrink:0;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--monitor-project-color,#10b981) 35%,#e2e8f0);border-radius:0.5rem;background:color-mix(in srgb,var(--monitor-project-color,#10b981) 12%,#ffffff);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;color:color-mix(in srgb,var(--monitor-project-color,#047857) 70%,#0f172a)}
.codex-monitor-status-pill{display:inline-flex;align-items:center;border:1px solid #d1fae5;border-radius:0.25rem;background:#ecfdf5;padding:0.1rem 0.4rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:500;color:#047857}
.codex-monitor-status-pill[data-status='执行中']{border-color:#a5f3fc;background:#ecfeff;color:#0e7490}
.codex-monitor-status-pill[data-status='就绪待命中']{border-color:#fde68a;background:#fffbeb;color:#b45309}
.codex-monitor-queue-chip{display:inline-flex;align-items:center;gap:0.5rem;border:1px solid #fde68a;border-radius:0.5rem;background:#fffbeb;padding:0.35rem 0.65rem;font-size:12px;color:#92400e;cursor:pointer}
.codex-monitor-layout-switch{display:flex;align-items:center;border:1px solid #e2e8f0;border-radius:0.5rem;background:#f1f5f9;padding:0.125rem}
.codex-monitor-layout-switch button{display:inline-flex;align-items:center;gap:0.25rem;border:0;border-radius:0.375rem;background:transparent;padding:0.25rem 0.6rem;font-size:12px;color:#475569;cursor:pointer}
.codex-monitor-layout-switch button[aria-pressed='true']{background:#ffffff;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,0.08)}
.codex-monitor-message-meta{display:flex;align-items:center;gap:0.35rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5px;color:#94a3b8}
.codex-monitor-message-user-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:0.2rem;padding-left:1.5rem}
.codex-monitor-message-assistant-wrap{display:flex;flex-direction:column;align-items:flex-start;gap:0.2rem;padding-right:1.5rem}
.codex-monitor-message-user{margin-left:auto;max-width:86%;border:1px solid #e2e8f0;border-radius:0.65rem 0.65rem 0.2rem 0.65rem;background:#ffffff;padding:0.4rem 0.6rem;box-shadow:0 1px 2px rgba(15,23,42,0.04);white-space:pre-wrap;font-size:0.625rem;line-height:1.4;-webkit-user-select:text!important;user-select:text!important}
.codex-monitor-status{align-self:flex-start}
.codex-monitor-markdown{font-size:0.625rem;line-height:1.4;overflow-wrap:anywhere;border:1px solid #e2e8f0;border-radius:0.65rem 0.65rem 0.65rem 0.2rem;background:#ffffff;padding:0.4rem 0.6rem;box-shadow:0 1px 2px rgba(15,23,42,0.04);-webkit-user-select:text!important;user-select:text!important}
.codex-monitor-card [data-selectable-text='true'],.codex-monitor-card [data-selectable-text='true'] *,.codex-monitor-markdown *{-webkit-user-select:text!important;user-select:text!important}
.codex-monitor-markdown :where(p,ul,ol,pre,blockquote){margin:0.18rem 0}
.codex-monitor-markdown :where(ul,ol){padding-left:0.9rem}
.codex-monitor-markdown :where(h1,h2,h3,h4,h5,h6){font-size:0.6875rem!important;font-weight:700!important;line-height:1.3!important;margin:0.3rem 0 0.12rem 0!important}
.codex-monitor-markdown :where(h1){font-size:0.75rem!important}
.codex-monitor-markdown :where(h2){font-size:0.7rem!important}
.codex-monitor-markdown pre{max-width:100%;overflow:auto;border:1px solid var(--ui-stroke-tertiary);border-radius:5px;background:#f8fafc;padding:0.3rem 0.45rem;font-size:0.575rem!important;line-height:1.3!important}
.codex-monitor-markdown code{font-size:0.6rem!important;border-radius:0.2rem!important;padding:0.04rem 0.2rem!important}
.codex-monitor-composer{display:flex;align-items:center;gap:0.35rem;border:1px solid #e2e8f0;border-radius:0.45rem;background:#f8fafc;padding:0.25rem 0.5rem}
.codex-monitor-composer:focus-within{border-color:#10b981;background:#ffffff}
.codex-monitor-composer-input{flex:1;min-width:0;border:0;background:transparent;padding:0;font-size:10.5px;color:#0f172a;outline:none}
.codex-monitor-queue-bar{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;border-top:1px dashed #e2e8f0;background:#f8fafc;padding:0.35rem 0.65rem;font-size:10px;color:#64748b}
.codex-monitor-queue-list{display:flex;flex-direction:column;gap:0.25rem;padding:0.35rem 0.65rem;background:#f1f5f9/60;border-top:1px solid #e2e8f0;max-height:6.5rem;overflow-y:auto}
.codex-monitor-queue-item{display:flex;align-items:center;justify-content:space-between;gap:0.4rem;background:#ffffff;border:1px solid #e2e8f0;border-radius:0.35rem;padding:0.2rem 0.4rem;font-size:10px}
.codex-monitor-footer{display:flex;height:2.25rem;flex-shrink:0;align-items:center;justify-content:space-between;border-top:1px solid #e2e8f0;background:#ffffff;padding:0 1rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#64748b}
.codex-monitor-new-field{display:flex;flex-direction:column;gap:0.35rem}
.codex-monitor-new-label{font-size:0.7rem;font-weight:500;color:var(--ui-text-secondary)}
.codex-monitor-new-images{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center}
.codex-monitor-new-thumb{position:relative;height:3rem;width:3rem;overflow:hidden;border:1px solid #e2e2e6;border-radius:8px;background:#f8f8fa}
.codex-monitor-new-thumb img{display:block;height:100%;width:100%;object-fit:cover}
.codex-monitor-new-thumb-remove{position:absolute;top:0.15rem;right:0.15rem;display:grid;place-items:center;width:1rem;height:1rem;border:0;border-radius:999px;background:rgba(15,23,42,0.72);color:#fff}
.codex-monitor-image-gallery{display:flex;flex-wrap:wrap;gap:0.35rem;margin-top:0.35rem}
.codex-monitor-img-thumb{position:relative;height:3.5rem;width:3.5rem;overflow:hidden;border:1px solid #e2e8f0;border-radius:0.45rem;background:#f8fafc;cursor:pointer;transition:transform 120ms ease,box-shadow 120ms ease}
.codex-monitor-img-thumb:hover{transform:scale(1.03);box-shadow:0 2px 6px rgba(15,23,42,0.12);border-color:#cbd5e1}
.codex-monitor-img-thumb img{display:block;height:100%;width:100%;object-fit:cover}
.codex-monitor-lightbox{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.75);backdrop-filter:blur(4px);padding:1.5rem;cursor:zoom-out}
.codex-monitor-lightbox-img{max-width:92vw;max-height:90vh;border-radius:0.5rem;box-shadow:0 12px 36px rgba(0,0,0,0.35);object-fit:contain;cursor:default}
.codex-monitor-lightbox-close{position:absolute;top:1.25rem;right:1.25rem;display:flex;align-items:center;justify-content:center;width:2rem;height:2rem;border-radius:999px;background:rgba(255,255,255,0.2);color:#fff;border:0;cursor:pointer;transition:background 120ms ease}
.codex-monitor-lightbox-close:hover{background:rgba(255,255,255,0.4)}
@media(max-width:900px){.codex-monitor-grid{grid-template-columns:minmax(0,1fr)}.codex-monitor-card,.codex-monitor-new-tile{min-height:22rem;max-height:none}}
.codex-gateway-session-row{position:relative;isolation:isolate}
.codex-gateway-session-row [data-session-status]:not(:has([role="status"])){display:none!important}
.codex-gateway-session-row [data-session-menu]{opacity:0;pointer-events:none}
.codex-gateway-session-row:is(:hover,:focus-within) [data-session-status]{visibility:hidden}
.codex-gateway-session-row:is(:hover,:focus-within) [data-session-menu],.codex-gateway-session-row [data-session-menu]:has([data-state="open"]){opacity:1;pointer-events:auto}
.codex-gateway-running-arc{display:none;--arc-c1:var(--codex-project-color, #1f2937);--arc-duration:3s;--arc-radius:0.75rem;transform:scaleX(-1)}
.codex-gateway-session-row:has([class~="bg-(--ui-accent)"])>.codex-gateway-running-arc,.codex-gateway-session-row:has([class~="border-(--ui-accent)"])>.codex-gateway-running-arc{display:block}
.codex-gateway-filter-tab{border:1px solid transparent!important;background:transparent!important;box-shadow:none!important;transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease}
.codex-gateway-filter-tab[aria-pressed="false"]:hover{background:#ffffff!important;border-color:#f0ebe2!important}
.codex-gateway-filter-tab[aria-pressed="true"]{background:#ffffff!important;border-color:#e9e2d6!important;box-shadow:0 1px 2px rgba(120,104,80,0.06)!important}
.codex-gateway-project-row{margin-top:4px;background:#ffffff;border:1px solid #e9e2d6;border-radius:8px;box-shadow:0 1px 2px rgba(120,104,80,0.05)}
.codex-gateway-project-row:hover{background:#fbfaf7;border-color:#ded4c2}
.codex-gateway-project-row .codex-project-label{font-weight:600}
.codex-gateway-project-meta{opacity:0.72;transition:opacity 120ms ease}
.codex-gateway-project-row:is(:hover,:focus-within) .codex-gateway-project-meta{opacity:1}
.codex-gateway-session-row{margin-top:4px;margin-left:1.5rem;box-shadow:inset 1px 0 0 color-mix(in srgb,var(--codex-project-color, #ece5d8) 30%,#ece5d8)}
.codex-gateway-session-row [data-session-time]{opacity:0.78;transition:opacity 120ms ease}
.codex-gateway-session-row:is(:hover,:focus-within) [data-session-time]{opacity:1}`
}

function syncModernIconStyles(active) {
  if (typeof document === 'undefined') {
    return
  }

  const existing = document.getElementById(MODERN_ICON_STYLE_ID)

  if (!active) {
    existing?.remove()

    return
  }

  const style = existing || document.createElement('style')
  style.id = MODERN_ICON_STYLE_ID
  style.dataset.codexModernIcons = 'true'
  // Avoid replacing the style text on every DOM mutation. Replacing its text
  // creates a childList mutation, and the old whole-document observer then
  // called this function again indefinitely, freezing the renderer.
  modernIconStylesheetCache ??= modernIconStylesheet()

  if (style.textContent !== modernIconStylesheetCache) {
    style.textContent = modernIconStylesheetCache
  }

  if (!existing) {
    document.head.appendChild(style)
  }
}

function codeCardContrastStylesheet() {
  return `[data-hermes-theme="${THEME_NAME}"] [data-slot="code-card"]{position:relative;background-color:#151a21!important;color:#edf3fb;color-scheme:dark;border:1px solid #303946;--ui-bg-editor:#151a21;--foreground:#edf3fb;--muted-foreground:#aebbc9;--ui-fg-primary:#edf3fb;--ui-fg-secondary:#cbd5e1;--ui-fg-tertiary:#aebbc9;--ui-stroke-primary:#303946;--ui-stroke-secondary:#29323d}[data-hermes-theme="${THEME_NAME}"] [data-slot="code-card"] .aui-shiki :where(pre,code){color:#edf3fb!important;-webkit-text-fill-color:#edf3fb!important}[data-hermes-theme="${THEME_NAME}"] [data-slot="code-card"] .aui-shiki .shiki span{color:var(--shiki-dark,#edf3fb)!important;-webkit-text-fill-color:var(--shiki-dark,#edf3fb)!important}[data-hermes-theme="${THEME_NAME}"] [data-slot="code-card"] :where(button,[data-slot="code-card-icon"]){color:#aebbc9;opacity:.55}[data-hermes-theme="${THEME_NAME}"] [data-slot="code-card"] :where(button,[data-slot="code-card-icon"]):is(:hover,:focus-visible){opacity:1}[data-hermes-theme="${THEME_NAME}"] [data-slot="code-card"]::after{content:"";pointer-events:none;position:absolute;right:0;top:0;bottom:0;width:1rem;background:linear-gradient(to right,transparent,#151a21);opacity:.72}`
}

const DYNAMIC_SURFACE_SELECTOR = [
  "[data-slot='aui_thread-content']",
  "[data-slot='aui_thread-viewport']",
  '[data-chat-surface]',
  "[data-slot='composer-bounds']",
  "[data-slot='composer-dock']",
  "[data-slot='composer-root']",
  "[data-slot='composer-surface']",
  "[data-slot='composer-fade']",
  "[data-slot='composer-rich-input']",
  "[data-slot='aui_assistant-message-root']",
  "[data-slot='aui_user-message-root']",
  '.composer-human-message'
].join(',')

function mutationsNeedElementSync(mutations) {
  return mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node => {
    if (node.nodeType !== 1) {
      return Boolean(node.parentElement?.closest?.(DYNAMIC_SURFACE_SELECTOR))
    }
    return Boolean(node.matches?.(DYNAMIC_SURFACE_SELECTOR) || node.querySelector?.(DYNAMIC_SURFACE_SELECTOR))
  }))
}

function syncCodeCardContrastStyles(active) {
  if (typeof document === 'undefined') {
    return
  }

  const existing = document.getElementById(CODE_CARD_CONTRAST_STYLE_ID)
  if (!active) {
    existing?.remove()
    return
  }

  const style = existing || document.createElement('style')
  style.id = CODE_CARD_CONTRAST_STYLE_ID
  style.dataset.codexCodeCardContrast = 'true'
  const stylesheet = codeCardContrastStylesheet()
  if (style.textContent !== stylesheet) {
    style.textContent = stylesheet
  }
  if (!existing) {
    document.head.appendChild(style)
  }
}

function rememberRootTokens(root, tokens) {
  const previous = new Map()

  if (root) {
    Object.keys(tokens).forEach(key => previous.set(key, root.style.getPropertyValue(key)))
  }

  return previous
}

function restoreRootToken(root, previous, key) {
  if (!root) {
    return
  }

  const value = previous.get(key) || ''

  if (value) {
    root.style.setProperty(key, value)
  } else {
    root.style.removeProperty(key)
  }
}

/**
 * Own inline element styles and restore them without clobbering a later writer.
 */
function sessionRowTitle(session) {
  return String(session?.title || session?.preview || 'Untitled session').trim() || 'Untitled session'
}

function sessionRowTime(session) {
  const seconds = Number(session?.last_active || session?.started_at || 0)
  return Number.isFinite(seconds) && seconds > 0 ? relativeTime(seconds * 1000) : ''
}

function sessionBooleanValue(value) {
  if (value === true || value === 1) {
    return true
  }

  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  }

  return false
}

function normalizeSessionRecord(session, fallbackProfile) {
  if (!session || typeof session !== 'object') {
    return session
  }

  return {
    ...session,
    archived: sessionBooleanValue(session.archived),
    is_active: sessionBooleanValue(session.is_active),
    pinned: sessionBooleanValue(session.pinned),
    profile: session.profile || fallbackProfile,
    unread: sessionBooleanValue(session.unread)
  }
}

function sessionPinned(session) {
  return sessionBooleanValue(session?.pinned)
}

function sessionUnread(session) {
  return sessionBooleanValue(session?.unread)
}

function sessionArchived(session) {
  return sessionBooleanValue(session?.archived)
}

function sessionActive(session) {
  return sessionBooleanValue(session?.is_active)
}

function sessionIsExternalChannel(session) {
  const source = typeof session?.source === 'string' ? session.source.trim().toLowerCase() : ''
  if (EXTERNAL_SESSION_SOURCES.has(source)) return true
  if (String(session?.handoff_state || '').trim().toLowerCase() !== 'completed') return false
  const handoff = typeof session?.handoff_platform === 'string' ? session.handoff_platform.trim().toLowerCase() : ''
  return EXTERNAL_SESSION_SOURCES.has(handoff)
}

function eventSessionId(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null
  return String(
    event?.session_id
    || event?.sessionId
    || payload?.session_id
    || payload?.stored_session_id
    || payload?.sessionId
    || ''
  ).trim()
}

function sessionActivityValue(session) {
  const value = session?.last_active ?? session?.updated_at ?? session?.started_at ?? session?.created_at ?? 0
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0
  }
  return numeric < 100_000_000_000 ? numeric * 1000 : numeric
}

function compareSessions(a, b) {
  const pinnedOrder = Number(sessionPinned(b)) - Number(sessionPinned(a))
  return pinnedOrder || sessionActivityValue(b) - sessionActivityValue(a)
}

function projectLatestActivity(project) {
  const sessions = Array.isArray(project?.sessions) ? project.sessions : []
  let latest = sessionActivityValue({ last_active: project?.lastActive })
  for (const session of sessions) {
    const value = sessionActivityValue(session)
    if (value > latest) latest = value
  }
  return latest
}

function compareProjects(a, b) {
  const aHasSessions = (a?.sessions?.length || 0) > 0
  const bHasSessions = (b?.sessions?.length || 0) > 0
  if (aHasSessions !== bHasSessions) {
    return aHasSessions ? -1 : 1
  }

  if (aHasSessions) {
    const activityOrder = projectLatestActivity(b) - projectLatestActivity(a)
    if (activityOrder !== 0) {
      return activityOrder
    }
  } else if (isHomeProject(a) !== isHomeProject(b)) {
    return isHomeProject(a) ? 1 : -1
  }

  const labelOrder = projectDisplayLabel(a).localeCompare(projectDisplayLabel(b), undefined, { sensitivity: 'base' })
  if (labelOrder !== 0) {
    return labelOrder
  }
  const sourceOrder = projectRemoteLabel(a).localeCompare(projectRemoteLabel(b), undefined, { sensitivity: 'base' })
  if (sourceOrder !== 0) {
    return sourceOrder
  }
  const profileOrder = String(a?.profile || '').localeCompare(String(b?.profile || ''), undefined, { sensitivity: 'base' })
  return profileOrder || String(a?.key || '').localeCompare(String(b?.key || ''))
}

function monitorEligibleSessions(projects) {
  const seen = new Set()
  const entries = []

  for (const project of Array.isArray(projects) ? projects : []) {
    const route = project?.route || {}
    const owner = [route.connectionId, route.profile, route.targetProfile].map(value => String(value || '').trim()).filter(Boolean).join('::') || String(project?.key || '')
    const sessions = [
      ...(Array.isArray(project?.prefetchedSessions) ? project.prefetchedSessions : []),
      ...(Array.isArray(project?.sessions) ? project.sessions : [])
    ]
    for (const session of sessions) {
      const sessionId = String(session?.id || '').trim()
      const identity = sessionId ? `${owner}::${sessionId}` : ''
      if (!identity || seen.has(identity) || sessionIsExternalChannel(session)) continue
      seen.add(identity)
      entries.push({ key: identity, project, session })
    }
  }

  return entries.sort((a, b) => sessionActivityValue(b.session) - sessionActivityValue(a.session) || a.key.localeCompare(b.key))
}

function monitorSessionCandidates(projects) {
  return monitorEligibleSessions(projects).filter(entry => sessionActive(entry.session))
}

function monitorDisplayedCandidates(projects, hiddenKeys, parkedKeys) {
  const hidden = new Set(normalizeStringKeyList(hiddenKeys, MONITOR_KEY_LIST_MAX))
  const parked = new Set(normalizeStringKeyList(parkedKeys, MONITOR_KEY_LIST_MAX))
  return monitorEligibleSessions(projects).filter(entry => {
    if (hidden.has(entry.key)) return false
    return sessionActive(entry.session) || parked.has(entry.key)
  })
}

function monitorQueueCandidates(projects, displayedKeys) {
  const shown = new Set(normalizeStringKeyList(displayedKeys, MONITOR_KEY_LIST_MAX))
  return monitorEligibleSessions(projects).filter(entry => !shown.has(entry.key))
}

function monitorHideSessionKeys(hiddenKeys, parkedKeys, key) {
  const target = String(key || '').trim()
  const hidden = normalizeStringKeyList(hiddenKeys, MONITOR_KEY_LIST_MAX)
  const parked = normalizeStringKeyList(parkedKeys, MONITOR_KEY_LIST_MAX).filter(item => item !== target)
  if (target && !hidden.includes(target)) hidden.push(target)
  const nextHidden = hidden.slice(-MONITOR_KEY_LIST_MAX)
  return {
    hiddenKeys: nextHidden,
    monitorHiddenKeys: nextHidden,
    monitorParkedKeys: parked,
    parkedKeys: parked
  }
}

function monitorParkSessionKeys(hiddenKeys, parkedKeys, key) {
  const target = String(key || '').trim()
  const hidden = normalizeStringKeyList(hiddenKeys, MONITOR_KEY_LIST_MAX).filter(item => item !== target)
  const parked = normalizeStringKeyList(parkedKeys, MONITOR_KEY_LIST_MAX)
  if (target && !parked.includes(target)) parked.push(target)
  const nextParked = parked.slice(-MONITOR_KEY_LIST_MAX)
  return {
    hiddenKeys: hidden,
    monitorHiddenKeys: hidden,
    monitorParkedKeys: nextParked,
    parkedKeys: nextParked
  }
}

function monitorSessionEntries(projects, limit) {
  const candidates = monitorSessionCandidates(projects)
  const requested = Number(limit)
  if (Number.isFinite(requested) && requested > 0) {
    return candidates.slice(0, Math.floor(requested))
  }
  return candidates
}

function stabilizeMonitorSlotKeys(previousKeys, candidates) {
  const candidateKeys = []
  const eligible = new Set()

  for (const entry of Array.isArray(candidates) ? candidates : []) {
    const key = String(entry?.key || '').trim()
    if (!key || eligible.has(key)) continue
    eligible.add(key)
    candidateKeys.push(key)
  }

  const next = []
  const occupied = new Set()
  for (const value of Array.isArray(previousKeys) ? previousKeys : []) {
    const key = String(value || '').trim()
    if (!key || !eligible.has(key) || occupied.has(key)) continue
    occupied.add(key)
    next.push(key)
  }

  for (const key of candidateKeys) {
    if (occupied.has(key)) continue
    occupied.add(key)
    next.push(key)
  }

  return next
}

function monitorSessionIndexLabel(index) {
  const value = Number(index)
  const n = Number.isFinite(value) && value >= 0 ? Math.floor(value) + 1 : 1
  return String(n).padStart(2, '0')
}

function monitorSessionStatusLabel(session, messages) {
  const rows = Array.isArray(messages) ? messages : []
  if (rows.some(row => row && row.kind === 'status')) return '执行中'
  return sessionActive(session) ? '对话中' : '就绪待命中'
}

function monitorSessionModelLabel(session) {
  return String(session?.model || '').trim()
}

function monitorSessionTokenLabel(session) {
  const tokens = Number(session?.input_tokens || 0) + Number(session?.output_tokens || 0)
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  return `Tokens: ${Math.round(tokens).toLocaleString('en-US')}`
}

function monitorMessageStamp(message) {
  const value = Number(message?.timestamp || message?.created_at || 0)
  if (!Number.isFinite(value) || value <= 0) return ''
  const ms = value < 100_000_000_000 ? value * 1000 : value
  return relativeTime(ms)
}

function monitorScrollToBottom(element) {
  if (!element) return false
  element.scrollTop = element.scrollHeight
  return true
}

function monitorContentText(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map(part => {
        if (typeof part === 'string') return part.trim()
        if (!part || typeof part !== 'object') return ''
        return monitorContentText(part.text ?? part.content ?? part.output ?? '')
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    return monitorContentText(value.text ?? value.content ?? value.output ?? '')
  }
  return ''
}

const MONITOR_ATTACH_TOOL_RE = /\[(?:The )?user attached (?:an )?image:[^\]]+\]\s*\[Examine it with the vision_analyze tool using image_url:\s*([^\]]+)\]/gi
const MONITOR_IMAGE_DIRECTIVE_RE = /@image:(?:`([^`]+)`|"([^"]+)"|([^\s\n]+))/gi
const MONITOR_MEDIA_TAG_RE = /[`"']?MEDIA:\s*(?:`([^`]+)`|"([^"]+)"|'([^']+)'|([^\s\n]+))[`"']?/gi

function extractMonitorMessageImages(rawText) {
  if (!rawText || typeof rawText !== 'string') return { cleanedText: '', imagePaths: [] }
  const paths = []
  const seen = new Set()

  const addPath = raw => {
    let p = String(raw || '').trim()
    if (!p) return
    // 去除多余的引号包裹
    p = p.replace(/^["'`]|["'`]$/g, '').trim()
    if (!p || seen.has(p)) return
    seen.add(p)
    paths.push(p)
  }

  // 1. 匹配网关底层 vision_analyze 附件注入
  for (const match of rawText.matchAll(MONITOR_ATTACH_TOOL_RE)) {
    addPath(match[1])
  }

  // 2. 匹配前端常用的 @image:... 指令
  for (const match of rawText.matchAll(MONITOR_IMAGE_DIRECTIVE_RE)) {
    addPath(match[1] || match[2] || match[3])
  }

  // 3. 匹配 MEDIA:... 标签
  for (const match of rawText.matchAll(MONITOR_MEDIA_TAG_RE)) {
    addPath(match[1] || match[2] || match[3] || match[4])
  }

  // 清洗掉原始文本中的冗长内部注入协议与指令标记，使对话泡保持优雅干净
  let cleaned = rawText
    .replace(MONITOR_ATTACH_TOOL_RE, '')
    .replace(MONITOR_IMAGE_DIRECTIVE_RE, '')
    .replace(MONITOR_MEDIA_TAG_RE, '')
    .trim()

  return { cleanedText: cleaned, imagePaths: paths }
}

function monitorMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  return monitorContentText(message.display_content ?? message.text ?? message.content ?? '')
}

function normalizeMonitorTranscript(response) {
  const rows = Array.isArray(response?.messages)
    ? response.messages
    : (Array.isArray(response?.data) ? response.data : [])
  return rows.filter(row => row && typeof row === 'object')
}

function monitorVisibleMessages(response, limit) {
  const requested = Number(limit)
  const max = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 18
  const visible = []
  for (const [index, message] of normalizeMonitorTranscript(response).entries()) {
    if (message.display_kind === 'hidden' || !['user', 'assistant'].includes(message.role)) continue
    const text = monitorMessageText(message)
    if (!text) continue
    visible.push({
      key: String(message.row_id ?? message.id ?? `${message.timestamp || 0}:${index}`),
      message,
      text
    })
  }
  return visible.slice(-max)
}

function monitorMessageIsToolActivity(message) {
  if (!message || typeof message !== 'object') return false
  const role = String(message.role || '').trim().toLowerCase()
  if (role === 'tool') return true
  if (String(message.tool_name || '').trim()) return true
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0
}

function monitorWallMessages(response, session, limit) {
  const rows = normalizeMonitorTranscript(response)
  const inflight = session?.id ? inflightUserPromptBySession.get(session.id) : null
  if (inflight && inflight.prompt && Array.isArray(rows)) {
    const hasPrompt = rows.some(r => r.role === 'user' && (r.content === inflight.prompt || r.text === inflight.prompt))
    if (!hasPrompt) {
      rows.push({
        id: `inflight-${session.id}-${inflight.timestamp}`,
        role: 'user',
        content: inflight.prompt,
        text: inflight.prompt,
        timestamp: Math.floor(inflight.timestamp / 1000)
      })
    }
  }
  const allVisible = []
  for (const [index, message] of rows.entries()) {
    if (message.display_kind === 'hidden' || !['user', 'assistant'].includes(message.role)) continue
    const text = monitorMessageText(message)
    if (!text) continue
    allVisible.push({
      key: String(message.row_id ?? message.id ?? `${message.timestamp || 0}:${index}`),
      message,
      text
    })
  }

  const requested = Number(limit)
  const max = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 18
  const wall = allVisible.slice(-max)

  // 保证卡片能看到该轮对话的用户指令：若当前切片中暂无用户消息，
  // 优先从本次获取的历史记录中抽取最新一条真实的 user 消息置顶；
  // 仅在会话极短或冷启动且 transcript 中尚无任何消息记录时，才回退至 session.preview。
  if (!wall.some(row => row.message && row.message.role === 'user')) {
    const latestUserRow = allVisible.filter(row => row.message && row.message.role === 'user').pop()
    if (latestUserRow) {
      wall.unshift(latestUserRow)
    } else if (allVisible.length === 0) {
      const preview = String(session?.preview || '').trim()
      if (preview) {
        wall.unshift({
          key: 'monitor-session-preview',
          message: { role: 'user' },
          text: preview
        })
      }
    }
  }

  let lastTextIndex = -1
  let lastToolIndex = -1
  for (const [index, message] of rows.entries()) {
    if (monitorMessageIsToolActivity(message)) lastToolIndex = index
    if (message.display_kind === 'hidden' || !['user', 'assistant'].includes(message.role)) continue
    if (!monitorMessageText(message)) continue
    lastTextIndex = index
  }
  if (rows.length === 0 && Number(session?.tool_call_count) > 0) {
    lastToolIndex = 0
  }
  if (lastToolIndex > lastTextIndex) {
    wall.push({
      key: 'monitor-working',
      kind: 'status',
      message: { role: 'assistant' },
      text: '正在执行任务…'
    })
  }
  return wall
}

function monitorToolCallLabel(message) {
  const name = String(message?.tool_name || message?.name || '').trim()
  if (name) return name
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  for (const call of calls) {
    if (typeof call === 'string' && call.trim()) return call.trim()
    if (!call || typeof call !== 'object') continue
    const nested = call.function && typeof call.function === 'object' ? call.function : null
    const found = String(call.name || call.tool || nested?.name || '').trim()
    if (found) return found
  }
  return '工具'
}

function monitorThinkingText(message) {
  if (!message || typeof message !== 'object') return ''
  return monitorContentText(message.reasoning_content ?? message.reasoning ?? '')
}

function monitorMobileActivityKind(message) {
  const displayKind = String(message?.display_kind || '').trim()
  if (displayKind === 'async_delegation_complete') return 'subagent'
  const tool = String(message?.tool_name || message?.name || '').trim().toLowerCase()
  if (tool.includes('todo')) return 'todo'
  if (tool.includes('delegate') || tool.includes('subagent') || tool.includes('background')) return 'background'
  return ''
}

function monitorSubagentText(message) {
  let meta = message?.display_metadata
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta) } catch { meta = null }
  }
  const count = meta && typeof meta === 'object' ? Number(meta.task_count) : NaN
  if (Number.isFinite(count) && count > 0) return `${Math.floor(count)} 个子代理完成`
  return monitorMessageText(message) || '子代理任务完成'
}

function monitorMobileMessages(response, session, limit, options) {
  const rows = normalizeMonitorTranscript(response)
  const out = []
  for (const [index, message] of rows.entries()) {
    const role = String(message.role || '').trim().toLowerCase()
    const thinking = monitorThinkingText(message)
    const text = monitorMessageText(message)
    const isTool = monitorMessageIsToolActivity(message)
    const activity = monitorMobileActivityKind(message)
    const keyBase = String(message.row_id ?? message.id ?? `${message.timestamp || 0}:${index}`)
    if (thinking) {
      out.push({
        key: `${keyBase}:thinking`,
        kind: 'thinking',
        message,
        role: 'thinking',
        text: thinking
      })
    }
    if (activity === 'subagent') {
      out.push({
        key: `${keyBase}:subagent`,
        kind: 'subagent',
        message,
        role: 'subagent',
        text: monitorSubagentText(message)
      })
    } else if (isTool) {
      const tool = monitorToolCallLabel(message)
      const preview = text || monitorContentText(message.context ?? message.args ?? '')
      const kind = activity === 'todo' || activity === 'background' ? activity : 'tool'
      out.push({
        key: `${keyBase}:${kind}`,
        kind,
        message,
        role: kind,
        text: preview || `调用 ${tool}`,
        tool
      })
    }
    if (message.display_kind === 'hidden') continue
    if (!['user', 'assistant'].includes(role)) continue
    if (!text) continue
    out.push({
      key: keyBase,
      kind: role,
      message,
      role,
      text
    })
  }

  const requested = Number(limit)
  const max = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 80
  const wall = out.slice(-max)
  if (!options?.isEarlier && !wall.some(row => row.role === 'user')) {
    const latestUserRow = out.filter(row => row.role === 'user').pop()
    if (latestUserRow) {
      wall.unshift(latestUserRow)
    } else if (out.length === 0) {
      const preview = String(session?.preview || '').trim()
      if (preview) {
        wall.unshift({
          key: 'monitor-session-preview',
          kind: 'user',
          message: { role: 'user' },
          role: 'user',
          text: preview
        })
      }
    }
  }
  return wall
}

function monitorTranscriptRequest(project, session, options) {
  const route = sessionRoute(project)
  const sessionId = String(session?.id || '').trim()
  if (!route || !sessionId) {
    throw new Error('Unable to resolve the monitored session owner.')
  }
  const profile = routeTargetProfile(route)
  const limit = options?.limit ?? MONITOR_TRANSCRIPT_LIMIT
  const offset = options?.offset ?? 0
  const order = options?.order ?? 'latest'
  const query = `limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}&order=${encodeURIComponent(order)}&include_compacted=true&profile=${encodeURIComponent(profile)}`
  return {
    connectionId: route.connectionId,
    path: `/api/sessions/${encodeURIComponent(sessionId)}/messages?${query}`,
    profile,
    timeoutMs: 15_000
  }
}

async function fetchMonitorTranscript(project, session, options) {
  const api = typeof window !== 'undefined' ? window.hermesDesktop?.api : null
  if (typeof api !== 'function') {
    throw new Error('Hermes Desktop transcript API unavailable.')
  }
  return normalizeMonitorTranscript(await api(monitorTranscriptRequest(project, session, options)))
}

function monitorModelChoiceKey(provider, model) {
  return JSON.stringify([String(provider || '').trim(), String(model || '').trim()])
}

function monitorModelChoiceFromKey(value) {
  try {
    const parsed = JSON.parse(String(value || ''))
    const provider = Array.isArray(parsed) ? String(parsed[0] || '').trim() : ''
    const model = Array.isArray(parsed) ? String(parsed[1] || '').trim() : ''
    return provider && model ? { model, provider } : null
  } catch {
    return null
  }
}

function normalizeMonitorModelOptions(response) {
  const providers = []
  const seenProviders = new Set()
  for (const row of Array.isArray(response?.providers) ? response.providers : []) {
    const provider = String(row?.slug || '').trim()
    if (!provider || row?.authenticated === false || seenProviders.has(provider)) continue
    const models = []
    const seenModels = new Set()
    for (const value of Array.isArray(row?.models) ? row.models : []) {
      const model = typeof value === 'string'
        ? value.trim()
        : String(value?.id || value?.name || '').trim()
      if (!model || seenModels.has(model)) continue
      seenModels.add(model)
      models.push(model)
    }
    if (!models.length) continue
    seenProviders.add(provider)
    providers.push({
      label: String(row?.name || provider).trim() || provider,
      models,
      provider
    })
  }

  const choices = providers.flatMap(row => row.models.map(model => ({
    key: monitorModelChoiceKey(row.provider, model),
    label: `${row.label} · ${model}`,
    model,
    provider: row.provider
  })))
  const preferredProvider = String(response?.provider || '').trim()
  const preferredModel = String(response?.model || '').trim()
  const preferred = choices.find(choice => choice.provider === preferredProvider && choice.model === preferredModel)
  return {
    choices,
    defaultChoiceKey: preferred?.key || choices[0]?.key || ''
  }
}

async function fetchMonitorModelOptions(project) {
  const route = project?.route
  if (!route || typeof host.requestProfile !== 'function') {
    throw new Error('Hermes Desktop model catalog unavailable.')
  }
  return host.requestProfile(route, 'model.options', {
    explicit_only: true,
    include_unconfigured: false
  })
}

function monitorSessionCreateParams(project, model) {
  const route = project?.route
  const targetPath = projectWorkspacePath(project)
  if (!route || !String(route.connectionId || '').trim()) {
    throw new Error('Unable to resolve the selected gateway.')
  }
  if (!isHomeProject(project) && !targetPath) {
    throw new Error(`Unable to resolve the workspace for ${projectDisplayLabel(project)}.`)
  }
  const selection = model && typeof model === 'object' ? model : {}
  const selectedModel = String(selection.model || '').trim()
  const selectedProvider = String(selection.provider || '').trim()
  if (!selectedModel || !selectedProvider) {
    throw new Error('A model selection is required.')
  }
  return {
    cols: 96,
    ...(targetPath ? { cwd: targetPath } : {}),
    model: selectedModel,
    profile: routeTargetProfile(route),
    provider: selectedProvider,
    source: 'desktop'
  }
}

function monitorImageAttachPayload(image, sessionId) {
  const filename = String(image?.name || '').trim()
  const dataUrl = String(image?.dataUrl || '').trim()
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  const contentBase64 = String(match?.[1] || '').replace(/\s+/g, '')
  if (!filename || !contentBase64) {
    throw new Error('Invalid image attachment.')
  }
  return {
    content_base64: contentBase64,
    filename,
    session_id: String(sessionId || '').trim()
  }
}

async function createMonitorSession(options) {
  const input = options && typeof options === 'object' ? options : {}
  const project = input.project
  const route = project?.route
  const prompt = String(input.prompt || '').trim()
  const images = Array.isArray(input.images) ? input.images : []
  if (!route || !prompt || typeof host.requestProfile !== 'function') {
    throw new Error('Unable to create the session.')
  }

  let release = null
  let runtimeId = ''
  let promptIssued = false
  try {
    if (typeof host.retainProfile === 'function') {
      release = await host.retainProfile(route)
    }
    const created = await host.requestProfile(route, 'session.create', monitorSessionCreateParams(project, input.model))
    runtimeId = String(created?.session_id || '').trim()
    const storedId = String(created?.stored_session_id || '').trim()
    if (!runtimeId || !storedId) {
      throw new Error('The gateway did not return a session id.')
    }

    for (const image of images) {
      const attached = await host.requestProfile(route, 'image.attach_bytes', monitorImageAttachPayload(image, runtimeId))
      if (!attached?.attached) {
        throw new Error('Image attachment was rejected.')
      }
    }

    promptIssued = true
    const submitted = await host.requestProfile(route, 'prompt.submit', { session_id: runtimeId, text: prompt })
    if (submitted?.ok === false) {
      throw new Error('The first prompt was rejected.')
    }
    return { runtimeId, storedId }
  } catch (error) {
    // A rejected image happens before any turn can persist. Close that temporary
    // runtime on its owner; after prompt.submit starts, do not guess whether a
    // disconnected caller missed a turn that the gateway already accepted.
    if (runtimeId && !promptIssued) {
      try {
        await host.requestProfile(route, 'session.close', { session_id: runtimeId })
      } catch {}
    }
    throw error
  } finally {
    try { release?.() } catch {}
  }
}

async function resolveMonitorRuntimeSessionId(route, storedSessionId) {
  const profile = routeTargetProfile(route)
  const resumed = await host.requestProfile(route, 'session.resume', {
    session_id: storedSessionId,
    source: 'desktop',
    omit_messages: true,
    ...(profile ? { profile } : {})
  })
  const runtimeId = String(resumed?.session_id || '').trim()
  if (!runtimeId) {
    throw new Error('无法激活会话运行时。')
  }
  if (typeof rememberMobileSessionRuntime === 'function') {
    rememberMobileSessionRuntime(storedSessionId, runtimeId)
  }
  return runtimeId
}

async function submitMonitorPrompt(options) {
  const input = options && typeof options === 'object' ? options : {}
  const project = input.project
  const route = project?.route
  const prompt = String(input.prompt || '').trim()
  const storedSessionId = String(input.session?.id || '').trim()
  const images = Array.isArray(input.images) ? input.images : []
  if (!route || (!prompt && !images.length) || !storedSessionId || typeof host.requestProfile !== 'function') {
    throw new Error('Unable to send the prompt.')
  }

  let release = null
  try {
    if (typeof host.retainProfile === 'function') {
      release = await host.retainProfile(route)
    }
    const runtimeId = await resolveMonitorRuntimeSessionId(route, storedSessionId)
    for (const image of images) {
      const attached = await host.requestProfile(route, 'image.attach_bytes', monitorImageAttachPayload(image, runtimeId))
      if (!attached?.attached) {
        throw new Error('Image attachment was rejected.')
      }
    }
    const submitted = await host.requestProfile(route, 'prompt.submit', { session_id: runtimeId, text: prompt })
    if (submitted?.ok === false) {
      throw new Error('The prompt was rejected.')
    }
    return submitted && typeof submitted === 'object' ? submitted : { ok: true }
  } finally {
    try { release?.() } catch {}
  }
}

async function switchMonitorSessionModel(project, session, modelChoice) {
  const route = project?.route
  const storedSessionId = String(session?.id || '').trim()
  const model = String(modelChoice?.model || '').trim()
  const provider = String(modelChoice?.provider || '').trim()
  if (!route || !storedSessionId || !model || !provider || typeof host.requestProfile !== 'function') {
    throw new Error('无法切换模型。')
  }

  let release = null
  try {
    if (typeof host.retainProfile === 'function') {
      release = await host.retainProfile(route)
    }
    const runtimeId = await resolveMonitorRuntimeSessionId(route, storedSessionId)
    const res = await host.requestProfile(route, 'config.set', {
      confirm_expensive_model: true,
      key: 'model',
      session_id: runtimeId,
      value: `${model} --provider ${provider} --session`
    })
    if (res?.error) {
      throw new Error(String(res.error.message || '模型切换被拒绝。'))
    }
    return res && typeof res === 'object' ? res : { ok: true }
  } finally {
    try { release?.() } catch {}
  }
}

async function stopMonitorSessionTask(project, session) {
  const route = project?.route
  const storedSessionId = String(session?.id || '').trim()
  if (!route || !storedSessionId || typeof host.requestProfile !== 'function') {
    throw new Error('无法停止任务。')
  }

  let release = null
  try {
    if (typeof host.retainProfile === 'function') {
      release = await host.retainProfile(route)
    }
    let runtimeId = ''
    try {
      runtimeId = await resolveMonitorRuntimeSessionId(route, storedSessionId)
    } catch {
      // 容错：直接尝试用 storedSessionId 发送中断
      runtimeId = storedSessionId
    }
    const res = await host.requestProfile(route, 'session.interrupt', {
      session_id: runtimeId
    })
    if (res?.error) {
      throw new Error(String(res.error.message || '停止任务请求被拒绝。'))
    }
    return res && typeof res === 'object' ? res : { status: 'interrupted' }
  } finally {
    try { release?.() } catch {}
  }
}

function monitorGatewayOptions(sourceGroups) {
  const seen = new Set()
  const choices = []
  for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) {
    const route = group?.route
    const key = route ? routeKey(route) : ''
    if (!key || group?.error || seen.has(key)) continue
    seen.add(key)
    const source = String(group?.label || group?.remoteLabel || route.connectionId || 'Gateway').trim()
    const profile = routeTargetProfile(route)
    choices.push({
      key,
      label: profile.toLowerCase() === PROFILE_SCOPE_DEFAULT ? source : `${source} · ${profile}`,
      route
    })
  }
  return choices
}

function monitorProjectsForGateway(projects, gatewayKey) {
  const target = String(gatewayKey || '').trim()
  return (Array.isArray(projects) ? projects : []).filter(project => routeKey(project?.route) === target)
}

function monitorImageMime(file) {
  const reported = String(file?.type || '').trim().toLowerCase()
  if (Object.values(MONITOR_IMAGE_MIME_BY_EXTENSION).includes(reported)) {
    return reported
  }
  const name = String(file?.name || '').trim()
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return MONITOR_IMAGE_MIME_BY_EXTENSION[extension] || ''
}

function readMonitorImageFile(file) {
  const name = String(file?.name || '').trim()
  const size = Number(file?.size) || 0
  const mime = monitorImageMime(file)
  if (!name || !mime) {
    return Promise.reject(new Error('只支持 PNG、JPG、GIF、WebP 或 BMP 图片。'))
  }
  if (size <= 0 || size > MONITOR_IMAGE_MAX_BYTES) {
    return Promise.reject(new Error('每张图片不能超过 25 MB。'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('error', () => reject(new Error('图片读取失败。')))
    reader.addEventListener('load', () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      const comma = value.indexOf(',')
      const content = comma >= 0 ? value.slice(comma + 1).replace(/\s+/g, '') : ''
      if (!content) {
        reject(new Error('图片读取失败。'))
        return
      }
      resolve({
        dataUrl: `data:${mime};base64,${content}`,
        id: `${name}:${size}:${Number(file?.lastModified) || 0}:${Date.now()}:${Math.random()}`,
        name
      })
    })
    reader.readAsDataURL(file)
  })
}

const PROJECT_APPEARANCE_COLORS = {
  red: '#e11d48',
  orange: '#ea580c',
  amber: '#d97706',
  yellow: '#ca8a04',
  lime: '#65a30d',
  green: '#16a34a',
  emerald: '#059669',
  teal: '#0d9488',
  cyan: '#0891b2',
  sky: '#0284c7',
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  purple: '#9333ea',
  fuchsia: '#c026d3',
  pink: '#db2777',
  rose: '#f43f5e',
  slate: '#64748b'
}
const PROJECT_APPEARANCE_ICONS = [
  'folder', 'repo', 'rocket', 'tools', 'database', 'cloud', 'code', 'package',
  'book', 'bug', 'flame', 'zap', 'star', 'heart', 'globe', 'server',
  'terminal', 'beaker', 'lightbulb', 'shield', 'target', 'gear', 'gift', 'coffee'
]

function projectAppearanceFor(appearance, projectKey) {
  if (!appearance || typeof appearance !== 'object') {
    return null
  }
  const entry = appearance[String(projectKey || '').trim()]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null
  }
  const color = typeof entry.color === 'string' && entry.color.trim() ? entry.color.trim() : ''
  const icon = typeof entry.icon === 'string' && entry.icon.trim() ? entry.icon.trim() : ''
  if (!color && !icon) {
    return null
  }
  return {
    ...(color ? { color } : {}),
    ...(icon ? { icon } : {})
  }
}

function projectIconName(appearance, projectKey) {
  const icon = projectAppearanceFor(appearance, projectKey)?.icon || ''
  return PROJECT_APPEARANCE_ICONS.includes(icon) ? icon : 'folder'
}

function projectIconColor(appearance, projectKey) {
  const color = projectAppearanceFor(appearance, projectKey)?.color || ''
  return Object.prototype.hasOwnProperty.call(PROJECT_APPEARANCE_COLORS, color)
    ? PROJECT_APPEARANCE_COLORS[color]
    : null
}

function orderProjectsWithPins(projects, pinnedKeys) {
  const list = Array.isArray(projects) ? [...projects] : []
  const pinned = typeof pinnedKeys?.has === 'function'
    ? pinnedKeys
    : new Set(Array.isArray(pinnedKeys) ? pinnedKeys : [])
  // `projects` already arrives in the stabilized (frozen) order. Re-sorting by
  // live activity here would resurrect the jump the stabilizer just removed, so
  // this only lifts pinned projects to the front while preserving the incoming
  // relative order (a stable partition, not a re-sort).
  if (pinned.size === 0) {
    return list
  }
  const pinnedProjects = list.filter(project => pinned.has(project?.key))
  const rest = list.filter(project => !pinned.has(project?.key))
  return [...pinnedProjects, ...rest]
}

function projectInfoHint(project) {
  const lines = [projectDisplayLabel(project)]
  const count = Math.max(
    Array.isArray(project?.sessions) ? project.sessions.length : 0,
    Number(project?.sessionCount) || 0
  )
  lines.push(`${count} 个会话`)
  const source = String(project?.sourceLabel || projectRemoteLabel(project) || '').trim()
  lines.push(source ? `网关：${source}` : '网关：本机')
  const path = projectWorkspacePath(project)
  if (path) {
    lines.push(`路径：${path}`)
  }
  const profile = String(project?.profile || '').trim()
  if (profile && profile.toLowerCase() !== PROFILE_SCOPE_DEFAULT) {
    lines.push(`配置：${profile}`)
  }
  return lines.filter(Boolean).join('\n')
}

function shouldResortProjectsForUserInput(input) {
  const reason = input && input.reason
  if (reason === 'refresh' || reason === 'new-chat') {
    return true
  }
  // Only a send in the session the user is already looking at may reorder the
  // rail: the focused session id must be unchanged while its busy flag rises.
  // Switching to an already-busy session also flips busy false→true, but that
  // is navigation, not a send — gating on the id keeps the list from jumping.
  if (input.previousSessionId !== input.sessionId) {
    return false
  }
  return Boolean(input) && input.previousBusy === false && input.busy === true
}

function pendingNewChatAppeared(pending, projects) {
  const projectKey = String(pending?.projectKey || '').trim()
  const sessionId = String(pending?.sessionId || '').trim()
  if (!projectKey || !sessionId) {
    return false
  }
  const project = (Array.isArray(projects) ? projects : []).find(row => row?.key === projectKey)
  return Boolean(project?.sessions?.some(session => session?.id === sessionId))
}

function stabilizeProjectOrder(projects, previousKeys, options) {
  const list = Array.isArray(projects) ? [...projects] : []
  const previous = Array.isArray(previousKeys) ? previousKeys : []
  const resort = Boolean(options && options.resort)
  if (list.length === 0) {
    return list
  }
  if (resort || previous.length === 0) {
    return list.sort(compareProjects)
  }

  const byKey = new Map(list.map(project => [project.key, project]))
  const ordered = []
  for (const key of previous) {
    const project = byKey.get(key)
    if (!project) continue
    ordered.push(project)
    byKey.delete(key)
  }
  const newcomers = [...byKey.values()].sort(compareProjects)
  return [...ordered, ...newcomers]
}

// Same freeze as stabilizeProjectOrder but for the sessions inside one project:
// keep the previous id order between resort epochs, only re-sorting by live
// activity on the first paint or when the user actually sends. Unsolicited
// newcomers append after frozen rows; a chat created from this pane is promoted
// once its exact project/session pair appears in refreshed data.
function stabilizeSessionOrder(sessions, previousIds, options) {
  const list = Array.isArray(sessions) ? [...sessions] : []
  const previous = Array.isArray(previousIds) ? previousIds : []
  const resort = Boolean(options && options.resort)
  if (list.length === 0) {
    return list
  }
  if (resort || previous.length === 0) {
    return list.sort(compareSessions)
  }

  const byId = new Map(list.map(session => [session.id, session]))
  const ordered = []
  for (const id of previous) {
    const session = byId.get(id)
    if (!session) continue
    ordered.push(session)
    byId.delete(id)
  }
  const newcomers = [...byId.values()].sort(compareSessions)
  return [...ordered, ...newcomers]
}

function sessionProfile(session, project) {
  return String(session?.profile || project?.route?.targetProfile || project?.route?.profile || 'default').trim() || 'default'
}

function sessionRoute(project) {
  const route = project?.route
  if (
    !route ||
    !String(route.connectionId || '').trim() ||
    !String(route.profile || '').trim() ||
    !String(route.targetProfile || '').trim()
  ) {
    return null
  }
  const profile = String(route.profile).trim()
  const targetProfile = String(route.targetProfile).trim()
  if (!profile || !targetProfile) {
    return null
  }
  return {
    connectionId: String(route.connectionId).trim(),
    mode: route.mode === 'local' ? 'local' : 'remote',
    profile,
    targetProfile
  }
}

function notifyActionError(error, fallback) {
  host.notify({
    kind: 'error',
    message: error instanceof Error ? error.message : fallback
  })
}

function verifySessionMutationResult(result, body, fallback) {
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok') && result.ok === false) {
    throw new Error(result.error || fallback)
  }
  return result
}

async function mutateGatewaySession(project, session, method, body) {
  const route = sessionRoute(project)
  const profile = routeTargetProfile(route)

  if (!route || !route.targetProfile) {
    throw new Error('当前 Hermes Desktop 无法识别该会话来源。')
  }

  if (method === 'PATCH' && Object.prototype.hasOwnProperty.call(body || {}, 'hidden')) {
    if (typeof host.setPersistedSessionHidden !== 'function') {
      throw new Error('当前 Hermes Desktop 不支持跨来源隐藏会话。')
    }
    return host.setPersistedSessionHidden(route, {
      hidden: Boolean(body.hidden),
      profile,
      sessionId: session.id
    })
  }

  // Session metadata mutations are REST resources, not gateway JSON-RPC
  // methods. `host.requestProfile` is reserved for live gateway RPC; these
  // mutations use the public connection-qualified Desktop REST bridge.
  const desktop = typeof window !== 'undefined' ? window.hermesDesktop : null
  if (typeof desktop?.api !== 'function') {
    throw new Error('当前 Hermes Desktop 不支持跨来源修改会话。')
  }

  const path = `/api/sessions/${encodeURIComponent(session.id)}`
  const request = {
    // `HermesApiRequest.profile` is the backend selector; the endpoint itself
    // accepts the session metadata body and does not need a second profile key.
    connectionId: route.connectionId,
    method,
    path,
    profile,
    ...(body == null ? {} : { body })
  }

  return desktop.api(request)
}

function SessionRenameDialog({ open, onOpenChange, project, session, onChanged }) {
  const [value, setValue] = useState(() => sessionRowTitle(session))
  const [saving, setSaving] = useState(false)

  if (!open) {
    return null
  }

  const save = async () => {
    const title = value.trim()
    if (!title || saving) {
      return
    }
    setSaving(true)
    try {
      const result = await mutateGatewaySession(project, session, 'PATCH', { title })
      verifySessionMutationResult(result, { title }, '重命名会话失败。')
      onOpenChange(false)
      onChanged?.({ body: { title }, method: 'PATCH', project, result, session })
    } catch (error) {
      notifyActionError(error, '无法重命名会话。')
    } finally {
      setSaving(false)
    }
  }

  return jsx(Dialog, {
    open,
    onOpenChange,
    children: jsx(DialogContent, {
      className: 'max-w-md',
      children: [
        jsx(DialogHeader, { children: jsx(DialogTitle, { children: '重命名会话' }) }, 'header'),
        jsx(Input, {
          autoFocus: true,
          disabled: saving,
          onChange: event => setValue(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void save()
            }
          },
          value
        }, 'input'),
        jsx(DialogFooter, {
          children: [
            jsx(Button, { disabled: saving, onClick: () => onOpenChange(false), variant: 'ghost', children: '取消' }, 'cancel'),
            jsx(Button, { disabled: saving || !value.trim(), onClick: () => void save(), children: '保存' }, 'save')
          ]
        }, 'footer')
      ]
    })
  })
}

function sessionMenuItems({ Item, Separator, actions, session }) {
  const { route, routeSupportsRest, title } = actions
  const unread = sessionUnread(session)

  return [
    ...(route?.mode === 'local'
      ? [jsx(Item, { onSelect: actions.openTerminal, children: [jsx(Codicon, { name: 'terminal', size: '0.875rem' }, 'icon'), jsx('span', { children: '在终端中打开' }, 'label')] }, 'terminal')]
      : []),
    jsx(Item, { onSelect: actions.openWindow, children: [jsx(Codicon, { name: 'link-external', size: '0.875rem' }, 'icon'), jsx('span', { children: '新窗口' }, 'label')] }, 'new-window'),
    jsx(Separator, {}, 'separator-open'),
    jsx(Item, { onSelect: actions.renameSession, children: [jsx(Codicon, { name: 'edit', size: '0.875rem' }, 'icon'), jsx('span', { children: '重命名' }, 'label')] }, 'rename'),
    jsx(Item, { disabled: !routeSupportsRest, onSelect: actions.togglePinned, children: [jsx(Codicon, { name: 'pin', size: '0.875rem' }, 'icon'), jsx('span', { children: sessionPinned(session) ? '取消置顶' : '置顶' }, 'label')] }, 'pin'),
    jsx(Item, { disabled: !routeSupportsRest, onSelect: actions.toggleUnread, children: [jsx(Codicon, { name: unread ? 'mail-read' : 'mail' }, 'icon'), jsx('span', { children: unread ? '标记为已读' : '标记为未读' }, 'label')] }, 'read'),
    jsx(Separator, {}, 'separator-work'),
    jsx(Item, { onSelect: actions.copySessionId, children: [jsx(Codicon, { name: 'copy', size: '0.875rem' }, 'icon'), jsx('span', { children: '复制 ID' }, 'label')] }, 'copy-id'),
    jsx(Separator, {}, 'separator-danger'),
    jsx(Item, { disabled: !routeSupportsRest, onSelect: actions.archiveSession, children: [jsx(Codicon, { name: 'archive', size: '0.875rem' }, 'icon'), jsx('span', { children: '归档' }, 'label')] }, 'archive'),
    jsx(Item, { disabled: !routeSupportsRest, variant: 'destructive', onSelect: actions.deleteSession, children: [jsx(Codicon, { name: 'trash', size: '0.875rem' }, 'icon'), jsx('span', { children: '删除' }, 'label')] }, 'delete')
  ]
}

function SessionContextMenu({ children, project, session, onChanged }) {
  const [renameOpen, setRenameOpen] = useState(false)
  const actions = sessionActionHandlers(project, session, onChanged, setRenameOpen)
  const items = sessionMenuItems({ Item: ContextMenuItem, Separator: ContextMenuSeparator, actions, session })

  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children }, 'trigger'),
      jsx(ContextMenuContent, { 'aria-label': `会话操作：${actions.title}`, className: 'w-44', children: items }, 'content'),
      jsx(SessionRenameDialog, { open: renameOpen, onOpenChange: setRenameOpen, onChanged, project, session }, 'rename-dialog')
    ]
  })
}

function sessionActionHandlers(project, session, onChanged, setRenameOpen) {
  const title = sessionRowTitle(session)
  const route = sessionRoute(project)
  const profile = sessionProfile(session, project)
  const routeSupportsRest = Boolean(
    route?.connectionId &&
      route?.profile &&
      route?.targetProfile &&
      typeof window !== 'undefined' &&
      typeof window.hermesDesktop?.api === 'function'
  )
  const run = async (method, body, message) => {
    try {
      const result = await mutateGatewaySession(project, session, method, body)
      verifySessionMutationResult(result, body, message)
      onChanged?.({ body, method, project, result, session })
    } catch (error) {
      notifyActionError(error, message)
    }
  }

  return {
    archiveSession: () => {
      if (!routeSupportsRest) return
      void run('PATCH', { archived: true }, '无法归档会话。')
    },
    copySessionId: async () => {
      const bridge = typeof window !== 'undefined' ? window.hermesDesktop : null
      if (typeof bridge?.writeClipboard !== 'function') {
        notifyActionError(null, '复制会话 ID 不可用。')
        return
      }
      try {
        const copied = await bridge.writeClipboard(session.id)
        if (!copied) throw new Error('复制会话 ID 不可用。')
        host.notify({ kind: 'success', message: '已复制会话 ID。' })
      } catch (error) {
        notifyActionError(error, '复制会话 ID 失败。')
      }
    },
    deleteSession: () => {
      if (typeof window !== 'undefined' && !window.confirm(`确定删除会话“${title}”吗？`)) return
      void run('DELETE', null, '无法删除会话。')
    },
    openTerminal: () => {
      const bridge = typeof window !== 'undefined' ? window.hermesDesktop : null
      if (typeof bridge?.openSessionInTerminal !== 'function') {
        notifyActionError(null, '无法在终端中打开会话。')
        return
      }
      void bridge.openSessionInTerminal(session.id, { cwd: session.cwd || undefined, profile }).then(result => {
        if (!result?.ok) notifyActionError(new Error(result?.error || '无法在终端中打开会话。'), '无法在终端中打开会话。')
      }).catch(error => notifyActionError(error, '无法在终端中打开会话。'))
    },
    openWindow: () => {
      const bridge = typeof window !== 'undefined' ? window.hermesDesktop : null
      if (typeof bridge?.openSessionWindow !== 'function') {
        notifyActionError(null, '无法打开新窗口。')
        return
      }
      void bridge.openSessionWindow(session.id, { watch: false }).then(result => {
        if (!result?.ok) notifyActionError(new Error(result?.error || '无法打开新窗口。'), '无法打开新窗口。')
      }).catch(error => notifyActionError(error, '无法打开新窗口。'))
    },
    renameSession: () => setRenameOpen(true),
    route,
    routeSupportsRest,
    title,
    togglePinned: () => {
      if (!routeSupportsRest) return
      void run('PATCH', { pinned: !sessionPinned(session) }, '无法更新会话置顶状态。')
    },
    toggleUnread: () => {
      if (!routeSupportsRest) return
      void run('PATCH', { unread: !sessionUnread(session) }, '无法更新会话已读状态。')
    }
  }
}

function SessionActionsMenu({ children, project, session, onChanged }) {
  const [renameOpen, setRenameOpen] = useState(false)
  const actions = sessionActionHandlers(project, session, onChanged, setRenameOpen)
  const items = sessionMenuItems({ Item: DropdownMenuItem, Separator: DropdownMenuSeparator, actions, session })

  return jsxs(DropdownMenu, {
    children: [
      jsx(DropdownMenuTrigger, { 'aria-haspopup': 'menu', asChild: true, children }, 'trigger'),
      jsx(DropdownMenuContent, { 'aria-label': `会话操作：${actions.title}`, align: 'end', className: 'w-44', children: items }, 'content'),
      jsx(SessionRenameDialog, { open: renameOpen, onOpenChange: setRenameOpen, onChanged, project, session }, 'rename-dialog')
    ]
  })
}

function focusedSessionMatches(session, project, focusedStoredSessionId, focusedSessionOwner) {
  const focusedId = String(focusedStoredSessionId || '').trim()
  const sessionId = String(session?.id || '').trim()
  if (!focusedId || focusedId !== sessionId) {
    return false
  }

  // Older Desktop builds expose the focused stored id before the owner atom.
  // Keep the id-only fallback for that compatibility window; once an owner is
  // present, require the route's connection and one of its profile aliases so
  // duplicate stored ids on different gateways cannot both look selected.
  if (!focusedSessionOwner || typeof focusedSessionOwner !== 'object') {
    return true
  }

  const connectionId = String(project?.route?.connectionId || '').trim()
  const ownerConnectionId = String(focusedSessionOwner.connectionId || '').trim()
  const ownerProfile = String(focusedSessionOwner.profile || '').trim()
  const profiles = [project?.route?.profile, project?.route?.targetProfile, session?.profile]
    .map(value => String(value || '').trim())
    .filter(Boolean)
  return Boolean(connectionId && ownerConnectionId && connectionId === ownerConnectionId && profiles.includes(ownerProfile))
}

function routeKey(route) {
  return [route?.connectionId, route?.profile, route?.targetProfile]
    .map(value => String(value || 'default').trim())
    .join('::')
}

function routeTargetProfile(route) {
  return String(route?.targetProfile || route?.profile || 'default').trim() || 'default'
}

function routeSourceLabel(route, agent, sourceById) {
  return String(agent?.connectionLabel || sourceById.get(route?.connectionId)?.label || route?.connectionId || 'Gateway')
}

function routeIsRemote(route, sourceById) {
  const source = sourceById.get(route?.connectionId)
  return source?.kind === 'remote' || source?.kind === 'ssh' || route?.mode === 'remote'
}

function routeRemoteLabel(route, sourceById) {
  if (!routeIsRemote(route, sourceById)) {
    return ''
  }

  const source = sourceById.get(route?.connectionId)
  // The registry exposes `host` as a credential-free hostname/IP. Never parse
  // the protected URL or any connection string in the plugin.
  const value = source?.host
  return String(value || '').trim()
}

function isHomeProject(project) {
  return project?.key === HOME_PROJECT_KEY || project?.sourceKey === HOME_PROJECT_KEY
}

function projectDisplayLabel(project) {
  return isHomeProject(project) ? HOME_PROJECT_LABEL : project.label
}

function projectRemoteLabel(project) {
  return isHomeProject(project) ? '' : String(project?.remoteLabel || '').trim()
}

function monitorProjectGatewayLabel(project) {
  const route = project?.route
  if (!route) return '本地网关'
  const remote = route.mode === 'remote' || Boolean(projectRemoteLabel(project))
  const source = remote
    ? String(project?.sourceLabel || projectRemoteLabel(project) || route.connectionId || '远程网关').trim()
    : '本地网关'
  const profile = routeTargetProfile(route)
  const profileLabel = profile && profile.toLowerCase() !== PROFILE_SCOPE_DEFAULT ? profile : ''
  return [source, profileLabel].filter(Boolean).join(' · ')
}

function projectSourceBadge(project) {
  const profile = String(project?.profile || '').trim()
  const profileLabel = profile && profile.toLowerCase() !== PROFILE_SCOPE_DEFAULT ? profile : ''
  const remote = project?.route?.mode === 'remote' || Boolean(projectRemoteLabel(project))
  const sourceLabel = remote
    ? String(project?.sourceLabel || projectRemoteLabel(project) || '').trim()
    : ''
  return [sourceLabel, profileLabel].filter(Boolean).join(' · ')
}

function flattenGatewaySessions(data) {
  const rows = Array.isArray(data?.sessions)
    ? data.sessions
    : Array.isArray(data?.items)
      ? data.items
      : []
  return rows
    .filter(session => session && typeof session.id === 'string' && session.id.trim())
    .map(session => normalizeSessionRecord(session, data?.profile))
}

function projectPathKey(value) {
  const raw = String(value || '').trim().replace(/[\\/]+$/, '').replace(/\\/g, '/')
  if (!raw) {
    return ''
  }

  return /^[A-Za-z]:\//.test(raw) || raw.startsWith('//') ? raw.toLowerCase() : raw
}

function projectPathContains(target, root) {
  const targetKey = projectPathKey(target)
  const rootKey = projectPathKey(root)
  return Boolean(targetKey && rootKey && (targetKey === rootKey || targetKey.startsWith(`${rootKey}/`)))
}

function projectTreeNodePaths(project) {
  return [
    project?.path,
    project?.primary_path,
    ...(Array.isArray(project?.repos) ? project.repos.flatMap(repo => [
      repo?.id,
      repo?.path,
      ...(Array.isArray(repo?.groups) ? repo.groups.map(group => group?.path) : [])
    ]) : [])
  ].filter(value => typeof value === 'string' && value.trim())
}

function projectTreeEntries(projectTree) {
  const projects = Array.isArray(projectTree?.projects) ? projectTree.projects : []
  return projects
    .filter(project => project && !project.isNoProject)
    .map(project => ({ project, paths: projectTreeNodePaths(project) }))
    .filter(entry => entry.paths.length > 0)
}

function normalizeProjectSessions(sessions, fallbackProfile, hideScheduled) {
  const byId = new Map()
  for (const value of Array.isArray(sessions) ? sessions : []) {
    if (!value || typeof value.id !== 'string' || !value.id.trim()) {
      continue
    }
    const session = normalizeSessionRecord(value, fallbackProfile)
    if (hideScheduled && sessionIsScheduled(session)) {
      continue
    }
    const existing = byId.get(session.id)
    if (!existing || sessionActivityValue(session) > sessionActivityValue(existing)) {
      byId.set(session.id, session)
    }
  }
  return [...byId.values()].sort(compareSessions)
}

function flattenProjectNodeSessions(project, fallbackProfile, hideScheduled) {
  const laneSessions = Array.isArray(project?.repos)
    ? project.repos.flatMap(repo => Array.isArray(repo?.groups)
      ? repo.groups.flatMap(group => Array.isArray(group?.sessions) ? group.sessions : [])
      : [])
    : []
  return normalizeProjectSessions(
    [...laneSessions, ...(Array.isArray(project?.previewSessions) ? project.previewSessions : [])],
    fallbackProfile,
    hideScheduled
  )
}

function directProjectDescriptor(session) {
  const project = session?.project
  if (project && typeof project === 'object') {
    const key = [project.id, project.project_id, project.path, project.name, project.label]
      .find(value => typeof value === 'string' && value.trim())
    if (key) {
      const path = String(project.path || '').trim()
      return {
        explicit: true,
        key: `project:${String(key).trim()}`,
        label: String(project.name || project.label || key).trim(),
        path: path || null
      }
    }
  }

  if (typeof project === 'string' && project.trim()) {
    return { explicit: true, key: `project:${project.trim()}`, label: project.trim() }
  }

  const explicit = [
    ['project_id', session?.project_id],
    ['projectId', session?.projectId],
    ['project_name', session?.project_name],
    ['workspace_id', session?.workspace_id],
    ['workspaceId', session?.workspaceId],
    ['workspace_name', session?.workspace_name]
  ].find(([, value]) => typeof value === 'string' && value.trim())

  if (explicit) {
    return { explicit: true, key: `project:${explicit[1].trim()}`, label: explicit[1].trim() }
  }

  const workspace = session?.workspace
  if (workspace && typeof workspace === 'object') {
    const key = [workspace.id, workspace.path, workspace.name, workspace.label]
      .find(value => typeof value === 'string' && value.trim())
    if (key) {
      return {
        explicit: true,
        key: `workspace:${String(key).trim()}`,
        label: String(workspace.name || workspace.label || key).trim()
      }
    }
  }

  return null
}

function projectDescriptorForSession(session, projectTree) {
  const direct = directProjectDescriptor(session)
  if (direct) {
    return direct
  }

  const targets = [session?.git_repo_root, session?.cwd]
    .filter(value => typeof value === 'string' && value.trim())
  let best = null
  let bestLength = -1

  for (const entry of projectTreeEntries(projectTree)) {
    for (const path of entry.paths) {
      if (projectPathContains(targets[0], path) || projectPathContains(targets[1], path)) {
        const length = projectPathKey(path).length
        if (length > bestLength) {
          best = entry.project
          bestLength = length
        }
      }
    }
  }

  if (best) {
    const treePath = projectTreeEntries(projectTree).find(entry => entry.project === best)?.paths[0] || ''
    return {
      explicit: !best.isAuto,
      key: `project-tree:${String(best.id || best.label || 'unknown')}`,
      label: String(best.label || best.name || best.id || 'Project').trim(),
      path: String(treePath || '').trim() || null
    }
  }

  // `git_repo_root` is an authoritative public session field. Do not promote a
  // bare cwd, title, or preview to a project: non-git sessions stay in Home
  // until Hermes exposes an explicit workspace/project field for that row.
  const repoRoot = typeof session?.git_repo_root === 'string' ? session.git_repo_root.trim() : ''
  if (repoRoot) {
    const segments = repoRoot.replace(/[\/]+$/, '').split(/[\/]/).filter(Boolean)
    return { explicit: true, key: `repo:${repoRoot}`, label: segments.at(-1) || repoRoot, path: repoRoot }
  }

  return { explicit: false, key: HOME_PROJECT_KEY, label: HOME_PROJECT_LABEL, path: null }
}

function projectTreePathForDescriptor(descriptor, projectTree) {
  if (!descriptor) return null
  const key = String(descriptor.key || '').trim()
  if (!key || key === HOME_PROJECT_KEY) return null
  if (key.startsWith('repo:')) {
    return key.slice(5).trim() || null
  }

  const rest = key.includes(':') ? key.slice(key.indexOf(':') + 1).trim() : ''
  if (
    (key.startsWith('project:') || key.startsWith('workspace:')) &&
    rest &&
    (rest.startsWith('/') || /^[A-Za-z]:[\/]/.test(rest) || rest.startsWith('//'))
  ) {
    return rest
  }

  for (const entry of projectTreeEntries(projectTree)) {
    const id = String(entry.project.id || '').trim()
    const label = String(entry.project.label || entry.project.name || '').trim()
    if (
      (id && (key === `project-tree:${id}` || key === `project:${id}`)) ||
      (label && (key === `project-tree:${label}` || key === `project:${label}` || descriptor.label === label))
    ) {
      return String(entry.paths[0] || '').trim() || null
    }
  }

  return null
}

function projectWorkspacePathFromDescriptor(descriptor, projectTree) {
  return projectTreePathForDescriptor(descriptor, projectTree)
}

function projectWorkspacePath(project) {
  if (isHomeProject(project)) return null
  const direct = String(project?.path || '').trim()
  if (direct) return direct
  return projectWorkspacePathFromDescriptor(
    { key: project?.sourceKey || project?.key, label: project?.label },
    project?.projectTree
  )
}

function sessionProjectKey(session, projectTree) {
  return projectDescriptorForSession(session, projectTree).key
}

function sessionProjectLabel(session, projectTree) {
  return projectDescriptorForSession(session, projectTree).label
}

function sessionIsScheduled(session) {
  // `source: 'cron'` is the stable public marker written by the scheduler. Do
  // not infer scheduler origin from a title, preview, path, or message content.
  return typeof session?.source === 'string' && session.source.trim().toLowerCase() === 'cron'
}

function gatewayInboxSummary(groups, hideScheduled = true) {
  const list = Array.isArray(groups) ? groups : []
  let failed = 0
  let loaded = 0
  let open = 0
  let pinned = 0
  let unread = 0
  let partial = false

  for (const group of list) {
    if (group?.error) {
      failed += 1
      continue
    }
    if (group?.hasMore) partial = true
    const sessions = Array.isArray(group?.sessions) ? group.sessions : []
    for (const session of sessions) {
      if (hideScheduled && sessionIsScheduled(session)) continue
      loaded += 1
      if (sessionUnread(session)) unread += 1
      if (sessionActive(session)) open += 1
      if (sessionPinned(session)) pinned += 1
    }
  }

  return { failed, loaded, open, partial, pinned, unread }
}

function refreshGatewaySessionQueries({ refreshRoutes = true } = {}) {
  if (refreshRoutes) {
    gatewayRouteCache.at = 0
    clearGatewayProjectTreeCache()
  } else {
    clearGatewayProjectSessionsCache()
  }
  $gatewayProjectDataRevision.set($gatewayProjectDataRevision.get() + 1)
  if (typeof pluginQueryClient?.refetchQueries !== 'function') {
    return Promise.resolve()
  }
  return pluginQueryClient.refetchQueries({ queryKey: GATEWAY_SESSIONS_KEY })
}

function subscribeGatewaySessionEvents() {
  if (typeof host.onEvent !== 'function' || typeof pluginQueryClient?.refetchQueries !== 'function') {
    return () => {}
  }

  let timer = 0
  const pendingEvents = new Map()
  const refreshFromEvent = event => {
    if (!event || !SESSION_FRESHNESS_EVENT_TYPES.has(event.type)) {
      return
    }
    const routeKey = eventRouteKey(event)
    const sessionId = eventSessionId(event)
    if (!routeKey) {
      return
    }
    const eventKey = `${routeKey}::${sessionId || 'route'}::${event.type}`
    const pendingEvent = pendingEvents.get(eventKey)
    if (!pendingEvent || eventTimestampMs(event) >= eventTimestampMs(pendingEvent)) {
      pendingEvents.set(eventKey, event)
    }
    if (timer) {
      window.clearTimeout(timer)
    }
    timer = window.setTimeout(() => {
      timer = 0
      const events = [...pendingEvents.values()]
      pendingEvents.clear()
      sessionDataRevision.current += 1
      const profileScope = $gatewaySessionPrefs.get().profileScope
      const sessionsQueryKey = [...GATEWAY_SESSIONS_KEY, profileScope]
      void pluginQueryClient.cancelQueries({ queryKey: sessionsQueryKey })
      const current = pluginQueryClient.getQueryData(sessionsQueryKey)
      const patchedGroups = patchSessionGroupsFromEvents(current?.groups, events)
      if (patchedGroups !== current?.groups) {
        pluginQueryClient.setQueryData(sessionsQueryKey, value => value ? { ...value, groups: patchSessionGroupsFromEvents(value.groups, events) } : value)
      }
      void pluginQueryClient.refetchQueries({ queryKey: GATEWAY_SESSIONS_KEY, type: 'active' })
    }, GATEWAY_EVENT_REFRESH_DEBOUNCE_MS)
  }

  const dispose = host.onEvent('*', event => {
    refreshFromEvent(event)
    const sessionId = canonicalMobileSessionId(mobileEventSessionId(event))
    if (MOBILE_TRANSCRIPT_EVENT_TYPES.has(event.type)) {
      if (event.type === 'message.complete') noteMobileTurnComplete(sessionId)
      else if (event.type !== 'todo.updated') noteMobileTurnActivity(sessionId)
      if (sessionId) {
        scheduleMobileTranscriptPush(sessionId)
      } else {
        for (const id of mobileWatchedSessionIds) scheduleMobileTranscriptPush(id)
      }
    }
    if (MOBILE_ACTIVITY_EVENT_TYPES.has(event.type) && sessionId) {
      if (event.type.startsWith('subagent.') && event.type !== 'subagent.complete') {
        noteMobileTurnActivity(sessionId)
      }
      applyMobileActivityEvent(event, sessionId)
    }
    if (MOBILE_SNAPSHOT_EVENT_TYPES.has(event.type)) {
      scheduleMobileBridgeSnapshot()
    }
  })
  return () => {
    if (timer) {
      window.clearTimeout(timer)
    }
    dispose?.()
  }
}

function eventTimestampMs(event, fallback = 0) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null
  const value = payload?.timestamp ?? event?.timestamp
  const parsed = sessionTimestampMs(value)
  return parsed > 0 ? parsed : fallback
}

function sessionMatchesFilter(session, filter = 'all') {
  if (filter === 'unread') return sessionUnread(session)
  // The persisted `is_active` field means the backend session is still open;
  // it is not the model's live turn state. Native SessionStatusDot owns the
  // actual working/stalled/needs-input semantics.
  if (filter === 'open') return sessionActive(session)
  if (filter === 'pinned') return sessionPinned(session)
  if (filter === 'recent') {
    const changedAt = sessionActivityValue(session)
    const now = Date.now()
    return changedAt > 0 && changedAt <= now && now - changedAt < RECENT_SESSION_WINDOW_MS
  }
  return true
}

function sessionTimestampMs(value) {
  if (typeof value === 'string' && value.trim() && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return numeric < 100_000_000_000 ? numeric * 1000 : numeric
}

function projectGroupsForGatewayGroup(group, hideScheduled) {
  const projectMap = new Map()
  const route = group.route

  const ensureProject = (descriptor, path, treeNode = null) => {
    const projectKey = `${group.key}::${descriptor.key}`
    const existing = projectMap.get(projectKey)
    if (existing) {
      if (!existing.path && path) existing.path = path
      return existing
    }

    const previewSessions = treeNode
      ? flattenProjectNodeSessions(treeNode, group.profile, hideScheduled)
      : []
    const project = {
      key: projectKey,
      sourceKey: descriptor.key,
      label: descriptor.label,
      hasExplicitMetadata: descriptor.explicit,
      remoteLabel: group.remoteLabel,
      sourceLabel: group.label,
      profile: group.profile,
      route,
      path: path || '',
      projectTree: group.projectTree,
      projectId: treeNode ? String(treeNode.id || '').trim() : '',
      authoritative: Boolean(treeNode),
      lastActive: treeNode ? Number(treeNode.lastActive) || 0 : 0,
      sessionCount: treeNode ? Math.max(previewSessions.length, Number(treeNode.sessionCount) || 0) : 0,
      previewSessions,
      prefetchedSessions: [],
      sessions: previewSessions
    }
    projectMap.set(projectKey, project)
    return project
  }

  // The backend tree is the authority for project identity, counts, and the
  // initial five-row preview. It also includes the Home bucket.
  const treeProjects = Array.isArray(group.projectTree?.projects) ? group.projectTree.projects : []
  for (const treeNode of treeProjects) {
    if (!treeNode) continue
    const home = Boolean(treeNode.isNoProject)
    const descriptor = {
      explicit: !home && !treeNode.isAuto,
      key: home ? HOME_PROJECT_KEY : `project-tree:${String(treeNode.id || treeNode.label || 'unknown')}`,
      label: home ? HOME_PROJECT_LABEL : String(treeNode.label || treeNode.name || treeNode.id || 'Project').trim()
    }
    ensureProject(descriptor, projectTreeNodePaths(treeNode)[0] || '', treeNode)
  }

  // The flat source window remains useful for fresh titles/status and search.
  // It may be incomplete, so it never replaces an authoritative tree count.
  for (const session of group.sessions) {
    if (hideScheduled && sessionIsScheduled(session)) {
      continue
    }

    const descriptor = projectDescriptorForSession(session, group.projectTree)
    const path = descriptor.path || projectTreePathForDescriptor(descriptor, group.projectTree) || ''
    const pathKey = projectPathKey(path)
    const directTreeMatch = projectMap.get(`${group.key}::${descriptor.key}`)
    const treeMatch = directTreeMatch || (pathKey
      ? [...projectMap.values()].find(item => projectPathKey(item.path) === pathKey)
      : null)
    const project = treeMatch || ensureProject(descriptor, path)
    project.prefetchedSessions.push(session)
  }

  return [...projectMap.values()].map(project => {
    const prefetchedSessions = normalizeProjectSessions(
      [...project.prefetchedSessions, ...project.previewSessions],
      group.profile,
      hideScheduled
    )
    const prefetchedComplete = project.authoritative
      ? !group.hasMore || prefetchedSessions.length >= project.sessionCount
      : true
    const sessionCount = project.authoritative
      ? prefetchedComplete
        ? prefetchedSessions.length
        : Math.max(project.sessionCount, prefetchedSessions.length)
      : prefetchedSessions.length
    const sessions = project.authoritative
      ? prefetchedSessions.slice(0, PROJECT_SESSION_PREVIEW_LIMIT)
      : prefetchedSessions

    return {
      ...project,
      prefetchedComplete,
      prefetchedSessions,
      sessionCount,
      sessions
    }
  })
}

function normalizeSessionPage(data) {
  if (Array.isArray(data)) {
    return { sessions: data }
  }

  return data && typeof data === 'object' ? data : { sessions: [] }
}

const gatewayRouteCache = {
  at: 0,
  promise: null,
  routes: null
}
const gatewayProjectTreeCache = new Map()
const gatewayProjectSessionsCache = new Map()

function gatewayProjectSessionsCacheKey(project) {
  const projectId = String(project?.projectId || '').trim()
  return project?.route && projectId ? `${routeKey(project.route)}::${projectId}` : ''
}

function clearGatewayProjectSessionsCache(project) {
  const key = gatewayProjectSessionsCacheKey(project)
  if (key) {
    gatewayProjectSessionsCache.delete(key)
  } else {
    gatewayProjectSessionsCache.clear()
  }
}

function isGatewayUnknownMethodError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('unknown method:')
}

function projectSessionsUnsupportedMessage() {
  return '当前网关 Hermes 版本过旧，不支持读取项目会话。请升级该网关的 Hermes 后重试。'
}

async function fetchGatewayProjectSessions(project) {
  const key = gatewayProjectSessionsCacheKey(project)
  if (!key || typeof host.requestProfile !== 'function') {
    throw new Error('当前 Hermes 版本无法读取项目会话。')
  }
  const cached = gatewayProjectSessionsCache.get(key)
  if (cached?.sessions) {
    return cached.sessions
  }
  if (cached?.promise) {
    return cached.promise
  }

  // Old gateways answer with JSON-RPC -32601 "unknown method". That verdict is
  // stable for the gateway's lifetime, so cache it and serve the tree preview
  // instead of letting the user retry a call that can never succeed.
  const previewFallback = () => {
    const fallback = Array.isArray(project.previewSessions) && project.previewSessions.length
      ? project.previewSessions
      : (Array.isArray(project.prefetchedSessions) && project.prefetchedSessions.length
        ? project.prefetchedSessions
        : project.sessions)
    return Array.isArray(fallback) ? fallback : []
  }

  const promise = Promise.resolve()
    .then(() => host.requestProfile(project.route, 'projects.project_sessions', {
      project_id: project.projectId,
      profile: routeTargetProfile(project.route)
    }))
    .then(response => {
      const node = response?.project
      if (!node || typeof node !== 'object') {
        throw new Error('项目会话不存在。')
      }
      const sessions = flattenProjectNodeSessions(node, project.profile, false)
      gatewayProjectSessionsCache.set(key, { sessions })
      return sessions
    })
    .catch(error => {
      if (isGatewayUnknownMethodError(error)) {
        const sessions = previewFallback()
        gatewayProjectSessionsCache.set(key, { sessions, unsupported: true })
        return sessions
      }
      gatewayProjectSessionsCache.delete(key)
      throw error
    })

  gatewayProjectSessionsCache.set(key, { promise })
  return promise
}

function usableProfileRoute(route) {
  return Boolean(
    route &&
    String(route.connectionId || '').trim() &&
    String(route.profile || '').trim() &&
    String(route.targetProfile || '').trim()
  )
}

async function cachedGatewayRoutes() {
  const now = Date.now()
  if (gatewayRouteCache.routes && now - gatewayRouteCache.at < GATEWAY_ROUTE_CACHE_MS) {
    return gatewayRouteCache.routes
  }
  if (gatewayRouteCache.promise) {
    return gatewayRouteCache.promise
  }
  if (typeof host.profileRoutes !== 'function') {
    throw new Error('请更新 Hermes Desktop 以读取网关配置。')
  }

  const promise = Promise.resolve()
    .then(() => host.profileRoutes())
    .then(routes => {
      const usable = Array.isArray(routes) ? routes.filter(usableProfileRoute) : []
      gatewayRouteCache.routes = usable
      gatewayRouteCache.at = Date.now()
      return usable
    })
    .finally(() => {
      if (gatewayRouteCache.promise === promise) {
        gatewayRouteCache.promise = null
      }
    })
  gatewayRouteCache.promise = promise
  return promise
}

function clearGatewayProjectTreeCache() {
  gatewayProjectTreeCache.clear()
  clearGatewayProjectSessionsCache()
}

async function listGatewaySessions(route, limit = GATEWAY_SESSIONS_LIMIT) {
  if (typeof host.listPersistedSessions !== 'function') {
    throw new Error('请更新 Hermes Desktop 以读取跨网关会话。')
  }

  const requestedLimit = Math.min(GATEWAY_SESSIONS_LIMIT_MAX, Math.max(GATEWAY_SESSIONS_LIMIT, limit))
  const data = normalizeSessionPage(await host.listPersistedSessions(route, {
    limit: requestedLimit,
    profile: routeTargetProfile(route)
  }))
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const hasReportedTotal = data.total !== null && data.total !== undefined && data.total !== '' && Number.isFinite(Number(data.total))
  const reportedTotal = hasReportedTotal ? Number(data.total) : 0
  const total = hasReportedTotal ? Math.max(sessions.length, reportedTotal) : sessions.length

  // The current public session contract exposes `source`; the extra checks are
  // deliberately compatibility-only for gateways that already return an
  // explicit scheduler marker. We never classify a row from its title/content.
  const normalizedSessions = sessions
    .filter(session => session && typeof session.id === 'string' && session.id.trim())
    .map(session => normalizeSessionRecord(session, data.profile))
  return {
    hasMore: hasReportedTotal ? normalizedSessions.length < total : normalizedSessions.length >= requestedLimit,
    totalExact: hasReportedTotal,
    sessions: normalizedSessions,
    total
  }
}

async function fetchGatewayProjectTree(route) {
  if (typeof host.requestProfile !== 'function') {
    return null
  }

  const key = routeKey(route)
  const now = Date.now()
  const cached = gatewayProjectTreeCache.get(key)
  if (cached?.promise) {
    return cached.promise
  }
  if (cached && now - cached.at < GATEWAY_PROJECT_TREE_CACHE_MS) {
    return cached.value
  }

  const promise = Promise.resolve()
    .then(() => host.requestProfile(route, 'projects.tree', {
      preview_limit: PROJECT_SESSION_PREVIEW_LIMIT,
      profile: routeTargetProfile(route)
    }))
    .then(response => response && typeof response === 'object' && response.projects ? response : null)
    .then(value => {
      gatewayProjectTreeCache.set(key, { at: Date.now(), value })
      return value
    })
    .catch(error => {
      gatewayProjectTreeCache.delete(key)
      throw error
    })

  gatewayProjectTreeCache.set(key, { at: now, promise })
  return promise
}

async function fetchGatewaySessionGroup(route, sessionLimit, sourceById) {
  const [projectTree, sessions] = await Promise.all([
    fetchGatewayProjectTree(route).catch(() => null),
    listGatewaySessions(route, sessionLimit)
  ])
  return {
    key: routeKey(route),
    label: routeSourceLabel(route, null, sourceById),
    kind: sourceById.get(route.connectionId)?.kind || (route.mode === 'local' ? 'local' : 'remote'),
    remoteLabel: routeRemoteLabel(route, sourceById),
    profile: String(route.profile || routeTargetProfile(route)),
    route,
    sessions: sessions.sessions.map(session => ({ ...session, projectTree })),
    hasMore: sessions.hasMore,
    totalExact: sessions.totalExact,
    total: sessions.total,
    projectTree,
    error: null
  }
}

function failedGatewaySessionGroup(route, sourceById, error) {
  return {
    key: routeKey(route),
    label: routeSourceLabel(route, null, sourceById),
    kind: sourceById.get(route.connectionId)?.kind || (route.mode === 'local' ? 'local' : 'remote'),
    remoteLabel: routeRemoteLabel(route, sourceById),
    profile: String(route.profile || routeTargetProfile(route)),
    route,
    sessions: [],
    hasMore: false,
    totalExact: false,
    total: 0,
    projectTree: null,
    error
  }
}

async function fetchGatewaySessionGroups(profileScope = PROFILE_SCOPE_DEFAULT, sessionLimit = GATEWAY_SESSIONS_LIMIT, { refreshRoutes = false } = {}) {
  if (refreshRoutes) {
    gatewayRouteCache.at = 0
    clearGatewayProjectTreeCache()
  }
  const allRoutes = await cachedGatewayRoutes()
  const routes = profileScope === PROFILE_SCOPE_ALL
    ? allRoutes
    : allRoutes.filter(route => routeTargetProfile(route).toLowerCase() === PROFILE_SCOPE_DEFAULT)
  let connections = []

  if (typeof host.connections === 'function') {
    connections = await host.connections().catch(() => [])
  }

  const sourceById = new Map(
    connections
      .filter(connection => connection && connection.id)
      .map(connection => {
        // Keep only the registry's public display metadata in plugin memory.
        // Do not retain a raw connection object: future SDK fields must not
        // accidentally carry credentials into this UI's data graph.
        const id = String(connection.id).trim()
        return [
          id,
          {
            id,
            kind: String(connection.kind || '').trim(),
            label: String(connection.label || '').trim(),
            host: typeof connection.host === 'string' ? connection.host.trim() : ''
          }
        ]
      })
  )

  // `profileRoutes()` intentionally carries only routing identity. Join the
  // route to the credential-free registry row here so the project line can
  // show the configured gateway name (and, for remote sources, its public
  // host) without exposing URL/auth material.
  for (const route of routes) {
    const source = sourceById.get(route.connectionId)
    if (source && !source.label) {
      source.label = route.connectionId
    }
  }

  // Older hosts may expose routes but not the richer registry list. Keep the
  // panel useful in that case, while still preferring the user-facing label
  // and exact connection kind from the registry when available.
  for (const route of routes) {
    if (!sourceById.has(route.connectionId)) {
      sourceById.set(route.connectionId, {
        id: route.connectionId,
        kind: route.mode === 'local' ? 'local' : 'remote',
        label: route.connectionId
      })
    }
  }

  const groups = await Promise.all(routes.map(route => fetchGatewaySessionGroup(route, sessionLimit, sourceById)
    .catch(error => failedGatewaySessionGroup(route, sourceById, error))))

  return { groups }
}

function patchSessionRows(rows, session, body, method, result) {
  if (!Array.isArray(rows)) {
    return rows
  }
  const isDelete = method === 'DELETE'
  const pinned = body && Object.prototype.hasOwnProperty.call(body, 'pinned')
    ? sessionBooleanValue(body.pinned)
    : result && Object.prototype.hasOwnProperty.call(result, 'pinned')
      ? sessionBooleanValue(result.pinned)
      : undefined
  const unread = body && Object.prototype.hasOwnProperty.call(body, 'unread')
    ? sessionBooleanValue(body.unread)
    : result && Object.prototype.hasOwnProperty.call(result, 'unread')
      ? sessionBooleanValue(result.unread)
      : undefined
  const archived = body && Object.prototype.hasOwnProperty.call(body, 'archived')
    ? sessionBooleanValue(body.archived)
    : result && Object.prototype.hasOwnProperty.call(result, 'archived')
      ? sessionBooleanValue(result.archived)
      : undefined
  const title = body && Object.prototype.hasOwnProperty.call(body, 'title')
    ? String(body.title || '').trim()
    : result && Object.prototype.hasOwnProperty.call(result, 'title')
      ? String(result.title || '').trim()
      : undefined

  if (isDelete || archived === true) {
    return rows.filter(row => row.id !== session.id)
  }
  return rows
    .map(row => row.id === session.id
      ? {
          ...row,
          ...(pinned === undefined ? {} : { pinned }),
          ...(unread === undefined ? {} : { unread }),
          ...(title === undefined ? {} : { title })
        }
      : row)
    .sort(compareSessions)
}

function patchProjectTreeSessions(tree, session, body, method, result) {
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.projects)) {
    return tree
  }
  const isDelete = method === 'DELETE'
  const archived = body && Object.prototype.hasOwnProperty.call(body, 'archived')
    ? sessionBooleanValue(body.archived)
    : result && Object.prototype.hasOwnProperty.call(result, 'archived')
      ? sessionBooleanValue(result.archived)
      : undefined
  const removed = isDelete || archived === true
  const title = body && Object.prototype.hasOwnProperty.call(body, 'title')
    ? String(body.title || '').trim()
    : result && Object.prototype.hasOwnProperty.call(result, 'title')
      ? String(result.title || '').trim()
      : undefined

  return {
    ...tree,
    projects: tree.projects.map(node => {
      if (!node || typeof node !== 'object') {
        return node
      }
      const preview = Array.isArray(node.previewSessions) ? node.previewSessions : null
      if (!preview || !preview.some(row => row && row.id === session.id)) {
        return node
      }
      const nextPreview = removed
        ? preview.filter(row => row.id !== session.id)
        : preview.map(row => row.id === session.id
          ? { ...row, ...(title === undefined ? {} : { title }) }
          : row)
      const dropped = removed && nextPreview.length < preview.length
      return {
        ...node,
        previewSessions: nextPreview,
        ...(dropped && Number.isFinite(Number(node.sessionCount))
          ? { sessionCount: Math.max(nextPreview.length, Number(node.sessionCount) - 1) }
          : {})
      }
    })
  }
}

function patchSessionInGroups(groups, project, session, body, method, result) {
  if (!Array.isArray(groups)) {
    return groups
  }

  const routeKeyForProject = project?.route ? routeKey(project.route) : ''
  if (!routeKeyForProject) {
    return groups
  }

  return groups.map(group => {
    if (group.key !== routeKeyForProject) {
      return group
    }

    const nextSessions = patchSessionRows(group.sessions, session, body, method, result)
    const removed = nextSessions.length < group.sessions.length
    return {
      ...group,
      // The flat rows and the embedded tree preview are two copies of the same
      // sessions; patch both or the deleted row is resurrected from the tree
      // when projectGroupsForGatewayGroup rebuilds the project rows.
      projectTree: patchProjectTreeSessions(group.projectTree, session, body, method, result),
      sessions: nextSessions,
      total: removed ? Math.max(nextSessions.length, (Number(group.total) || group.sessions.length) - 1) : group.total
    }
  })
}

function gatewayRowHeight(row) {
  if (row?.type === 'pinned-header') return 28
  if (row?.type === 'more' || row?.type === 'collapse' || row?.type === 'project-loading' || row?.type === 'project-error') return 28
  // 32px content + 4px breathing gap between rows (see .codex-gateway-project-row /
  // .codex-gateway-session-row margin-top), so virtual spacers stay aligned.
  return 36
}

function gatewayVirtualWindow(rows, scrollTop, viewportHeight) {
  const list = Array.isArray(rows) ? rows : []
  const heights = list.map(gatewayRowHeight)
  const topTarget = Math.max(0, Number(scrollTop) || 0)
  const bottomTarget = topTarget + Math.max(1, Number(viewportHeight) || 1)
  let firstVisible = 0
  let firstTop = 0
  while (firstVisible < heights.length && firstTop + heights[firstVisible] <= topTarget) {
    firstTop += heights[firstVisible]
    firstVisible += 1
  }

  let firstAfterViewport = firstVisible
  let cursor = firstTop
  while (firstAfterViewport < heights.length && cursor < bottomTarget) {
    cursor += heights[firstAfterViewport]
    firstAfterViewport += 1
  }

  const start = Math.max(0, firstVisible - GATEWAY_VIRTUAL_OVERSCAN)
  const end = Math.min(list.length, firstAfterViewport + GATEWAY_VIRTUAL_OVERSCAN)
  const top = heights.slice(0, start).reduce((sum, height) => sum + height, 0)
  const bottom = heights.slice(end).reduce((sum, height) => sum + height, 0)
  return { bottom, end, start, top }
}

const GATEWAY_PINNED_SECTION_KEY = '__pinned__'

function gatewayPinnedSessionEntries(projects) {
  const entries = []
  for (const project of Array.isArray(projects) ? projects : []) {
    const sessions = Array.isArray(project?.sessions) ? project.sessions : []
    for (const session of sessions) {
      if (sessionPinned(session)) {
        entries.push({ project, session })
      }
    }
  }
  entries.sort((a, b) => sessionActivityValue(b.session) - sessionActivityValue(a.session))
  return entries
}

function gatewayRenderRows(projects, collapsed, revealed = new Set()) {
  const rows = []

  // Pinned sessions break out of their project into a dedicated top section.
  // They render only here — never duplicated under the owning project.
  const pinnedEntries = gatewayPinnedSessionEntries(projects)
  if (pinnedEntries.length > 0) {
    rows.push({ key: `pinned-header:${GATEWAY_PINNED_SECTION_KEY}`, type: 'pinned-header', count: pinnedEntries.length })
    if (!collapsed.has(GATEWAY_PINNED_SECTION_KEY)) {
      for (const entry of pinnedEntries) {
        rows.push({
          key: `pinned-session:${entry.project.key}:${entry.session.id}`,
          type: 'pinned-session',
          project: entry.project,
          session: entry.session
        })
      }
    }
  }

  for (const project of projects) {
    rows.push({ key: `project:${project.key}`, type: 'project', project })
    if (collapsed.has(project.key)) {
      continue
    }

    const allSessions = Array.isArray(project.sessions) ? project.sessions : []
    // Pinned sessions live in the pinned section only (跳出), so the project
    // renders just its unpinned rows.
    const sessions = allSessions.filter(session => !sessionPinned(session))
    const hidden = allSessions.length - sessions.length
    const sessionCount = Math.max(0, (Number(project.sessionCount) || sessions.length) - hidden)
    const canExpand = sessionCount > PROJECT_SESSION_PREVIEW_LIMIT
    const showAll = revealed.has(project.key) || !canExpand
    const visible = showAll ? sessions : sessions.slice(0, PROJECT_SESSION_PREVIEW_LIMIT)
    for (const session of visible) {
      rows.push({ key: `session:${project.key}:${session.id}`, type: 'session', project, session })
    }
    const remaining = Math.max(0, sessionCount - visible.length)
    if (!showAll && remaining > 0) {
      rows.push({
        key: `more:${project.key}`,
        type: 'more',
        project,
        remaining
      })
    }
    if (showAll && project.loadStatus === 'loading') {
      rows.push({ key: `project-loading:${project.key}`, type: 'project-loading', project })
    } else if (showAll && project.loadStatus === 'error') {
      rows.push({ key: `project-error:${project.key}`, type: 'project-error', project })
    }
    if (showAll && !project.suppressCollapse && (canExpand || revealed.has(project.key))) {
      rows.push({
        key: `collapse:${project.key}`,
        type: 'collapse',
        project
      })
    }
  }
  return rows
}

function gatewayProjectHeaderRow(project, collapsed, toggle, newChat, pinnedProjects, onTogglePin, appearance, onEditAppearance) {
  const projectKey = project.key
  const remoteLabel = projectRemoteLabel(project)
  const remote = project?.route?.mode === 'remote' || Boolean(remoteLabel)
  const sourceBadge = projectSourceBadge(project)
  const projectLabel = projectDisplayLabel(project)
  const isPinned = typeof pinnedProjects?.has === 'function' ? pinnedProjects.has(projectKey) : false
  const infoHint = projectInfoHint(project)
  const customIcon = projectIconName(appearance, projectKey)
  const customColor = projectIconColor(appearance, projectKey)
  const iconStyle = customColor ? { color: customColor } : undefined
  return jsxs('div', {
    className: 'codex-gateway-project-row group flex h-8 w-full items-center gap-1 rounded px-1.5 hover:bg-(--ui-row-hover-background)',
    'data-row-kind': 'project',
    children: [
      jsxs('button', {
        className: 'flex min-w-0 flex-1 items-center gap-1.5 text-left',
        'aria-expanded': !collapsed.has(projectKey),
        'aria-label': `${collapsed.has(projectKey) ? '展开' : '收起'} ${projectLabel}`,
        onClick: () => toggle(projectKey),
        title: infoHint,
        type: 'button',
        children: [
          jsx(Codicon, { name: collapsed.has(projectKey) ? 'chevron-right' : 'chevron-down', size: '0.68rem' }, 'chevron'),
          isHomeProject(project)
            ? jsx('span', {
                className: 'flex size-4 shrink-0 items-center justify-center',
                style: iconStyle,
                title: projectLabel,
                children: jsx(Codicon, { name: projectAppearanceFor(appearance, projectKey)?.icon ? customIcon : 'home', size: '0.76rem' })
              }, 'home')
            : remote
              ? jsxs('span', {
                  className: 'relative flex size-4 shrink-0 items-center justify-center',
                  style: iconStyle,
                  title: project.hasExplicitMetadata ? '远程项目' : '自动识别的远程项目',
                  children: [
                    jsx(Codicon, { name: customIcon, size: '0.76rem' }, 'folder'),
                    jsx(Codicon, { name: 'globe', size: '0.5rem', className: 'absolute -bottom-0.5 -right-0.5 rounded-full bg-(--ui-sidebar-surface-background)' }, 'globe')
                  ]
                }, 'remote-folder')
              : jsx('span', {
                  className: 'flex size-4 shrink-0 items-center justify-center',
                  style: iconStyle,
                  title: project.hasExplicitMetadata ? '项目' : '自动识别的项目',
                  children: jsx(Codicon, { name: customIcon, size: '0.76rem' })
                }, 'folder'),
          jsx('span', { className: 'codex-project-label min-w-0 flex-1 truncate text-[0.7rem] font-medium text-foreground/80', children: projectLabel }, 'label'),
          sourceBadge && jsx('span', { className: 'codex-gateway-project-meta max-w-28 shrink-0 truncate px-1 text-[0.58rem] text-(--ui-text-quaternary)', title: sourceBadge, children: sourceBadge }, 'source'),
          jsx('span', {
            className: 'codex-gateway-project-meta text-[0.6rem] tabular-nums text-(--ui-text-quaternary)',
            title: project.loadUnsupported ? projectSessionsUnsupportedMessage() : undefined,
            children: Math.max(project.sessions.length, Number(project.sessionCount) || 0)
          }, 'count')
        ]
      }, 'toggle'),
      jsx(Button, {
        'aria-label': `自定义 ${projectLabel} 的图标和颜色`,
        className: 'size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        onClick: () => onEditAppearance?.(project),
        size: 'icon-xs',
        title: '自定义图标和颜色',
        variant: 'ghost',
        children: jsx(Codicon, { name: 'edit', size: '0.74rem' })
      }, 'edit-appearance'),
      jsx(Button, {
        'aria-label': isPinned ? `取消置顶项目 ${projectLabel}` : `置顶项目 ${projectLabel}`,
        'aria-pressed': isPinned,
        className: `size-6 transition-opacity focus-visible:opacity-100 ${isPinned ? 'opacity-100 text-foreground' : 'opacity-0 group-hover:opacity-100'}`,
        onClick: () => onTogglePin?.(projectKey),
        size: 'icon-xs',
        title: isPinned ? '取消置顶项目' : '置顶项目',
        variant: 'ghost',
        children: jsx(Codicon, { name: isPinned ? 'pinned' : 'pin', size: '0.78rem' })
      }, 'pin-project'),
      jsx(Button, {
        'aria-label': `在 ${projectLabel} 中新建会话`,
        className: 'size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        onClick: () => newChat(project),
        size: 'icon-xs',
        title: `在 ${projectLabel} 中新建会话`,
        variant: 'ghost',
        children: jsx(Codicon, { name: 'add', size: '0.8rem' })
      }, 'new-chat')
    ]
  }, projectKey)
}

function ProjectAppearanceDialog({ open, onOpenChange, project, appearance, onSave }) {
  const projectKey = project?.key || ''
  const existing = projectAppearanceFor(appearance, projectKey) || {}
  const [color, setColor] = useState(() => existing.color || '')
  const [icon, setIcon] = useState(() => existing.icon || '')

  useEffect(() => {
    if (open) {
      setColor(existing.color || '')
      setIcon(existing.icon || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectKey])

  if (!open || !project) {
    return null
  }
  const label = projectDisplayLabel(project)
  const previewColor = color && PROJECT_APPEARANCE_COLORS[color] ? PROJECT_APPEARANCE_COLORS[color] : undefined
  const previewIcon = icon && PROJECT_APPEARANCE_ICONS.includes(icon) ? icon : 'folder'

  const save = () => {
    const entry = {}
    if (color) entry.color = color
    if (icon) entry.icon = icon
    onSave?.(projectKey, entry)
    onOpenChange(false)
  }

  return jsx(Dialog, {
    open,
    onOpenChange,
    children: jsxs(DialogContent, {
      className: 'max-w-sm',
      children: [
        jsx(DialogHeader, { children: jsx(DialogTitle, { children: `自定义「${label}」` }) }, 'header'),
        jsxs('div', {
          className: 'flex items-center gap-2 rounded border border-(--ui-stroke-tertiary) px-2 py-1.5',
          children: [
            jsx('span', {
              className: 'flex size-5 items-center justify-center',
              style: previewColor ? { color: previewColor } : undefined,
              children: jsx(Codicon, { name: previewIcon, size: '0.9rem' })
            }, 'preview-icon'),
            jsx('span', { className: 'text-[0.72rem] text-foreground/80', children: label }, 'preview-label')
          ]
        }, 'preview'),
        jsxs('div', {
          className: 'space-y-1',
          children: [
            jsx('div', { className: 'text-[0.65rem] text-(--ui-text-quaternary)', children: '颜色' }, 'color-label'),
            jsx('div', {
              className: 'flex flex-wrap gap-1.5',
              children: [
                jsx('button', {
                  'aria-label': '默认颜色',
                  'aria-pressed': !color,
                  className: `size-6 rounded-full border ${!color ? 'ring-1 ring-(--ui-accent)' : ''}`,
                  onClick: () => setColor(''),
                  style: { background: 'var(--ui-text-quaternary)' },
                  title: '默认',
                  type: 'button'
                }, 'color-default'),
                ...Object.entries(PROJECT_APPEARANCE_COLORS).map(([name, hex]) => jsx('button', {
                  'aria-label': `颜色 ${name}`,
                  'aria-pressed': color === name,
                  className: `size-6 rounded-full border border-black/10 ${color === name ? 'ring-2 ring-(--ui-accent)' : ''}`,
                  onClick: () => setColor(name),
                  style: { background: hex },
                  title: name,
                  type: 'button'
                }, `color-${name}`))
              ]
            }, 'color-row')
          ]
        }, 'color-section'),
        jsxs('div', {
          className: 'space-y-1',
          children: [
            jsx('div', { className: 'text-[0.65rem] text-(--ui-text-quaternary)', children: '图标' }, 'icon-label'),
            jsx('div', {
              className: 'flex flex-wrap gap-1.5',
              children: PROJECT_APPEARANCE_ICONS.map(name => jsx('button', {
                'aria-label': `图标 ${name}`,
                'aria-pressed': (icon || 'folder') === name,
                className: `flex size-7 items-center justify-center rounded border ${(icon || 'folder') === name ? 'border-(--ui-accent) bg-(--ui-row-active-background)' : 'border-(--ui-stroke-tertiary)'}`,
                onClick: () => setIcon(name === 'folder' ? '' : name),
                title: name,
                type: 'button',
                children: jsx(Codicon, { name, size: '0.85rem' })
              }, `icon-${name}`))
            }, 'icon-row')
          ]
        }, 'icon-section'),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, { onClick: () => { setColor(''); setIcon('') }, size: 'xs', variant: 'ghost', children: '重置' }, 'reset'),
            jsx(Button, { onClick: () => onOpenChange(false), size: 'xs', variant: 'ghost', children: '取消' }, 'cancel'),
            jsx(Button, { onClick: save, size: 'xs', children: '保存' }, 'save')
          ]
        }, 'footer')
      ]
    })
  })
}

function gatewayPinnedSessionHint(project, session) {
  const lines = [sessionRowTitle(session)]
  const time = sessionRowTime(session)
  const projectLabel = projectDisplayLabel(project)
  if (projectLabel) {
    lines.push(`项目：${projectLabel}`)
  }
  const gateway = String(project?.sourceLabel || projectRemoteLabel(project) || '').trim()
  lines.push(`网关：${gateway || '本机'}`)
  if (time) {
    lines.push(`时间：${time}`)
  }
  if (session?.preview) {
    lines.push(String(session.preview).trim())
  }
  return lines.filter(Boolean).join('\n')
}

function gatewayPinnedSectionHeader(collapsed, toggle, count) {
  const isCollapsed = collapsed.has(GATEWAY_PINNED_SECTION_KEY)
  return jsxs('button', {
    'aria-expanded': !isCollapsed,
    'aria-label': `${isCollapsed ? '展开' : '收起'}置顶会话`,
    className: 'flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-(--ui-row-hover-background)',
    onClick: () => toggle(GATEWAY_PINNED_SECTION_KEY),
    type: 'button',
    children: [
      jsx(Codicon, { name: isCollapsed ? 'chevron-right' : 'chevron-down', size: '0.68rem' }, 'chevron'),
      jsx(Codicon, { name: 'pin', size: '0.72rem', className: 'text-(--ui-text-quaternary)' }, 'pin'),
      jsx('span', { className: 'text-[0.65rem] font-medium uppercase tracking-wide text-(--ui-text-quaternary)', children: '置顶' }, 'label'),
      jsx('span', { className: 'text-[0.6rem] tabular-nums text-(--ui-text-quaternary)', children: count }, 'count')
    ]
  }, GATEWAY_PINNED_SECTION_KEY)
}

function gatewaySessionRow(project, session, focusedStoredSessionId, focusedSessionOwner, opening, open, applySessionChange, options = {}) {
  const sessionKey = `${project.key}::${session.id}`
  const title = sessionRowTitle(session)
  const active = focusedSessionMatches(session, project, focusedStoredSessionId, focusedSessionOwner)
  const openingNow = opening === sessionKey
  const pinned = Boolean(options.pinned)
  const projectColor = projectIconColor(options.appearance, project.key)
  const indent = options.indent === false ? '0' : '1.5rem'
  const rowClassName = `codex-gateway-session-row group relative h-8 min-w-0 rounded-xl text-left transition-colors hover:bg-(--ui-row-hover-background) ${active ? 'bg-(--ui-row-active-background) text-foreground' : ''} ${openingNow ? 'opacity-60' : ''}`
  const hint = pinned ? gatewayPinnedSessionHint(project, session) : null
  const row = jsxs('div', {
    'aria-current': active ? 'page' : undefined,
    'aria-label': `会话 ${title}`,
    'data-session-row': session.id,
    className: rowClassName,
    style: {
      '--codex-project-color': projectColor || undefined,
      alignItems: 'stretch',
      backgroundColor: active ? 'var(--ui-row-active-background)' : undefined,
      boxShadow: active ? 'inset 0 0 0 1px var(--ui-stroke-secondary), 0 1px 2px rgba(120,104,80,0.06)' : undefined,
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) max-content max-content',
      marginLeft: indent,
      minWidth: 0,
      width: `calc(100% - ${indent})`
    },
    children: [
      jsx('span', {
        'aria-hidden': true,
        className: 'arc-border arc-row codex-gateway-running-arc'
      }, 'running-arc'),
      jsx(RowButton, {
        className: 'flex w-full min-w-0 items-center rounded-md bg-transparent px-2 py-1 text-left hover:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)',
        disabled: openingNow,
        onClick: () => void open(project, session),
        title: hint || (session.preview ? `${title}\n${session.preview}` : title),
        type: 'button',
        children: jsx('span', {
          className: `block min-w-0 flex-1 truncate ${active ? 'font-semibold text-foreground' : 'font-normal text-foreground/85'}`,
          children: title
        })
      }, 'open'),
      jsx('button', {
        'aria-label': `打开会话 ${title}`,
        'data-session-time': true,
        className: 'shrink-0 min-w-max bg-transparent px-1 text-right text-[0.6rem] tabular-nums whitespace-nowrap text-(--ui-text-quaternary) hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)',
        onClick: () => void open(project, session),
        title: sessionRowTime(session),
        type: 'button',
        children: openingNow ? jsx(Codicon, { name: 'loading', size: '0.75rem', spinning: true }) : sessionRowTime(session)
      }, 'time'),
      jsxs('div', {
        className: 'relative flex min-w-8 shrink-0 items-center justify-end px-1',
        'data-session-actions': true,
        'aria-hidden': false,
        'data-row-actions': true,
        style: { minWidth: '2rem' },
        children: [
          jsx('span', {
            className: 'pointer-events-none flex items-center justify-center',
            'data-session-status': true,
            children: jsx(SessionStatusDot, { session, storedSessionId: session.id })
          }, 'status'),
          jsx('div', {
            className: 'absolute inset-y-0 right-0 flex items-center justify-end px-1',
            'data-session-menu': true,
            children: jsx(SessionActionsMenu, {
              children: jsx(Button, {
                'aria-label': `会话操作：${title}`,
                className: 'size-6 rounded-[4px] bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:ring-0 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground',
                size: 'icon-xs',
                variant: 'ghost',
                children: jsx(Codicon, { name: 'kebab-vertical', size: '0.8rem' })
              }),
              onChanged: applySessionChange,
              project,
              session
            })
          }, 'menu')
        ]
      }, 'actions')
    ]
  }, sessionKey)
  return jsx(SessionContextMenu, { children: row, onChanged: applySessionChange, project, session }, sessionKey)
}

function gatewayProjectToggleRow(project, remaining, onToggle, mode) {
  const count = Math.max(0, Number(remaining) || 0)
  const collapsing = mode === 'collapse'
  const label = collapsing ? '收起' : '展开显示'
  const extra = collapsing ? '' : ` ${count}`
  return jsx('div', {
    className: 'min-w-0',
    style: { marginLeft: '1.5rem', width: 'calc(100% - 1.5rem)' },
    children: jsx(Button, {
      'aria-label': collapsing
        ? `收起 ${projectDisplayLabel(project)} 的额外会话`
        : `展开显示 ${projectDisplayLabel(project)} 的另外 ${count} 个会话`,
      className: 'h-7 justify-start rounded-md bg-transparent px-2 py-1.5 text-[0.62rem] font-medium text-(--ui-text-quaternary) hover:bg-(--ui-row-hover-background) hover:text-foreground',
      onClick: () => onToggle(project.key),
      size: 'xs',
      title: collapsing ? '收起到最近 5 个会话' : `还有 ${count} 个会话`,
      variant: 'ghost',
      children: `${label}${extra}`
    })
  }, `${collapsing ? 'collapse' : 'more'}:${project.key}`)
}

function gatewayProjectLoadRow(project, onRetry, mode) {
  const failed = mode === 'error'
  return jsx('div', {
    className: 'flex h-7 min-w-0 items-center gap-1.5 px-2 text-[0.62rem] text-(--ui-text-quaternary)',
    role: failed ? 'alert' : 'status',
    style: { marginLeft: '1.5rem', width: 'calc(100% - 1.5rem)' },
    children: failed
      ? jsx(Button, {
          className: 'h-6 justify-start bg-transparent px-0 text-[0.62rem] text-(--ui-text-quaternary) hover:text-foreground',
          onClick: () => onRetry(project.key),
          size: 'xs',
          variant: 'ghost',
          children: '加载失败，点击重试'
        })
      : jsxs('span', {
          className: 'flex items-center gap-1.5',
          children: [
            jsx(GlyphSpinner, { ariaLabel: '正在加载项目会话', className: 'text-[0.7rem]' }, 'spinner'),
            jsx('span', { children: '正在加载会话…' }, 'label')
          ]
        })
  }, `${failed ? 'project-error' : 'project-loading'}:${project.key}`)
}

function eventRouteKey(event) {
  const connectionId = String(event?.connectionId || '').trim()
  const profile = String(event?.profile || '').trim()
  if (!connectionId || !profile) {
    return ''
  }
  return [connectionId, profile].join('::')
}

function groupRouteIdentity(group) {
  const route = group?.route
  if (!route) {
    return ''
  }
  return [String(route.connectionId || '').trim(), String(route.profile || '').trim()].join('::')
}

function patchSessionGroupsFromEvent(groups, event) {
  if (!Array.isArray(groups) || !event || !PATCHABLE_SESSION_EVENT_TYPES.has(event.type)) {
    return groups
  }

  const key = eventRouteKey(event)
  const sessionId = eventSessionId(event)
  if (!key || !sessionId) {
    return groups
  }

  let changed = false
  const nextGroups = groups.map(group => {
    if (groupRouteIdentity(group) !== key || !Array.isArray(group.sessions)) {
      return group
    }
    let groupChanged = false
    const sessions = group.sessions.map(session => {
      if (session.id !== sessionId) {
        return session
      }
      const currentActivity = sessionActivityValue(session)
      const nextActivity = eventTimestampMs(event, currentActivity)
      if (nextActivity <= currentActivity) {
        return session
      }
      changed = true
      groupChanged = true
      return { ...session, last_active: nextActivity }
    })
    return groupChanged ? { ...group, sessions: sessions.sort(compareSessions) } : group
  })
  return changed ? nextGroups : groups
}

function patchSessionGroupsFromEvents(groups, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return groups
  }

  return events.reduce((current, event) => patchSessionGroupsFromEvent(current, event), groups)
}

function mergeGatewaySessionGroup(current, incoming) {
  if (!current || !incoming || current.key !== incoming.key) {
    return incoming
  }

  if (incoming.error) {
    return { ...current, error: incoming.error }
  }

  const currentById = new Map((current.sessions || []).map(session => [session.id, session]))
  return {
    ...incoming,
    sessions: incoming.sessions.map(session => {
      const existing = currentById.get(session.id)
      return existing && sessionActivityValue(existing) > sessionActivityValue(session)
        ? { ...session, last_active: sessionActivityValue(existing) }
        : session
    }).sort(compareSessions)
  }
}

function fetchSharedGatewaySessionGroups(profileScope) {
  const queryClient = pluginQueryClient
  const sessionsQueryKey = [...GATEWAY_SESSIONS_KEY, profileScope]
  return async () => {
    const revision = sessionDataRevision.current
    const incoming = await fetchGatewaySessionGroups(profileScope, $gatewaySessionLimit.get())
    const current = queryClient?.getQueryData?.(sessionsQueryKey)
    if (revision !== sessionDataRevision.current && current?.groups) {
      return current
    }
    if (!current?.groups) {
      return incoming
    }
    const currentByKey = new Map(current.groups.map(group => [group.key, group]))
    return {
      ...incoming,
      groups: incoming.groups.map(group => mergeGatewaySessionGroup(currentByKey.get(group.key), group))
    }
  }
}

function useGatewaySessionsQuery(profileScopeOverride) {
  const queryClient = useQueryClient()
  const prefs = useValue($gatewaySessionPrefs)
  const sessionLimit = useValue($gatewaySessionLimit)
  const profileScope = profileScopeOverride === PROFILE_SCOPE_ALL ? PROFILE_SCOPE_ALL : prefs.profileScope
  const sessionsQueryKey = useMemo(() => [...GATEWAY_SESSIONS_KEY, profileScope], [profileScope])
  const previousSessionLimitRef = useRef(sessionLimit)
  const sessionsQuery = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: fetchSharedGatewaySessionGroups(profileScope),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity
  })

  useEffect(() => {
    if (previousSessionLimitRef.current === sessionLimit) {
      return
    }
    previousSessionLimitRef.current = sessionLimit
    void queryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
  }, [queryClient, sessionLimit, sessionsQueryKey])

  return { prefs, profileScope, sessionLimit, sessionsQuery, sessionsQueryKey }
}

function GatewayMobileChip() {
  const online = useValue($mobileBridgeStatus)
  return jsxs('button', {
    className: 'inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 hover:text-slate-800 transition px-1.5 py-0.5 rounded cursor-pointer',
    onClick: () => {
      host.notify({
        kind: 'info',
        message: online
          ? 'Overlook 移动端中继已连接，手机可直接访问局域网 IP:9999 实时监控！'
          : 'Overlook 移动端中继未运行。请运行 node overlook/server/server.js 启动服务。'
      })
    },
    title: online ? 'Overlook 移动端中继：在线' : 'Overlook 移动端中继：未连接 (端口 9999)',
    type: 'button',
    children: [
      jsx(Codicon, { name: 'device-mobile', size: '0.8rem' }),
      jsx('span', {
        className: cn('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-300'),
        'aria-hidden': true
      }),
      jsx('span', { children: online ? '移动端' : '移动离线' })
    ]
  })
}
function GatewayInboxChip() {
  const { prefs, sessionsQuery } = useGatewaySessionsQuery()
  const inbox = gatewayInboxSummary(sessionsQuery.data?.groups, prefs.hideScheduled)
  if (!sessionsQuery.data) {
    return null
  }

  const label = inbox.failed
    ? `${inbox.failed} 个会话来源不可用`
    : inbox.unread
      ? (inbox.partial
        ? `已加载会话中有 ${inbox.unread} 个未读（部分来源未全量加载）`
        : `跨网关有 ${inbox.unread} 个未读会话`)
      : (inbox.partial
        ? `已加载 ${inbox.loaded} 个会话（部分来源未全量加载）`
        : `跨网关共加载 ${inbox.loaded} 个会话`)

  return jsx(Tip, {
    label,
    children: jsxs('button', {
      className: cn(
        'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      onClick: () => void refreshGatewaySessionQueries(),
      type: 'button',
      children: [
        jsx(Codicon, { name: inbox.failed ? 'warning' : 'comment-discussion', size: '0.7rem' }),
        jsx('span', { children: inbox.failed ? inbox.failed : (inbox.unread || inbox.loaded) }),
        !inbox.failed && inbox.partial ? jsx('span', { 'aria-hidden': true, children: '+' }) : null
      ]
    })
  })
}

function openSessionMonitorWorkspace() {
  if (typeof host.openWorkspace !== 'function') {
    host.navigate(MONITOR_ROUTE)
    return
  }
  try {
    monitorWorkspaceClose = host.openWorkspace('overlook-monitor', {
      dock: { pane: 'workspace', pos: 'center' },
      minWidth: '32rem',
      onClose: () => { monitorWorkspaceClose = null },
      render: () => jsx(SessionMonitorPage, {}),
      title: '监控室'
    })
  } catch {
    host.notify({ kind: 'error', message: '无法打开多会话监控室。' })
  }
}

function openMonitoredSession(project, session) {
  let opening
  try {
    opening = host.openSession(session.id, {
      intent: 'in-place',
      keepAllProfilesScope: true,
      profile: project.route.profile,
      route: project.route
    })
    host.navigate(`/${encodeURIComponent(session.id)}`)
  } catch {
    host.notify({ kind: 'error', message: '无法打开监控中的会话。' })
    return
  }
  void Promise.resolve(opening).catch(error => {
    if (error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {
      return
    }
    host.notify({ kind: 'error', message: '无法打开监控中的会话。' })
  })
}

function MonitorImageThumbnail({ path, onZoom }) {
  const [src, setSrc] = useState(null)
  const isUrl = /^(?:https?|data):/i.test(path)

  useEffect(() => {
    let alive = true
    if (isUrl) {
      setSrc(path)
      return
    }
    // 尝试读取本地图片文件的 Data URL
    const load = window.hermesDesktop?.readFileDataUrl?.(path)
    if (load && typeof load.then === 'function') {
      load.then(url => {
        if (alive && url) setSrc(url)
      }).catch(() => {})
    } else {
      // 容错：file:/// 本地路径
      const normalized = path.replace(/\\/g, '/')
      const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
      setSrc(fileUrl)
    }
    return () => { alive = false }
  }, [path, isUrl])

  return jsx('div', {
    className: 'codex-monitor-img-thumb',
    onClick: () => onZoom(src || path),
    title: '点击放大查看图片',
    children: src
      ? jsx('img', { alt: '图片附件', src }, 'img')
      : jsx('div', { className: 'flex h-full w-full items-center justify-center bg-slate-100 text-[9px] text-slate-400', children: '加载中…' }, 'loading')
  })
}

function MonitorMessageRow({ row }) {
  const [lightboxSrc, setLightboxSrc] = useState(null)

  if (row.kind === 'status') {
    return jsx('div', {
      className: 'codex-monitor-status text-[0.5875rem] italic text-(--ui-text-quaternary)',
      children: row.text
    }, row.key)
  }
  const role = row.message.role
  const stamp = monitorMessageStamp(row.message)

  // 提取用户消息中的图片路径并清洗提示协议文本
  const parsed = useMemo(() => extractMonitorMessageImages(row.text), [row.text])
  const displayText = parsed.cleanedText || (parsed.imagePaths.length ? '' : row.text)
  const images = parsed.imagePaths

  if (role === 'user') {
    return jsxs('div', {
      className: 'codex-monitor-message-user-wrap',
      children: [
        jsxs('div', { className: 'codex-monitor-message-meta', children: [jsx('span', { children: '用户' }, 'who'), stamp ? jsx('span', { children: stamp }, 'time') : null] }, 'meta'),
        jsxs('div', {
          className: 'codex-monitor-message-user text-[0.625rem] leading-relaxed text-foreground/85',
          children: [
            displayText ? jsx('div', { children: displayText }, 'text') : null,
            images.length > 0
              ? jsx('div', {
                  className: 'codex-monitor-image-gallery',
                  children: images.map((imgPath, i) => jsx(MonitorImageThumbnail, {
                    onZoom: setLightboxSrc,
                    path: imgPath
                  }, `img-${i}`))
                }, 'gallery')
              : null
          ]
        }, 'body'),
        lightboxSrc
          ? jsxs('div', {
              className: 'codex-monitor-lightbox',
              onClick: () => setLightboxSrc(null),
              children: [
                jsx('img', {
                  alt: '放大查看',
                  className: 'codex-monitor-lightbox-img',
                  onClick: e => e.stopPropagation(),
                  src: lightboxSrc
                }, 'large-img'),
                jsx('button', {
                  'aria-label': '关闭全屏查看',
                  className: 'codex-monitor-lightbox-close',
                  onClick: () => setLightboxSrc(null),
                  type: 'button',
                  children: jsx(Codicon, { name: 'close', size: '1rem' })
                }, 'close-btn')
              ]
            }, 'lightbox')
          : null
      ]
    }, row.key)
  }
  return jsxs('div', {
    className: 'codex-monitor-message-assistant-wrap',
    children: [
      jsxs('div', { className: 'codex-monitor-message-meta', children: [jsx('span', { children: '助手' }, 'who'), stamp ? jsx('span', { children: stamp }, 'time') : null] }, 'meta'),
      jsxs('div', {
        className: 'codex-monitor-markdown text-[0.625rem] text-foreground/90',
        children: [
          displayText ? jsx(Streamdown, {
            controls: false,
            mode: 'static',
            parseIncompleteMarkdown: false,
            children: displayText
          }, 'prose') : null,
          images.length > 0
            ? jsx('div', {
                className: 'codex-monitor-image-gallery',
                children: images.map((imgPath, i) => jsx(MonitorImageThumbnail, {
                  onZoom: setLightboxSrc,
                  path: imgPath
                }, `img-${i}`))
              }, 'gallery')
            : null
        ]
      }, 'body'),
      lightboxSrc
        ? jsxs('div', {
            className: 'codex-monitor-lightbox',
            onClick: () => setLightboxSrc(null),
            children: [
              jsx('img', {
                alt: '放大查看',
                className: 'codex-monitor-lightbox-img',
                onClick: e => e.stopPropagation(),
                src: lightboxSrc
              }, 'large-img'),
              jsx('button', {
                'aria-label': '关闭全屏查看',
                className: 'codex-monitor-lightbox-close',
                onClick: () => setLightboxSrc(null),
                type: 'button',
                children: jsx(Codicon, { name: 'close', size: '1rem' })
              }, 'close-btn')
            ]
          }, 'lightbox')
        : null
    ]
  }, row.key)
}

function MonitorNewSessionTile({ onCreate, onQueue, queueCount }) {
  const waiting = Number(queueCount) || 0
  return jsxs('div', {
    'aria-label': '开启新会话窗口',
    className: 'codex-monitor-new-tile',
    onClick: onCreate,
    children: [
      jsx('span', { className: 'codex-monitor-new-tile-icon', children: jsx(Codicon, { name: 'add', size: '1.4rem' }) }, 'icon'),
      jsx('span', { className: 'text-sm font-semibold', children: '开启新会话窗口' }, 'title'),
      jsx('span', { className: 'max-w-xs text-xs leading-relaxed', children: '无并发限制，点击随时弹性开启新会话，或从队列中拉取未分配会话' }, 'hint'),
      jsxs('div', {
        className: 'mt-1 flex items-center gap-2',
        onClick: event => event.stopPropagation(),
        children: [
          jsx(Button, {
            disabled: waiting <= 0,
            onClick: event => {
              event.stopPropagation()
              onQueue?.()
            },
            size: 'xs',
            type: 'button',
            variant: 'outline',
            children: `从待命队列接入 (${waiting})`
          }, 'queue'),
          jsx(Button, {
            onClick: event => {
              event.stopPropagation()
              onCreate?.()
            },
            size: 'xs',
            type: 'button',
            children: '+ 空白会话'
          }, 'blank')
        ]
      }, 'actions')
    ]
  })
}

function MonitorSessionComposer({
  onEnqueue,
  onSendNow,
  onSendQueueNow,
  onStop,
  onRemoveQueueItem,
  onClearQueue,
  placeholder,
  queue = [],
  status
}) {
  const [text, setText] = useState('')
  const [images, setImages] = useState([])
  const [sending, setSending] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const fileRef = useRef(null)
  const isBusy = status === '执行中'

  const enqueue = () => {
    const prompt = text.trim()
    if (!prompt && !images.length) return
    onEnqueue?.({ images, prompt, text })
    setText('')
    setImages([])
  }

  const sendDirect = async () => {
    const prompt = text.trim()
    if ((!prompt && !images.length) || sending) return
    setSending(true)
    try {
      await onSendNow?.(prompt, images)
      setText('')
      setImages([])
    } catch (error) {
      const msg = error instanceof Error ? error.message : '无法发送到该会话。'
      host.notify({ kind: 'error', message: msg })
    } finally {
      setSending(false)
    }
  }

  const addImages = async event => {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    try {
      const next = await Promise.all(files.map(readMonitorImageFile))
      setImages(current => [...current, ...next])
    } catch (error) {
      host.notify({
        kind: 'error',
        message: error instanceof Error ? error.message : '图片读取失败。'
      })
    }
  }

  const onPaste = async event => {
    const clipboard = event.clipboardData
    if (!clipboard) return
    const imageFiles = []
    const items = clipboard.items ? [...clipboard.items] : []
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (!imageFiles.length && clipboard.files && clipboard.files.length) {
      for (const file of clipboard.files) {
        if (file.type && file.type.startsWith('image/')) {
          imageFiles.push(file)
        }
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault()
      try {
        const next = await Promise.all(imageFiles.map(readMonitorImageFile))
        setImages(current => [...current, ...next])
      } catch (error) {
        host.notify({
          kind: 'error',
          message: error instanceof Error ? error.message : '粘贴图片失败。'
        })
      }
    }
  }

  return jsxs('footer', {
    className: 'shrink-0 border-t border-slate-200 bg-white p-2.5',
    children: [
      queue.length > 0
        ? jsxs('div', {
            className: 'mb-1.5 overflow-hidden rounded-md border border-amber-200 bg-amber-50/50',
            children: [
              jsxs('div', {
                className: 'codex-monitor-queue-bar',
                children: [
                  jsxs('button', {
                    className: 'flex items-center gap-1.5 font-medium text-amber-800 hover:text-amber-900',
                    onClick: () => setQueueExpanded(curr => !curr),
                    type: 'button',
                    children: [
                      jsx(Codicon, { name: queueExpanded ? 'chevron-down' : 'chevron-right', size: '0.75rem' }),
                      jsx('span', { children: `消息队列 (${queue.length})` }),
                      jsx('span', { className: 'text-[9px] text-amber-600', children: '排队待发' })
                    ]
                  }, 'toggle'),
                  jsxs('div', {
                    className: 'flex items-center gap-1',
                    children: [
                      jsx(Button, {
                        disabled: sending,
                        onClick: async () => {
                          setSending(true)
                          try {
                            await onSendQueueNow?.()
                          } finally {
                            setSending(false)
                          }
                        },
                        size: 'xs',
                        variant: 'secondary',
                        children: '立即发送队列'
                      }, 'send-queue'),
                      jsx(Button, {
                        className: 'text-slate-400 hover:text-slate-600',
                        disabled: sending,
                        onClick: onClearQueue,
                        size: 'icon-xs',
                        title: '清空队列',
                        variant: 'ghost',
                        children: jsx(Codicon, { name: 'clear-all', size: '0.75rem' })
                      }, 'clear')
                    ]
                  }, 'actions')
                ]
              }, 'header'),
              queueExpanded
                ? jsx('div', {
                    className: 'codex-monitor-queue-list',
                    children: queue.map((item, idx) => jsxs('div', {
                      className: 'codex-monitor-queue-item',
                      children: [
                        jsxs('span', {
                          className: 'truncate text-slate-700',
                          children: [
                            jsx('span', { className: 'mr-1 font-mono text-[9px] text-slate-400', children: `#${idx + 1}` }),
                            item.prompt || (item.images?.length ? `[${item.images.length} 张图片]` : '未命名指令')
                          ]
                        }, 'text'),
                        jsx('button', {
                          'aria-label': '从队列移除',
                          className: 'text-slate-400 hover:text-rose-500',
                          onClick: () => onRemoveQueueItem?.(item.id),
                          type: 'button',
                          children: jsx(Codicon, { name: 'close', size: '0.65rem' })
                        }, 'del')
                      ]
                    }, item.id || idx))
                  }, 'list')
                : null
            ]
          }, 'queue-box')
        : null,
      images.length
        ? jsxs('div', {
            className: 'codex-monitor-new-images mb-1.5',
            children: images.map(image => jsxs('span', {
              className: 'codex-monitor-new-thumb',
              title: image.name,
              children: [
                jsx('img', { alt: image.name, src: image.dataUrl }, 'preview'),
                jsx('button', {
                  'aria-label': `移除 ${image.name}`,
                  className: 'codex-monitor-new-thumb-remove',
                  disabled: sending,
                  onClick: () => setImages(current => current.filter(item => item.id !== image.id)),
                  type: 'button',
                  children: jsx(Codicon, { name: 'close', size: '0.65rem' })
                }, 'remove')
              ]
            }, image.id))
          }, 'thumbs')
        : null,
      jsxs('div', {
        className: 'codex-monitor-composer',
        children: [
          jsx('input', {
            accept: MONITOR_IMAGE_ACCEPT,
            className: 'hidden',
            disabled: sending,
            multiple: true,
            onChange: event => { void addImages(event) },
            ref: fileRef,
            type: 'file'
          }, 'file'),
          jsx('button', {
            'aria-label': '上传文件',
            className: 'text-slate-400',
            disabled: sending,
            onClick: () => fileRef.current?.click(),
            title: '上传文件',
            type: 'button',
            children: jsx(Codicon, { name: 'add', size: '0.85rem' })
          }, 'attach'),
          jsx('input', {
            className: 'codex-monitor-composer-input',
            disabled: sending,
            onChange: event => setText(event.target.value),
            onKeyDown: event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                // 默认回车加入队列
                enqueue()
              }
            },
            onPaste,
            placeholder: placeholder || '输入消息加入队列… (Enter 入队)',
            value: text
          }, 'input'),
          jsx(Button, {
            'aria-label': '加入队列',
            className: 'size-6 shrink-0 text-amber-700 hover:bg-amber-100 hover:text-amber-800',
            disabled: sending || (!text.trim() && !images.length),
            onClick: enqueue,
            size: 'icon-xs',
            title: '加入消息队列 (Enter)',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'list-ordered', size: '0.8rem' })
          }, 'enqueue'),
          isBusy && !text.trim() && !images.length
            ? jsx(Button, {
                'aria-label': '停止任务',
                className: 'size-7 shrink-0 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 border border-rose-200',
                disabled: sending,
                onClick: async () => {
                  setSending(true)
                  try {
                    await onStop?.()
                    host.notify({ kind: 'info', message: '已请求停止当前任务。' })
                  } catch (err) {
                    host.notify({ kind: 'error', message: err instanceof Error ? err.message : '无法停止任务。' })
                  } finally {
                    setSending(false)
                  }
                },
                size: 'icon-xs',
                title: '停止当前任务',
                variant: 'secondary',
                children: jsx(Codicon, { name: 'debug-stop', size: '0.8rem' })
              }, 'stop')
            : jsx(Button, {
                'aria-label': '立即发送',
                className: 'size-7 shrink-0',
                disabled: sending || (!text.trim() && !images.length),
                onClick: () => void sendDirect(),
                size: 'icon-xs',
                title: '立即单独发送',
                children: jsx(Codicon, { name: 'arrow-right', size: '0.8rem' })
              }, 'send')
        ]
      }, 'bar')
    ]
  })
}

function MonitorLayoutSwitch({ layout, onChange }) {
  const current = normalizeMonitorLayout(layout)
  const options = [
    ['tile', '平铺流'],
    ['compact', '自适应网格'],
    ['list', '列表']
  ]
  return jsx('div', {
    'aria-label': '监控室布局',
    className: 'codex-monitor-layout-switch',
    children: options.map(([value, label]) => jsx('button', {
      'aria-pressed': current === value,
      onClick: () => onChange(value),
      type: 'button',
      children: label
    }, value))
  })
}

function MonitorQueueMenu({ queue, onOpenDialog }) {
  const waiting = Array.isArray(queue) ? queue : []
  return jsxs('button', {
    className: 'codex-monitor-queue-chip',
    onClick: onOpenDialog,
    title: '查看待命队列会话',
    type: 'button',
    children: [
      jsx('span', { className: 'inline-block size-2 rounded-full bg-amber-500' }, 'dot'),
      jsx('span', { children: '待命队列:' }, 'label'),
      jsx('span', { className: 'rounded border border-amber-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold', children: `${waiting.length} 个会话` }, 'count')
    ]
  })
}

function MonitorQueueSelectDialog({ open, onOpenChange, queue, onSelect }) {
  const [search, setSearch] = useState('')
  const list = Array.isArray(queue) ? queue : []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(entry => {
      const title = sessionRowTitle(entry.session).toLowerCase()
      const project = projectDisplayLabel(entry.project).toLowerCase()
      const preview = String(entry.session?.preview || '').toLowerCase()
      return title.includes(q) || project.includes(q) || preview.includes(q)
    })
  }, [list, search])

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  return jsx(Dialog, {
    onOpenChange,
    open,
    children: jsxs(DialogContent, {
      className: 'max-w-lg',
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: '从待命队列接入会话' }),
            jsx('p', {
              className: 'text-xs text-slate-500',
              children: `当前待命队列中有 ${list.length} 个会话，选择并平铺到监控室。`
            })
          ]
        }, 'header'),
        list.length > 5
          ? jsx('div', {
              className: 'mb-1 px-1',
              children: jsx(Input, {
                className: 'h-8 text-xs',
                onChange: e => setSearch(e.target.value),
                placeholder: '搜索待命会话…',
                value: search
              })
            }, 'search')
          : null,
        jsx('div', {
          className: 'max-h-80 overflow-y-auto space-y-1.5 p-1',
          children: filtered.length
            ? filtered.map(entry => {
                const title = sessionRowTitle(entry.session)
                const projectLabel = projectDisplayLabel(entry.project)
                const source = projectSourceBadge(entry.project)
                const time = sessionRowTime(entry.session)
                const model = monitorSessionModelLabel(entry.session)
                const preview = String(entry.session?.preview || '').trim()

                return jsxs('button', {
                  className: 'group flex w-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50/40 hover:shadow-xs',
                  onClick: () => {
                    onSelect(entry.key)
                    onOpenChange(false)
                  },
                  type: 'button',
                  children: [
                    jsxs('div', {
                      className: 'flex items-center justify-between gap-2',
                      children: [
                        jsx('span', { className: 'truncate text-xs font-bold text-slate-900 group-hover:text-emerald-800', children: title }, 'title'),
                        time ? jsx('span', { className: 'shrink-0 font-mono text-[10px] text-slate-400', children: time }, 'time') : null
                      ]
                    }, 'top'),
                    jsxs('div', {
                      className: 'flex items-center gap-1.5 font-mono text-[11px] text-slate-500',
                      children: [
                        jsx('span', { className: 'truncate', children: projectLabel }, 'proj'),
                        source ? jsx('span', { children: '·' }, 'dot1') : null,
                        source ? jsx('span', { className: 'truncate', children: source }, 'src') : null,
                        model ? jsx('span', { children: '·' }, 'dot2') : null,
                        model ? jsx('span', { className: 'truncate text-slate-600', children: model }, 'mod') : null
                      ]
                    }, 'meta'),
                    preview
                      ? jsx('p', { className: 'line-clamp-2 text-[11px] text-slate-600 leading-relaxed', children: preview }, 'preview')
                      : null
                  ]
                }, entry.key)
              })
            : jsx('div', {
                className: 'py-8 text-center text-xs text-slate-400',
                children: list.length === 0 ? '待命队列为空' : '未找到匹配的待命会话'
              })
        }, 'list'),
        jsx(DialogFooter, {
          children: jsx(Button, { onClick: () => onOpenChange(false), variant: 'ghost', children: '关闭' })
        }, 'footer')
      ]
    })
  })
}

function MonitorCardModelPicker({ project, session, currentModel, onModelChanged }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState(false)
  const modelQuery = useQuery({
    enabled: open && Boolean(project?.route),
    queryFn: () => fetchMonitorModelOptions(project),
    queryKey: [...MONITOR_QUERY_KEY, 'models', project?.key || ''],
    retry: false,
    staleTime: 120_000
  })
  const catalog = useMemo(() => normalizeMonitorModelOptions(modelQuery.data), [modelQuery.data])
  const activeLabel = currentModel || catalog.choices[0]?.model || '选择模型'

  const filteredChoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog.choices
    return catalog.choices.filter(c =>
      String(c.model || '').toLowerCase().includes(q) ||
      String(c.provider || '').toLowerCase().includes(q) ||
      String(c.label || '').toLowerCase().includes(q)
    )
  }, [catalog.choices, search])

  const handleSelect = async choice => {
    if (!choice || switching) return
    setSwitching(true)
    try {
      await switchMonitorSessionModel(project, session, choice)
      onModelChanged?.(choice.model)
      host.notify({ kind: 'success', message: `已切换为 ${choice.model}` })
      setOpen(false)
      setSearch('')
    } catch (err) {
      host.notify({
        kind: 'error',
        message: err instanceof Error ? err.message : '切换模型失败。'
      })
    } finally {
      setSwitching(false)
    }
  }

  return jsxs(DropdownMenu, {
    onOpenChange: nextOpen => {
      setOpen(nextOpen)
      if (!nextOpen) setSearch('')
    },
    open,
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsxs('button', {
          className: 'inline-flex max-w-[13rem] items-center gap-1 truncate rounded bg-slate-100/80 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 transition border border-slate-200/60',
          title: `当前模型: ${activeLabel} (点击切换)`,
          type: 'button',
          children: [
            jsx(Codicon, { name: 'hubot', size: '0.65rem' }),
            jsx('span', { className: 'truncate font-medium text-slate-700', children: activeLabel }, 'label'),
            jsx(Codicon, { name: switching ? 'loading' : 'chevron-down', size: '0.6rem', spinning: switching }, 'icon')
          ]
        })
      }, 'trigger'),
      jsxs(DropdownMenuContent, {
        align: 'start',
        className: 'max-h-72 overflow-hidden w-64 p-1.5 flex flex-col',
        children: [
          jsx('div', {
            className: 'p-1 pb-1.5',
            children: jsx(Input, {
              autoFocus: true,
              className: 'h-6 text-[10px] px-2 bg-slate-50',
              onChange: e => setSearch(e.target.value),
              onClick: e => e.stopPropagation(),
              onKeyDown: e => e.stopPropagation(),
              placeholder: '搜索模型名称或提供商…',
              value: search
            })
          }, 'search-box'),
          jsx('div', {
            className: 'max-h-52 overflow-y-auto flex flex-col gap-0.5',
            children: filteredChoices.length
              ? filteredChoices.map(choice => jsxs(DropdownMenuItem, {
                  className: 'flex items-center justify-between text-[10px] py-1 px-2 cursor-pointer',
                  disabled: switching,
                  onSelect: () => void handleSelect(choice),
                  children: [
                    jsx('span', { className: 'truncate font-medium text-slate-800', children: choice.model }, 'm'),
                    jsx('span', { className: 'ml-2 text-[9px] text-slate-400 font-mono shrink-0', children: choice.provider }, 'p')
                  ]
                }, choice.key))
              : jsx(DropdownMenuItem, {
                  disabled: true,
                  children: modelQuery.isLoading ? '正在加载模型…' : (catalog.choices.length ? '未找到匹配模型' : '暂无可用模型')
                }, 'empty')
          }, 'items')
        ]
      }, 'content')
    ]
  })
}

function MonitorSessionCard({ appearance, entry, slotIndex, onDismiss }) {
  const { project, session } = entry
  const transcriptQuery = useQuery({
    queryKey: [...MONITOR_QUERY_KEY, routeKey(project.route), session.id],
    queryFn: () => fetchMonitorTranscript(project, session),
    refetchInterval: MONITOR_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: 1,
    staleTime: MONITOR_REFRESH_MS - 250
  })
  const transcript = Array.isArray(transcriptQuery.data) ? transcriptQuery.data : []
  const messages = useMemo(() => monitorWallMessages({ messages: transcript }, session, 18), [session, transcript])
  const transcriptVersion = messages.map(row => `${row.key}:${row.text}`).join('|')
  const scrollRef = useRef(null)
  const contentRef = useRef(null)
  useEffect(() => {
    const element = scrollRef.current
    const content = contentRef.current
    if (!element || !content) return undefined

    const scrollToBottom = () => monitorScrollToBottom(element)
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToBottom()
      secondFrame = window.requestAnimationFrame(scrollToBottom)
    })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scrollToBottom)
    if (observer) observer.observe(content)

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      observer?.disconnect()
    }
  }, [entry.key, transcriptVersion])

  const color = projectIconColor(appearance, project.key)
  const source = projectSourceBadge(project)
  const gatewayLabel = monitorProjectGatewayLabel(project)
  const status = monitorSessionStatusLabel(session, messages)
  const [overrideModel, setOverrideModel] = useState('')
  const model = overrideModel || monitorSessionModelLabel(session)
  const tokens = monitorSessionTokenLabel(session)
  const queryClient = useQueryClient()
  const ready = status === '就绪待命中'
  const sessionQueues = useValue($monitorMessageQueueBySession)
  const queue = sessionQueues[session.id] || []

  const updateQueue = updater => {
    const currentAll = $monitorMessageQueueBySession.get()
    const currentQueue = currentAll[session.id] || []
    const nextQueue = typeof updater === 'function' ? updater(currentQueue) : updater
    $monitorMessageQueueBySession.set({
      ...currentAll,
      [session.id]: nextQueue
    })
  }

  const handleEnqueue = item => {
    updateQueue(curr => [
      ...curr,
      {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        images: item.images || [],
        prompt: item.prompt || '',
        queuedAt: Date.now()
      }
    ])
  }

  const handleRemoveQueueItem = itemId => {
    updateQueue(curr => curr.filter(item => item.id !== itemId))
  }

  const handleClearQueue = () => {
    updateQueue([])
  }

  const handleSendQueueNow = async () => {
    const currentQueue = $monitorMessageQueueBySession.get()[session.id] || []
    if (!currentQueue.length) return
    const first = currentQueue[0]
    noteMobileTurnActivity(session.id)
    if (first.prompt) {
      inflightUserPromptBySession.set(session.id, {
        prompt: first.prompt,
        images: first.images || [],
        timestamp: Date.now()
      })
    }
    await submitMonitorPrompt({ images: first.images, project, prompt: first.prompt, session })
    updateQueue(curr => curr.slice(1))
    void queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, routeKey(project.route), session.id] })
    void queryClient.invalidateQueries({ queryKey: GATEWAY_SESSIONS_KEY })
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, routeKey(project.route), session.id] })
    }, 600)
  }

  return jsxs('section', {
    'aria-label': `监控会话 ${sessionRowTitle(session)}`,
    className: 'codex-monitor-card',
    'data-monitor-session': session.id,
    'data-monitor-slot': String(slotIndex + 1),
    style: { '--monitor-project-color': color || '#10b981' },
    children: [
      jsxs('header', {
        className: 'flex shrink-0 items-center gap-2.5 border-b border-slate-200 bg-slate-50/90 px-3.5 py-2.5',
        children: [
          jsx('span', { className: 'codex-monitor-index', children: monitorSessionIndexLabel(slotIndex) }, 'index'),
          jsxs('div', {
            className: 'min-w-0 flex-1',
            children: [
              jsxs('div', {
                className: 'flex min-w-0 items-center gap-1.5',
                children: [
                  jsx('h2', { className: 'truncate text-xs font-bold text-slate-900', title: sessionRowTitle(session), children: sessionRowTitle(session) }, 'title'),
                  jsx('span', { className: 'codex-monitor-status-pill shrink-0', 'data-status': status, children: status }, 'pill')
                ]
              }, 'title-row'),
              jsxs('div', {
                className: 'flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-slate-500',
                children: [
                  jsx('span', { className: 'truncate font-medium text-slate-600', children: projectDisplayLabel(project) }, 'project'),
                  jsx('span', { 'aria-hidden': true, children: '·' }, 'dot'),
                  jsx('span', {
                    className: 'truncate rounded bg-slate-200/60 px-1 py-0.2 text-[9.5px] text-slate-600 font-sans',
                    title: `网关: ${gatewayLabel}`,
                    children: gatewayLabel
                  }, 'gateway')
                ]
              }, 'meta')
            ]
          }, 'labels'),
          jsx('span', {
            className: 'flex size-5 shrink-0 items-center justify-center',
            children: jsx(SessionStatusDot, { session, storedSessionId: session.id })
          }, 'status'),
          jsx(Button, {
            'aria-label': `打开完整会话 ${sessionRowTitle(session)}`,
            className: 'size-7 shrink-0',
            onClick: () => openMonitoredSession(project, session),
            size: 'icon-xs',
            title: '打开完整会话',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'screen-full', size: '0.8rem' })
          }, 'open'),
          jsx(Button, {
            'aria-label': `移出监控室 ${sessionRowTitle(session)}`,
            className: 'size-7 shrink-0',
            onClick: () => onDismiss?.(entry.key),
            size: 'icon-xs',
            title: '移出监控室',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'close', size: '0.8rem' })
          }, 'dismiss')
        ]
      }, 'header'),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-3.5 py-3.5 select-text',
        'data-selectable-text': 'true',
        ref: scrollRef,
        children: transcriptQuery.isLoading && messages.length === 0
          ? jsx('div', {
              className: 'flex h-full items-center justify-center gap-2 text-[0.68rem] text-(--ui-text-quaternary)',
              children: [
                jsx(GlyphSpinner, { ariaLabel: '正在读取会话', className: 'text-xs' }, 'spinner'),
                jsx('span', { children: '正在读取会话…' }, 'label')
              ]
            })
          : transcriptQuery.error && messages.length === 0
            ? jsx('div', {
                className: 'flex h-full flex-col items-center justify-center gap-2 text-center text-[0.68rem] text-(--ui-text-quaternary)',
                children: [
                  jsx('span', { children: '暂时无法读取会话内容' }, 'label'),
                  jsx(Button, { onClick: () => void transcriptQuery.refetch(), size: 'xs', variant: 'ghost', children: '重试' }, 'retry')
                ]
              })
          : jsx('div', {
                  className: 'flex min-h-full flex-col justify-end gap-3.5',
                  ref: contentRef,
                  children: messages.map(row => jsx(MonitorMessageRow, { row }, row.key))
                })
      }, 'transcript'),
      jsx(MonitorSessionComposer, {
        onClearQueue: handleClearQueue,
        onEnqueue: handleEnqueue,
        onRemoveQueueItem: handleRemoveQueueItem,
        onSendNow: async (prompt, images) => {
          await submitMonitorPrompt({ images, project, prompt, session })
          void queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, routeKey(project.route), session.id] })
          void queryClient.invalidateQueries({ queryKey: GATEWAY_SESSIONS_KEY })
          setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, routeKey(project.route), session.id] })
          }, 600)
        },
        onSendQueueNow: handleSendQueueNow,
        onStop: async () => {
          await stopMonitorSessionTask(project, session)
          void queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, routeKey(project.route), session.id] })
        },
        placeholder: ready ? '输入 Prompt 启动或加入队列… (Enter 入队)' : (status === '执行中' ? '输入下一步指令加入队列… (Enter 入队)' : '输入指令加入队列… (Enter 入队)'),
        queue,
        status
      }, 'composer'),
      tokens || sessionRowTime(session) || model
        ? jsxs('div', {
            className: 'flex shrink-0 items-center justify-between px-3.5 pb-2 font-mono text-[9.5px] text-slate-400 gap-2',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-1.5 min-w-0 flex-1 truncate',
                children: [
                  jsx(MonitorCardModelPicker, {
                    currentModel: model,
                    onModelChanged: setOverrideModel,
                    project,
                    session
                  }, 'model-picker'),
                  tokens || sessionRowTime(session)
                    ? jsx('span', { className: 'truncate', children: [tokens, sessionRowTime(session)].filter(Boolean).join(' • ') }, 'meta')
                    : null
                ]
              }, 'left-meta'),
              jsx('span', { className: 'shrink-0', children: status === '执行中' ? '● 正在执行' : (ready ? '● 准备启动' : '● 正在监听反馈') }, 'live')
            ]
          }, 'usage')
        : null
    ]
  }, entry.key)
}

function MonitorNewSessionDialog({ open, onOpenChange, onCreated, projects, sourceGroups }) {
  const gatewayChoices = useMemo(() => monitorGatewayOptions(sourceGroups), [sourceGroups])
  const [gatewayKey, setGatewayKey] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef(null)

  const selectedGateway = gatewayChoices.find(choice => choice.key === gatewayKey) || gatewayChoices[0] || null
  const selectedGatewayKey = selectedGateway?.key || ''
  const gatewayProjects = useMemo(
    () => monitorProjectsForGateway(projects, selectedGatewayKey),
    [projects, selectedGatewayKey]
  )
  const selectedProject = gatewayProjects.find(project => project.key === projectKey) || gatewayProjects[0] || null
  const modelQuery = useQuery({
    enabled: open && Boolean(selectedProject?.route),
    queryFn: () => fetchMonitorModelOptions(selectedProject),
    queryKey: [...MONITOR_QUERY_KEY, 'models', selectedProject?.key || ''],
    retry: false,
    staleTime: 120_000
  })
  const catalog = useMemo(() => normalizeMonitorModelOptions(modelQuery.data), [modelQuery.data])
  const selectedModelKey = catalog.choices.some(choice => choice.key === modelKey) ? modelKey : catalog.defaultChoiceKey

  useEffect(() => {
    if (!open) return
    setGatewayKey(current => (gatewayChoices.some(choice => choice.key === current) ? current : selectedGatewayKey))
  }, [gatewayChoices, open, selectedGatewayKey])

  useEffect(() => {
    if (!open) return
    const nextKey = selectedProject?.key || ''
    setProjectKey(current => (gatewayProjects.some(project => project.key === current) ? current : nextKey))
  }, [gatewayProjects, open, selectedProject?.key])

  useEffect(() => {
    if (!open) return
    setModelKey(current => (catalog.choices.some(choice => choice.key === current) ? current : catalog.defaultChoiceKey))
  }, [catalog, open])

  useEffect(() => {
    if (open) return
    setPrompt('')
    setImages([])
    setSubmitting(false)
    setModelKey('')
  }, [open])

  const model = monitorModelChoiceFromKey(selectedModelKey)
  const canSubmit = Boolean(open && selectedProject && model && prompt.trim() && !submitting && !modelQuery.isLoading && !modelQuery.error)

  const addImages = async event => {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    try {
      const next = await Promise.all(files.map(readMonitorImageFile))
      setImages(current => [...current, ...next])
    } catch (error) {
      host.notify({
        kind: 'error',
        message: error instanceof Error ? error.message : '图片读取失败。'
      })
    }
  }

  const submit = async () => {
    if (!canSubmit || !model) return
    setSubmitting(true)
    try {
      await createMonitorSession({
        images,
        model,
        project: selectedProject,
        prompt
      })
      onOpenChange(false)
      onCreated?.()
      host.notify({ kind: 'success', message: '会话已创建。' })
    } catch {
      host.notify({ kind: 'error', message: '无法在监控室新建会话。' })
    } finally {
      setSubmitting(false)
    }
  }

  return jsx(Dialog, {
    onOpenChange: next => {
      if (submitting) return
      onOpenChange(next)
    },
    open,
    children: jsxs(DialogContent, {
      className: 'max-w-lg',
      children: [
        jsx(DialogHeader, { children: jsx(DialogTitle, { children: '新建会话' }) }, 'header'),
        jsxs('div', {
          className: 'codex-monitor-new-field',
          children: [
            jsx('span', { className: 'codex-monitor-new-label', children: '网关' }, 'label'),
            gatewayChoices.length
              ? jsxs(Select, {
                  disabled: submitting,
                  onValueChange: setGatewayKey,
                  value: selectedGatewayKey,
                  children: [
                    jsx(SelectTrigger, { className: 'w-full', children: jsx(SelectValue, { placeholder: '选择网关' }) }, 'trigger'),
                    jsx(SelectContent, {
                      children: gatewayChoices.map(choice => jsx(SelectItem, { value: choice.key, children: choice.label }, choice.key))
                    }, 'content')
                  ]
                }, 'select')
              : jsx('span', { className: 'text-[0.7rem] text-(--ui-text-quaternary)', children: '暂无可用网关' }, 'empty')
          ]
        }, 'gateway'),
        jsxs('div', {
          className: 'codex-monitor-new-field',
          children: [
            jsx('span', { className: 'codex-monitor-new-label', children: '项目' }, 'label'),
            gatewayProjects.length
              ? jsxs(Select, {
                  disabled: submitting,
                  onValueChange: setProjectKey,
                  value: selectedProject?.key || '',
                  children: [
                    jsx(SelectTrigger, { className: 'w-full', children: jsx(SelectValue, { placeholder: '选择项目' }) }, 'trigger'),
                    jsx(SelectContent, {
                      children: gatewayProjects.map(project => jsx(SelectItem, { value: project.key, children: projectDisplayLabel(project) }, project.key))
                    }, 'content')
                  ]
                }, 'select')
              : jsx('span', { className: 'text-[0.7rem] text-(--ui-text-quaternary)', children: '该网关没有项目' }, 'empty')
          ]
        }, 'project'),
        jsxs('div', {
          className: 'codex-monitor-new-field',
          children: [
            jsx('span', { className: 'codex-monitor-new-label', children: '模型' }, 'label'),
            modelQuery.isLoading
              ? jsxs('div', {
                  className: 'flex h-8 items-center gap-2 text-[0.7rem] text-(--ui-text-quaternary)',
                  children: [
                    jsx(GlyphSpinner, { ariaLabel: '正在加载默认模型', className: 'text-xs' }, 'spinner'),
                    jsx('span', { children: '正在预加载默认模型…' }, 'copy')
                  ]
                }, 'loading')
              : modelQuery.error
                ? jsxs('div', {
                    className: 'flex items-center gap-2 text-[0.7rem] text-(--ui-text-quaternary)',
                    children: [
                      jsx('span', { children: '无法读取该网关的模型列表' }, 'copy'),
                      jsx(Button, { onClick: () => void modelQuery.refetch(), size: 'xs', variant: 'ghost', children: '重试' }, 'retry')
                    ]
                  }, 'error')
                : catalog.choices.length
                  ? jsxs(Select, {
                      disabled: submitting,
                      onValueChange: setModelKey,
                      value: selectedModelKey,
                      children: [
                        jsx(SelectTrigger, { className: 'w-full', children: jsx(SelectValue, { placeholder: '选择模型' }) }, 'trigger'),
                        jsx(SelectContent, {
                          children: catalog.choices.map(choice => jsx(SelectItem, { value: choice.key, children: choice.label }, choice.key))
                        }, 'content')
                      ]
                    }, 'select')
                  : jsx('span', { className: 'text-[0.7rem] text-(--ui-text-quaternary)', children: '当前网关没有可用模型' }, 'empty')
          ]
        }, 'model'),
        jsxs('div', {
          className: 'codex-monitor-new-field',
          children: [
            jsx('span', { className: 'codex-monitor-new-label', children: '首条指令' }, 'label'),
            jsx(Textarea, {
              disabled: submitting,
              onChange: event => setPrompt(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void submit()
                }
              },
              placeholder: '输入第一条指令…',
              rows: 4,
              value: prompt
            }, 'input')
          ]
        }, 'prompt'),
        jsxs('div', {
          className: 'codex-monitor-new-field',
          children: [
            jsx('span', { className: 'codex-monitor-new-label', children: '图片' }, 'label'),
            jsxs('div', {
              className: 'codex-monitor-new-images',
              children: [
                ...images.map(image => jsxs('span', {
                  className: 'codex-monitor-new-thumb',
                  title: image.name,
                  children: [
                    jsx('img', { alt: image.name, src: image.dataUrl }, 'preview'),
                    jsx('button', {
                      'aria-label': `移除 ${image.name}`,
                      className: 'codex-monitor-new-thumb-remove',
                      disabled: submitting,
                      onClick: () => setImages(current => current.filter(item => item.id !== image.id)),
                      type: 'button',
                      children: jsx(Codicon, { name: 'close', size: '0.65rem' })
                    }, 'remove')
                  ]
                }, image.id)),
                jsx('input', {
                  accept: MONITOR_IMAGE_ACCEPT,
                  className: 'hidden',
                  disabled: submitting,
                  multiple: true,
                  onChange: event => { void addImages(event) },
                  ref: fileRef,
                  type: 'file'
                }, 'file'),
                jsxs(Button, {
                  disabled: submitting,
                  onClick: () => fileRef.current?.click(),
                  size: 'xs',
                  type: 'button',
                  variant: 'outline',
                  children: [
                    jsx(Codicon, { name: 'add', size: '0.75rem' }, 'icon'),
                    jsx('span', { children: '添加图片' }, 'label')
                  ]
                }, 'add')
              ]
            }, 'list')
          ]
        }, 'images'),
        jsxs(DialogFooter, {
          children: [
            jsx(Button, { disabled: submitting, onClick: () => onOpenChange(false), variant: 'ghost', children: '取消' }, 'cancel'),
            jsx(Button, { disabled: !canSubmit, onClick: () => void submit(), children: submitting ? '正在创建…' : '创建并发送' }, 'submit')
          ]
        }, 'footer')
      ]
    })
  })
}

function SessionMonitorPage() {
  const queryClient = useQueryClient()
  const { prefs, sessionsQuery } = useGatewaySessionsQuery(PROFILE_SCOPE_ALL)
  const sourceGroups = sessionsQuery.data?.groups || []
  const projects = useMemo(
    () => sourceGroups
      .filter(group => !group.error)
      .flatMap(group => projectGroupsForGatewayGroup(group, prefs.hideScheduled)),
    [prefs.hideScheduled, sourceGroups]
  )
  const hiddenKeys = prefs.monitorHiddenKeys || []
  const parkedKeys = prefs.monitorParkedKeys || []
  const layout = normalizeMonitorLayout(prefs.monitorLayout)
  const candidates = useMemo(
    () => monitorDisplayedCandidates(projects, hiddenKeys, parkedKeys),
    [hiddenKeys, parkedKeys, projects]
  )
  const candidateByKey = useMemo(() => new Map(candidates.map(entry => [entry.key, entry])), [candidates])
  const [slotKeys, setSlotKeys] = useState(() => [])
  const [createOpen, setCreateOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const renderedSlotKeys = stabilizeMonitorSlotKeys(slotKeys, candidates)
  const slots = renderedSlotKeys.map(key => candidateByKey.get(key)).filter(Boolean)
  const occupiedCount = slots.length
  const queue = useMemo(
    () => monitorQueueCandidates(projects, renderedSlotKeys),
    [projects, renderedSlotKeys]
  )

  useEffect(() => {
    setSlotKeys(current => {
      const next = stabilizeMonitorSlotKeys(current, candidates)
      return next.length === current.length && next.every((key, index) => key === current[index]) ? current : next
    })
  }, [candidates])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const persistPrefs = patch => {
    writeGatewaySessionPreferences({
      ...prefs,
      ...patch
    })
  }
  const failedSources = sourceGroups.filter(group => group.error).length
  const refresh = () => {
    void sessionsQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: MONITOR_QUERY_KEY })
  }
  const dismiss = key => {
    const next = monitorHideSessionKeys(hiddenKeys, parkedKeys, key)
    persistPrefs(next)
  }
  const park = key => {
    const targetKey = String(key || '').trim()
    if (!targetKey) return
    const next = monitorParkSessionKeys(hiddenKeys, parkedKeys, targetKey)
    persistPrefs(next)
    const targetEntry = queue.find(q => q.key === targetKey) || candidates.find(c => c.key === targetKey)
    const title = targetEntry?.session ? sessionRowTitle(targetEntry.session) : '会话'
    host.notify({ kind: 'info', message: `已接入待命会话：${title}` })
  }
  const clock = new Date(now).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })

  return jsxs('div', {
    className: 'codex-monitor-page text-foreground',
    'data-slot': 'codex-session-monitor',
    children: [
      jsxs('header', {
        className: 'codex-monitor-topbar',
        children: [
          jsxs('div', {
            className: 'flex min-w-0 items-center gap-2.5',
            children: [
              jsx('span', {
                className: 'flex size-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600',
                children: jsx(Codicon, { name: 'layout', size: '1rem' })
              }, 'icon'),
              jsxs('div', {
                className: 'min-w-0',
                children: [
                  jsxs('h1', {
                    className: 'flex items-center gap-2 text-base font-bold tracking-wide text-slate-900',
                    children: [
                      jsx('span', { children: '多会话监控室' }, 'title'),
                      jsxs('span', {
                        className: 'codex-monitor-live',
                        children: [
                          jsx('span', { className: 'codex-monitor-live-dot' }, 'dot'),
                          jsx('span', { children: 'LIVE 实时监控中' }, 'label')
                        ]
                      }, 'live')
                    ]
                  }, 'heading'),
                  jsx('p', { className: 'text-xs text-slate-500', children: '动态并发流 · 活跃会话实时调度 · 支持弹性多窗口平铺与扩容' }, 'description')
                ]
              }, 'copy')
            ]
          }, 'brand'),
          jsxs('div', {
            className: 'flex shrink-0 items-center gap-2',
            children: [
              failedSources ? jsx('span', { className: 'text-[0.65rem] text-slate-400', title: '部分会话来源当前不可用', children: `${failedSources} 个来源不可用` }, 'failed') : null,
              jsx(MonitorQueueMenu, { onOpenDialog: () => setQueueOpen(true), queue }, 'queue'),
              jsx('span', { className: 'rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600', children: `自动轮询: ${MONITOR_REFRESH_MS / 1000}s` }, 'poll'),
              jsx(MonitorLayoutSwitch, { layout, onChange: value => persistPrefs({ monitorLayout: value }) }, 'layout'),
              jsx(Button, {
                'aria-label': '在监控室新建会话',
                onClick: () => setCreateOpen(true),
                size: 'xs',
                title: '新建会话',
                children: jsxs('span', { className: 'inline-flex items-center gap-1', children: [jsx(Codicon, { name: 'add', size: '0.8rem' }, 'icon'), jsx('span', { children: '新建会话' }, 'label')] })
              }, 'create'),
              jsx(Button, {
                'aria-label': '刷新多会话看板',
                className: 'size-8',
                onClick: refresh,
                size: 'icon-xs',
                title: '刷新',
                variant: 'ghost',
                children: jsx(Codicon, { name: 'refresh', size: '0.85rem', spinning: sessionsQuery.isFetching })
              }, 'refresh')
            ]
          }, 'actions')
        ]
      }, 'header'),
      sessionsQuery.isLoading && sourceGroups.length === 0
        ? jsx('div', {
            className: 'flex min-h-0 flex-1 items-center justify-center gap-2 text-(--ui-text-tertiary)',
            children: [
              jsx(GlyphSpinner, { ariaLabel: '正在加载活跃会话' }, 'spinner'),
              jsx('span', { children: '正在加载活跃会话…' }, 'label')
            ]
          }, 'loading')
        : sessionsQuery.error && sourceGroups.length === 0
          ? jsx(ErrorState, { className: 'min-h-0 flex-1', description: '暂时无法读取跨网关会话。', title: '监控室不可用', children: jsx(Button, { onClick: refresh, size: 'xs', variant: 'ghost', children: '重试' }) }, 'error')
          : jsx('main', {
              className: 'codex-monitor-grid',
              'data-layout': layout,
              'data-seat-count': String(occupiedCount),
              children: [
                ...slots.map((entry, index) => jsx(MonitorSessionCard, {
                  appearance: prefs.projectAppearance || {},
                  entry,
                  onDismiss: dismiss,
                  slotIndex: index
                }, entry.key)),
                jsx(MonitorNewSessionTile, {
                  onCreate: () => setCreateOpen(true),
                  onQueue: () => {
                    if (queue.length > 0) {
                      setQueueOpen(true)
                    } else {
                      host.notify({ kind: 'info', message: '当前没有待命队列会话。' })
                    }
                  },
                  queueCount: queue.length
                }, 'new-session')
              ]
            }, 'grid'),
      jsxs('footer', {
        className: 'codex-monitor-footer',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-4',
            children: [
              jsxs('span', { className: 'inline-flex items-center gap-1.5 text-slate-800', children: [jsx('span', { className: 'codex-monitor-live-dot' }, 'dot'), jsx('span', { children: '调度引擎: 正常' }, 'label')] }, 'engine'),
              jsx('span', { children: `当前活跃: ${occupiedCount} 实例` }, 'active'),
              jsx('span', { children: `队列待命中: ${queue.length}` }, 'queue'),
              jsx('span', { children: '自动调度策略: 弹性负载与优先级唤醒' }, 'policy')
            ]
          }, 'left'),
          jsxs('span', { children: ['Overlook Monitor', 'UTC+8', clock].join(' · ') }, 'brand')
        ]
      }, 'status'),
      jsx(MonitorQueueSelectDialog, {
        onOpenChange: setQueueOpen,
        onSelect: park,
        open: queueOpen,
        queue
      }, 'queue-dialog'),
      jsx(MonitorNewSessionDialog, {
        onCreated: refresh,
        onOpenChange: setCreateOpen,
        open: createOpen,
        projects,
        sourceGroups
      }, 'create-dialog')
    ]
  })
}

function GatewaySessionsPane() {
  const queryClient = useQueryClient()
  const { prefs, profileScope, sessionLimit, sessionsQuery, sessionsQueryKey } = useGatewaySessionsQuery()
  const search = prefs.search
  const hideScheduled = prefs.hideScheduled
  const collapsed = useMemo(() => new Set(prefs.collapsedKeys), [prefs.collapsedKeys])
  const [revealedProjects, setRevealedProjects] = useState(() => new Set())
  const [projectLoads, setProjectLoads] = useState(() => new Map())
  const projectLoadGenerationRef = useRef(0)
  const [opening, setOpening] = useState('')
  const [sessionFilter, setSessionFilter] = useState('all')
  const [retryingSourceKey, setRetryingSourceKey] = useState('')
  const sessionsScrollRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(640)
  const focusedStoredSessionId = useValue(host.state.focusedStoredSessionId)
  const focusedSessionOwner = useValue(host.state.focusedSessionOwner)
  const focusedBusy = useValue(host.state.busy)
  const projectDataRevision = useValue($gatewayProjectDataRevision)
  const projectOrderKeysRef = useRef([])
  const sessionOrderIdsRef = useRef(new Map())
  const pendingNewChatRef = useRef(null)
  const lastProjectSortEpochRef = useRef(-1)
  const previousBusyRef = useRef(false)
  const previousFocusedSessionIdRef = useRef(null)
  const [projectSortEpoch, setProjectSortEpoch] = useState(0)

  const persistPrefs = patch => {
    writeGatewaySessionPreferences({
      ...prefs,
      ...patch
    })
  }

  const pinnedProjects = useMemo(() => new Set(prefs.pinnedProjectKeys || []), [prefs.pinnedProjectKeys])
  const toggleProjectPin = key => {
    const next = new Set(pinnedProjects)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    persistPrefs({ pinnedProjectKeys: [...next].slice(-100) })
  }

  const projectAppearance = prefs.projectAppearance || {}
  const [appearanceEditorProject, setAppearanceEditorProject] = useState(null)
  const saveProjectAppearance = (key, entry) => {
    const next = { ...projectAppearance }
    if (entry && (entry.color || entry.icon)) {
      next[key] = entry
    } else {
      delete next[key]
    }
    persistPrefs({ projectAppearance: next })
  }

  useEffect(() => {
    const element = sessionsScrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const update = () => setViewportHeight(Math.max(1, element.clientHeight || 640))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    projectOrderKeysRef.current = []
    lastProjectSortEpochRef.current = -1
    projectLoadGenerationRef.current += 1
    setProjectLoads(new Map())
    setRevealedProjects(new Set())
  }, [projectDataRevision, sessionsQueryKey])

  useEffect(() => {
    if (shouldResortProjectsForUserInput({
      previousBusy: previousBusyRef.current,
      busy: focusedBusy,
      previousSessionId: previousFocusedSessionIdRef.current,
      sessionId: focusedStoredSessionId
    })) {
      setProjectSortEpoch(current => current + 1)
    }
    previousBusyRef.current = Boolean(focusedBusy)
    previousFocusedSessionIdRef.current = focusedStoredSessionId
  }, [focusedBusy, focusedStoredSessionId])

  const sourceGroups = sessionsQuery.data?.groups || []
  const loadedSessionCount = sourceGroups.reduce((count, group) => count + group.sessions.filter(session => !hideScheduled || !sessionIsScheduled(session)).length, 0)
  const sourcesIncomplete = sourceGroups.some(group => !group.error && group.hasMore)

  // Groups are only a transport shape. The UI deliberately flattens every
  // route's projects into one list; route metadata stays on each project so a
  // same-named project from two gateways cannot open the wrong session.
  // Project *order* is sticky after first paint: background last_active
  // patches must not reshuffle the rail while two chats stream at once.
  const unfilteredProjects = useMemo(() => (
    sourceGroups
      .flatMap(group => projectGroupsForGatewayGroup(group, hideScheduled))
      .map(project => {
        const displayLabel = projectDisplayLabel(project)
        const remoteLabel = projectRemoteLabel(project)
        const sourceLabel = String(project.sourceLabel || '').trim()
        const profile = String(project.profile || '').trim()
        const load = projectLoads.get(project.key)
        const hydratedSessions = load?.status === 'ready'
          ? normalizeProjectSessions(load.sessions, profile, hideScheduled)
          : null
        const prefetchedSessions = hydratedSessions || project.prefetchedSessions || project.sessions
        const sessions = hydratedSessions || project.sessions
        return {
          ...project,
          displayLabel,
          remoteLabel,
          sourceLabel,
          profile,
          hydrated: Boolean(hydratedSessions) || project.prefetchedComplete,
          loadError: load?.error || '',
          loadStatus: load?.status || 'idle',
          loadUnsupported: Boolean(load?.unsupported),
          prefetchedSessions,
          searchSessions: prefetchedSessions,
          sessionCount: hydratedSessions ? hydratedSessions.length : project.sessionCount,
          sessions: [...sessions].sort(compareSessions)
        }
      })
  ), [hideScheduled, projectLoads, sourceGroups])

  const totalProjectSessionCount = unfilteredProjects.reduce(
    (count, project) => count + Math.max(project.sessions.length, Number(project.sessionCount) || 0),
    0
  )

  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtering = Boolean(needle) || sessionFilter !== 'all'
    return unfilteredProjects
      .map(project => {
        const pool = filtering ? project.searchSessions : project.sessions
        const sessions = pool.filter(session => {
          if (!sessionMatchesFilter(session, sessionFilter)) {
            return false
          }
          if (!needle) {
            return true
          }
          return `${sessionRowTitle(session)} ${session.preview || ''} ${project.displayLabel} ${project.remoteLabel} ${project.profile} ${project.sourceLabel}`
            .toLowerCase()
            .includes(needle)
        })
        return {
          ...project,
          loadStatus: filtering ? 'idle' : project.loadStatus,
          sessionCount: filtering ? sessions.length : project.sessionCount,
          sessions,
          suppressCollapse: filtering
        }
      })
      .filter(project => project.sessions.length > 0 || !filtering)
  }, [search, sessionFilter, unfilteredProjects])

  const projects = useMemo(() => {
    const known = new Set(unfilteredProjects.map(project => project.key))
    const previousKeys = projectOrderKeysRef.current.filter(key => known.has(key))
    const pendingNewChatReady = pendingNewChatAppeared(pendingNewChatRef.current, unfilteredProjects)
    const resort = lastProjectSortEpochRef.current !== projectSortEpoch || previousKeys.length === 0 || pendingNewChatReady
    const orderedAll = stabilizeProjectOrder(unfilteredProjects, previousKeys, { resort })
    lastProjectSortEpochRef.current = projectSortEpoch
    projectOrderKeysRef.current = orderedAll.map(project => project.key)
    if (pendingNewChatReady) pendingNewChatRef.current = null

    // Freeze each project's session order against the same epoch, so a live
    // last_active tick inside a project no longer reshuffles its rows either.
    const frozenSessionOrder = new Map()
    for (const project of orderedAll) {
      const previousIds = sessionOrderIdsRef.current.get(project.key) || []
      const frozen = stabilizeSessionOrder(project.sessions, previousIds, { resort })
      frozenSessionOrder.set(project.key, frozen.map(session => session.id))
    }
    sessionOrderIdsRef.current = frozenSessionOrder

    const visibleByKey = new Map(visibleProjects.map(project => [project.key, project]))
    const visible = orderedAll
      .map(project => {
        const visibleProject = visibleByKey.get(project.key)
        if (!visibleProject) return null
        // Re-apply the frozen id order to whatever subset search/filter kept.
        const rank = new Map((frozenSessionOrder.get(project.key) || []).map((id, index) => [id, index]))
        const sessions = [...visibleProject.sessions].sort((a, b) => {
          const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER
          const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER
          return ra - rb || compareSessions(a, b)
        })
        return sessions === visibleProject.sessions ? visibleProject : { ...visibleProject, sessions }
      })
      .filter(Boolean)
    return orderProjectsWithPins(visible, pinnedProjects)
  }, [pinnedProjects, projectSortEpoch, unfilteredProjects, visibleProjects])

  const unavailableSources = sourceGroups.filter(group => group.error)

  const revealedForRender = useMemo(() => {
    if (search.trim()) {
      return new Set(projects.map(project => project.key))
    }
    return revealedProjects
  }, [projects, revealedProjects, search])

  const renderRows = useMemo(
    () => gatewayRenderRows(projects, collapsed, revealedForRender),
    [collapsed, projects, revealedForRender]
  )

  const renderedRows = useMemo(() => {
    if (renderRows.length <= GATEWAY_VIRTUALIZE_THRESHOLD) {
      return { rows: renderRows, topSpacer: 0, bottomSpacer: 0 }
    }

    const windowed = gatewayVirtualWindow(renderRows, scrollTop, viewportHeight)
    return {
      rows: renderRows.slice(windowed.start, windowed.end),
      topSpacer: windowed.top,
      bottomSpacer: windowed.bottom
    }
  }, [renderRows, scrollTop, viewportHeight])

  const open = (project, session) => {
    const key = `${project.key}::${session.id}`
    setOpening(key)

    // `host.openSession()` deliberately waits for a cold route's gateway dial
    // before it calls the core open-session action. That is useful to callers
    // that need a fully hydrated promise, but it is the wrong contract for a
    // sidebar click: native Sessions navigates first and lets resume/history
    // recovery continue in the background. Start the routed open so the SDK
    // records the exact owner synchronously, then hand the UI the canonical
    // route without waiting for profile activation or transcript hydration.
    let opening

    try {
      opening = host.openSession(session.id, {
        intent: 'in-place',
        keepAllProfilesScope: true,
        profile: project.route.profile,
        route: project.route
      })

      // Keep connectionId/profile/targetProfile in the host call above; this
      // navigation is presentation-only and must never replace route-aware
      // session RPC routing. The hash change makes the existing core
      // useRouteResume path paint the target chat immediately.
      host.navigate(`/${encodeURIComponent(session.id)}`)
    } catch {
      host.notify({
        kind: 'error',
        message: '无法打开网关会话。'
      })
      setOpening(current => (current === key ? '' : current))
      return
    }

    // The dial/resume remains owned by Hermes in the background. Do not keep
    // the plugin row disabled while a remote backend starts, and do not report
    // the expected superseded-open rejection when the user clicks another row.
    setOpening(current => (current === key ? '' : current))
    void opening.catch(error => {
      if (error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {
        return
      }

      host.notify({
        kind: 'error',
        message: '无法打开网关会话。'
      })
    })
  }

  const toggle = key => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    persistPrefs({ collapsedKeys: [...next].slice(-200) })
    setRevealedProjects(current => {
      if (!current.has(key)) return current
      const revealed = new Set(current)
      revealed.delete(key)
      return revealed
    })
  }

  const loadProjectSessions = (key, retry = false) => {
    const project = unfilteredProjects.find(row => row.key === key)
    if (!project || project.loadStatus === 'loading') {
      return
    }

    setRevealedProjects(current => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })

    if (project.loadStatus === 'ready') {
      return
    }

    if (project.prefetchedComplete || !project.projectId) {
      setProjectLoads(current => {
        const next = new Map(current)
        next.set(key, { status: 'ready', sessions: project.prefetchedSessions })
        return next
      })
      return
    }

    if (retry) {
      clearGatewayProjectSessionsCache(project)
    }
    const generation = projectLoadGenerationRef.current
    setProjectLoads(current => {
      const next = new Map(current)
      next.set(key, { status: 'loading' })
      return next
    })
    void fetchGatewayProjectSessions(project)
      .then(sessions => {
        if (generation !== projectLoadGenerationRef.current) return
        const unsupported = Boolean(gatewayProjectSessionsCache.get(gatewayProjectSessionsCacheKey(project))?.unsupported)
        setProjectLoads(current => {
          const next = new Map(current)
          next.set(key, { status: 'ready', sessions, unsupported })
          return next
        })
      })
      .catch(() => {
        if (generation !== projectLoadGenerationRef.current) return
        setProjectLoads(current => {
          const next = new Map(current)
          next.set(key, { status: 'error', error: '无法加载项目会话。' })
          return next
        })
      })
  }

  const revealProjectSessions = key => loadProjectSessions(key)
  const retryProjectSessions = key => loadProjectSessions(key, true)

  const collapseProjectSessions = key => {
    setRevealedProjects(current => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }

  const handleSessionsScroll = event => {
    const nextTop = event.currentTarget.scrollTop
    setScrollTop(current => (current === nextTop ? current : nextTop))
  }

  const newChat = async project => {
    let release = null
    let handedOff = false
    try {
      if (typeof host.requestProfile !== 'function' || typeof host.openSession !== 'function') {
        throw new Error('请更新 Hermes Desktop 以在其他网关新建会话。')
      }

      const home = isHomeProject(project)
      const targetPath = projectWorkspacePath(project)
      if (!home && !targetPath) {
        throw new Error(`无法解析项目“${projectDisplayLabel(project)}”的工作目录。`)
      }

      // Do not call host.newChat / ensureAgent. Those rewrite the global
      // $newChatRoute and the active primary gateway, which is how native
      // Sessions "+" started creating on the remote source and how this
      // pane's remote "+" later landed in local Home. session.create on the
      // clicked route carries cwd without touching chrome ownership.
      if (typeof host.retainProfile === 'function') {
        release = await host.retainProfile(project.route)
      }

      const created = await host.requestProfile(project.route, 'session.create', {
        cols: 96,
        source: 'desktop',
        profile: routeTargetProfile(project.route),
        ...(targetPath ? { cwd: targetPath } : {})
      })
      const stored = String(created?.stored_session_id || '').trim()
      if (!stored) {
        throw new Error('The gateway did not return a session id.')
      }
      pendingNewChatRef.current = { projectKey: project.key, sessionId: stored }

      const opening = host.openSession(stored, {
        intent: 'in-place',
        keepAllProfilesScope: true,
        profile: project.route.profile,
        route: project.route
      })
      host.navigate(`/${encodeURIComponent(stored)}`)
      handedOff = true
      void opening
        .catch(error => {
          if (error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {
            return
          }
          host.notify({
            kind: 'error',
            message: '无法打开新建的网关会话。'
          })
        })
        .finally(() => {
          try { release?.() } catch {}
        })
      clearGatewayProjectTreeCache()
      projectLoadGenerationRef.current += 1
      setProjectLoads(new Map())
      setRevealedProjects(new Set())
      void queryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
    } catch {
      host.notify({
        kind: 'error',
        message: '无法新建网关会话。'
      })
    } finally {
      if (!handedOff) {
        try { release?.() } catch {}
      }
    }
  }

  const refresh = ({ refreshRoutes = true } = {}) => {
    setProjectSortEpoch(current => current + 1)
    void refreshGatewaySessionQueries({ refreshRoutes })
  }

  const retryGatewaySource = async group => {
    if (retryingSourceKey) return
    setRetryingSourceKey(group.key)
    const sourceById = new Map([[
      group.route.connectionId,
      {
        id: group.route.connectionId,
        kind: group.kind,
        label: group.label,
        host: group.remoteLabel
      }
    ]])
    try {
      await queryClient.cancelQueries({ queryKey: sessionsQueryKey })
      const revision = sessionDataRevision.current
      const nextGroup = await fetchGatewaySessionGroup(group.route, sessionLimit, sourceById)
      if (revision !== sessionDataRevision.current) {
        void queryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
        return
      }
      queryClient.setQueryData(sessionsQueryKey, current => current
        ? {
            ...current,
            groups: current.groups.map(value => value.key === group.key ? mergeGatewaySessionGroup(value, nextGroup) : value)
          }
        : current)
    } catch {
      host.notify({ kind: 'error', message: `无法重试 ${group.label}。` })
    } finally {
      setRetryingSourceKey(current => current === group.key ? '' : current)
    }
  }

  const applySessionChange = ({ body, method, project, result, session } = {}) => {
    if (!project || !session) {
      refresh({ refreshRoutes: false })
      return
    }
    sessionDataRevision.current += 1
    void queryClient.cancelQueries({ queryKey: sessionsQueryKey })
    queryClient.setQueryData(sessionsQueryKey, current => {
      if (!current || !Array.isArray(current.groups)) {
        return current
      }
      return {
        ...current,
        groups: patchSessionInGroups(current.groups, project, session, body, method, result)
      }
    })
    clearGatewayProjectSessionsCache(project)
    // Deletions must also invalidate the project tree cache: the refetch below
    // rebuilds project rows from projects.tree, and a stale cached tree would
    // resurrect the deleted preview row.
    clearGatewayProjectTreeCache()
    setProjectLoads(current => {
      const load = current.get(project.key)
      if (!load?.sessions) {
        return current
      }
      const next = new Map(current)
      next.set(project.key, {
        ...load,
        sessions: patchSessionRows(load.sessions, session, body, method, result)
      })
      return next
    })
    void queryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
  }

  if (sessionsQuery.isLoading && sourceGroups.length === 0) {
    return jsxs('div', {
      className: 'flex h-full flex-col items-center justify-center gap-2 bg-(--ui-sidebar-surface-background) p-4 text-(--ui-text-tertiary)',
      children: [
        jsx(GlyphSpinner, { ariaLabel: '正在加载会话', className: 'text-sm' }, 'spinner'),
        jsx(EmptyState, {
          className: 'min-h-0',
          description: '正在读取所有可用网关的会话。',
          title: '正在加载会话…'
        }, 'empty')
      ]
    })
  }

  if (sessionsQuery.error && sourceGroups.length === 0) {
    return jsx('div', {
      className: 'flex h-full items-center justify-center bg-(--ui-sidebar-surface-background) p-4',
      children: jsxs(ErrorState, {
        className: 'max-w-xs',
        description: '暂时无法读取网关会话。',
        title: 'Overlook',
        children: jsx(Button, { onClick: refresh, size: 'xs', variant: 'ghost', children: '重试' }, 'retry')
      })
    })
  }

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col bg-(--ui-sidebar-surface-background) text-xs text-(--ui-text-tertiary)',
    children: [
      jsxs('header', {
        'aria-label': '跨网关会话',
        className: 'flex shrink-0 items-center gap-1.5 border-b border-(--ui-stroke-tertiary) px-3 py-1.5',
        children: [
          jsx('span', {
            className: 'text-[0.65rem] tabular-nums text-(--ui-text-quaternary)',
            title: sourcesIncomplete ? `项目共 ${totalProjectSessionCount} 条；搜索已加载 ${loadedSessionCount} 条` : `共 ${totalProjectSessionCount} 条会话`,
            children: totalProjectSessionCount
          }, 'count'),
          jsx('select', {
            'aria-label': '配置范围',
            className: 'h-6 max-w-20 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1 text-[0.65rem] text-foreground',
            onChange: event => persistPrefs({ profileScope: event.target.value }),
            title: profileScope === PROFILE_SCOPE_ALL ? '显示全部配置' : '仅显示默认配置',
            value: profileScope,
            children: [
              jsx('option', { value: PROFILE_SCOPE_DEFAULT, children: '默认' }, PROFILE_SCOPE_DEFAULT),
              jsx('option', { value: PROFILE_SCOPE_ALL, children: '全部配置' }, PROFILE_SCOPE_ALL)
            ]
          }, 'profile-scope'),
          jsx('span', { className: 'min-w-0 flex-1' }, 'spacer'),
          jsx(Button, {
            'aria-label': '打开多会话看板',
            className: 'size-6',
            onClick: openSessionMonitorWorkspace,
            size: 'icon-xs',
            title: '多会话监控室',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'layout', size: '0.8rem' })
          }, 'monitor'),
          jsx(Button, {
            'aria-label': hideScheduled ? '显示定时会话' : '隐藏定时会话',
            className: 'size-6',
            onClick: () => persistPrefs({ hideScheduled: !hideScheduled }),
            size: 'icon-xs',
            title: hideScheduled ? '显示定时会话' : '隐藏定时会话',
            variant: hideScheduled ? 'secondary' : 'ghost',
            children: jsx(Codicon, { name: 'calendar', size: '0.8rem' })
          }, 'scheduled'),
          jsx(Button, { 'aria-label': '刷新会话', className: 'size-6', onClick: refresh, size: 'icon-xs', title: '刷新会话', variant: 'ghost', children: jsx(Codicon, { name: 'refresh', size: '0.8rem', spinning: sessionsQuery.isFetching }) }, 'refresh')
        ]
      }, 'header'),
      jsx(SearchField, { 'aria-label': '搜索会话', containerClassName: 'mx-3 mt-1.5 w-auto opacity-70! focus-within:opacity-100!', inputClassName: 'placeholder:text-(--ui-text-tertiary)', onChange: value => persistPrefs({ search: value }), placeholder: '搜索会话', value: search }, 'search'),
      jsxs('div', {
        className: 'flex shrink-0 flex-nowrap gap-1 overflow-x-auto px-2 pt-1',
        children: [
          ['all', '全部'],
          ['unread', '未读'],
          ['open', '开放中'],
          ['pinned', '置顶'],
          ['recent', '24小时']
        ].map(([value, label]) => {
          const activeFilter = sessionFilter === value
          return jsx(Button, {
            'aria-pressed': activeFilter,
            className: 'codex-gateway-filter-tab rounded-lg',
            onClick: () => setSessionFilter(value),
            size: 'xs',
            title: value === 'open'
              ? '后端会话仍开放，不代表模型正在生成'
              : value === 'unread'
                ? '未读依据同步状态，实时状态点可能先更新'
                : undefined,
            variant: 'ghost',
            children: label
          }, value)
        })
      }, 'filters'),
      sourcesIncomplete && (search.trim() || sessionFilter !== 'all') && jsx('div', {
        className: 'shrink-0 px-3 pt-1 text-[0.6rem] leading-tight text-(--ui-text-quaternary)',
        title: `当前搜索和筛选覆盖已加载的 ${loadedSessionCount} 条会话`,
        children: `当前结果基于已加载的 ${loadedSessionCount} 条会话`
      }, 'partial-filter-scope'),
      unavailableSources.length > 0 && jsxs('div', {
        className: 'mx-3 mt-1 flex flex-wrap items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.62rem] text-(--ui-text-quaternary)',
        children: [
          jsx('span', { className: 'mr-auto', children: `${unavailableSources.length} 个会话来源不可用` }, 'label'),
          ...unavailableSources.map(group => jsx(Button, {
            disabled: Boolean(retryingSourceKey),
            onClick: () => void retryGatewaySource(group),
            size: 'xs',
            title: `重试 ${group.label}`,
            variant: 'ghost',
            children: retryingSourceKey === group.key ? `重试中 ${group.label}…` : `重试 ${group.label}`
          }, group.key))
        ]
      }, 'unavailable'),
      projects.length === 0
        ? jsx(EmptyState, {
            className: 'flex-1 min-h-0',
            description: search ? '请尝试其他标题、项目或网关名称。' : '可以从项目标题右侧新建会话。',
            title: search ? '没有匹配的会话' : '暂无会话'
          }, 'empty')
        : jsx('div', {
            className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3 pt-2',
            onScroll: handleSessionsScroll,
            ref: sessionsScrollRef,
            children: [
              renderedRows.topSpacer > 0 && jsx('div', { 'aria-hidden': true, style: { height: renderedRows.topSpacer } }, 'virtual-top'),
              ...renderedRows.rows.map(renderRow => renderRow.type === 'pinned-header'
                ? gatewayPinnedSectionHeader(collapsed, toggle, renderRow.count || 0)
                : renderRow.type === 'pinned-session'
                  ? gatewaySessionRow(renderRow.project, renderRow.session, focusedStoredSessionId, focusedSessionOwner, opening, open, applySessionChange, { appearance: projectAppearance, indent: false, pinned: true })
                  : renderRow.type === 'project'
                ? gatewayProjectHeaderRow(renderRow.project, collapsed, toggle, newChat, pinnedProjects, toggleProjectPin, projectAppearance, setAppearanceEditorProject)
                : renderRow.type === 'more'
                  ? gatewayProjectToggleRow(renderRow.project, renderRow.remaining, revealProjectSessions, 'more')
                  : renderRow.type === 'collapse'
                    ? gatewayProjectToggleRow(renderRow.project, 0, collapseProjectSessions, 'collapse')
                    : renderRow.type === 'project-loading'
                      ? gatewayProjectLoadRow(renderRow.project, retryProjectSessions, 'loading')
                      : renderRow.type === 'project-error'
                        ? gatewayProjectLoadRow(renderRow.project, retryProjectSessions, 'error')
                        : gatewaySessionRow(renderRow.project, renderRow.session, focusedStoredSessionId, focusedSessionOwner, opening, open, applySessionChange, { appearance: projectAppearance })),
              renderedRows.bottomSpacer > 0 && jsx('div', { 'aria-hidden': true, style: { height: renderedRows.bottomSpacer } }, 'virtual-bottom')
            ]
          }, 'session-list'),
      jsx(ProjectAppearanceDialog, {
        appearance: projectAppearance,
        onOpenChange: next => { if (!next) setAppearanceEditorProject(null) },
        onSave: saveProjectAppearance,
        open: Boolean(appearanceEditorProject),
        project: appearanceEditorProject
      }, 'appearance-dialog')
    ]
  })
}

function createElementStyleOwner() {
  const touched = new Map()

  const set = (element, property, value) => {
    if (!element || !element.style) {
      return
    }

    let values = touched.get(element)

    if (!values) {
      values = new Map()
      touched.set(element, values)
    }

    const state = values.get(property)

    if (state) {
      state.applied = value
    } else {
      values.set(property, {
        applied: value,
        previous: element.style.getPropertyValue(property)
      })
    }

    if (element.style.getPropertyValue(property) !== value) {
      element.style.setProperty(property, value)
    }
  }

  const restore = (element, property) => {
    const values = touched.get(element)
    const state = values?.get(property)

    if (!state) {
      return
    }

    if (element.style.getPropertyValue(property) === state.applied) {
      if (state.previous) {
        element.style.setProperty(property, state.previous)
      } else {
        element.style.removeProperty(property)
      }
    }

    values.delete(property)

    if (values.size === 0) {
      touched.delete(element)
    }
  }

  const restoreAll = () => {
    for (const [element, values] of touched) {
      for (const property of values.keys()) {
        restore(element, property)
      }
    }
  }

  return { restore, restoreAll, set, touched }
}

export default {
  id: ID,
  name: 'Overlook',
  description: 'Overlook：纯白主题、跨网关会话侧栏、命令面板和未读状态。',
  register(ctx) {
    gatewaySessionStorage = ctx.storage
    gatewaySessionStorageOwner = ctx
    $gatewaySessionPrefs.set(readGatewaySessionPreferences())
    ctx.onDispose(subscribeGatewaySessionEvents())
    connectMobileBridge()

    ctx.register({
      id: 'theme',
      area: THEMES_AREA,
      data: OVERLOOK_THEME
    })

    ctx.register({
      id: 'monitor-page',
      area: ROUTES_AREA,
      data: { path: MONITOR_ROUTE },
      render: () => jsx(SessionMonitorPage, {})
    })

    // This is a real contributed pane, not DOM injected into Hermes's React
    // Sessions tree. It uses the same left-side zone as the native Sessions
    // pane, so the user can switch between the native list and this aggregate
    // view without changing the active gateway.
    ctx.register({
      id: 'gateway-sessions',
      area: 'panes',
      title: 'Overlook',
      data: {
        collapsible: true,
        placement: 'left',
        width: '280px'
      },
      order: 85,
      render: () => jsx(GatewaySessionsPane, {})
    })

    ctx.register({
      id: 'mobile-bridge',
      area: STATUSBAR_AREAS.right,
      order: 85,
      render: () => jsx(GatewayMobileChip, {})
    })

    ctx.register({
      id: 'inbox',
      area: STATUSBAR_AREAS.right,
      order: 86,
      render: () => jsx(GatewayInboxChip, {})
    })

    ctx.register({
      id: 'monitor-palette',
      area: PALETTE_AREA,
      data: {
        id: 'overlook.monitor',
        action: 'overlook.monitor',
        label: 'Overlook：打开多会话监控室',
        keywords: ['overlook', 'monitor', 'sessions', '监控室', '多会话', '通览'],
        run: openSessionMonitorWorkspace
      }
    })

    ctx.register({
      id: 'refresh-palette',
      area: PALETTE_AREA,
      data: {
        id: 'overlook.refresh',
        action: 'overlook.refresh',
        label: 'Overlook：刷新会话',
        keywords: ['overlook', 'gateway', 'sessions', 'refresh', 'reload', '刷新', '会话', '网关', '通览'],
        run: () => void refreshGatewaySessionQueries()
      }
    })

    ctx.register({
      id: 'theme-palette',
      area: PALETTE_AREA,
      data: {
        id: 'overlook.theme',
        label: 'Overlook：应用 Hermes Cold White',
        keywords: ['overlook', 'theme', 'cold', 'white', 'light', '主题', '纯白', '通览'],
        run: () => {
          if (requestTheme(THEME_NAME)) {
            ctx.storage.set('theme-revision', THEME_REVISION)
          }
        }
      }
    })

    ctx.register({
      id: 'refresh-keybind',
      area: KEYBINDS_AREA,
      data: {
        id: 'overlook.refresh',
        category: 'view',
        defaults: ['mod+alt+g'],
        label: 'Overlook：刷新会话',
        run: () => void refreshGatewaySessionQueries()
      }
    })

    const root = typeof document === 'undefined' ? null : document.documentElement
    const rootTokenSet = {
      ...LIGHT_ROOT_TOKENS,
      '--composer-width': MESSAGE_COLUMN_WIDTH
    }
    const previousRootTokens = rememberRootTokens(root, rootTokenSet)
    const rootTokenKeys = Object.keys(rootTokenSet)
    const elementStyles = createElementStyleOwner()

    const isColdWhite = () =>
      Boolean(root) && root.dataset.hermesTheme === THEME_NAME

    const syncComposerAndMessageElements = () => {
      if (!root) {
        return
      }

      const active = isColdWhite()
      // React owns the icon and brand nodes. Keep the visual contribution in
      // CSS so React can reconcile and remove its own nodes safely.
      syncModernIconStyles(active)
      syncCodeCardContrastStyles(active)
      const elements = active
        ? [
            ...document.querySelectorAll("[data-slot='aui_thread-content']"),
            ...document.querySelectorAll("[data-slot='aui_thread-viewport']"),
            ...document.querySelectorAll('[data-chat-surface]'),
            ...document.querySelectorAll("[data-slot='composer-bounds']"),
            ...document.querySelectorAll("[data-slot='composer-dock']"),
            ...document.querySelectorAll("[data-slot='composer-root']"),
            ...document.querySelectorAll("[data-slot='composer-surface']"),
            ...document.querySelectorAll("[data-slot='composer-fade']"),
            ...document.querySelectorAll("[data-slot='composer-fade'] > div.grid.w-full"),
            ...document.querySelectorAll("[data-slot='composer-rich-input']"),
            ...document.querySelectorAll("[data-slot='aui_assistant-message-root']"),
            ...document.querySelectorAll("[data-slot='aui_user-message-root']"),
            ...document.querySelectorAll("[data-slot='aui_user-message-root'] .composer-human-message")
          ]
        : []
      const current = new Set(elements)

      if (active) {
        document.querySelectorAll("[data-slot='aui_thread-content']").forEach(element => {
          elementStyles.set(element, 'max-width', MESSAGE_COLUMN_WIDTH)
          elementStyles.set(element, '--composer-width', MESSAGE_COLUMN_WIDTH)
          elementStyles.set(element, 'background-color', '#ffffff')
        })

        document
          .querySelectorAll("[data-slot='aui_thread-viewport'], [data-chat-surface], [data-slot='composer-bounds']")
          .forEach(element => elementStyles.set(element, 'background-color', '#ffffff'))

        document.querySelectorAll("[data-slot='composer-dock']").forEach(element => {
          elementStyles.set(element, '--composer-width', MESSAGE_COLUMN_WIDTH)
        })

        document.querySelectorAll("[data-slot='composer-root']").forEach(element => {
          elementStyles.set(element, '--composer-fill', '#ffffff')
          elementStyles.set(element, '--composer-width', MESSAGE_COLUMN_WIDTH)
          elementStyles.set(element, 'border-radius', COMPOSER_RADIUS)
        })

        document.querySelectorAll("[data-slot='composer-surface']").forEach(element => {
          elementStyles.set(element, 'background-color', '#ffffff')
          elementStyles.set(element, 'border-radius', COMPOSER_RADIUS)
          elementStyles.set(element, 'box-shadow', COMPOSER_SHADOW)
        })

        // The native composer owns all layout metrics and the controls row. Do
        // not set height, min-height, grid tracks, alignment, z-index, or pointer
        // hit-testing here: the empty state and the text/attachment states have
        // different measured footprints.

        document.querySelectorAll("[data-slot='aui_assistant-message-root']").forEach(element => {
          elementStyles.set(element, 'background-color', '#ffffff')
        })

        document.querySelectorAll("[data-slot='aui_user-message-root']").forEach(element => {
          elementStyles.set(element, 'background-color', '#ffffff')
        })

        document.querySelectorAll("[data-slot='aui_user-message-root'] .composer-human-message").forEach(element => {
          // Content-sized, right-aligned bubble: short prompts stay short and
          // long prompts cap at the same ~70% proportion as the native composer.
          elementStyles.set(element, 'width', 'fit-content')
          elementStyles.set(element, 'max-width', USER_MESSAGE_MAX_WIDTH)
          elementStyles.set(element, 'margin-left', 'auto')
          elementStyles.set(element, 'border-radius', USER_MESSAGE_RADIUS)
          elementStyles.set(element, 'background-color', '#f3f4f5')
          elementStyles.set(element, 'border-color', '#d4d4d8')
        })

      }

      // Remove inline values from elements that disappeared or are no longer
      // part of the active Cold White surface. Some layout cells we align
      // (menu/input/control descendants) are intentionally not data-slot roots,
      // so keep connected descendants while their owning public surface exists.
      for (const [element, values] of elementStyles.touched) {
        const owner = element.closest?.(
          "[data-slot='composer-root'], [data-slot='aui_user-message-root'], [data-slot='aui_assistant-message-root']"
        )
        const remainsOwned = element.isConnected && (current.has(element) || Boolean(owner))

        if (!active || !remainsOwned) {
          for (const property of values.keys()) {
            elementStyles.restore(element, property)
          }
        }
      }
    }

    const syncRootTokens = () => {
      if (!root) {
        return
      }

      const codexActive = root.dataset.hermesTheme === THEME_NAME
      const next = codexActive
        ? {
            '--composer-width': MESSAGE_COLUMN_WIDTH,
            ...LIGHT_ROOT_TOKENS
          }
        : {}

      rootTokenKeys.forEach(key => {
        if (next[key]) {
          root.style.setProperty(key, next[key])
        } else {
          restoreRootToken(root, previousRootTokens, key)
        }
      })

      syncComposerAndMessageElements()
    }

    syncRootTokens()

    // Theme switches are rare and should be handled immediately. DOM changes
    // (streaming messages, React re-renders, list updates) are frequent, so
    // reconcile those at most once per animation frame. Most importantly, the
    // two observers are separate: updating our own style element can no longer
    // recursively invoke the theme-token writer.
    const observer =
      root && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => syncRootTokens())
        : null

    observer?.observe(root, {
      attributes: true,
      attributeFilter: ['data-hermes-mode', 'data-hermes-theme']
    })

    let syncFrame = 0
    let syncPending = false
    const scheduleElementSync = () => {
      if (syncPending || typeof window === 'undefined') {
        return
      }

      syncPending = true
      syncFrame = window.requestAnimationFrame(() => {
        syncPending = false
        syncComposerAndMessageElements()
      })
    }

    const domObserver =
      root && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(mutations => {
            if (mutationsNeedElementSync(mutations)) {
              scheduleElementSync()
            }
          })
        : null

    domObserver?.observe(root, { childList: true, subtree: true })

    ctx.onDispose(() => {
      const closeMonitor = monitorWorkspaceClose
      monitorWorkspaceClose = null
      try { closeMonitor?.() } catch {}
      observer?.disconnect()
      domObserver?.disconnect()
      if (syncFrame && typeof window !== 'undefined') {
        window.cancelAnimationFrame(syncFrame)
      }
      // The icon layer is a renderer-side style contribution, not a theme
      // token. Remove it explicitly when the plugin is disabled/reloaded.
      syncModernIconStyles(false)
      syncCodeCardContrastStyles(false)
      elementStyles.restoreAll()
      rootTokenKeys.forEach(key => restoreRootToken(root, previousRootTokens, key))
      if (gatewaySessionStorageOwner === ctx) {
        gatewaySessionStorage = null
        gatewaySessionStorageOwner = null
      }
    })

    // The plugin theme is registered after the boot-time theme paint. Re-request
    // it on every activation so the dynamically registered theme survives app
    // restarts; requestTheme still persists the assignment through ThemeProvider.
    if (requestTheme(THEME_NAME)) {
      ctx.storage.set('theme-revision', THEME_REVISION)
    }
  }
}
