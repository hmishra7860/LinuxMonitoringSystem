"""Alert suppression. Suppression NEVER stops metric collection: it only changes alert status / holds notifications back."""
from fastapi import HTTPException

from ..engine.policy import DURATIONS, MODULES, suppression_matches
from . import alerts as alert_svc
from .common import audit, suppression_out

LABEL = {"server": "", "client": "Client: ", "env": "Environment: ", "region": "Region: "}


def _label(tx, ws_id, kind, val):
    if kind == "server":
        s = tx.one("SELECT name FROM servers WHERE id::text = %s AND workspace_id = %s", (val, ws_id))
        if not s:
            raise HTTPException(404, "Server not found")
        return s["name"]
    if kind == "client" and not tx.one("SELECT 1 FROM servers WHERE workspace_id = %s AND client = %s", (ws_id, val)):
        raise HTTPException(404, "Client not found")
    if kind == "env" and val not in ("Production", "Development", "Testing"):
        raise HTTPException(422, "Unknown environment")
    return LABEL[kind] + val


def list_all(tx, ws_id):
    sups = tx.q("SELECT * FROM suppressions WHERE workspace_id = %s ORDER BY started_at DESC LIMIT 500", (ws_id,))
    audit_rows = tx.q("SELECT * FROM suppression_audit WHERE workspace_id = %s ORDER BY ts DESC LIMIT 500", (ws_id,))
    from .common import ms
    return {"suppressions": [suppression_out(s) for s in sups],
            "audit": [{"id": a["id"], "ts": ms(a["ts"]), "action": a["action"], "suppressionId": a["suppression_id"], "user": a["user_name"], "details": a["details"]} for a in audit_rows]}


def create(tx, ctx, d):
    kind, _, val = d.target.partition(":")
    if kind not in LABEL and kind != "all":
        raise HTTPException(422, "target must be server:<id>, client:<name>, env:<name>, region:<name> or all")
    bad = [m for m in d.modules if m != "all" and m not in MODULES]
    if bad or not d.modules:
        raise HTTPException(422, "Choose at least one valid monitoring module")
    if d.durationId not in DURATIONS:
        raise HTTPException(422, "Unknown duration")
    label = "All servers" if kind == "all" else _label(tx, ctx.workspace_id, kind, val)
    minutes = DURATIONS[d.durationId]
    s = tx.one(
        "INSERT INTO suppressions (id, workspace_id, target, target_label, modules, duration_id, expires_at, reason, created_by) "
        "VALUES ('SUP-' || nextval('suppression_seq'), %s, %s, %s, %s, %s, CASE WHEN %s::float8 IS NULL THEN NULL ELSE now() + (%s::float8 * interval '1 minute') END, %s, %s) RETURNING *",
        (ctx.workspace_id, d.target, label, d.modules, d.durationId, minutes, minutes, d.reason.strip(), ctx.user_name))
    tx.x("INSERT INTO suppression_audit (workspace_id, action, suppression_id, user_name, details) VALUES (%s,'suppress',%s,%s,%s)",
         (ctx.workspace_id, s["id"], ctx.user_name, f"{label} · {', '.join(d.modules)} · {d.durationId}" + (f" — {d.reason.strip()}" if d.reason.strip() else "")))
    audit(tx, ctx, "suppression.create", f"Suppressed {', '.join(d.modules)} on {label} ({d.durationId})")
    alert_svc.reapply_suppressions(tx, ctx.workspace_id)
    return suppression_out(s)


def end(tx, ctx, sup_id):
    s = tx.one("UPDATE suppressions SET ended_at = now(), ended_by = %s WHERE id = %s AND workspace_id = %s AND ended_at IS NULL RETURNING *", (ctx.user_name, sup_id, ctx.workspace_id))
    if not s:
        raise HTTPException(404, "Active suppression not found")
    tx.x("INSERT INTO suppression_audit (workspace_id, action, suppression_id, user_name, details) VALUES (%s,'unsuppress',%s,%s,%s)",
         (ctx.workspace_id, sup_id, ctx.user_name, f"{s['target_label']} · {', '.join(s['modules'])} — manually re-enabled"))
    audit(tx, ctx, "suppression.end", f"Re-enabled alerts for {s['target_label']}")
    return alert_svc.reapply_suppressions(tx, ctx.workspace_id)  # alerts that become active again get notified


def unsuppress_alert(tx, ctx, alert_id):
    a = tx.one("SELECT a.*, s.env AS s_env, s.region AS s_region FROM alerts a JOIN servers s ON s.id = a.server_id WHERE a.id = %s AND a.workspace_id = %s", (alert_id, ctx.workspace_id))
    if not a:
        raise HTTPException(404, "Alert not found")
    srv = {"id": a["server_id"], "client": a["client"], "env": a["s_env"], "region": a["s_region"]}
    now = alert_svc.db_now(tx)
    ended, notify = 0, []
    for s in alert_svc.load_active_suppressions(tx, ctx.workspace_id):
        if suppression_matches(s, srv, a["module"], now):
            notify += end(tx, ctx, s["id"])
            ended += 1
    return ended, notify
