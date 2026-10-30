"""Server registration, listing, editing and read APIs for metrics/logs/snapshots."""
import math
from datetime import timezone

from fastapi import HTTPException

from ..db import J
from ..security import hash_token, new_token
from .common import audit, from_ms, ms, server_out

DEFAULT_MONITORING = {"interval": 30, "modules": {"cpu": True, "memory": True, "disk": True, "network": True, "processes": True, "services": True, "logs": True}}
DEFAULT_SERVICES = [("ssh", "ssh.service", True), ("docker", "docker.service", True), ("nginx", "nginx.service", False), ("postgresql", "postgresql.service", False), ("redis", "redis-server.service", False), ("cron", "cron.service", False)]
METRIC_COL = {"cpu": "cpu", "memory": "mem", "disk": "disk", "swap": "swap", "netIn": "net_in", "netOut": "net_out"}
ORIGIN = 946684800  # 2000-01-01 UTC, matches date_bin origin below


def availability_map(tx, ws_id):
    rows = tx.q(
        "WITH w AS (SELECT now() - interval '30 days' AS start) "
        "SELECT s.id, GREATEST(0, LEAST(100, 100 - 100 * COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(d.ended_at, now()), now()) - GREATEST(d.started_at, (SELECT start FROM w))))), 0) "
        "/ GREATEST(1, EXTRACT(EPOCH FROM (now() - GREATEST(s.created_at, (SELECT start FROM w))))))) AS pct "
        "FROM servers s LEFT JOIN server_downtime d ON d.server_id = s.id AND COALESCE(d.ended_at, now()) > (SELECT start FROM w) "
        "WHERE s.workspace_id = %s GROUP BY s.id", (ws_id,))
    return {r["id"]: float(r["pct"]) for r in rows}


def list_servers(tx, ws_id):
    servers = tx.q("SELECT * FROM servers WHERE workspace_id = %s ORDER BY name", (ws_id,))
    services = {}
    for sv in tx.q("SELECT sv.* FROM server_services sv JOIN servers s ON s.id = sv.server_id WHERE s.workspace_id = %s ORDER BY sv.name", (ws_id,)):
        services.setdefault(sv["server_id"], []).append(sv)
    avail = availability_map(tx, ws_id)
    return [server_out(s, services.get(s["id"], []), avail.get(s["id"], 100.0)) for s in servers]


def _get(tx, ws_id, server_id):
    s = tx.one("SELECT * FROM servers WHERE id = %s AND workspace_id = %s", (server_id, ws_id)) if _is_uuid(server_id) else None
    if not s:
        raise HTTPException(404, "Server not found")
    return s


def _is_uuid(v):
    import uuid
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False


def get_server(tx, ws_id, server_id):
    s = _get(tx, ws_id, server_id)
    services = tx.q("SELECT * FROM server_services WHERE server_id = %s ORDER BY name", (server_id,))
    return server_out(s, services, availability_map(tx, ws_id).get(server_id, 100.0))


def create_server(tx, ctx, d):
    if tx.one("SELECT 1 FROM servers WHERE workspace_id = %s AND lower(name) = lower(%s)", (ctx.workspace_id, d.name)):
        raise HTTPException(409, f'A server named "{d.name}" already exists.')
    token = new_token("lwt_", 30)
    monitoring = d.monitoring.model_dump() if d.monitoring else DEFAULT_MONITORING
    s = tx.one(
        "INSERT INTO servers (workspace_id, name, hostname, ip, os, os_version, client, env, region, tags, description, monitoring, token_hash, token_prefix) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (ctx.workspace_id, d.name.strip(), d.hostname.strip(), d.hostname.strip() if d.hostname.replace(".", "").isdigit() else "—", d.os, d.osVersion, d.client.strip(), d.env, d.region, d.tags, d.description, J(monitoring), hash_token(token), token[:8]),
    )
    for name, unit, monitored in DEFAULT_SERVICES:
        tx.x("INSERT INTO server_services (server_id, name, unit, monitored, status) VALUES (%s,%s,%s,%s,'unknown')", (s["id"], name, unit, monitored))
    audit(tx, ctx, "server.create", f"Registered server {s['name']}")
    return get_server(tx, ctx.workspace_id, s["id"]), token  # the token is returned exactly once


def update_server(tx, ctx, server_id, d):
    cur = _get(tx, ctx.workspace_id, server_id)
    fields = d.model_dump(exclude_unset=True)
    if "name" in fields and tx.one("SELECT 1 FROM servers WHERE workspace_id = %s AND lower(name) = lower(%s) AND id <> %s", (ctx.workspace_id, fields["name"], server_id)):
        raise HTTPException(409, f'A server named "{fields["name"]}" already exists.')
    colmap = {"name": "name", "hostname": "hostname", "os": "os", "osVersion": "os_version", "description": "description", "env": "env", "client": "client", "region": "region", "tags": "tags"}
    sets, params = [], []
    for k, col in colmap.items():
        if k in fields:
            sets.append(f"{col} = %s")
            params.append(fields[k])
    if "monitoring" in fields and fields["monitoring"] is not None:
        sets.append("monitoring = %s")
        params.append(J(d.monitoring.model_dump()))
    if sets:
        tx.x(f"UPDATE servers SET {', '.join(sets)} WHERE id = %s", (*params, server_id))
        if "name" in fields:
            tx.x("UPDATE alerts SET server_name = %s WHERE server_id = %s", (fields["name"], server_id))
        if "client" in fields:
            tx.x("UPDATE alerts SET client = %s WHERE server_id = %s", (fields["client"], server_id))
    audit(tx, ctx, "server.update", f"Updated server {cur['name']}")
    return get_server(tx, ctx.workspace_id, server_id)


