#!/usr/bin/env python3
"""
Overlook Mobile Relay Server (Python + FastAPI + Uvicorn)

Zero external installation dependencies (uses Hermes built-in FastAPI/Uvicorn).
Listens on 0.0.0.0:9999 for LAN mobile access and bi-directional WebSocket relay with Hermes Desktop.
"""

import os
import sys
import json
import socket
from pathlib import Path
from typing import Set, Dict, Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

PORT = int(os.environ.get("OVERLOOK_PORT", 9999))
HOST = os.environ.get("OVERLOOK_HOST", "0.0.0.0")

app = FastAPI(title="Overlook Mobile Relay")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

desktop_socket: WebSocket | None = None
mobile_sockets: Set[WebSocket] = set()

cached_snapshot: Dict[str, Any] = {
    "activeSessionId": "",
    "busyBySession": {},
    "connections": [],
    "monitoredSessions": [],
    "projectAppearance": {},
    "queues": {},
    "stats": {"totalSessions": 0, "liveRunning": 0},
}

HTML_PATH = Path(__file__).parent / "mobile.html"
MANIFEST_PATH = Path(__file__).parent / "manifest.json"
ICON_SVG_PATH = Path(__file__).parent / "icon.svg"
ICON_192_PATH = Path(__file__).parent / "icon-192.png"
ICON_512_PATH = Path(__file__).parent / "icon-512.png"


def get_local_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    return ips or ["127.0.0.1"]


@app.get("/", response_class=HTMLResponse)
@app.get("/mobile", response_class=HTMLResponse)
async def serve_mobile():
    if HTML_PATH.exists():
        return HTML_PATH.read_text(encoding="utf-8")
    return "<h1>Overlook Mobile (mobile.html not found)</h1>"


@app.get("/manifest.json")
@app.get("/manifest.webmanifest")
async def serve_manifest():
    if MANIFEST_PATH.exists():
        return Response(content=MANIFEST_PATH.read_text(encoding="utf-8"), media_type="application/manifest+json")
    return JSONResponse({
        "name": "Overlook",
        "short_name": "Overlook",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#ffffff"
    })


@app.get("/icon.svg")
async def serve_icon_svg():
    if ICON_SVG_PATH.exists():
        return Response(content=ICON_SVG_PATH.read_text(encoding="utf-8"), media_type="image/svg+xml")
    return Response(content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="200" fill="#006591"/></svg>', media_type="image/svg+xml")


@app.get("/icon-192.png")
async def serve_icon_192():
    if ICON_192_PATH.exists():
        return Response(content=ICON_192_PATH.read_bytes(), media_type="image/png")
    return Response(status_code=404)


@app.get("/icon-512.png")
async def serve_icon_512():
    if ICON_512_PATH.exists():
        return Response(content=ICON_512_PATH.read_bytes(), media_type="image/png")
    return Response(status_code=404)


@app.get("/api/status")
async def api_status():
    return {
        "ok": True,
        "port": PORT,
        "desktopConnected": desktop_socket is not None,
        "mobileClients": len(mobile_sockets),
        "version": "1.0.0",
    }


async def broadcast_to_mobiles(message: dict):
    data = json.dumps(message, ensure_ascii=False)
    for ws in list(mobile_sockets):
        try:
            await ws.send_text(data)
        except Exception:
            mobile_sockets.discard(ws)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    global desktop_socket, cached_snapshot
    await ws.accept()

    query_params = ws.query_params
    client_type = query_params.get("client", "")
    is_desktop = client_type == "desktop"

    if is_desktop:
        desktop_socket = ws
        print("[Overlook Relay] Hermes Desktop connected.")
        await broadcast_to_mobiles({"type": "desktop_status", "connected": True})

        try:
            while True:
                text = await ws.receive_text()
                try:
                    msg = json.loads(text)
                    m_type = msg.get("type")
                    if m_type == "snapshot":
                        cached_snapshot.update(msg.get("payload", {}))
                        await broadcast_to_mobiles({
                            "type": "snapshot",
                            "payload": cached_snapshot,
                        })
                    else:
                        await broadcast_to_mobiles(msg)
                except Exception as e:
                    print("[Overlook Relay] Error handling desktop msg:", e)
        except WebSocketDisconnect:
            pass
        finally:
            if desktop_socket == ws:
                desktop_socket = None
                print("[Overlook Relay] Hermes Desktop disconnected.")
                await broadcast_to_mobiles({"type": "desktop_status", "connected": False})

    else:
        # Mobile client
        mobile_sockets.add(ws)
        print(f"[Overlook Relay] Mobile client connected. Total mobile: {len(mobile_sockets)}")

        # Send initial snapshot
        init_payload = {
            "type": "init",
            "payload": {
                "desktopConnected": desktop_socket is not None,
                "snapshot": cached_snapshot,
            },
        }
        await ws.send_text(json.dumps(init_payload, ensure_ascii=False))

        try:
            while True:
                text = await ws.receive_text()
                # Forward to Desktop
                if desktop_socket is not None:
                    try:
                        await desktop_socket.send_text(text)
                    except Exception as e:
                        print("[Overlook Relay] Forward error:", e)
                else:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "Hermes Desktop 未连接，无法下发指令。",
                    }, ensure_ascii=False))
        except WebSocketDisconnect:
            pass
        finally:
            mobile_sockets.discard(ws)
            print(f"[Overlook Relay] Mobile client disconnected. Remaining: {len(mobile_sockets)}")


def main():
    ips = get_local_ips()
    print("=" * 55)
    print(" Overlook Mobile Relay Server (Multi-Gateway Bridge)")
    print(f" Port: {PORT}")
    print(f" Local:   http://localhost:{PORT}")
    for ip in ips:
        print(f" Mobile:  http://{ip}:{PORT}")
    print("=" * 55)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
