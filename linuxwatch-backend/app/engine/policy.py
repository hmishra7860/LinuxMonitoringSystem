"""Pure alerting logic: policy resolution, thresholds, suppression matching, notification routing."""
from datetime import datetime

MODULES = ["cpu", "memory", "disk", "network", "processes", "services", "availability"]
DURATIONS = {"15m": 15, "30m": 30, "1h": 60, "4h": 240, "24h": 1440, "manual": None}
SPECIFICITY = {"server": 5, "tag": 4, "region": 3, "environment": 3, "client": 2, "global": 1}

DEFAULT_CONFIG = {
    "cpu": {"warn": 75, "crit": 90, "duration": 5},
    "memory": {"warn": 80, "crit": 90, "duration": 5},
    "disk": {"warn": 80, "crit": 90, "duration": 10},
    "network": {"inMbps": 800, "outMbps": 800, "errors": 50},
    "service": {"expected": "active", "failAfter": 2},
}
NETWORK_DURATION_MIN = 2


def policy_specificity(policy: dict, server: dict) -> int:
    """0 = does not apply; higher = more specific assignment."""
    if not policy["enabled"]:
        return 0
    best = SPECIFICITY["global"] if policy["is_default"] else 0
    for a in policy.get("assignments") or []:
        t, v = a.get("type"), a.get("value")
        hit = (
            (t == "server" and v == server["id"])
            or (t == "client" and v == server["client"])
            or (t == "environment" and v == server["env"])
            or (t == "region" and v == server["region"])
            or (t == "tag" and v in (server.get("tags") or []))
        )
        if hit:
            best = max(best, SPECIFICITY[t])
    return best


def effective_policy(server: dict, policies: list) -> dict:
    best, score = None, 0
    for p in policies:
        s = policy_specificity(p, server)
        if s > score:
            best, score = p, s
    if best:
        return best
    default = next((p for p in policies if p["is_default"]), None)
    return default or {"id": None, "name": "Built-in defaults", "config": DEFAULT_CONFIG, "is_default": True, "enabled": True, "assignments": []}


def severity_for(value, warn, crit):
    if value is None:
        return None
    return "critical" if value >= crit else "warning" if value >= warn else None


def sustained_severity(min_value, sample_count: int, oldest_age_sec: float, warn, crit, duration_min: float, interval_sec: float):
    """Fire only when EVERY sample in the evaluation window breached, and the window is actually covered by data.
    `min_value` is the minimum over the window, so one dip below the threshold prevents (or resolves) the alert."""
    if sample_count == 0 or min_value is None:
        return None
    required = max(0.0, duration_min * 60 - interval_sec * 1.5)
    if oldest_age_sec < required:
        return None
    return severity_for(min_value, warn, crit)


def suppression_active(s: dict, now: datetime) -> bool:
    return s["ended_at"] is None and (s["expires_at"] is None or s["expires_at"] > now)


def suppression_matches(s: dict, server: dict, module: str, now: datetime) -> bool:
    if not suppression_active(s, now):
        return False
    if not ("all" in s["modules"] or module in s["modules"]):
        return False
    kind, _, val = s["target"].partition(":")
    return (
        kind == "all"
        or (kind == "server" and val == server["id"])
        or (kind == "client" and val == server["client"])
        or (kind == "env" and val == server["env"])
        or (kind == "region" and val == server["region"])
    )


def is_suppressed(suppressions: list, server: dict, module: str, now: datetime) -> bool:
    return any(suppression_matches(s, server, module, now) for s in suppressions)


def route(alert: dict, server: dict, rules: list, integrations: list) -> list:
    """Return the enabled integrations that should receive this alert (de-duplicated)."""
    ids = set()
    for r in rules:
        if not r["enabled"] or alert["severity"] not in r["severities"]:
            continue
        if not ("all" in r["modules"] or alert["module"] in r["modules"]):
            continue
        t, v = r["scope_type"], r["scope_value"]
        ok = (
            t == "all"
            or (t == "client" and v == alert["client"])
            or (t == "server" and v == alert["server_id"])
            or (t == "environment" and server is not None and v == server["env"])
        )
        if ok:
            ids.update(r["integration_ids"])
    return [i for i in integrations if i["id"] in ids and i["enabled"]]


def validate_policy_config(cfg: dict) -> list:
    errs = []
    for m in ("cpu", "memory", "disk"):
        t = cfg.get(m) or {}
        w, c, d = t.get("warn"), t.get("crit"), t.get("duration")
        if not all(isinstance(x, (int, float)) for x in (w, c, d)):
            errs.append(f"{m}: warn, crit and duration are required numbers")
        elif not (1 <= w < c <= 100):
            errs.append(f"{m}: need 1 <= warning < critical <= 100")
        elif d < 1:
            errs.append(f"{m}: duration must be at least 1 minute")
    n = cfg.get("network") or {}
    if not all(isinstance(n.get(k), (int, float)) and n.get(k) >= 0 for k in ("inMbps", "outMbps", "errors")) or n.get("inMbps", 0) <= 0 or n.get("outMbps", 0) <= 0:
        errs.append("network: inMbps and outMbps must be positive, errors must be >= 0")
    s = cfg.get("service") or {}
    if s.get("expected") != "active" or not isinstance(s.get("failAfter"), (int, float)) or s["failAfter"] < 1:
        errs.append("service: expected must be 'active' and failAfter >= 1 minute")
    return errs
