"""Alert lifecycle: evaluate policies against fresh metrics, apply suppression, route + deliver notifications."""
import logging
import secrets as _secrets
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException

from ..db import db
from ..engine import notify
from ..engine.policy import (NETWORK_DURATION_MIN, effective_policy, is_suppressed, route, sustained_severity, severity_for)
from ..realtime import hub
from ..security import decrypt_json
from .common import add_event, alert_out, audit

log = logging.getLogger("linuxwatch.alerts")
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="lw-notify")

METRIC_COLUMN = {"cpu": "cpu", "memory": "mem", "disk": "disk", "net_in": "net_in", "net_out": "net_out"}


# ---------- loading ----------
def load_policies(tx, ws_id):
    return tx.q("SELECT * FROM policies WHERE workspace_id = %s", (ws_id,))


def load_active_suppressions(tx, ws_id):
    return tx.q("SELECT * FROM suppressions WHERE workspace_id = %s AND ended_at IS NULL AND (expires_at IS NULL OR expires_at > now())", (ws_id,))


def db_now(tx):
    return tx.one("SELECT now() AS n")["n"]


# ---------- check computation ----------
def _window(tx, server_id, column, minutes):
    return tx.one(
        f"SELECT min({column}) AS mn, count(*) AS n, COALESCE(EXTRACT(EPOCH FROM (now() - min(ts))), 0) AS age "
        f"FROM metrics WHERE server_id = %s AND ts > now() - (%s::float8 * interval '1 minute') AND {column} IS NOT NULL",
        (server_id, float(minutes)),
    )


def compute_checks(tx, server, services, snapshot, cfg):
    mods = (server["monitoring"] or {}).get("modules", {})
    interval = float((server["monitoring"] or {}).get("interval", 30))
    checks = []

    def add(key, module, metric, value, unit, sev, threshold):
        checks.append({"key": key, "module": module, "metric": metric, "value": value, "unit": unit, "sev": sev if mods.get(_mod_flag(module), True) else None, "threshold": threshold})

    for module, column, label, current in (("cpu", "cpu", "CPU usage", server["cpu"]), ("memory", "mem", "Memory usage", server["mem"]), ("disk", "disk", "Disk usage", server["disk"])):
        t = cfg[module]
        w = _window(tx, server["id"], column, t["duration"])
        sev = sustained_severity(w["mn"], w["n"], w["age"], t["warn"], t["crit"], t["duration"], interval)
        add(module, module, label, round(current, 1), "%", sev, t["crit"] if sev == "critical" else t["warn"])

    net = cfg["network"]
    for key, column, label, limit, current in (("network:in", "net_in", "Network inbound", net["inMbps"], server["net_in"]), ("network:out", "net_out", "Network outbound", net["outMbps"], server["net_out"])):
        w = _window(tx, server["id"], column, NETWORK_DURATION_MIN)
        sev = sustained_severity(w["mn"], w["n"], w["age"], limit * 0.8, limit, NETWORK_DURATION_MIN, interval)
        add(key, "network", label, round(current, 1), "Mbps", sev, limit if sev == "critical" else limit * 0.8)
    errs_per_min = sum(i.get("errors", 0) + i.get("drops", 0) for i in (snapshot or {}).get("interfaces", [])) * 60.0 / interval
    sev = severity_for(errs_per_min, max(1, net["errors"] * 0.5), net["errors"]) if net["errors"] > 0 else None
    add("network:errors", "network", "Network packet errors", round(errs_per_min, 1), "/min", sev, net["errors"] if sev == "critical" else net["errors"] * 0.5)

    fail_after = cfg["service"]["failAfter"]
    for sv in services:
        if not sv["monitored"]:
            continue
        bad = sv["status"] in ("failed", "inactive")
        sustained = bad and sv["bad_since"] is not None and (db_now(tx) - sv["bad_since"]).total_seconds() >= fail_after * 60
        add("service:" + sv["name"], "services", f"Service {sv['name']}", sv["status"], "", "critical" if sustained else None, cfg["service"]["expected"])
    return checks


def _mod_flag(module):  # monitoring.modules flag that controls a check
    return {"memory": "memory", "cpu": "cpu", "disk": "disk", "network": "network", "services": "services"}.get(module, module)


# ---------- creation / resolution primitives ----------
def insert_alert(tx, server, check, status, simulated=False):
    value = check["value"]
    return tx.one(
        "INSERT INTO alerts (id, workspace_id, server_id, server_name, client, module, key, metric, value, value_num, unit, threshold, severity, status, simulated) "
        "VALUES ('ALT-' || nextval('alert_seq'), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (server_id, key) WHERE status <> 'resolved' AND NOT simulated DO NOTHING RETURNING *",
        (server["workspace_id"], server["id"], server["name"], server["client"], check["module"], check["key"], check["metric"], str(value),
         float(value) if isinstance(value, (int, float)) else None, check["unit"], str(check["threshold"]), check["sev"], status, simulated),
    )


