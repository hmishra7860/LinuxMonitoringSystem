"""WebSocket hub: pushes live updates to dashboards. publish() is safe to call from worker threads."""
import asyncio
import logging

log = logging.getLogger("linuxwatch.realtime")


class Hub:
    def __init__(self):
        self.rooms = {}
        self.loop = None

    def attach_loop(self, loop):
        self.loop = loop

    async def connect(self, ws_id: str, ws):
        self.rooms.setdefault(ws_id, set()).add(ws)

    def disconnect(self, ws_id: str, ws):
        self.rooms.get(ws_id, set()).discard(ws)

    async def _broadcast(self, ws_id: str, msg: dict):
        dead = []
        for ws in list(self.rooms.get(ws_id, ())):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws_id, ws)

    def publish(self, ws_id: str, msg: dict):
        if not self.loop or not self.rooms.get(ws_id):
            return
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(ws_id, msg), self.loop)
        except Exception:  # never let realtime break ingestion
            log.exception("publish failed")


hub = Hub()
