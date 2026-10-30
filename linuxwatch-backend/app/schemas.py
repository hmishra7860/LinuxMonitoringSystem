"""Request validation models (pydantic v2)."""
from typing import Annotated, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Env = Literal["Production", "Development", "Testing"]
Role = Literal["Admin", "Operator", "Viewer"]
Severity = Literal["critical", "warning"]
Pct = Annotated[float, Field(ge=0, le=100)]


# ---------- auth ----------
class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    company: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", max_length=200)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)
    remember: bool = False


class ForgotIn(BaseModel):
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", max_length=200)


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=8, max_length=200)


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)


# ---------- servers ----------
class Modules(BaseModel):
    cpu: bool = True
    memory: bool = True
    disk: bool = True
    network: bool = True
    processes: bool = True
    services: bool = True
    logs: bool = True


class MonitoringIn(BaseModel):
    interval: Literal[15, 30, 60, 300] = 30
    modules: Modules = Modules()


_NAME = r"^[a-zA-Z0-9][a-zA-Z0-9._ -]*$"
_HOST = r"^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$"


def _clean_tags(v):
    return sorted({t.strip().lower() for t in v if t.strip()})


class ServerCreate(BaseModel):
    name: str = Field(min_length=3, max_length=80, pattern=_NAME)
    hostname: str = Field(min_length=1, max_length=253, pattern=_HOST)
    os: str = Field(default="Linux", max_length=60)
    osVersion: str = Field(default="—", max_length=40)
    env: Env
    client: str = Field(min_length=2, max_length=120)
    region: str = Field(default="", max_length=40)
    tags: List[str] = Field(default_factory=list, max_length=20)
    description: str = Field(default="", max_length=240)
    monitoring: Optional[MonitoringIn] = None

    @field_validator("tags")
    @classmethod
    def _t(cls, v):
        return _clean_tags(v)


class ServerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=80, pattern=_NAME)
    hostname: Optional[str] = Field(default=None, min_length=1, max_length=253, pattern=_HOST)
    os: Optional[str] = Field(default=None, max_length=60)
    osVersion: Optional[str] = Field(default=None, max_length=40)
    env: Optional[Env] = None
    client: Optional[str] = Field(default=None, min_length=2, max_length=120)
    region: Optional[str] = Field(default=None, max_length=40)
    tags: Optional[List[str]] = Field(default=None, max_length=20)
    description: Optional[str] = Field(default=None, max_length=240)
    monitoring: Optional[MonitoringIn] = None

    @field_validator("tags")
    @classmethod
    def _t(cls, v):
        return None if v is None else _clean_tags(v)


class ServiceIn(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9@:_.-]{2,40}$")
    unit: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9@:_.-]{2,60}$")
    monitored: bool = True


class ServicesIn(BaseModel):
    services: List[ServiceIn] = Field(max_length=100)


# ---------- agent ----------
class IfaceIn(BaseModel):
    name: str = Field(max_length=40)
    rx: float = Field(ge=0, default=0)
    tx: float = Field(ge=0, default=0)
    rxPk: float = Field(ge=0, default=0)
    txPk: float = Field(ge=0, default=0)
    errors: int = Field(ge=0, default=0)
    drops: int = Field(ge=0, default=0)


class FsIn(BaseModel):
    mount: str = Field(max_length=200)
    device: str = Field(default="", max_length=120)
    fs: str = Field(default="", max_length=30)
    size: float = Field(ge=0)
    used: float = Field(ge=0)
    pct: Pct
    inode: float = Field(default=0, ge=0, le=100)


class ProcIn(BaseModel):
    pid: int
    name: str = Field(max_length=120)
    user: str = Field(default="", max_length=60)
    cpu: float = Field(ge=0, le=10000)
    mem: float = Field(ge=0, le=100)
    threads: int = Field(default=1, ge=0)


class SvcIn(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9@:_.-]{2,40}$")
    unit: str = Field(max_length=80)
    status: Literal["active", "inactive", "failed", "not-installed", "unknown"]