def resolve_alert_row(tx, alert_id, by="auto"):
    return tx.one("UPDATE alerts SET status = 'resolved', resolved_at = now(), resolved_by = %s WHERE id = %s AND status <> 'resolved' RETURNING *", (by, alert_id))


# ---------- evaluation ----------
def evaluate_server(tx, server) -> list:
    """Evaluate one server after fresh data. Returns alerts that must be notified (newly active or escalated)."""
    ws = server["workspace_id"]
    pol = effective_policy(server, load_policies(tx, ws))
    sups = load_active_suppressions(tx, ws)
    now = db_now(tx)
    services = tx.q("SELECT * FROM server_services WHERE server_id = %s", (server["id"],))
    snapshot = tx.one("SELECT interfaces FROM server_snapshots WHERE server_id = %s", (server["id"],))
    checks = compute_checks(tx, server, services, snapshot, pol["config"])
    open_alerts = {a["key"]: a for a in tx.q("SELECT * FROM alerts WHERE server_id = %s AND status <> 'resolved' AND NOT simulated", (server["id"],))}
    notify_list, changed, produced = [], False, set()
    for c in checks:
        produced.add(c["key"])
        ex = open_alerts.get(c["key"])
        if c["sev"]:
            if ex is None:
                suppressed = is_suppressed(sups, server, c["module"], now)
                a = insert_alert(tx, server, c, "suppressed" if suppressed else "active")
                if a:
                    changed = True
                    if not suppressed:
                        add_event(tx, ws, "alert", a["severity"], f"{a['severity'].capitalize()}: {a['metric']} on {a['server_name']}", f"Current {a['value']}{a['unit']}, threshold {a['threshold']}{a['unit']}", a["id"], server["id"])
                        notify_list.append(a)
            else:
                escalated = ex["severity"] == "warning" and c["sev"] == "critical"
                a = tx.one("UPDATE alerts SET severity = %s, threshold = %s, value = %s, value_num = %s WHERE id = %s RETURNING *",
                           (c["sev"], str(c["threshold"]), str(c["value"]), float(c["value"]) if isinstance(c["value"], (int, float)) else None, ex["id"]))
                if escalated and a["status"] != "suppressed":
                    add_event(tx, ws, "alert", "critical", f"Escalated to critical: {a['metric']} on {a['server_name']}", f"Current {a['value']}{a['unit']}", a["id"], server["id"])
                    notify_list.append(a)
        elif ex is not None:
            resolve_alert_row(tx, ex["id"])
            changed = True
    for key, ex in open_alerts.items():  # alerts whose check no longer exists (service unmonitored/removed)
        if key not in produced and key != "agent:offline":
            resolve_alert_row(tx, ex["id"])
            changed = True
    if changed or notify_list:
        _after_commit_publish(ws, {"type": "alerts.changed", "serverId": server["id"]})
    return notify_list


def evaluate_workspace(tx, ws_id) -> list:
    out = []
    for s in tx.q("SELECT * FROM servers WHERE workspace_id = %s AND agent_online", (ws_id,)):
        out.extend(evaluate_server(tx, s))
    return out


def _after_commit_publish(ws_id, msg):
    hub.publish(ws_id, msg)  # fire-and-forget; clients re-fetch on 'alerts.changed'


# ---------- suppression re-application ----------
def reapply_suppressions(tx, ws_id) -> list:
    """Sync open alerts with active suppressions. Returns alerts that became active again (never notified while suppressed)."""
    sups = load_active_suppressions(tx, ws_id)
    now = db_now(tx)
    rows = tx.q("SELECT a.*, s.env AS s_env, s.region AS s_region, s.tags AS s_tags FROM alerts a JOIN servers s ON s.id = a.server_id WHERE a.workspace_id = %s AND a.status <> 'resolved'", (ws_id,))
    to_notify = []
    for a in rows:
        srv = {"id": a["server_id"], "client": a["client"], "env": a["s_env"], "region": a["s_region"], "tags": a["s_tags"]}
        should = is_suppressed(sups, srv, a["module"], now)
        if should and a["status"] != "suppressed":
            tx.x("UPDATE alerts SET prev_status = status, status = 'suppressed' WHERE id = %s", (a["id"],))
        elif not should and a["status"] == "suppressed":
            new = a["prev_status"] if a["prev_status"] in ("active", "acknowledged") else "active"
            upd = tx.one("UPDATE alerts SET status = %s, prev_status = NULL WHERE id = %s RETURNING *", (new, a["id"]))
            if new == "active":
                to_notify.append(upd)
    hub.publish(ws_id, {"type": "alerts.changed"})
    return to_notify