def replace_services(tx, ctx, server_id, items):
    s = _get(tx, ctx.workspace_id, server_id)
    names = [i.name for i in items]
    tx.x("DELETE FROM server_services WHERE server_id = %s AND name <> ALL(%s::text[])", (server_id, names))
    for i in items:
        tx.x("INSERT INTO server_services (server_id, name, unit, monitored, status) VALUES (%s,%s,%s,%s,'unknown') "
             "ON CONFLICT (server_id, name) DO UPDATE SET monitored = EXCLUDED.monitored, unit = EXCLUDED.unit",
             (server_id, i.name, i.unit or i.name + ".service", i.monitored))
    audit(tx, ctx, "server.services", f"Updated monitored services on {s['name']}")
    return get_server(tx, ctx.workspace_id, server_id)


def delete_server(tx, ctx, server_id):
    s = _get(tx, ctx.workspace_id, server_id)
    tx.x("DELETE FROM servers WHERE id = %s", (server_id,))  # cascades metrics, logs, alerts, services
    audit(tx, ctx, "server.delete", f"Deleted server {s['name']}")


def regenerate_token(tx, ctx, server_id):
    s = _get(tx, ctx.workspace_id, server_id)
    token = new_token("lwt_", 30)
    tx.x("UPDATE servers SET token_hash = %s, token_prefix = %s, pending = true, agent_online = false WHERE id = %s", (hash_token(token), token[:8], server_id))
    audit(tx, ctx, "server.token_regenerate", f"Regenerated registration token for {s['name']}")
    return token


# ---------- read APIs ----------
def series(tx, ws_id, server_id, metric, t_from, t_to, points=60):
    if metric not in METRIC_COL:
        raise HTTPException(400, "Unknown metric")
    _get(tx, ws_id, server_id)
    return _bucketed(tx, "server_id = %s", (server_id,), METRIC_COL[metric], t_from, t_to, points)


def fleet_series(tx, ws_id, metric, t_from, t_to, points=60, server_ids=None):
    if metric not in METRIC_COL:
        raise HTTPException(400, "Unknown metric")
    cond, params = "server_id IN (SELECT id FROM servers WHERE workspace_id = %s AND agent_online)", [ws_id]
    if server_ids:
        cond = "server_id IN (SELECT id FROM servers WHERE workspace_id = %s AND id = ANY(%s::uuid[]))"
        params.append(server_ids)
    return _bucketed(tx, cond, tuple(params), METRIC_COL[metric], t_from, t_to, points)


def _bucketed(tx, cond, params, col, t_from, t_to, points):
    points = max(2, min(int(points), 500))
    if t_to <= t_from:
        raise HTTPException(400, "'to' must be after 'from'")
    step = max(15, math.ceil((t_to - t_from) / 1000 / points))
    rows = tx.q(
        f"SELECT date_bin(make_interval(secs => %s), ts, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS b, avg({col}) AS v FROM metrics "
        f"WHERE {cond} AND ts >= %s AND ts <= %s AND {col} IS NOT NULL GROUP BY b ORDER BY b",
        (float(step), *params, from_ms(t_from), from_ms(t_to)))
    by_bucket = {int(r["b"].timestamp()): r["v"] for r in rows}
    start = ORIGIN + ((int(t_from / 1000) - ORIGIN) // step) * step
    times, values = [], []
    t = start
    while t * 1000 <= t_to:
        times.append(t * 1000)
        values.append(by_bucket.get(t))  # None => gap (agent offline)
        t += step
    return {"times": times, "values": values, "stepSec": step}


def snapshot(tx, ws_id, server_id):
    _get(tx, ws_id, server_id)
    r = tx.one("SELECT * FROM server_snapshots WHERE server_id = %s", (server_id,))
    if not r:
        return {"ts": None, "perCore": [], "loadAvg": [0, 0, 0], "filesystems": [], "interfaces": [], "processes": []}
    return {"ts": ms(r["ts"]), "perCore": r["per_core"], "loadAvg": r["load_avg"], "filesystems": r["filesystems"], "interfaces": r["interfaces"], "processes": r["processes"]}


def logs(tx, ws_id, server_id, level=None, q=None, limit=100, offset=0):
    _get(tx, ws_id, server_id)
    cond, params = "server_id = %s", [server_id]
    if level:
        cond += " AND level = %s"
        params.append(level)
    if q:
        cond += " AND (message ILIKE '%%' || %s || '%%' OR source ILIKE '%%' || %s || '%%')"
        params += [q, q]
    total = tx.one(f"SELECT count(*) AS n FROM logs WHERE {cond}", tuple(params))["n"]
    rows = tx.q(f"SELECT id, ts, level, source, message FROM logs WHERE {cond} ORDER BY ts DESC LIMIT %s OFFSET %s", (*params, min(limit, 500), offset))
    return {"total": total, "items": [{"id": r["id"], "ts": ms(r["ts"]), "level": r["level"], "source": r["source"], "message": r["message"]} for r in rows]}
