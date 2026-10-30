"""Notification integrations (secrets encrypted at rest and never returned) and routing rules."""
from fastapi import HTTPException

from ..db import J
from ..engine import notify
from ..security import assert_public_url, decrypt_json, encrypt_json
from . import alerts as alert_svc
from .common import audit, integration_out, ms, rule_out

SECRET_FIELDS = {"email": ["password"], "slack": ["webhookUrl"], "teams": ["webhookUrl"], "webhook": ["token"]}


def _validate(type_, config, secrets, existing_secrets):
    merged = {**existing_secrets, **{k: v for k, v in secrets.items() if v}}
    if type_ == "email":
        for k in ("host", "sender", "username"):
            if not str(config.get(k, "")).strip():
                raise HTTPException(422, f"email: {k} is required")
        if not config.get("recipients"):
            raise HTTPException(422, "email: add at least one recipient")
        if not merged.get("password"):
            raise HTTPException(422, "email: password is required")
        if not (1 <= int(config.get("port") or 0) <= 65535):
            raise HTTPException(422, "email: port must be 1-65535")
    elif type_ in ("slack", "teams"):
        url = merged.get("webhookUrl", "")
        if not url:
            raise HTTPException(422, "Webhook URL is required")
        if not url.startswith("https://"):
            raise HTTPException(422, "Webhook URL must start with https://")
        _ssrf(url)
    elif type_ == "webhook":
        _ssrf(config.get("url", ""))
        if config.get("auth", "none") != "none" and not merged.get("token"):
            raise HTTPException(422, "Credentials are required for this auth type")
    return merged


def _ssrf(url):
    try:
        assert_public_url(url)
    except ValueError as e:
        raise HTTPException(422, str(e))


def list_integrations(tx, ws_id):
    rows = tx.q("SELECT * FROM integrations WHERE workspace_id = %s ORDER BY created_at", (ws_id,))
    return [integration_out(r, [k for k, v in decrypt_json(r["secrets_enc"]).items() if v]) for r in rows]


def save(tx, ctx, d, integration_id=None):
    existing, existing_secrets = None, {}
    if integration_id:
        existing = tx.one("SELECT * FROM integrations WHERE id = %s AND workspace_id = %s", (integration_id, ctx.workspace_id))
        if not existing:
            raise HTTPException(404, "Integration not found")
        existing_secrets = decrypt_json(existing["secrets_enc"])
    secrets_in = {k: v for k, v in (d.secrets or {}).items() if k in SECRET_FIELDS[d.type]}
    merged = _validate(d.type, d.config, secrets_in, existing_secrets)
    enc = encrypt_json({k: v for k, v in merged.items() if k in SECRET_FIELDS[d.type]})
    if existing:
        r = tx.one("UPDATE integrations SET name = %s, enabled = %s, config = %s, secrets_enc = %s WHERE id = %s RETURNING *", (d.name.strip(), d.enabled, J(d.config), enc, integration_id))
        audit(tx, ctx, "integration.update", f'Updated integration "{r["name"]}"')
    else:
        r = tx.one("INSERT INTO integrations (workspace_id, type, name, enabled, config, secrets_enc) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *", (ctx.workspace_id, d.type, d.name.strip(), d.enabled, J(d.config), enc))
        audit(tx, ctx, "integration.create", f'Created integration "{r["name"]}"')
    return integration_out(r, [k for k, v in decrypt_json(r["secrets_enc"]).items() if v])


def delete(tx, ctx, integration_id):
    r = tx.one("DELETE FROM integrations WHERE id = %s AND workspace_id = %s RETURNING name", (integration_id, ctx.workspace_id))
    if not r:
        raise HTTPException(404, "Integration not found")
    tx.x("UPDATE routing_rules SET integration_ids = array_remove(integration_ids, %s::uuid) WHERE workspace_id = %s", (integration_id, ctx.workspace_id))
    audit(tx, ctx, "integration.delete", f'Deleted integration "{r["name"]}"')


