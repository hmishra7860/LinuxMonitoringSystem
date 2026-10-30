from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .. import schemas as S
from ..db import db
from ..deps import Ctx, ROLE_RANK, admin, get_ctx, operator, viewer
from ..services import alerts as alert_svc
from ..services import auth as auth_svc
from ..services import integrations as int_svc
from ..services import policies as pol_svc
from ..services import reports as report_svc
from ..services import servers as srv_svc
from ..services import settings as set_svc
from ..services import suppressions as sup_svc

router = APIRouter()


# ---------------- auth ----------------
@router.post("/auth/register", status_code=201, tags=["auth"])
def register(d: S.RegisterIn):
    with db.tx() as tx:
        return auth_svc.register(tx, d)


@router.post("/auth/login", tags=["auth"])
def login(d: S.LoginIn, request: Request):
    with db.tx() as tx:
        return auth_svc.login(tx, d, request.client.host if request.client else "")


@router.post("/auth/forgot", status_code=202, tags=["auth"])
def forgot(d: S.ForgotIn):
    # Always the same response (no account enumeration). Wire an SMTP reset-link flow here for production.
    return {"sent": True}


@router.get("/auth/me", tags=["auth"])
def me(ctx: Ctx = Depends(get_ctx)):
    with db.tx() as tx:
        return auth_svc.me(tx, ctx)


@router.patch("/auth/profile", tags=["auth"])
def profile(d: S.ProfileIn, ctx: Ctx = Depends(get_ctx)):
    with db.tx() as tx:
        return auth_svc.update_profile(tx, ctx, d)


@router.post("/auth/password", status_code=204, tags=["auth"])
def password(d: S.PasswordIn, ctx: Ctx = Depends(get_ctx)):
    with db.tx() as tx:
        auth_svc.change_password(tx, ctx, d)


@router.get("/workspaces", tags=["workspaces"])
def workspaces(ctx: Ctx = Depends(get_ctx)):
    with db.tx() as tx:
        return auth_svc.workspaces_for(tx, ctx.user_id)


@router.post("/workspaces", status_code=201, tags=["workspaces"])
def create_workspace(d: S.WorkspaceIn, ctx: Ctx = Depends(get_ctx)):
    if not ctx.user_id:
        raise HTTPException(403, "Not available for API tokens")
    with db.tx() as tx:
        return auth_svc.create_workspace(tx, ctx, d.name)


