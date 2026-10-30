"""Agent data ingestion: authenticate agent, store metrics, update state, evaluate alert policies."""
from fastapi import HTTPException

from ..db import J, db
from ..realtime import hub
from ..security import hash_token
from . import alerts as alert_svc
from .common import add_event, ms

LEVEL_RANK = {"INFO": 0, "WARNING": 1, "ERROR": 2, "CRITICAL": 3}
MAX_LOGS = 200


def _agent_config(tx, server):
    services = tx.q("SELECT unit FROM server_services WHERE server_id = %s ORDER BY name", (server["id"],))
    mon = server["monitoring"] or {}
    return {"interval": int(mon.get("interval", 30)), "modules": mon.get("modules", {}), "services": [s["unit"] for s in services]}


def ingest(token: str, p: dict, client_ip: str = "") -> dict:
    to_notify, ws_id, server_id, summary = [], None, None, {}
    with db.tx() as tx:
        s = tx.one("SELECT * FROM servers WHERE token_hash = %s", (hash_token(token),))
        if not s:
            raise HTTPException(401, "Invalid agent token")
        ws_id, server_id = s["workspace_id"], s["id"]
        was_offline = not s["agent_online"]
        first_contact = s["pending"]

        tx.x(
            "UPDATE servers SET pending = false, agent_online = true, last_heartbeat = now(), agent_version = %s, os = COALESCE(NULLIF(%s, ''), os), "
            "os_version = COALESCE(NULLIF(%s, ''), os_version), kernel = COALESCE(NULLIF(%s, ''), kernel), ip = COALESCE(NULLIF(%s, ''), ip), uptime_sec = %s, cores = %s, "
            "ram_total_gb = %s, disk_total_gb = %s, swap_total_gb = %s, cpu = %s, mem = %s, disk = %s, swap_pct = %s, net_in = %s, net_out = %s WHERE id = %s",
            (p["agent_version"], p["os"], p["os_version"], p["kernel"], p.get("ip") or client_ip, p["uptime_sec"], p["cores"], p["ram_total_gb"], p["disk_total_gb"], p["swap_total_gb"],
             p["cpu"], p["mem"], p["disk"], p["swap"], p["net_in"], p["net_out"], server_id))

        if was_offline:
            tx.x("UPDATE server_downtime SET ended_at = now() WHERE server_id = %s AND ended_at IS NULL", (server_id,))
            tx.x("UPDATE alerts SET status = 'resolved', resolved_at = now(), resolved_by = 'auto' WHERE server_id = %s AND key = 'agent:offline' AND status <> 'resolved'", (server_id,))
            add_event(tx, ws_id, "info", "info", "Agent connected" if first_contact else "Agent reconnected", f"{s['name']} is reporting again", None, server_id)

        tx.x("INSERT INTO metrics (server_id, ts, cpu, mem, disk, swap, net_in, net_out) VALUES (%s, now(), %s, %s, %s, %s, %s, %s) "
             "ON CONFLICT (server_id, ts) DO UPDATE SET cpu = EXCLUDED.cpu, mem = EXCLUDED.mem, disk = EXCLUDED.disk, swap = EXCLUDED.swap, net_in = EXCLUDED.net_in, net_out = EXCLUDED.net_out",
             (server_id, p["cpu"], p["mem"], p["disk"], p["swap"], p["net_in"], p["net_out"]))

        mods = (s["monitoring"] or {}).get("modules", {})
        tx.x(
            "INSERT INTO server_snapshots (server_id, ts, per_core, load_avg, filesystems, interfaces, processes) VALUES (%s, now(), %s, %s, %s, %s, %s) "
            "ON CONFLICT (server_id) DO UPDATE SET ts = now(), per_core = EXCLUDED.per_core, load_avg = EXCLUDED.load_avg, filesystems = EXCLUDED.filesystems, "
            "interfaces = EXCLUDED.interfaces, processes = EXCLUDED.processes",
            (server_id, J(p["per_core"]), J(p["load"]), J(p["filesystems"]), J(p["interfaces"]), J(p["processes"] if mods.get("processes", True) else [])))

        if mods.get("services", True):
            for sv in p["services"]:
                tx.x(
                    "INSERT INTO server_services (server_id, name, unit, monitored, status, since, bad_since) VALUES (%s, %s, %s, false, %s, now(), CASE WHEN %s IN ('failed','inactive') THEN now() END) "
                    "ON CONFLICT (server_id, name) DO UPDATE SET status = EXCLUDED.status, "
                    "since = CASE WHEN server_services.status <> EXCLUDED.status THEN now() ELSE server_services.since END, "
                    "bad_since = CASE WHEN EXCLUDED.status IN ('failed','inactive') THEN COALESCE(server_services.bad_since, now()) ELSE NULL END",
                    (server_id, sv["name"], sv["unit"], sv["status"], sv["status"]))

        if mods.get("logs", True) and p["logs"]:
            row = tx.one("SELECT data FROM workspace_settings WHERE workspace_id = %s", (ws_id,))
            min_rank = LEVEL_RANK.get(((row or {}).get("data") or {}).get("logLevel", "WARNING"), 1)
            for l in p["logs"][:MAX_LOGS]:
                if LEVEL_RANK[l["level"]] >= min_rank:
                    tx.x("INSERT INTO logs (server_id, ts, level, source, message) VALUES (%s, to_timestamp(%s), %s, %s, %s)", (server_id, l["ts"], l["level"], l["source"][:80], l["message"][:2000]))

        fresh = tx.one("SELECT * FROM servers WHERE id = %s", (server_id,))
        to_notify = alert_svc.evaluate_server(tx, fresh)
        config = _agent_config(tx, fresh)
        summary = {"type": "server.update", "serverId": server_id, "cpu": fresh["cpu"], "mem": fresh["mem"], "disk": fresh["disk"], "netIn": fresh["net_in"], "netOut": fresh["net_out"],
                   "agentOnline": True, "lastHeartbeat": ms(fresh["last_heartbeat"]), "uptimeSec": fresh["uptime_sec"], "pending": False}
    hub.publish(ws_id, summary)  # after commit
    alert_svc.dispatch(ws_id, to_notify)
    return config


def heartbeat(token: str) -> dict:
    with db.tx() as tx:
        s = tx.one("UPDATE servers SET last_heartbeat = now() WHERE token_hash = %s AND agent_online RETURNING *", (hash_token(token),))
        if not s:
            if not tx.one("SELECT 1 FROM servers WHERE token_hash = %s", (hash_token(token),)):
                raise HTTPException(401, "Invalid agent token")
            raise HTTPException(409, "Send a metrics payload first")
        return _agent_config(tx, s)