def test_saved(ctx, integration_id):
    from ..db import db
    with db.tx() as tx:
        r = tx.one("SELECT * FROM integrations WHERE id = %s AND workspace_id = %s", (integration_id, ctx.workspace_id))
        if not r:
            raise HTTPException(404, "Integration not found")
    ok, msg = notify.send(r["type"], r["config"], decrypt_json(r["secrets_enc"]), notify.test_context())  # network I/O outside any transaction
    alert_svc.record_delivery(ctx.workspace_id, r["id"], "test", None, ok, "Test notification", None if ok else msg)
    with db.tx() as tx:
        audit(tx, ctx, "integration.test", f'Sent test notification via {r["name"]}')
    return {"ok": ok, "message": "Test notification delivered." if ok else msg}


def test_draft(ctx, d):
    secrets_in = {k: v for k, v in (d.secrets or {}).items() if k in SECRET_FIELDS[d.type]}
    try:
        merged = _validate(d.type, d.config, secrets_in, {})
    except HTTPException as e:
        return {"ok": False, "message": e.detail}
    ok, msg = notify.send(d.type, d.config, merged, notify.test_context())
    return {"ok": ok, "message": "Test notification delivered." if ok else msg}


# ---------- routing rules ----------
def list_rules(tx, ws_id):
    return [rule_out(r) for r in tx.q("SELECT * FROM routing_rules WHERE workspace_id = %s ORDER BY name", (ws_id,))]


def save_rule(tx, ctx, d, rule_id=None):
    if d.integrationIds:
        found = tx.one("SELECT count(*) AS n FROM integrations WHERE workspace_id = %s AND id = ANY(%s::uuid[])", (ctx.workspace_id, d.integrationIds))["n"]
        if found != len(set(d.integrationIds)):
            raise HTTPException(422, "Unknown integration in rule")
    vals = (d.name.strip(), d.severities, d.modules, d.scope.type, d.scope.value, d.integrationIds, d.enabled)
    if rule_id:
        r = tx.one("UPDATE routing_rules SET name=%s, severities=%s, modules=%s, scope_type=%s, scope_value=%s, integration_ids=%s::uuid[], enabled=%s WHERE id = %s AND workspace_id = %s RETURNING *", (*vals, rule_id, ctx.workspace_id))
        if not r:
            raise HTTPException(404, "Rule not found")
    else:
        r = tx.one("INSERT INTO routing_rules (name, severities, modules, scope_type, scope_value, integration_ids, enabled, workspace_id) VALUES (%s,%s,%s,%s,%s,%s::uuid[],%s,%s) RETURNING *", (*vals, ctx.workspace_id))
    audit(tx, ctx, "routing.save", f'Saved routing rule "{r["name"]}"')
    return rule_out(r)


def delete_rule(tx, ctx, rule_id):
    if not tx.x("DELETE FROM routing_rules WHERE id = %s AND workspace_id = %s", (rule_id, ctx.workspace_id)):
        raise HTTPException(404, "Rule not found")
    audit(tx, ctx, "routing.delete", "Deleted routing rule")


def list_deliveries(tx, ws_id, limit=100):
    rows = tx.q("SELECT * FROM deliveries WHERE workspace_id = %s ORDER BY ts DESC LIMIT %s", (ws_id, min(limit, 500)))
    return [{"id": r["id"], "ts": ms(r["ts"]), "integrationId": r["integration_id"], "kind": r["kind"], "alertId": r["alert_id"], "status": r["status"], "summary": r["summary"], "error": r["error"]} for r in rows]


def list_events(tx, ws_id, limit=40):
    rows = tx.q("SELECT * FROM events WHERE workspace_id = %s ORDER BY ts DESC LIMIT %s", (ws_id, min(limit, 200)))
    return [{"id": r["id"], "ts": ms(r["ts"]), "type": r["type"], "severity": r["severity"], "title": r["title"], "body": r["body"], "alertId": r["alert_id"], "serverId": r["server_id"]} for r in rows]
