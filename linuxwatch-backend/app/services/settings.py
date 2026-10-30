"""Workspace settings, members & roles, API tokens, audit log."""
from fastapi import HTTPException

from ..db import J
from ..deps import ROLE_RANK
from ..security import hash_token, new_token
from .auth import DEFAULT_SETTINGS
from .common import audit, ms


def get_settings(tx, ws_id):
    row = tx.one("SELECT data FROM workspace_settings WHERE workspace_id = %s", (ws_id,))
    data = (row or {}).get("data") or {}
    return {**DEFAULT_SETTINGS, **data, "notif": {**DEFAULT_SETTINGS["notif"], **(data.get("notif") or {})}}


def save_settings(tx, ctx, patch: dict):
    merged = {**get_settings(tx, ctx.workspace_id), **patch}
    tx.x("INSERT INTO workspace_settings (workspace_id, data) VALUES (%s, %s) ON CONFLICT (workspace_id) DO UPDATE SET data = EXCLUDED.data", (ctx.workspace_id, J(merged)))
    audit(tx, ctx, "settings.update", "Updated settings: " + ", ".join(patch.keys()))
    return merged


# ---------- members ----------
def list_members(tx, ws_id):
    rows = tx.q("SELECT * FROM members WHERE workspace_id = %s ORDER BY CASE role WHEN 'Owner' THEN 0 WHEN 'Admin' THEN 1 WHEN 'Operator' THEN 2 ELSE 3 END, name", (ws_id,))
    return [{"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "status": r["status"], "lastActive": ms(r["last_active"])} for r in rows]


def _can_assign(ctx, role):
    # Owners can assign anything below Owner; Admins can only manage Operator/Viewer.
    return role != "Owner" and ROLE_RANK[ctx.role] > ROLE_RANK[role]


def invite(tx, ctx, email, role):
    if not _can_assign(ctx, role):
        raise HTTPException(403, f"You cannot invite someone as {role}")
    if tx.one("SELECT 1 FROM members WHERE workspace_id = %s AND lower(email) = lower(%s)", (ctx.workspace_id, email)):
        raise HTTPException(409, "This person is already a member.")
    existing = tx.one("SELECT id, name FROM users WHERE lower(email) = lower(%s)", (email,))
    if existing:  # existing user is added directly
        tx.x("INSERT INTO members (workspace_id, user_id, email, name, role, status) VALUES (%s,%s,%s,%s,%s,'Active')", (ctx.workspace_id, existing["id"], email, existing["name"], role))
    else:  # becomes active when they register with this address
        tx.x("INSERT INTO members (workspace_id, email, name, role, status) VALUES (%s,%s,%s,%s,'Invited')", (ctx.workspace_id, email, email.split("@")[0], role))
    audit(tx, ctx, "member.invite", f"Invited {email} as {role}")


def _member(tx, ctx, member_id):
    m = tx.one("SELECT * FROM members WHERE id = %s AND workspace_id = %s", (member_id, ctx.workspace_id))
    if not m:
        raise HTTPException(404, "Member not found")
    if m["role"] == "Owner":
        raise HTTPException(403, "The workspace owner cannot be changed or removed")
    if ROLE_RANK[ctx.role] <= ROLE_RANK[m["role"]]:
        raise HTTPException(403, "You can only manage members with a lower role than yours")
    return m


def set_role(tx, ctx, member_id, role):
    m = _member(tx, ctx, member_id)
    if not _can_assign(ctx, role):
        raise HTTPException(403, f"You cannot assign the {role} role")
    tx.x("UPDATE members SET role = %s WHERE id = %s", (role, member_id))
    audit(tx, ctx, "member.role", f"Changed {m['email']} to {role}")


def remove(tx, ctx, member_id):
    m = _member(tx, ctx, member_id)
    tx.x("DELETE FROM members WHERE id = %s", (member_id,))
    audit(tx, ctx, "member.remove", f"Removed {m['email']}")


# ---------- API tokens ----------
SCOPES = {"metrics:read", "servers:read", "servers:write", "alerts:read", "alerts:write"}


def list_tokens(tx, ws_id):
    rows = tx.q("SELECT * FROM api_tokens WHERE workspace_id = %s ORDER BY created_at DESC", (ws_id,))
    return [{"id": r["id"], "name": r["name"], "prefix": r["prefix"], "scopes": r["scopes"], "createdAt": ms(r["created_at"]), "lastUsed": ms(r["last_used"])} for r in rows]


def create_token(tx, ctx, name, scopes):
    if not scopes or any(s not in SCOPES for s in scopes):
        raise HTTPException(422, "Choose valid scopes")
    secret = new_token("lwk_", 30)
    tx.x("INSERT INTO api_tokens (workspace_id, user_id, name, prefix, token_hash, scopes) VALUES (%s,%s,%s,%s,%s,%s)", (ctx.workspace_id, ctx.user_id, name.strip(), secret[:8], hash_token(secret), scopes))
    audit(tx, ctx, "token.create", f'Created API token "{name.strip()}"')
    return secret  # shown once


def revoke_token(tx, ctx, token_id):
    t = tx.one("DELETE FROM api_tokens WHERE id = %s AND workspace_id = %s RETURNING name", (token_id, ctx.workspace_id))
    if not t:
        raise HTTPException(404, "Token not found")
    audit(tx, ctx, "token.revoke", f'Revoked API token "{t["name"]}"')


def list_audit(tx, ws_id, q=None, limit=200):
    cond, params = "workspace_id = %s", [ws_id]
    if q:
        cond += " AND (user_name || ' ' || action || ' ' || detail) ILIKE '%%' || %s || '%%'"
        params.append(q)
    rows = tx.q(f"SELECT * FROM audit_log WHERE {cond} ORDER BY ts DESC LIMIT %s", (*params, min(limit, 1000)))
    return [{"id": r["id"], "ts": ms(r["ts"]), "user": r["user_name"], "action": r["action"], "detail": r["detail"], "ip": r["ip"]} for r in rows]
