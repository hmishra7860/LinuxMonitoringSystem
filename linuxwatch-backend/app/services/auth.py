from fastapi import HTTPException

from ..db import J
from ..engine.policy import DEFAULT_CONFIG
from ..security import create_access_token, hash_password, login_limiter, password_issues, verify_password
from .common import ms

DEFAULT_SETTINGS = {"timezone": "UTC", "heartbeatSec": 30, "collectionSec": 30, "logLevel": "WARNING", "logSources": ["journald", "/var/log/syslog"], "retentionDays": 30,
                    "notif": {"emailDigest": True, "criticalPush": True, "weeklyReport": False, "desktop": True}}


def _create_workspace(tx, user, name, plan="Trial"):
    ws = tx.one("INSERT INTO workspaces (name, plan) VALUES (%s, %s) RETURNING id", (name, plan))
    tx.x("INSERT INTO members (workspace_id, user_id, email, name, role, status, last_active) VALUES (%s,%s,%s,%s,'Owner','Active', now())", (ws["id"], user["id"], user["email"], user["name"]))
    tx.x("INSERT INTO policies (workspace_id, name, description, is_default, config) VALUES (%s, 'Global default', 'Applies to every server without a more specific policy.', true, %s)", (ws["id"], J(DEFAULT_CONFIG)))
    tx.x("INSERT INTO workspace_settings (workspace_id, data) VALUES (%s, %s)", (ws["id"], J(DEFAULT_SETTINGS)))
    return ws["id"]


def user_out(u):
    return {"id": u["id"], "name": u["name"], "email": u["email"], "company": u["company"]}


def workspaces_for(tx, user_id):
    rows = tx.q("SELECT w.id, w.name, w.plan, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = %s AND m.status = 'Active' ORDER BY w.created_at", (user_id,))
    return [{"id": r["id"], "name": r["name"], "plan": r["plan"], "role": r["role"]} for r in rows]


def register(tx, d):
    issues = password_issues(d.password)
    if issues:
        raise HTTPException(422, "Password needs " + ", ".join(issues) + ".")
    if tx.one("SELECT 1 FROM users WHERE lower(email) = lower(%s)", (d.email,)):
        raise HTTPException(409, "An account with this email already exists.")
    u = tx.one("INSERT INTO users (email, name, company, password_hash) VALUES (%s,%s,%s,%s) RETURNING *", (d.email.strip(), d.name.strip(), d.company.strip(), hash_password(d.password)))
    # accept any pending invitations addressed to this email
    tx.x("UPDATE members SET user_id = %s, status = 'Active', name = %s WHERE lower(email) = lower(%s) AND user_id IS NULL", (u["id"], u["name"], u["email"]))
    _create_workspace(tx, u, d.company.strip())
    token, ttl = create_access_token(u["id"])
    return {"token": token, "expiresIn": ttl, "user": user_out(u), "workspaces": workspaces_for(tx, u["id"])}


def login(tx, d, ip):
    key = f"{ip}|{d.email.lower()}"
    if login_limiter.blocked(key):
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    u = tx.one("SELECT * FROM users WHERE lower(email) = lower(%s)", (d.email,))
    if not u or not verify_password(d.password, u["password_hash"]):
        login_limiter.fail(key)
        raise HTTPException(401, "Invalid email or password.")
    login_limiter.reset(key)
    token, ttl = create_access_token(u["id"], d.remember)
    return {"token": token, "expiresIn": ttl, "user": user_out(u), "workspaces": workspaces_for(tx, u["id"])}


def me(tx, ctx):
    u = tx.one("SELECT * FROM users WHERE id = %s", (ctx.user_id,))
    return {"user": user_out(u), "workspaces": workspaces_for(tx, ctx.user_id), "workspaceId": ctx.workspace_id, "role": ctx.role}


def update_profile(tx, ctx, d):
    if tx.one("SELECT 1 FROM users WHERE lower(email) = lower(%s) AND id <> %s", (d.email, ctx.user_id)):
        raise HTTPException(409, "That email is already in use.")
    u = tx.one("UPDATE users SET name = %s, email = %s WHERE id = %s RETURNING *", (d.name.strip(), d.email.strip(), ctx.user_id))
    tx.x("UPDATE members SET name = %s, email = %s WHERE user_id = %s", (u["name"], u["email"], ctx.user_id))
    return user_out(u)


def change_password(tx, ctx, d):
    u = tx.one("SELECT * FROM users WHERE id = %s", (ctx.user_id,))
    if not verify_password(d.current, u["password_hash"]):
        raise HTTPException(400, "Current password is incorrect.")
    issues = password_issues(d.new)
    if issues:
        raise HTTPException(422, "Password needs " + ", ".join(issues) + ".")
    tx.x("UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(d.new), ctx.user_id))


def create_workspace(tx, ctx, name):
    u = tx.one("SELECT * FROM users WHERE id = %s", (ctx.user_id,))
    ws_id = _create_workspace(tx, u, name.strip())
    return {"id": ws_id, "name": name.strip(), "plan": "Trial", "role": "Owner"}
