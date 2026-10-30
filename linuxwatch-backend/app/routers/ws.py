import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..db import db
from ..realtime import hub
from ..security import decode_access_token

router = APIRouter()


def _authorize(token: str, workspace_id: str):
    user_id = decode_access_token(token or "")
    if not user_id:
        return None
    with db.tx() as tx:
        if workspace_id:
            m = tx.one("SELECT workspace_id FROM members WHERE user_id = %s AND workspace_id = %s AND status = 'Active'", (user_id, workspace_id))
        else:
            m = tx.one("SELECT workspace_id FROM members WHERE user_id = %s AND status = 'Active' ORDER BY created_at LIMIT 1", (user_id,))
    return m["workspace_id"] if m else None


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """Protocol: connect, then send {"type":"auth","token":"<jwt>","workspace":"<id>"} within 10 s (the token is NOT put in the URL).
    The server then pushes {type: 'server.update' | 'alerts.changed' | 'deliveries.changed' | 'event', ...}."""
    await ws.accept()
    ws_id = None
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        msg = json.loads(raw)
        if msg.get("type") != "auth":
            raise ValueError("auth required")
        ws_id = await asyncio.get_running_loop().run_in_executor(None, _authorize, msg.get("token"), msg.get("workspace"))
        if not ws_id:
            await ws.close(code=4401)
            return
        await hub.connect(ws_id, ws)
        await ws.send_json({"type": "ready", "workspace": ws_id})
        while True:
            await ws.receive_text()  # keep-alive pings from the client
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, json.JSONDecodeError):
        pass
    finally:
        if ws_id:
            hub.disconnect(ws_id, ws)
        try:
            await ws.close()
        except Exception:
            pass
