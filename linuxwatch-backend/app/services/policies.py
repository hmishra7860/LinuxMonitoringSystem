from fastapi import HTTPException

from ..db import J
from ..engine.policy import validate_policy_config
from . import alerts as alert_svc
from .common import audit, policy_out

CFG_KEYS = ("cpu", "memory", "disk", "network", "service")


def list_policies(tx, ws_id):
    return [policy_out(p) for p in tx.q("SELECT * FROM policies WHERE workspace_id = %s ORDER BY is_default DESC, name", (ws_id,))]


def save_policy(tx, ctx, d, policy_id=None):
    cfg = {k: getattr(d, k).model_dump() for k in CFG_KEYS}
    errs = validate_policy_config(cfg)
    if errs:
        raise HTTPException(422, "; ".join(errs))
    if not d.isDefault and not d.assignments:
        raise HTTPException(422, "Assign the policy to at least one server or group, or make it the global default.")
    if tx.one("SELECT 1 FROM policies WHERE workspace_id = %s AND lower(name) = lower(%s) AND id::text <> COALESCE(%s, '')", (ctx.workspace_id, d.name, policy_id)):
        raise HTTPException(409, "A policy with this name already exists.")
    assignments = [] if d.isDefault else [a.model_dump() for a in d.assignments]
    if d.isDefault:
        tx.x("UPDATE policies SET is_default = false WHERE workspace_id = %s AND is_default AND id::text <> COALESCE(%s, '')", (ctx.workspace_id, policy_id))
    if policy_id:
        cur = tx.one("SELECT is_default FROM policies WHERE id = %s AND workspace_id = %s", (policy_id, ctx.workspace_id))
        if not cur:
            raise HTTPException(404, "Policy not found")
        if cur["is_default"] and not d.isDefault:
            raise HTTPException(422, "A global default policy must always exist. Make another policy the default instead.")
        p = tx.one("UPDATE policies SET name = %s, description = %s, is_default = %s, enabled = %s, config = %s, assignments = %s WHERE id = %s RETURNING *",
                   (d.name.strip(), d.description, d.isDefault, d.enabled, J(cfg), J(assignments), policy_id))
        audit(tx, ctx, "policy.update", f'Updated policy "{p["name"]}"')
    else:
        p = tx.one("INSERT INTO policies (workspace_id, name, description, is_default, enabled, config, assignments) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                   (ctx.workspace_id, d.name.strip(), d.description, d.isDefault, d.enabled, J(cfg), J(assignments)))
        audit(tx, ctx, "policy.create", f'Created policy "{p["name"]}"')
    notify = alert_svc.evaluate_workspace(tx, ctx.workspace_id)  # re-evaluate immediately with the new thresholds
    return policy_out(p), notify


def delete_policy(tx, ctx, policy_id):
    p = tx.one("SELECT * FROM policies WHERE id = %s AND workspace_id = %s", (policy_id, ctx.workspace_id))
    if not p:
        raise HTTPException(404, "Policy not found")
    if p["is_default"]:
        raise HTTPException(422, "The global default policy cannot be deleted. Make another policy the default first.")
    tx.x("DELETE FROM policies WHERE id = %s", (policy_id,))
    audit(tx, ctx, "policy.delete", f'Deleted policy "{p["name"]}"')
    return alert_svc.evaluate_workspace(tx, ctx.workspace_id)
