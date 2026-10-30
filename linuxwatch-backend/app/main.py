import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import db
from .jobs import Scheduler
from .realtime import hub
from .routers import agent, core, ws

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("linuxwatch")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate()
    db.open()
    db.init_schema()
    hub.attach_loop(asyncio.get_running_loop())
    scheduler = Scheduler()
    scheduler.start()
    log.info("LinuxWatch API started")
    yield
    scheduler.stop()
    db.close()


app = FastAPI(title="LinuxWatch API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "X-Workspace-Id"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)  # never leak internals


@app.get("/healthz", tags=["health"])
def healthz():
    with db.tx() as tx:
        tx.one("SELECT 1 AS ok")
    return {"status": "ok"}


app.include_router(core.router, prefix="/api/v1")
app.include_router(agent.router, prefix="/api/v1")
app.include_router(ws.router, prefix="/api/v1")
