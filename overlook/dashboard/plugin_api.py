# -*- coding: utf-8 -*-
"""Overlook Plugin Backend API (Mounted under /api/plugins/overlook).

Runs directly inside Hermes Desktop's backend server process.
Provides:
1. Mobile-friendly adaptive web interface (/mobile)
2. LAN multi-gateway WebSocket relay (/ws) connecting Desktop and mobile devices
"""

import json
import socket
from pathlib import Path
from typing import Any, Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

router = APIRouter()

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


@router.get("/mobile", response_class=HTMLResponse)
async def mobile_interface():
    """Serve the self-contained mobile monitor room page."""
    if HTML_PATH.exists():
        return HTML_PATH.read_text(encoding="utf-8")
    return "<h1>Overlook Mobile (mobile.html not found)</h1>"


@router.get("/status")
async def status():
    """Discovery and health status endpoint."""
    return {
        "ok": True,
        "desktopConnected": desktop_socket is not None,
        "mobileClients": len(mobile_sockets),
        "localIps": get_local_ips(),
    }


async def broadcast_to_mobiles(message: dict):
    data = json.dumps(message, ensure_ascii=False)
    for ws in list(mobile_sockets):
        try:
            await ws.send_text(data)
        except Exception:
            mobile_sockets.discard(ws)


@router.websocket("/ws")
async def websocket_relay(ws: WebSocket):
    global desktop_socket, cached_snapshot
    await ws.accept()

    query_params = ws.query_params
    is_desktop = query_params.get("client") == "desktop"

    if is_desktop:
        desktop_socket = ws
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
                    elif m_type in ("transcript_update", "rpc_reply"):
                        await broadcast_to_mobiles(msg)
                except Exception:
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            if desktop_socket == ws:
                desktop_socket = None
                await broadcast_to_mobiles({"type": "desktop_status", "connected": False})
    else:
        mobile_sockets.add(ws)

        # Send initial snapshot immediately
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
                # Forward to Desktop renderer
                if desktop_socket is not None:
                    try:
                        await desktop_socket.send_text(text)
                    except Exception:
                        pass
                else:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": "Hermes Desktop 尚未就绪，无法转发指令。",
                    }, ensure_ascii=False))
        except WebSocketDisconnect:
            pass
        finally:
            mobile_sockets.discard(ws)
