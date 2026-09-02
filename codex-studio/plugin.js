/**
 * Codex Studio — appearance and cross-gateway session panel plugin for Hermes Desktop.
 *
 * Adds a small cross-gateway session rail while keeping Hermes's existing
 * workflow and applies the Cold White visual system through the Desktop Plugin
 * SDK:
 *
 *   - sidebar: the semantic Hermes sidebar surface
 *   - conversation, assistant messages, dialogs, and composer: cold white
 *
 * The Codex Studio pane is a genuine `area: 'panes'` contribution. It
 * aggregates credential-free profile routes, reads each source's persisted
 * sessions through the owning connection, and opens a row with that exact
 * route. The pane is intentionally separate from Hermes's native $sessions
 * tree; no React-owned sidebar nodes are mutated.
 *   - user message bubble: cool blue-white
 *   - code blocks: graphite; inline code: pale blue-gray
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
 * The Codex Studio pane uses only credential-free route metadata plus the
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
 *   <HERMES_HOME>/desktop-plugins/codex-studio/plugin.js
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
  RowButton,
  requestTheme,
  SearchField,
  SessionStatusDot,
  STATUSBAR_AREAS,
  THEMES_AREA,
  Tip,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'codex-studio'
const THEME_NAME = 'hermes-cold-white'
const THEME_REVISION = 15
const MESSAGE_COLUMN_WIDTH = '46rem'
const USER_MESSAGE_MAX_WIDTH = '70%'
const COMPOSER_RADIUS = '1.25rem'
const USER_MESSAGE_RADIUS = '1.125rem'
const COMPOSER_SHADOW =
  '0 0 0 1px rgba(13, 28, 47, 0.06), 0 0.25rem 0.75rem rgba(13, 28, 47, 0.06), 0 0.875rem 2rem rgba(13, 28, 47, 0.08)'
const MODERN_ICON_STROKE = '1.8'
const GATEWAY_SESSIONS_KEY = ['codex-studio', 'gateway-sessions']
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
const GATEWAY_ROW_ESTIMATE_HEIGHT = 36
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
const PATCHABLE_SESSION_EVENT_TYPES = new Set(['message.complete', 'message.start'])
const GATEWAY_EVENT_REFRESH_DEBOUNCE_MS = 900
const RECENT_SESSION_WINDOW_MS = 24 * 60 * 60_000
const DEFAULT_GATEWAY_SESSION_PREFERENCES = {
  collapsedKeys: [],
  hideScheduled: HIDE_SCHEDULED_SESSIONS_DEFAULT,
  profileScope: PROFILE_SCOPE_DEFAULT,
  search: ''
}

// Set by register() and cleared on dispose. The pane receives this namespace
// explicitly, but the fallback keeps hot-reload/remount paths harmless when an
// older Desktop host renders a contribution one tick after registration.
let gatewaySessionStorage = null
let gatewaySessionStorageOwner = null
const $gatewaySessionLimit = atom(GATEWAY_SESSIONS_LIMIT)
const $gatewaySessionPrefs = atom(DEFAULT_GATEWAY_SESSION_PREFERENCES)
const sessionDataRevision = { current: 0 }

function normalizeGatewaySessionPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : DEFAULT_GATEWAY_SESSION_PREFERENCES
  return {
    collapsedKeys: Array.isArray(source.collapsedKeys) ? source.collapsedKeys : [],
    hideScheduled: typeof source.hideScheduled === 'boolean' ? source.hideScheduled : HIDE_SCHEDULED_SESSIONS_DEFAULT,
    profileScope: source.profileScope === PROFILE_SCOPE_ALL ? PROFILE_SCOPE_ALL : PROFILE_SCOPE_DEFAULT,
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

const CODEX_THEME = {
  name: THEME_NAME,
  label: 'Hermes Cold White',
  description: 'A light-only cold-white workbench with blue-gray structure, ink controls, and graphite code surfaces.',
  colors: {
    background: '#f8f9ff',
    foreground: '#0d1c2f',
    card: '#ffffff',
    cardForeground: '#0d1c2f',
    muted: '#eff4ff',
    mutedForeground: '#68717a',
    popover: '#ffffff',
    popoverForeground: '#0d1c2f',
    primary: '#20262a',
    primaryForeground: '#f8f9ff',
    secondary: '#eff4ff',
    secondaryForeground: '#34465e',
    accent: '#e8efff',
    accentForeground: '#0d1c2f',
    border: '#d3dde9',
    input: '#d3dde9',
    ring: '#0d1c2f',
    midground: '#0d1c2f',
    midgroundForeground: '#ffffff',
    composerRing: '#20262a',
    destructive: '#b64b4b',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#eff4ff',
    sidebarBorder: '#d3dde9',
    userBubble: '#f3f4f5',
    userBubbleBorder: '#d3dde9'
  },
  typography: {
    fontSans: '"Hanken Grotesk", "Segoe UI", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", "Cascadia Code", Consolas, monospace'
  }
}

// Cold White intentionally exposes one bright palette. Supplying the same
// colors for the host's dark preference prevents Desktop from synthesizing a
// different variant while renderedModeFor keeps the actual window light.
CODEX_THEME.darkColors = CODEX_THEME.colors

// Public semantic tokens already consumed by Hermes Desktop. The theme
// contribution supplies the authored palette; these values remove normal
// translucency/mix rounding so the requested RGB levels are exact.
const LIGHT_ROOT_TOKENS = {
  '--background': '#f8f9ff',
  '--foreground': '#0d1c2f',
  '--composer-fill': '#ffffff',

  '--dt-background': '#f8f9ff',
  '--dt-card': '#ffffff',
  '--dt-popover': '#ffffff',
  '--dt-sidebar-bg': '#eff4ff',
  '--dt-user-bubble': '#f3f4f5',
  '--dt-user-bubble-border': '#d3dde9',
  '--ui-bg-card': '#ffffff',
  '--ui-bg-chrome': '#f8f9ff',
  // Keep the inherited editor surface cold-white; fenced code cards receive
  // their graphite treatment at the stable [data-slot='code-card'] below.
  '--ui-bg-editor': '#f8f9ff',
  '--ui-bg-elevated': '#ffffff',
  '--ui-bg-input': '#ffffff',
  '--ui-bg-sidebar': '#eff4ff',
  '--ui-chat-bubble-background': '#ffffff',
  '--ui-chat-bubble-opaque-background': '#ffffff',
  '--ui-chat-surface-background': '#f8f9ff',
  '--ui-editor-surface-background': '#f8f9ff',
  '--ui-inline-code-background': '#e8efff',
  '--ui-inline-code-foreground': '#0d1c2f',
  '--ui-sidebar-surface-background': '#eff4ff',
  '--ui-surface-background': '#f8f9ff',
  '--ui-widget-surface-background': '#ffffff',
  '--ui-stroke-primary': '#b8c5d8',
  '--ui-stroke-secondary': '#c6d0e0',
  '--ui-stroke-tertiary': '#d3dde9',
  '--ui-stroke-quaternary': '#e6eeff',
  '--ui-text-quaternary': '#68717a',
  '--ui-control-hover-background': '#e8efff',
  '--ui-control-active-background': '#dfe8fa',
  '--ui-row-hover-background': '#e8efff',
  '--ui-row-active-background': '#e7edf6'
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
.codex-gateway-session-row{position:relative;isolation:isolate}
.codex-gateway-session-row:has([class~="bg-(--ui-accent)"])::before,.codex-gateway-session-row:has([class~="border-(--ui-accent)"])::before{content:"";pointer-events:none;position:absolute;z-index:-1;inset:0;border-radius:8px;padding:1px;background:conic-gradient(from var(--codex-gateway-arc-angle,0deg),transparent 0deg,transparent 258deg,#1f2937 286deg,#64748b 326deg,transparent 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:codex-gateway-running-border 2s linear infinite}
@property --codex-gateway-arc-angle{syntax:"<angle>";initial-value:0deg;inherits:false}
@keyframes codex-gateway-running-border{to{--codex-gateway-arc-angle:360deg}}
@media (prefers-reduced-motion: reduce){.codex-gateway-session-row:has([class~="bg-(--ui-accent)"])::before,.codex-gateway-session-row:has([class~="border-(--ui-accent)"])::before{animation:none;background:#94A3B8}}`
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

function eventSessionId(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null
  return String(event?.session_id || payload?.session_id || payload?.stored_session_id || '').trim()
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
  let latest = 0
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

function shouldResortProjectsForUserInput(input) {
  const reason = input && input.reason
  if (reason === 'refresh' || reason === 'new-chat') {
    return true
  }
  return Boolean(input) && input.previousBusy === false && input.busy === true
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
    throw new Error('Session owner route is unavailable in this Hermes Desktop build.')
  }

  if (method === 'PATCH' && Object.prototype.hasOwnProperty.call(body || {}, 'hidden')) {
    if (typeof host.setPersistedSessionHidden !== 'function') {
      throw new Error('Route-aware session visibility is unavailable in this Hermes Desktop build.')
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
    throw new Error('Route-aware session REST is unavailable in this Hermes Desktop build.')
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
      notifyActionError(error, 'Could not rename the session.')
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
      jsx(ContextMenuContent, { 'aria-label': `Actions for ${actions.title}`, className: 'w-44', children: items }, 'content'),
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
      jsx(DropdownMenuContent, { 'aria-label': `Actions for ${actions.title}`, align: 'end', className: 'w-44', children: items }, 'content'),
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

function projectTreeEntries(projectTree) {
  const projects = Array.isArray(projectTree?.projects) ? projectTree.projects : []
  return projects
    .filter(project => project && !project.isNoProject)
    .map(project => {
      const paths = [
        project.path,
        project.primary_path,
        ...(Array.isArray(project.repos) ? project.repos.flatMap(repo => [
          repo?.id,
          repo?.path,
          ...(Array.isArray(repo?.groups) ? repo.groups.map(group => group?.path) : [])
        ]) : [])
      ].filter(value => typeof value === 'string' && value.trim())

      return { project, paths }
    })
    .filter(entry => entry.paths.length > 0)
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

  for (const group of list) {
    if (group?.error) failed += 1
    const sessions = Array.isArray(group?.sessions) ? group.sessions : []
    for (const session of sessions) {
      if (hideScheduled && sessionIsScheduled(session)) continue
      loaded += 1
      if (sessionUnread(session)) unread += 1
      if (sessionActive(session)) open += 1
      if (sessionPinned(session)) pinned += 1
    }
  }

  return { failed, loaded, open, pinned, unread }
}

function refreshGatewaySessionQueries({ refreshRoutes = true } = {}) {
  if (refreshRoutes) {
    gatewayRouteCache.at = 0
    clearGatewayProjectTreeCache()
  }
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
      void pluginQueryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
    }, GATEWAY_EVENT_REFRESH_DEBOUNCE_MS)
  }

  const dispose = host.onEvent('*', refreshFromEvent)
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

  const ensureProject = (descriptor, path) => {
    const projectKey = `${group.key}::${descriptor.key}`
    const existing = projectMap.get(projectKey)
    if (existing) {
      if (!existing.path && path) existing.path = path
      return existing
    }

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
      sessions: []
    }
    projectMap.set(projectKey, project)
    return project
  }

  // Seed authoritative tree projects so an empty remote folder still has a
  // "+" that can send that path as session.create cwd.
  for (const entry of projectTreeEntries(group.projectTree)) {
    const descriptor = {
      explicit: !entry.project.isAuto,
      key: `project-tree:${String(entry.project.id || entry.project.label || 'unknown')}`,
      label: String(entry.project.label || entry.project.name || entry.project.id || 'Project').trim()
    }
    ensureProject(descriptor, entry.paths[0] || '')
  }

  for (const session of group.sessions) {
    if (hideScheduled && sessionIsScheduled(session)) {
      continue
    }

    const descriptor = projectDescriptorForSession(session, group.projectTree)
    const path = descriptor.path || projectTreePathForDescriptor(descriptor, group.projectTree) || ''
    const pathKey = projectPathKey(path)
    const treeMatch = pathKey
      ? [...projectMap.values()].find(item => projectPathKey(item.path) === pathKey)
      : null
    const project = treeMatch || ensureProject(descriptor, path)
    project.sessions.push(session)
  }

  return [...projectMap.values()]
    .map(project => ({
      ...project,
      sessions: [...project.sessions].sort(compareSessions)
    }))
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
    throw new Error('Update Hermes Desktop to enumerate gateway profiles.')
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
}

async function listGatewaySessions(route, limit = GATEWAY_SESSIONS_LIMIT) {
  if (typeof host.listPersistedSessions !== 'function') {
    throw new Error('Update Hermes Desktop to list sessions across gateways.')
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
      preview_limit: 3,
      session_limit: GATEWAY_SESSIONS_LIMIT,
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

function patchSessionInGroups(groups, project, session, body, method, result) {
  if (!Array.isArray(groups)) {
    return groups
  }

  const routeKeyForProject = project?.route ? routeKey(project.route) : ''
  if (!routeKeyForProject) {
    return groups
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
  const removesSession = isDelete || archived === true
  const title = body && Object.prototype.hasOwnProperty.call(body, 'title')
    ? String(body.title || '').trim()
    : result && Object.prototype.hasOwnProperty.call(result, 'title')
      ? String(result.title || '').trim()
      : undefined

  return groups.map(group => {
    if (group.key !== routeKeyForProject) {
      return group
    }

    const nextSessions = removesSession
      ? group.sessions.filter(row => row.id !== session.id)
      : group.sessions
        .map(row => row.id === session.id
          ? {
              ...row,
              ...(pinned === undefined ? {} : { pinned }),
              ...(unread === undefined ? {} : { unread }),
              ...(title === undefined ? {} : { title })
            }
          : row)
        .sort(compareSessions)

    return {
      ...group,
      sessions: nextSessions,
      total: removesSession ? Math.max(nextSessions.length, (Number(group.total) || group.sessions.length) - 1) : group.total
    }
  })
}

function gatewayVirtualWindow(totalRows, scrollTop, viewportHeight) {
  const rowHeight = GATEWAY_ROW_ESTIMATE_HEIGHT
  const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight))
  const visibleCount = Math.max(1, Math.ceil(Math.max(rowHeight, viewportHeight) / rowHeight))
  const start = Math.max(0, firstVisible - GATEWAY_VIRTUAL_OVERSCAN)
  const end = Math.min(totalRows, firstVisible + visibleCount + GATEWAY_VIRTUAL_OVERSCAN)
  return {
    bottom: Math.max(0, (totalRows - end) * rowHeight),
    end,
    rowHeight,
    start,
    top: start * rowHeight
  }
}

function gatewayRenderRows(projects, collapsed, revealed = new Set()) {
  const rows = []
  for (const project of projects) {
    rows.push({ key: `project:${project.key}`, type: 'project', project })
    if (collapsed.has(project.key)) {
      continue
    }

    const sessions = Array.isArray(project.sessions) ? project.sessions : []
    const showAll = revealed.has(project.key) || sessions.length <= PROJECT_SESSION_PREVIEW_LIMIT
    const visible = showAll ? sessions : sessions.slice(0, PROJECT_SESSION_PREVIEW_LIMIT)
    for (const session of visible) {
      rows.push({ key: `session:${project.key}:${session.id}`, type: 'session', project, session })
    }
    if (!showAll) {
      rows.push({
        key: `more:${project.key}`,
        type: 'more',
        project,
        remaining: sessions.length - visible.length
      })
    }
  }
  return rows
}

function gatewayProjectHeaderRow(project, collapsed, toggle, newChat) {
  const projectKey = project.key
  const gatewayLabel = String(project.sourceLabel || '').trim()
  const remoteLabel = projectRemoteLabel(project)
  const profileLabel = String(project.profile || '').trim()
  const sourceBadge = [gatewayLabel, remoteLabel, profileLabel].filter(Boolean).join(' · ')
  return jsxs('div', {
    className: 'group flex h-9 w-full items-center gap-1 rounded px-1.5 hover:bg-(--ui-row-hover-background)',
    children: [
      jsxs('button', {
        className: 'flex min-w-0 flex-1 items-center gap-1.5 text-left',
        'aria-expanded': !collapsed.has(projectKey),
        'aria-label': `${collapsed.has(projectKey) ? 'Expand' : 'Collapse'} ${projectDisplayLabel(project)}`,
        onClick: () => toggle(projectKey),
        type: 'button',
        children: [
          jsx(Codicon, { name: collapsed.has(projectKey) ? 'chevron-right' : 'chevron-down', size: '0.68rem' }, 'chevron'),
          isHomeProject(project)
            ? jsx(Codicon, { name: 'home', size: '0.76rem' }, 'home')
            : remoteLabel
              ? jsxs('span', {
                  className: 'relative flex size-4 shrink-0 items-center justify-center',
                  title: 'Remote project',
                  children: [
                    jsx(Codicon, { name: 'folder', size: '0.76rem' }, 'folder'),
                    jsx(Codicon, { name: 'globe', size: '0.5rem', className: 'absolute -bottom-0.5 -right-0.5 rounded-full bg-(--ui-sidebar-surface-background)' }, 'globe')
                  ]
                }, 'remote-folder')
              : jsx(Codicon, { name: 'folder', size: '0.76rem' }, 'folder'),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-[0.7rem] font-medium text-foreground/80', children: projectDisplayLabel(project) }, 'label'),
          sourceBadge && jsx('span', { className: 'max-w-36 shrink-0 truncate rounded px-1 text-[0.58rem] text-(--ui-text-quaternary)', title: sourceBadge, children: sourceBadge }, 'source'),
          !project.hasExplicitMetadata && jsx('span', { className: 'text-[0.58rem] text-(--ui-text-quaternary)', children: 'auto' }, 'auto'),
          jsx('span', { className: 'text-[0.6rem] tabular-nums text-(--ui-text-quaternary)', children: project.sessions.length }, 'count')
        ]
      }, 'toggle'),
      jsx(Button, {
        'aria-label': `New chat on ${project.sourceLabel || 'gateway'}`,
        className: 'size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        onClick: () => newChat(project),
        size: 'icon-xs',
        title: `New chat on ${project.sourceLabel || 'gateway'}`,
        variant: 'ghost',
        children: jsx(Codicon, { name: 'add', size: '0.8rem' })
      }, 'new-chat')
    ]
  }, projectKey)
}

function gatewaySessionRow(project, session, focusedStoredSessionId, focusedSessionOwner, opening, open, applySessionChange) {
  const sessionKey = `${project.key}::${session.id}`
  const title = sessionRowTitle(session)
  const active = focusedSessionMatches(session, project, focusedStoredSessionId, focusedSessionOwner)
  const openingNow = opening === sessionKey
  const rowClassName = `codex-gateway-session-row group relative h-9 min-w-0 rounded-md text-left transition-colors hover:bg-(--ui-row-hover-background) ${active ? 'bg-(--ui-row-active-background) text-foreground' : ''} ${openingNow ? 'opacity-60' : ''}`
  const row = jsxs('div', {
    'aria-current': active ? 'page' : undefined,
    'aria-label': `Session ${title}`,
    'data-session-row': session.id,
    className: rowClassName,
    style: {
      alignItems: 'stretch',
      backgroundColor: active ? 'var(--ui-row-active-background)' : undefined,
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) max-content max-content',
      marginLeft: '1.5rem',
      minWidth: 0,
      width: 'calc(100% - 1.5rem)'
    },
    children: [
      jsx(RowButton, {
        className: 'flex w-full min-w-0 items-center gap-2 rounded-md bg-transparent px-2 py-1.5 text-left hover:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)',
        disabled: openingNow,
        onClick: () => void open(project, session),
        title: session.preview || title,
        type: 'button',
        children: [
          sessionPinned(session) && jsx(Codicon, { name: 'pin', className: 'shrink-0 text-(--ui-accent)', size: '0.72rem' }, 'pinned'),
          jsx(SessionStatusDot, { session, storedSessionId: session.id }, 'status'),
          jsxs('span', {
            className: 'min-w-0 flex flex-1 flex-col',
            children: [
              jsx('span', { className: 'block min-w-0 truncate font-medium text-foreground/85', children: title }, 'title'),
              jsx('span', { className: 'block truncate text-[0.64rem] text-(--ui-text-quaternary)', children: session.preview || `${session.message_count || 0} messages` }, 'preview')
            ]
          }, 'content')
        ]
      }, 'open'),
      jsx('button', {
        'aria-label': `Open session ${title}`,
        'data-session-time': true,
        className: 'shrink-0 min-w-max bg-transparent px-1 text-right text-[0.62rem] tabular-nums whitespace-nowrap text-(--ui-text-quaternary) hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)',
        onClick: () => void open(project, session),
        title: sessionRowTime(session),
        type: 'button',
        children: openingNow ? jsx(Codicon, { name: 'loading', size: '0.75rem', spinning: true }) : sessionRowTime(session)
      }, 'time'),
      jsx('div', {
        className: 'pointer-events-none flex min-w-8 shrink-0 items-center justify-end px-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        'data-session-actions': true,
        'aria-hidden': false,
        'data-row-actions': true,
        style: { minWidth: '2rem' },
        children: jsx(SessionActionsMenu, {
          children: jsx(Button, {
            'aria-label': `Actions for ${title}`,
            className: 'size-6 rounded-[4px] bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:ring-0 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground',
            size: 'icon-xs',
            variant: 'ghost',
            children: jsx(Codicon, { name: 'kebab-vertical', size: '0.8rem' })
          }),
          onChanged: applySessionChange,
          project,
          session
        })
      }, 'actions')
    ]
  }, sessionKey)
  return jsx(SessionContextMenu, { children: row, onChanged: applySessionChange, project, session }, sessionKey)
}

function gatewayProjectMoreRow(project, remaining, reveal) {
  const count = Math.max(0, Number(remaining) || 0)
  return jsx('div', {
    className: 'px-1.5',
    style: { marginLeft: '1.5rem', width: 'calc(100% - 1.5rem)' },
    children: jsx(Button, {
      'aria-label': `展开显示 ${projectDisplayLabel(project)} 的另外 ${count} 个会话`,
      className: 'h-7 w-full justify-center rounded-md border border-(--ui-stroke-tertiary) bg-transparent text-[0.62rem] text-(--ui-text-quaternary) hover:bg-(--ui-row-hover-background) hover:text-foreground',
      onClick: () => reveal(project.key),
      size: 'xs',
      title: `还有 ${count} 个会话`,
      variant: 'ghost',
      children: '展开显示'
    })
  }, `more:${project.key}`)
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

function useGatewaySessionsQuery() {
  const queryClient = useQueryClient()
  const prefs = useValue($gatewaySessionPrefs)
  const sessionLimit = useValue($gatewaySessionLimit)
  const profileScope = prefs.profileScope
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

function GatewayInboxChip() {
  const { prefs, sessionsQuery } = useGatewaySessionsQuery()
  const inbox = gatewayInboxSummary(sessionsQuery.data?.groups, prefs.hideScheduled)
  if (!sessionsQuery.data) {
    return null
  }

  const label = inbox.failed
    ? `${inbox.failed} gateway source${inbox.failed === 1 ? '' : 's'} unavailable`
    : inbox.unread
      ? `${inbox.unread} unread across gateways`
      : `${inbox.loaded} sessions across gateways`

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
        jsx('span', { children: inbox.failed ? inbox.failed : (inbox.unread || inbox.loaded) })
      ]
    })
  })
}

function GatewaySessionsPane() {
  const queryClient = useQueryClient()
  const { prefs, profileScope, sessionLimit, sessionsQuery, sessionsQueryKey } = useGatewaySessionsQuery()
  const search = prefs.search
  const hideScheduled = prefs.hideScheduled
  const collapsed = useMemo(() => new Set(prefs.collapsedKeys), [prefs.collapsedKeys])
  const [revealedProjects, setRevealedProjects] = useState(() => new Set())
  const [opening, setOpening] = useState('')
  const [sessionFilter, setSessionFilter] = useState('all')
  const [retryingSourceKey, setRetryingSourceKey] = useState('')
  const sessionsScrollRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(640)
  const focusedStoredSessionId = useValue(host.state.focusedStoredSessionId)
  const focusedSessionOwner = useValue(host.state.focusedSessionOwner)
  const focusedBusy = useValue(host.state.busy)
  const projectOrderKeysRef = useRef([])
  const lastProjectSortEpochRef = useRef(-1)
  const previousBusyRef = useRef(false)
  const [projectSortEpoch, setProjectSortEpoch] = useState(0)

  const persistPrefs = patch => {
    writeGatewaySessionPreferences({
      ...prefs,
      ...patch
    })
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
  }, [sessionsQueryKey])

  useEffect(() => {
    if (shouldResortProjectsForUserInput({ previousBusy: previousBusyRef.current, busy: focusedBusy })) {
      setProjectSortEpoch(current => current + 1)
    }
    previousBusyRef.current = Boolean(focusedBusy)
  }, [focusedBusy])

  const sourceGroups = sessionsQuery.data?.groups || []
  const loadedSessionCount = sourceGroups.reduce((count, group) => count + group.sessions.length, 0)
  const totalSessionCount = sourceGroups.reduce((count, group) => count + Math.max(group.sessions.length, Number(group.total) || 0), 0)
  const hasExactSessionTotal = sourceGroups.length > 0 && sourceGroups.every(group => !group.error && group.totalExact)
  const hasMoreSessions = sessionLimit < GATEWAY_SESSIONS_LIMIT_MAX && sourceGroups.some(group => group.hasMore)
  const nextSessionLimit = Math.min(GATEWAY_SESSIONS_LIMIT_MAX, Math.max(sessionLimit + 1, sessionLimit * 2))

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
        return {
          ...project,
          displayLabel,
          remoteLabel,
          sourceLabel,
          profile,
          sessions: [...project.sessions].sort(compareSessions)
        }
      })
  ), [hideScheduled, sourceGroups])

  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return unfilteredProjects
      .map(project => ({
        ...project,
        sessions: project.sessions.filter(session => {
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
      }))
      .filter(project => project.sessions.length > 0 || !needle)
  }, [search, sessionFilter, unfilteredProjects])

  const projects = useMemo(() => {
    const known = new Set(unfilteredProjects.map(project => project.key))
    const previousKeys = projectOrderKeysRef.current.filter(key => known.has(key))
    const resort = lastProjectSortEpochRef.current !== projectSortEpoch || previousKeys.length === 0
    const orderedAll = stabilizeProjectOrder(unfilteredProjects, previousKeys, { resort })
    lastProjectSortEpochRef.current = projectSortEpoch
    projectOrderKeysRef.current = orderedAll.map(project => project.key)
    const visibleByKey = new Map(visibleProjects.map(project => [project.key, project]))
    return orderedAll.map(project => visibleByKey.get(project.key)).filter(Boolean)
  }, [projectSortEpoch, unfilteredProjects, visibleProjects])

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

    const windowed = gatewayVirtualWindow(renderRows.length, scrollTop, viewportHeight)
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
    } catch (error) {
      host.notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not open gateway session.'
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
        message: error instanceof Error ? error.message : 'Could not open gateway session.'
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

  const revealProjectSessions = key => {
    setRevealedProjects(current => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
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
        throw new Error('Update Hermes Desktop to start a chat on another gateway.')
      }

      const home = isHomeProject(project)
      const targetPath = projectWorkspacePath(project)
      if (!home && !targetPath) {
        throw new Error(`Could not resolve a workspace path for ${projectDisplayLabel(project)}.`)
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
            message: error instanceof Error ? error.message : 'Could not open the new gateway chat.'
          })
        })
        .finally(() => {
          try { release?.() } catch {}
        })
      void queryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
      setProjectSortEpoch(current => current + 1)
    } catch (error) {
      host.notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not start a gateway chat.'
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
      host.notify({ kind: 'error', message: `Could not retry ${group.label}.` })
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
    void queryClient.refetchQueries({ queryKey: sessionsQueryKey, type: 'active' })
  }

  if (sessionsQuery.isLoading && sourceGroups.length === 0) {
    return jsxs('div', {
      className: 'flex h-full flex-col items-center justify-center gap-2 bg-(--ui-sidebar-surface-background) p-4 text-(--ui-text-tertiary)',
      children: [
        jsx(GlyphSpinner, { ariaLabel: 'Loading sessions', className: 'text-sm' }, 'spinner'),
        jsx(EmptyState, {
          className: 'min-h-0',
          description: 'Reading sessions from every available gateway.',
          title: 'Loading sessions…'
        }, 'empty')
      ]
    })
  }

  if (sessionsQuery.error && sourceGroups.length === 0) {
    return jsx('div', {
      className: 'flex h-full items-center justify-center bg-(--ui-sidebar-surface-background) p-4',
      children: jsxs(ErrorState, {
        className: 'max-w-xs',
        description: 'Gateway sessions are unavailable.',
        title: 'Codex Studio',
        children: jsx(Button, { onClick: refresh, size: 'xs', variant: 'ghost', children: 'Retry' }, 'retry')
      })
    })
  }

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col bg-(--ui-sidebar-surface-background) text-xs text-(--ui-text-tertiary)',
    children: [
      jsxs('header', {
        className: 'flex shrink-0 items-center gap-1.5 border-b border-(--ui-stroke-tertiary) px-3 py-2',
        children: [
          jsx('div', { className: 'min-w-0 flex-1 font-medium text-foreground', children: 'Codex Studio' }, 'title'),
          jsx('span', {
            className: 'text-[0.65rem] tabular-nums text-(--ui-text-quaternary)',
            title: hasExactSessionTotal && totalSessionCount > loadedSessionCount ? `已加载 ${loadedSessionCount} / 共 ${totalSessionCount}` : `已加载 ${loadedSessionCount}`,
            children: hasExactSessionTotal && totalSessionCount > loadedSessionCount ? `${loadedSessionCount}/${totalSessionCount}` : loadedSessionCount
          }, 'count'),
          jsx('select', {
            'aria-label': 'Profile scope',
            className: 'h-6 max-w-28 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1 text-[0.65rem] text-foreground',
            onChange: event => persistPrefs({ profileScope: event.target.value }),
            title: profileScope === PROFILE_SCOPE_ALL ? 'Showing all profiles' : 'Showing default profile',
            value: profileScope,
            children: [
              jsx('option', { value: PROFILE_SCOPE_DEFAULT, children: 'default' }, PROFILE_SCOPE_DEFAULT),
              jsx('option', { value: PROFILE_SCOPE_ALL, children: 'All profiles' }, PROFILE_SCOPE_ALL)
            ]
          }, 'profile-scope'),
          jsx(Button, {
            'aria-label': hideScheduled ? 'Show scheduled sessions' : 'Hide scheduled sessions',
            className: 'size-6',
            onClick: () => persistPrefs({ hideScheduled: !hideScheduled }),
            size: 'icon-xs',
            title: hideScheduled ? 'Show scheduled sessions' : 'Hide scheduled sessions',
            variant: hideScheduled ? 'secondary' : 'ghost',
            children: jsx(Codicon, { name: 'calendar', size: '0.8rem' })
          }, 'scheduled'),
          jsx(Button, { 'aria-label': 'Refresh gateway sessions', className: 'size-6', onClick: refresh, size: 'icon-xs', variant: 'ghost', children: jsx(Codicon, { name: 'refresh', size: '0.8rem', spinning: sessionsQuery.isFetching }) }, 'refresh')
        ]
      }, 'header'),
      jsx(SearchField, { 'aria-label': 'Search gateway sessions', containerClassName: 'mx-3 mt-1 w-auto', onChange: value => persistPrefs({ search: value }), placeholder: 'Search sessions', value: search }, 'search'),
      jsxs('div', {
        className: 'flex shrink-0 flex-wrap gap-1 px-2 pt-1.5',
        children: [
          ['all', '全部'],
          ['unread', '未读'],
          ['open', '开放中'],
          ['pinned', '置顶'],
          ['recent', '24小时']
        ].map(([value, label]) => jsx(Button, {
          'aria-pressed': sessionFilter === value,
          onClick: () => setSessionFilter(value),
          size: 'xs',
          title: value === 'open'
            ? 'Gateway 持久化状态，不代表模型正在生成'
            : value === 'unread'
              ? '未读依据已同步状态，实时状态点可能先更新'
              : undefined,
          variant: sessionFilter === value ? 'secondary' : 'ghost',
          children: label
        }, value))
      }, 'filters'),
      jsx('div', {
        className: 'shrink-0 px-3 pt-1 text-[0.6rem] leading-tight text-(--ui-text-quaternary)',
        title: `筛选只覆盖当前已加载窗口，最多 ${GATEWAY_SESSIONS_LIMIT_MAX} 条`,
        children: `筛选范围：已加载 ${loadedSessionCount} 条${hasExactSessionTotal ? ` / 共 ${totalSessionCount} 条` : ''}；未读依据已同步状态`
      }, 'filter-scope'),
      unavailableSources.length > 0 && jsxs('div', {
        className: 'mx-3 mt-1 flex flex-wrap items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.62rem] text-(--ui-text-quaternary)',
        children: [
          jsx('span', { className: 'mr-auto', children: `${unavailableSources.length} source${unavailableSources.length === 1 ? '' : 's'} unavailable` }, 'label'),
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
            description: search ? 'Try a different title, project, or gateway name.' : 'Create a chat from a project header, or wait for an existing session to appear.',
            title: search ? 'No matching sessions.' : 'No sessions found.'
          }, 'empty')
        : jsx('div', {
            className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3 pt-2',
            onScroll: handleSessionsScroll,
            ref: sessionsScrollRef,
            children: [
              renderedRows.topSpacer > 0 && jsx('div', { 'aria-hidden': true, style: { height: renderedRows.topSpacer } }, 'virtual-top'),
              ...renderedRows.rows.map(renderRow => renderRow.type === 'project'
                ? gatewayProjectHeaderRow(renderRow.project, collapsed, toggle, newChat)
                : renderRow.type === 'more'
                  ? gatewayProjectMoreRow(renderRow.project, renderRow.remaining, revealProjectSessions)
                  : gatewaySessionRow(renderRow.project, renderRow.session, focusedStoredSessionId, focusedSessionOwner, opening, open, applySessionChange)),
              renderedRows.bottomSpacer > 0 && jsx('div', { 'aria-hidden': true, style: { height: renderedRows.bottomSpacer } }, 'virtual-bottom'),
              hasMoreSessions && jsx('div', {
                className: 'flex justify-center px-2 py-2',
                children: jsx(Button, {
                  disabled: sessionsQuery.isFetching,
                  onClick: () => $gatewaySessionLimit.set(nextSessionLimit),
                  size: 'xs',
                  variant: 'ghost',
                  children: sessionsQuery.isFetching
                    ? '加载中…'
                    : hasExactSessionTotal
                      ? `加载更多（已加载 ${loadedSessionCount} / ${totalSessionCount}）`
                      : `加载更多（已加载 ${loadedSessionCount}）`
                })
              }, 'load-more')
            ]
          }, 'session-list')
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
  name: 'Codex Studio',
  description: 'Codex Studio: Cold White theme, a cross-gateway session pane, command palette, and unread status chip.',
  register(ctx) {
    gatewaySessionStorage = ctx.storage
    gatewaySessionStorageOwner = ctx
    $gatewaySessionPrefs.set(readGatewaySessionPreferences())
    ctx.onDispose(subscribeGatewaySessionEvents())

    ctx.register({
      id: 'theme',
      area: THEMES_AREA,
      data: CODEX_THEME
    })

    // This is a real contributed pane, not DOM injected into Hermes's React
    // Sessions tree. It uses the same left-side zone as the native Sessions
    // pane, so the user can switch between the native list and this aggregate
    // view without changing the active gateway.
    ctx.register({
      id: 'gateway-sessions',
      area: 'panes',
      title: 'Codex Studio',
      data: {
        collapsible: true,
        placement: 'left',
        width: '280px'
      },
      order: 85,
      render: () => jsx(GatewaySessionsPane, {})
    })

    ctx.register({
      id: 'inbox',
      area: STATUSBAR_AREAS.right,
      order: 86,
      render: () => jsx(GatewayInboxChip, {})
    })

    ctx.register({
      id: 'refresh-palette',
      area: PALETTE_AREA,
      data: {
        id: 'codex-studio.refresh',
        action: 'codex-studio.refresh',
        label: 'Codex Studio: Refresh sessions',
        keywords: ['codex', 'studio', 'gateway', 'sessions', 'refresh', 'reload'],
        run: () => void refreshGatewaySessionQueries()
      }
    })

    ctx.register({
      id: 'theme-palette',
      area: PALETTE_AREA,
      data: {
        id: 'codex-studio.theme',
        label: 'Codex Studio: Apply Hermes Cold White',
        keywords: ['codex', 'studio', 'theme', 'cold', 'white', 'light'],
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
        id: 'codex-studio.refresh',
        category: 'view',
        defaults: ['mod+alt+g'],
        label: 'Codex Studio: Refresh sessions',
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
          elementStyles.set(element, 'background-color', '#f8f9ff')
        })

        document
          .querySelectorAll("[data-slot='aui_thread-viewport'], [data-chat-surface], [data-slot='composer-bounds']")
          .forEach(element => elementStyles.set(element, 'background-color', '#f8f9ff'))

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
          elementStyles.set(element, 'background-color', '#f8f9ff')
        })

        document.querySelectorAll("[data-slot='aui_user-message-root']").forEach(element => {
          elementStyles.set(element, 'background-color', '#f8f9ff')
        })

        document.querySelectorAll("[data-slot='aui_user-message-root'] .composer-human-message").forEach(element => {
          // Content-sized, right-aligned bubble: short prompts stay short and
          // long prompts cap at the same ~70% proportion as Codex.
          elementStyles.set(element, 'width', 'fit-content')
          elementStyles.set(element, 'max-width', USER_MESSAGE_MAX_WIDTH)
          elementStyles.set(element, 'margin-left', 'auto')
          elementStyles.set(element, 'border-radius', USER_MESSAGE_RADIUS)
          elementStyles.set(element, 'background-color', '#f3f4f5')
          elementStyles.set(element, 'border-color', '#d3dde9')
        })

      }

      // Remove inline values from elements that disappeared or are no longer
      // part of the active Codex-light surface. Some layout cells we align
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
