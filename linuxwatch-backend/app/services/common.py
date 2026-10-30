"""Shared helpers: timestamps, audit log, events, serialization to the JSON shape the web UI consumes (camelCase, epoch-ms)."""
from datetime import datetime, timezone

from ..realtime import hub


def ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


def from_ms(v):
    return datetime.fromtimestamp(v / 1000, tz=timezone.utc)


def audit(tx, ctx, action: str, detail: str = ""):
    tx.x("INSERT INTO audit_log (workspace_id, user_name, action, detail, ip) VALUES (%s,%s,%s,%s,%s)", (ctx.workspace_id, ctx.user_name, action, detail[:500], ctx.ip))


def add_event(tx, ws_id: str, type_: str, severity: str, title: str, body: str = "", alert_id=None, server_id=None):
    tx.x("INSERT INTO events (workspace_id, type, severity, title, body, alert_id, server_id) VALUES (%s,%s,%s,%s,%s,%s,%s::uuid)", (ws_id, type_, severity, title[:200], body[:500], alert_id, server_id))
    hub.publish(ws_id, {"type": "event", "severity": severity, "title": title, "body": body, "serverId": server_id, "alertId": alert_id})


def fmt_num(v, d=0):
    return f"{v:.{d}f}"


def server_out(r: dict, services: list, availability: float = 100.0) -> dict:
    return {
        "id": r["id"], "name": r["name"], "hostname": r["hostname"], "ip": r["ip"], "os": r["os"], "osVersion": r["os_version"], "kernel": r["kernel"],
        "agentVersion": r["agent_version"], "client": r["client"], "env": r["env"], "region": r["region"], "tags": r["tags"], "description": r["description"],
        "cpu": r["cpu"], "mem": r["mem"], "disk": r["disk"], "netIn": r["net_in"], "netOut": r["net_out"], "swapPct": r["swap_pct"], "cores": r["cores"],
        "ramTotalGb": r["ram_total_gb"], "diskTotalGb": r["disk_total_gb"], "swapTotalGb": r["swap_total_gb"], "uptimeSec": r["uptime_sec"],
        "agentOnline": r["agent_online"], "lastHeartbeat": ms(r["last_heartbeat"]), "monitoring": r["monitoring"], "tokenPrefix": r["token_prefix"],
        "createdAt": ms(r["created_at"]), "pending": r["pending"], "availability": round(availability, 3), "sample": False,
        "services": [{"name": s["name"], "unit": s["unit"], "monitored": s["monitored"], "status": s["status"], "since": ms(s["since"])} for s in services],
    }


def alert_out(a: dict) -> dict:
    num = a["value_num"]
    return {
        "id": a["id"], "serverId": a["server_id"], "serverName": a["server_name"], "client": a["client"], "module": a["module"], "key": a["key"], "metric": a["metric"],
        "value": num if num is not None else a["value"], "unit": a["unit"], "threshold": _num_or_str(a["threshold"]), "severity": a["severity"], "status": a["status"],
        "triggeredAt": ms(a["triggered_at"]), "resolvedAt": ms(a["resolved_at"]), "ackBy": a["ack_by"], "resolvedBy": a["resolved_by"], "simulated": a["simulated"],
    }


def _num_or_str(s):
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return s


def policy_out(p: dict) -> dict:
    return {"id": p["id"], "name": p["name"], "description": p["description"], "isDefault": p["is_default"], "enabled": p["enabled"], "assignments": p["assignments"], **p["config"]}


def suppression_out(s: dict) -> dict:
    return {"id": s["id"], "target": s["target"], "targetLabel": s["target_label"], "modules": s["modules"], "durationId": s["duration_id"], "startedAt": ms(s["started_at"]),
            "expiresAt": ms(s["expires_at"]), "reason": s["reason"], "createdBy": s["created_by"], "endedAt": ms(s["ended_at"]), "endedBy": s["ended_by"]}


def integration_out(i: dict, secret_keys: list) -> dict:
    return {"id": i["id"], "type": i["type"], "name": i["name"], "enabled": i["enabled"], "status": i["status"], "lastSuccess": ms(i["last_success"]), "lastFailure": ms(i["last_failure"]),
            "config": i["config"], "secrets": {k: True for k in secret_keys}}  # secret VALUES never leave the server


def rule_out(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "severities": r["severities"], "modules": r["modules"], "scope": {"type": r["scope_type"], "value": r["scope_value"]},
            "integrationIds": r["integration_ids"], "enabled": r["enabled"]}