# ---------- user actions ----------
def list_alerts(tx, ws_id, days=30):
    rows = tx.q("SELECT * FROM alerts WHERE workspace_id = %s AND (status <> 'resolved' OR triggered_at > now() - (%s::float8 * interval '1 day')) ORDER BY triggered_at DESC LIMIT 2000", (ws_id, float(days)))
    return [alert_out(a) for a in rows]


def set_status(tx, ctx, alert_id, action):
    if action == "ack":
        a = tx.one("UPDATE alerts SET status = 'acknowledged', ack_by = %s WHERE id = %s AND workspace_id = %s AND status = 'active' RETURNING *", (ctx.user_name, alert_id, ctx.workspace_id))
    else:
        a = tx.one("UPDATE alerts SET status = 'resolved', resolved_at = now(), resolved_by = %s WHERE id = %s AND workspace_id = %s AND status <> 'resolved' RETURNING *", (ctx.user_name, alert_id, ctx.workspace_id))
    if not a:
        raise HTTPException(409, "Alert not found or not in a state that allows this action")
    audit(tx, ctx, "alert.acknowledge" if action == "ack" else "alert.resolve", f"{'Acknowledged' if action == 'ack' else 'Resolved'} {alert_id}")
    hub.publish(ctx.workspace_id, {"type": "alerts.changed"})
    return alert_out(a)


def bulk(tx, ctx, ids, action):
    n = 0
    for i in ids:
        try:
            set_status(tx, ctx, i, action)
            n += 1
        except HTTPException:
            pass
    return n


def simulate(tx, ctx, server_id):
    s = tx.one("SELECT * FROM servers WHERE id = %s AND workspace_id = %s", (server_id, ctx.workspace_id))
    if not s:
        raise HTTPException(404, "Server not found")
    pol = effective_policy(s, load_policies(tx, ctx.workspace_id))
    check = {"key": "sim:" + _secrets.token_hex(4), "module": "cpu", "metric": "CPU usage (simulated)", "value": 97, "unit": "%", "sev": "critical", "threshold": pol["config"]["cpu"]["crit"]}
    suppressed = is_suppressed(load_active_suppressions(tx, ctx.workspace_id), s, "cpu", db_now(tx))
    a = insert_alert(tx, s, check, "suppressed" if suppressed else "active", simulated=True)
    audit(tx, ctx, "alert.simulate", f"Simulated alert {a['id']} on {s['name']}")
    if not suppressed:
        add_event(tx, ctx.workspace_id, "alert", "critical", f"Critical: {a['metric']} on {a['server_name']}", "Simulated alert", a["id"], s["id"])
    hub.publish(ctx.workspace_id, {"type": "alerts.changed"})
    return a, suppressed


# ---------- notification delivery (worker thread) ----------
def dispatch(ws_id, alerts):
    """Queue notification delivery. Call AFTER the originating transaction has committed."""
    if alerts:
        _pool.submit(_deliver_safe, ws_id, alerts)


def _deliver_safe(ws_id, alerts):
    try:
        deliver(ws_id, alerts)
    except Exception:
        log.exception("notification delivery failed")


def deliver(ws_id, alerts):
    with db.tx() as tx:
        rules = tx.q("SELECT * FROM routing_rules WHERE workspace_id = %s", (ws_id,))
        integrations = tx.q("SELECT * FROM integrations WHERE workspace_id = %s", (ws_id,))
        servers = {s["id"]: s for s in tx.q("SELECT id, env FROM servers WHERE workspace_id = %s", (ws_id,))}
    for a in alerts:
        ctx = notify.alert_context(a, a["server_name"])
        for integ in route(a, servers.get(a["server_id"]), rules, integrations):
            ok, msg = notify.send(integ["type"], integ["config"], decrypt_json(integ["secrets_enc"]), ctx)
            record_delivery(ws_id, integ["id"], "alert", a["id"], ok, notify.summary_line(ctx), None if ok else msg)


def record_delivery(ws_id, integration_id, kind, alert_id, ok, summary, error=None):
    with db.tx() as tx:
        tx.x("INSERT INTO deliveries (workspace_id, integration_id, kind, alert_id, status, summary, error) VALUES (%s, %s::uuid, %s, %s, %s, %s, %s)",
             (ws_id, integration_id, kind, alert_id, "delivered" if ok else "failed", summary[:300], error))
        if integration_id:
            if ok:
                tx.x("UPDATE integrations SET status = 'connected', last_success = now() WHERE id = %s", (integration_id,))
            else:
                tx.x("UPDATE integrations SET status = 'failing', last_failure = now() WHERE id = %s", (integration_id,))
        if not ok:
            add_event(tx, ws_id, "delivery", "critical", "Notification failed", f"{summary[:120]} — {error}"[:300])
    hub.publish(ws_id, {"type": "deliveries.changed"})
