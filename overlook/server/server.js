/**
 * Overlook Mobile Relay Server
 *
 * Lightweight standalone server providing:
 * 1. Mobile-friendly adaptive Web UI for multi-gateway session monitoring.
 * 2. Bi-directional WebSocket relay connecting Hermes Desktop and mobile browsers.
 *
 * Default port: 9999 (0.0.0.0 accessible on LAN)
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { WebSocketServer, WebSocket } = require('ws')
const os = require('os')

const PORT = Number(process.env.OVERLOOK_PORT || 9999)
const HOST = process.env.OVERLOOK_HOST || '0.0.0.0'

// Broadcast state cache
let desktopSocket = null
const mobileSockets = new Set()
let cachedSnapshot = {
  activeSessionId: '',
  busyBySession: {},
  connections: [],
  monitoredSessions: [],
  projectAppearance: {},
  queues: {},
  stats: { totalSessions: 0, liveRunning: 0 }
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces()
  const addresses = []
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address)
      }
    }
  }
  return addresses
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // Serve static mobile web client
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/mobile') {
    const htmlPath = path.join(__dirname, 'mobile.html')
    fs.readFile(htmlPath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Failed to load mobile client interface.')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(content)
    })
    return
  }

  // Health check & LAN discovery endpoint
  if (url.pathname === '/api/status') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(JSON.stringify({
      desktopConnected: Boolean(desktopSocket && desktopSocket.readyState === WebSocket.OPEN),
      mobileClients: mobileSockets.size,
      ok: true,
      port: PORT,
      version: '1.0.0'
    }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const isDesktop = url.pathname.includes('/desktop') || url.searchParams.get('client') === 'desktop'

  if (isDesktop) {
    if (desktopSocket && desktopSocket !== ws) {
      try { desktopSocket.close() } catch {}
    }
    desktopSocket = ws
    console.log('[Overlook Relay] Hermes Desktop connected.')

    // Notify all mobile clients of desktop presence
    broadcastToMobiles({
      type: 'desktop_status',
      connected: true
    })

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'snapshot') {
          cachedSnapshot = { ...cachedSnapshot, ...msg.payload }
          broadcastToMobiles({
            type: 'snapshot',
            payload: cachedSnapshot
          })
        } else if (msg.type === 'transcript_update') {
          broadcastToMobiles(msg)
        } else if (msg.type === 'rpc_reply') {
          broadcastToMobiles(msg)
        }
      } catch (err) {
        console.error('[Overlook Relay] Error handling desktop message:', err)
      }
    })

    ws.on('close', () => {
      if (desktopSocket === ws) {
        desktopSocket = null
        console.log('[Overlook Relay] Hermes Desktop disconnected.')
        broadcastToMobiles({
          type: 'desktop_status',
          connected: false
        })
      }
    })
  } else {
    // Mobile client
    mobileSockets.add(ws)
    console.log(`[Overlook Relay] Mobile client connected. Total mobile: ${mobileSockets.size}`)

    // Immediately send cached snapshot & desktop online status
    ws.send(JSON.stringify({
      type: 'init',
      payload: {
        desktopConnected: Boolean(desktopSocket && desktopSocket.readyState === WebSocket.OPEN),
        snapshot: cachedSnapshot
      }
    }))

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString())
        // Forward commands from mobile to Desktop
        if (desktopSocket && desktopSocket.readyState === WebSocket.OPEN) {
          desktopSocket.send(JSON.stringify(msg))
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Hermes Desktop 未连接，无法转发指令。'
          }))
        }
      } catch (err) {
        console.error('[Overlook Relay] Error handling mobile message:', err)
      }
    })

    ws.on('close', () => {
      mobileSockets.delete(ws)
      console.log(`[Overlook Relay] Mobile client left. Total mobile: ${mobileSockets.size}`)
    })
  }

  ws.on('error', err => {
    console.error('[Overlook Relay] Socket error:', err.message)
  })
})

function broadcastToMobiles(payload) {
  const json = JSON.stringify(payload)
  for (const client of mobileSockets) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(json) } catch {}
    }
  }
}

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const ips = getLocalIpAddresses()
    console.log(`====================================================`)
    console.log(` Overlook Mobile Relay Server started!`)
    console.log(` Port: ${PORT}`)
    console.log(` Local:   http://localhost:${PORT}`)
    ips.forEach(ip => {
      console.log(` Mobile:  http://${ip}:${PORT}`)
    })
    console.log(`====================================================`)
  })
}

module.exports = { server, PORT }
