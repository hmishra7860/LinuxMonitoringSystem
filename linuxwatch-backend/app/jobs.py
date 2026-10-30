"""Background maintenance: offline detection, suppression expiry, data retention."""
import logging
import threading

from .config import settings
from .db import db
from .realtime import hub
from .services import alerts as alert_svc
from .services.common import add_event

log = logging.getLogger("linuxwatch.jobs")


def mark_offline():
    """Servers that stopped sending data become Offline, get a downtime record, a critical alert and a notification."""
    by_ws = {}
    with db.tx() as tx:
        rows = tx.q(
            "UPDATE servers SET agent_online = false WHERE agent_online AND last_heartbeat < now() - make_interval(secs => GREATEST(%s::float8, COALESCE((monitoring->>'interval')::float8, 30) * 3)) RETURNING *",
            (float(settings.offline_after_sec),))
        if rows:
            sups_cache = {}
            for s in rows:
                ws = s["workspace_id"]
                tx.x("INSERT INTO server_downtime (server_id, started_at) VALUES (%s, %s)", (s["id"], s["last_heartbeat"]))
                sups = sups_cache.setdefault(ws, alert_svc.load_active_suppressions(tx, ws))
                suppressed = alert_svc.is_suppressed(sups, s, "availability", alert_svc.db_now(tx))
                a = alert_svc.insert_alert(tx, s, {"key": "agent:offline", "module": "availability", "metric": "Agent connectivity", "value": "offline", "unit": "", "sev": "critical", "threshold": f"{settings.offline_after_sec}s"},
                                           "suppressed" if suppressed else "active")
                if a and not suppressed:
                    add_event(tx, ws, "alert", "critical", f"Server offline: {s['name']}", "No heartbeat received from the agent", a["id"], s["id"])
                    by_ws.setdefault(ws, []).append(a)
                hub.publish(ws, {"type": "server.update", "serverId": s["id"], "agentOnline": False})
                hub.publish(ws, {"type": "alerts.changed", "serverId": s["id"]})
    for ws, alerts in by_ws.items():
        alert_svc.dispatch(ws, alerts)


def expire_suppressions():
    notify = {}
    with db.tx() as tx:
        rows = tx.q("UPDATE suppressions SET ended_at = expires_at, ended_by = 'expired' WHERE ended_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now() RETURNING *")
        for s in rows:
            tx.x("INSERT INTO suppression_audit (workspace_id, action, suppression_id, user_name, details) VALUES (%s,'expired',%s,'system',%s)",
                 (s["workspace_id"], s["id"], f"{s['target_label']} · {', '.join(s['modules'])} — expired automatically"))
            add_event(tx, s["workspace_id"], "info", "info", f"Suppression {s['id']} expired", f"Alerting resumed for {s['target_label']}")
        for ws in {s["workspace_id"] for s in rows}:
            notify[ws] = alert_svc.reapply_suppressions(tx, ws)
    for ws, alerts in notify.items():
        alert_svc.dispatch(ws, alerts)


def retention():
    with db.tx() as tx:
        tx.x("DELETE FROM metrics WHERE ts < now() - (%s::float8 * interval '1 day')", (float(settings.metric_retention_days),))
        tx.x("DELETE FROM logs WHERE ts < now() - (%s::float8 * interval '1 day')", (float(settings.log_retention_days),))
        tx.x("DELETE FROM deliveries WHERE ts < now() - interval '90 days'")
        tx.x("DELETE FROM events WHERE ts < now() - interval '30 days'")
        tx.x("DELETE FROM server_downtime WHERE ended_at IS NOT NULL AND ended_at < now() - interval '400 days'")


class Scheduler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="lw-scheduler")
        self.stop_event = threading.Event()

    def run(self):
        ticks = 0
        while not self.stop_event.wait(15):
            ticks += 1
            for fn, every in ((mark_offline, 1), (expire_suppressions, 1), (retention, 240)):  # retention hourly
                if ticks % every == 0:
                    try:
                        fn()
                    except Exception:
                        log.exception("job %s failed", fn.__name__)

    def stop(self):
        self.stop_event.set()
