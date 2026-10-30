"""Endpoints used by the monitoring agent (authenticated with the per-server registration token) + installer downloads."""
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse

from .. import schemas as S
from ..config import settings
from ..services import ingest as ingest_svc

router = APIRouter(prefix="/agent", tags=["agent"])


def _token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing agent token")
    t = authorization[7:].strip()
    if not t.startswith("lwt_"):
        raise HTTPException(401, "Invalid agent token")
    return t


@router.post("/metrics")
def push_metrics(payload: S.AgentPayload, request: Request, authorization: Optional[str] = Header(None)):
    return ingest_svc.ingest(_token(authorization), payload.model_dump(), request.client.host if request.client else "")


@router.post("/heartbeat")
def heartbeat(authorization: Optional[str] = Header(None)):
    return ingest_svc.heartbeat(_token(authorization))


@router.get("/lw_agent.py")
def download_agent():
    path = os.path.join(settings.agent_dir, "lw_agent.py")
    if not os.path.isfile(path):
        raise HTTPException(404, "Agent file not found on server")
    return FileResponse(path, media_type="text/x-python", filename="lw_agent.py")


@router.get("/install.sh", response_class=PlainTextResponse)
def install_script():
    path = os.path.join(settings.agent_dir, "install.sh")
    if not os.path.isfile(path):
        raise HTTPException(404, "Installer not found on server")
    with open(path, encoding="utf-8") as f:
        return f.read().replace("__ENDPOINT__", settings.public_url + "/api/v1")