# ---------------- bootstrap (single call that hydrates the dashboard) ----------------
@router.get("/bootstrap", tags=["dashboard"])
def bootstrap(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        ws = ctx.workspace_id
        sup = sup_svc.list_all(tx, ws)
        is_admin = ROLE_RANK[ctx.role] >= ROLE_RANK["Admin"]
        return {
            "role": ctx.role, "servers": srv_svc.list_servers(tx, ws), "alerts": alert_svc.list_alerts(tx, ws), "policies": pol_svc.list_policies(tx, ws),
            "suppressions": sup["suppressions"], "suppressionAudit": sup["audit"], "integrations": int_svc.list_integrations(tx, ws), "rules": int_svc.list_rules(tx, ws),
            "deliveries": int_svc.list_deliveries(tx, ws), "events": int_svc.list_events(tx, ws), "members": set_svc.list_members(tx, ws),
            "tokens": set_svc.list_tokens(tx, ws) if is_admin else [], "audit": set_svc.list_audit(tx, ws) if is_admin else [], "settings": set_svc.get_settings(tx, ws),
        }


# ---------------- servers ----------------
@router.get("/servers", tags=["servers"])
def list_servers(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return srv_svc.list_servers(tx, ctx.workspace_id)


@router.post("/servers", status_code=201, tags=["servers"])
def create_server(d: S.ServerCreate, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        server, token = srv_svc.create_server(tx, ctx, d)
    return {"server": server, "token": token}  # the registration token is only ever returned here


@router.get("/servers/{server_id}", tags=["servers"])
def get_server(server_id: str, ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return srv_svc.get_server(tx, ctx.workspace_id, server_id)


@router.patch("/servers/{server_id}", tags=["servers"])
def update_server(server_id: str, d: S.ServerUpdate, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        return srv_svc.update_server(tx, ctx, server_id, d)


@router.put("/servers/{server_id}/services", tags=["servers"])
def put_services(server_id: str, d: S.ServicesIn, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        return srv_svc.replace_services(tx, ctx, server_id, d.services)


@router.delete("/servers/{server_id}", status_code=204, tags=["servers"])
def delete_server(server_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        srv_svc.delete_server(tx, ctx, server_id)


@router.post("/servers/{server_id}/token/regenerate", tags=["servers"])
def regenerate(server_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return {"token": srv_svc.regenerate_token(tx, ctx, server_id)}


def _range(t_from: Optional[int], t_to: Optional[int], default_ms: int = 3600_000):
    now = int(datetime.now().timestamp() * 1000)
    t_to = t_to or now
    return (t_from or t_to - default_ms), t_to


@router.get("/servers/{server_id}/metrics", tags=["metrics"])
def server_metrics(server_id: str, metric: str = Query(..., pattern="^(cpu|memory|disk|swap|netIn|netOut)$"), from_: Optional[int] = Query(None, alias="from"), to: Optional[int] = None,
                   points: int = 60, ctx: Ctx = Depends(viewer)):
    a, b = _range(from_, to)
    with db.tx() as tx:
        return srv_svc.series(tx, ctx.workspace_id, server_id, metric, a, b, points)


@router.get("/metrics/fleet", tags=["metrics"])
def fleet_metrics(metric: str = Query(..., pattern="^(cpu|memory|disk|swap|netIn|netOut)$"), from_: Optional[int] = Query(None, alias="from"), to: Optional[int] = None,
                  points: int = 60, server_ids: Optional[str] = None, ctx: Ctx = Depends(viewer)):
    a, b = _range(from_, to)
    ids = [i for i in (server_ids or "").split(",") if i] or None
    with db.tx() as tx:
        return srv_svc.fleet_series(tx, ctx.workspace_id, metric, a, b, points, ids)


@router.get("/servers/{server_id}/snapshot", tags=["metrics"])
def server_snapshot(server_id: str, ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return srv_svc.snapshot(tx, ctx.workspace_id, server_id)


@router.get("/servers/{server_id}/logs", tags=["metrics"])
def server_logs(server_id: str, level: Optional[str] = Query(None, pattern="^(INFO|WARNING|ERROR|CRITICAL)$"), q: Optional[str] = Query(None, max_length=100), limit: int = 100, offset: int = 0, ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return srv_svc.logs(tx, ctx.workspace_id, server_id, level, q, limit, offset)


# ---------------- alerts ----------------
@router.get("/alerts", tags=["alerts"])
def list_alerts(days: int = Query(30, ge=1, le=365), ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return alert_svc.list_alerts(tx, ctx.workspace_id, days)


@router.post("/alerts/bulk", tags=["alerts"])
def bulk_alerts(d: S.BulkIn, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        return {"updated": alert_svc.bulk(tx, ctx, d.ids, d.action)}


@router.post("/alerts/simulate", tags=["alerts"])
def simulate(d: S.SimulateIn, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        a, suppressed = alert_svc.simulate(tx, ctx, d.serverId)
    if not suppressed:
        alert_svc.dispatch(ctx.workspace_id, [a])
    from ..services.common import alert_out
    return {"alert": alert_out(a), "suppressed": suppressed}


@router.post("/alerts/{alert_id}/ack", tags=["alerts"])
def ack(alert_id: str, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        return alert_svc.set_status(tx, ctx, alert_id, "ack")


@router.post("/alerts/{alert_id}/resolve", tags=["alerts"])
def resolve(alert_id: str, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        return alert_svc.set_status(tx, ctx, alert_id, "resolve")


@router.post("/alerts/{alert_id}/unsuppress", tags=["alerts"])
def unsuppress(alert_id: str, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        ended, notify = sup_svc.unsuppress_alert(tx, ctx, alert_id)
    alert_svc.dispatch(ctx.workspace_id, notify)
    return {"ended": ended}


# ---------------- policies ----------------
@router.get("/policies", tags=["policies"])
def list_policies(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return pol_svc.list_policies(tx, ctx.workspace_id)


@router.post("/policies", status_code=201, tags=["policies"])
def create_policy(d: S.PolicyIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        p, notify = pol_svc.save_policy(tx, ctx, d)
    alert_svc.dispatch(ctx.workspace_id, notify)
    return {"policy": p, "notified": len(notify)}


@router.put("/policies/{policy_id}", tags=["policies"])
def update_policy(policy_id: str, d: S.PolicyIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        p, notify = pol_svc.save_policy(tx, ctx, d, policy_id)
    alert_svc.dispatch(ctx.workspace_id, notify)
    return {"policy": p, "notified": len(notify)}


@router.delete("/policies/{policy_id}", status_code=204, tags=["policies"])
def delete_policy(policy_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        notify = pol_svc.delete_policy(tx, ctx, policy_id)
    alert_svc.dispatch(ctx.workspace_id, notify)


# ---------------- suppressions ----------------
@router.get("/suppressions", tags=["suppression"])
def list_suppressions(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return sup_svc.list_all(tx, ctx.workspace_id)


@router.post("/suppressions", status_code=201, tags=["suppression"])
def create_suppression(d: S.SuppressionIn, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        return sup_svc.create(tx, ctx, d)


@router.post("/suppressions/{sup_id}/end", tags=["suppression"])
def end_suppression(sup_id: str, ctx: Ctx = Depends(operator)):
    with db.tx() as tx:
        notify = sup_svc.end(tx, ctx, sup_id)
    alert_svc.dispatch(ctx.workspace_id, notify)
    return {"ok": True}


# ---------------- integrations & routing ----------------
@router.get("/integrations", tags=["integrations"])
def list_integrations(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return int_svc.list_integrations(tx, ctx.workspace_id)


@router.post("/integrations", status_code=201, tags=["integrations"])
def create_integration(d: S.IntegrationIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return int_svc.save(tx, ctx, d)


@router.post("/integrations/test", tags=["integrations"])
def test_draft(d: S.IntegrationIn, ctx: Ctx = Depends(admin)):
    return int_svc.test_draft(ctx, d)


@router.put("/integrations/{integration_id}", tags=["integrations"])
def update_integration(integration_id: str, d: S.IntegrationIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return int_svc.save(tx, ctx, d, integration_id)


@router.delete("/integrations/{integration_id}", status_code=204, tags=["integrations"])
def delete_integration(integration_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        int_svc.delete(tx, ctx, integration_id)


@router.post("/integrations/{integration_id}/test", tags=["integrations"])
def test_saved(integration_id: str, ctx: Ctx = Depends(admin)):
    return int_svc.test_saved(ctx, integration_id)


@router.get("/routing-rules", tags=["integrations"])
def list_rules(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return int_svc.list_rules(tx, ctx.workspace_id)


@router.post("/routing-rules", status_code=201, tags=["integrations"])
def create_rule(d: S.RuleIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return int_svc.save_rule(tx, ctx, d)


@router.put("/routing-rules/{rule_id}", tags=["integrations"])
def update_rule(rule_id: str, d: S.RuleIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return int_svc.save_rule(tx, ctx, d, rule_id)


@router.delete("/routing-rules/{rule_id}", status_code=204, tags=["integrations"])
def delete_rule(rule_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        int_svc.delete_rule(tx, ctx, rule_id)


@router.get("/deliveries", tags=["integrations"])
def deliveries(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return int_svc.list_deliveries(tx, ctx.workspace_id)


@router.get("/events", tags=["dashboard"])
def events(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return int_svc.list_events(tx, ctx.workspace_id)


# ---------------- reports ----------------
@router.get("/reports/{rtype}", tags=["reports"])
def report(rtype: str, from_: int = Query(..., alias="from"), to: int = Query(...), ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return report_svc.build(tx, ctx.workspace_id, rtype, from_, to)


# ---------------- settings / org ----------------
@router.get("/settings", tags=["settings"])
def get_settings(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return set_svc.get_settings(tx, ctx.workspace_id)


@router.put("/settings", tags=["settings"])
def put_settings(d: S.SettingsIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return set_svc.save_settings(tx, ctx, d.model_dump(exclude_unset=True, exclude_none=True))


@router.get("/members", tags=["settings"])
def members(ctx: Ctx = Depends(viewer)):
    with db.tx() as tx:
        return set_svc.list_members(tx, ctx.workspace_id)


@router.post("/members", status_code=201, tags=["settings"])
def invite(d: S.InviteIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        set_svc.invite(tx, ctx, d.email, d.role)
        return set_svc.list_members(tx, ctx.workspace_id)


@router.patch("/members/{member_id}", tags=["settings"])
def member_role(member_id: str, d: S.RoleIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        set_svc.set_role(tx, ctx, member_id, d.role)
        return set_svc.list_members(tx, ctx.workspace_id)


@router.delete("/members/{member_id}", status_code=204, tags=["settings"])
def member_remove(member_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        set_svc.remove(tx, ctx, member_id)


@router.get("/tokens", tags=["settings"])
def tokens(ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return set_svc.list_tokens(tx, ctx.workspace_id)


@router.post("/tokens", status_code=201, tags=["settings"])
def create_token(d: S.TokenIn, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return {"token": set_svc.create_token(tx, ctx, d.name, d.scopes)}  # shown once


@router.delete("/tokens/{token_id}", status_code=204, tags=["settings"])
def revoke_token(token_id: str, ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        set_svc.revoke_token(tx, ctx, token_id)


@router.get("/audit-log", tags=["settings"])
def audit_log(q: Optional[str] = Query(None, max_length=100), ctx: Ctx = Depends(admin)):
    with db.tx() as tx:
        return set_svc.list_audit(tx, ctx.workspace_id, q)
