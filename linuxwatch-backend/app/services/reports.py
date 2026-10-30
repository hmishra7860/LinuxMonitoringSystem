"""Report generation (JSON; the UI exports CSV/PDF). All figures come from stored metrics and alert history."""
from fastapi import HTTPException

from ..engine.policy import effective_policy
from .common import from_ms, ms

TYPES = ("availability", "cpu", "memory", "disk", "alerts", "services", "incidents")


def _fmt_dur(sec):
    sec = int(max(0, sec))
    if sec < 60:
        return f"{sec}s"
    m = sec // 60
    if m < 60:
        return f"{m}m"
    h, m = divmod(m, 60)
    if h < 24:
        return f"{h}h {m}m"
    return f"{h // 24}d {h % 24}h"


def _pct(v):
    return f"{(v or 0):.1f}%"


def build(tx, ws_id, rtype, t_from, t_to):
    if rtype not in TYPES:
        raise HTTPException(404, "Unknown report type")
    if t_to <= t_from:
        raise HTTPException(400, "'to' must be after 'from'")
    f, t = from_ms(t_from), from_ms(t_to)
    base = {"range": {"from": t_from, "to": t_to, "days": max(1, round((t_to - t_from) / 86400000))}}
    policies = tx.q("SELECT * FROM policies WHERE workspace_id = %s", (ws_id,))

    if rtype == "availability":
        rows = tx.q(
            "SELECT s.name, s.client, s.env, s.agent_online, "
            "COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(d.ended_at, %s), %s) - GREATEST(d.started_at, %s)))), 0) AS down, "
            "count(d.id) AS incidents FROM servers s LEFT JOIN server_downtime d ON d.server_id = s.id AND d.started_at < %s AND COALESCE(d.ended_at, %s) > %s "
            "WHERE s.workspace_id = %s GROUP BY s.id ORDER BY s.name", (t, t, f, t, t, f, ws_id))
        period = (t_to - t_from) / 1000
        out = [{"server": r["name"], "client": r["client"], "env": r["env"], "availability": _pct(100 - 100 * r["down"] / period), "downtime": _fmt_dur(r["down"]), "incidents": r["incidents"], "state": "Online" if r["agent_online"] else "Offline"} for r in rows]
        avg = sum(100 - 100 * r["down"] / period for r in rows) / len(rows) if rows else 0
        return {**base, "title": "Server availability", "columns": [["server", "Server"], ["client", "Client"], ["env", "Environment"], ["availability", "Availability"], ["downtime", "Downtime"], ["incidents", "Incidents"], ["state", "Current state"]],
                "rows": out, "summary": [["Fleet availability", _pct(avg)], ["Servers", len(rows)], ["Offline now", sum(1 for r in rows if not r["agent_online"])]]}

    if rtype in ("cpu", "memory"):
        col = "cpu" if rtype == "cpu" else "mem"
        rows = tx.q(
            f"SELECT s.id, s.name, s.client, s.env, s.region, s.tags, avg(m.{col}) AS avg, percentile_cont(0.95) WITHIN GROUP (ORDER BY m.{col}) AS p95, max(m.{col}) AS peak "
            f"FROM servers s JOIN metrics m ON m.server_id = s.id AND m.ts >= %s AND m.ts <= %s WHERE s.workspace_id = %s GROUP BY s.id ORDER BY s.name", (f, t, ws_id))
        out = []
        for r in rows:
            th = effective_policy(r, policies)["config"]["cpu" if rtype == "cpu" else "memory"]
            out.append({"server": r["name"], "client": r["client"], "avg": _pct(r["avg"]), "p95": _pct(r["p95"]), "max": _pct(r["peak"]), "warn": f"{th['warn']}%",
                        "status": "Critical" if r["peak"] >= th["crit"] else "Warning" if r["peak"] >= th["warn"] else "OK"})
        return {**base, "title": "CPU utilization" if rtype == "cpu" else "RAM utilization", "columns": [["server", "Server"], ["client", "Client"], ["avg", "Average"], ["p95", "P95"], ["max", "Peak"], ["warn", "Warn threshold"], ["status", "Worst status"]],
                "rows": out, "summary": [["Servers reporting", len(out)], ["Above warning", sum(1 for o in out if o["status"] != "OK")]]}

    if rtype == "disk":
        rows = tx.q(
            "SELECT s.name, s.disk, s.disk_total_gb, (SELECT disk FROM metrics WHERE server_id = s.id AND ts >= %s ORDER BY ts LIMIT 1) AS first, "
            "(SELECT EXTRACT(EPOCH FROM (max(ts) - min(ts))) / 86400 FROM metrics WHERE server_id = s.id AND ts >= %s) AS span_days "
            "FROM servers s WHERE s.workspace_id = %s AND s.agent_online ORDER BY s.name", (f, f, ws_id))
        out = []
        for r in rows:
            used = r["disk_total_gb"] * r["disk"] / 100
            growth = ((r["disk"] - r["first"]) / r["span_days"]) if r["first"] is not None and r["span_days"] and r["span_days"] > 0 else 0
            out.append({"server": r["name"], "capacity": f"{r['disk_total_gb']:.0f} GB", "used": f"{used:.0f} GB", "free": f"{r['disk_total_gb'] - used:.0f} GB", "usage": _pct(r["disk"]),
                        "full": f"{round((100 - r['disk']) / growth)} days" if growth > 0.01 else "not growing"})
        return {**base, "title": "Disk capacity", "columns": [["server", "Server"], ["capacity", "Capacity"], ["used", "Used"], ["free", "Free"], ["usage", "Usage"], ["full", "Est. time to full"]],
                "rows": out, "summary": [["Servers", len(out)], ["Over 80% used", sum(1 for r in rows if r["disk"] >= 80)]]}

    if rtype == "alerts":
        rows = tx.q(
            "SELECT server_name, client, count(*) FILTER (WHERE severity = 'critical') AS crit, count(*) FILTER (WHERE severity = 'warning') AS warn, "
            "count(*) FILTER (WHERE status = 'resolved') AS resolved, count(*) FILTER (WHERE status <> 'resolved') AS open "
            "FROM alerts WHERE workspace_id = %s AND triggered_at >= %s AND triggered_at <= %s GROUP BY server_name, client ORDER BY server_name", (ws_id, f, t))
        out = [{"server": r["server_name"], "client": r["client"], "critical": r["crit"], "warning": r["warn"], "resolved": r["resolved"], "open": r["open"]} for r in rows]
        return {**base, "title": "Alert summary", "columns": [["server", "Server"], ["client", "Client"], ["critical", "Critical"], ["warning", "Warning"], ["resolved", "Resolved"], ["open", "Still open"]],
                "rows": out, "summary": [["Total alerts", sum(o["critical"] + o["warning"] for o in out)], ["Critical", sum(o["critical"] for o in out)], ["Resolved", sum(o["resolved"] for o in out)]]}

    if rtype == "services":
        rows = tx.q(
            "SELECT s.name AS server, sv.name AS service, sv.status, "
            "(SELECT count(*) FROM alerts a WHERE a.server_id = s.id AND a.key = 'service:' || sv.name AND a.triggered_at >= %s AND a.triggered_at <= %s) AS failures, "
            "(SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(a.resolved_at, %s), %s) - GREATEST(a.triggered_at, %s)))), 0) FROM alerts a WHERE a.server_id = s.id AND a.key = 'service:' || sv.name AND a.triggered_at <= %s AND COALESCE(a.resolved_at, %s) >= %s) AS down "
            "FROM server_services sv JOIN servers s ON s.id = sv.server_id WHERE s.workspace_id = %s AND sv.monitored ORDER BY s.name, sv.name", (f, t, t, t, f, t, t, f, ws_id))
        period = (t_to - t_from) / 1000
        out = [{"server": r["server"], "service": r["service"], "uptime": _pct(100 - 100 * r["down"] / period), "failures": r["failures"], "state": r["status"]} for r in rows]
        return {**base, "title": "Service availability", "columns": [["server", "Server"], ["service", "Service"], ["uptime", "Uptime"], ["failures", "Failures"], ["state", "Current state"]],
                "rows": out, "summary": [["Services monitored", len(out)], ["Currently failing", sum(1 for o in out if o["state"] in ("failed", "inactive"))]]}

    rows = tx.q("SELECT * FROM alerts WHERE workspace_id = %s AND triggered_at >= %s AND triggered_at <= %s ORDER BY triggered_at DESC LIMIT 5000", (ws_id, f, t))
    out = [{"id": a["id"], "server": a["server_name"], "metric": a["metric"], "severity": a["severity"], "triggered": a["triggered_at"].strftime("%Y-%m-%d %H:%M"),
            "duration": _fmt_dur(((a["resolved_at"] or from_ms(t_to)) - a["triggered_at"]).total_seconds()), "status": a["status"], "ack": a["ack_by"] or "—"} for a in rows]
    return {**base, "title": "Historical incidents", "columns": [["id", "Alert ID"], ["server", "Server"], ["metric", "Metric"], ["severity", "Severity"], ["triggered", "Triggered (UTC)"], ["duration", "Duration"], ["status", "Status"], ["ack", "Acknowledged by"]],
            "rows": out, "summary": [["Incidents", len(out)], ["Critical", sum(1 for o in out if o["severity"] == "critical")]]}