class LogIn(BaseModel):
    ts: float
    level: Literal["INFO", "WARNING", "ERROR", "CRITICAL"]
    source: str = Field(default="", max_length=80)
    message: str = Field(max_length=2000)


class AgentPayload(BaseModel):
    agent_version: str = Field(max_length=30)
    os: str = Field(default="", max_length=60)
    os_version: str = Field(default="", max_length=60)
    kernel: str = Field(default="", max_length=80)
    ip: str = Field(default="", max_length=64)
    uptime_sec: int = Field(ge=0)
    cores: int = Field(ge=1, le=4096)
    ram_total_gb: float = Field(ge=0)
    disk_total_gb: float = Field(ge=0)
    swap_total_gb: float = Field(ge=0)
    cpu: Pct
    mem: Pct
    disk: Pct
    swap: Pct
    net_in: float = Field(ge=0)
    net_out: float = Field(ge=0)
    per_core: List[float] = Field(default_factory=list, max_length=4096)
    load: List[float] = Field(default_factory=lambda: [0, 0, 0], max_length=3)
    filesystems: List[FsIn] = Field(default_factory=list, max_length=64)
    interfaces: List[IfaceIn] = Field(default_factory=list, max_length=64)
    processes: List[ProcIn] = Field(default_factory=list, max_length=50)
    services: List[SvcIn] = Field(default_factory=list, max_length=100)
    logs: List[LogIn] = Field(default_factory=list, max_length=500)


# ---------- policies ----------
class Thresh(BaseModel):
    warn: float
    crit: float
    duration: float


class NetCfg(BaseModel):
    inMbps: float
    outMbps: float
    errors: float


class SvcCfg(BaseModel):
    expected: str = "active"
    failAfter: float


class Assignment(BaseModel):
    type: Literal["server", "client", "environment", "region", "tag"]
    value: str = Field(min_length=1, max_length=120)


class PolicyIn(BaseModel):
    name: str = Field(min_length=3, max_length=100)
    description: str = Field(default="", max_length=300)
    isDefault: bool = False
    enabled: bool = True
    assignments: List[Assignment] = Field(default_factory=list, max_length=100)
    cpu: Thresh
    memory: Thresh
    disk: Thresh
    network: NetCfg
    service: SvcCfg


# ---------- alerts / suppression ----------
class BulkIn(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=500)
    action: Literal["ack", "resolve"]


class SimulateIn(BaseModel):
    serverId: str


class SuppressionIn(BaseModel):
    target: str = Field(max_length=200)
    modules: List[str] = Field(min_length=1)
    durationId: str
    reason: str = Field(default="", max_length=300)


# ---------- integrations ----------
class IntegrationIn(BaseModel):
    type: Literal["email", "slack", "teams", "webhook"]
    name: str = Field(min_length=2, max_length=100)
    enabled: bool = True
    config: dict = Field(default_factory=dict)
    secrets: Dict[str, str] = Field(default_factory=dict)


class Scope(BaseModel):
    type: Literal["all", "client", "environment", "server"] = "all"
    value: str = ""


class RuleIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    severities: List[Severity] = Field(min_length=1)
    modules: List[str] = Field(min_length=1)
    scope: Scope = Scope()
    integrationIds: List[str] = Field(min_length=1)
    enabled: bool = True


# ---------- org ----------
class InviteIn(BaseModel):
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
    role: Role


class RoleIn(BaseModel):
    role: Role


class TokenIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    scopes: List[str] = Field(min_length=1)


class SettingsIn(BaseModel):
    timezone: Optional[str] = Field(default=None, max_length=60)
    heartbeatSec: Optional[int] = Field(default=None, ge=10, le=300)
    collectionSec: Optional[int] = Field(default=None, ge=10, le=600)
    logLevel: Optional[Literal["INFO", "WARNING", "ERROR", "CRITICAL"]] = None
    logSources: Optional[List[str]] = Field(default=None, max_length=20)
    retentionDays: Optional[int] = Field(default=None, ge=1, le=365)
    notif: Optional[Dict[str, bool]] = None
