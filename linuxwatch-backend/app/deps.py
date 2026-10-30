"""Authentication + role-based access control dependencies."""
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request

from .db import db
from .security import decode_access_token, hash_token

ROLE_RANK = {"Viewer": 0, "Operator": 1, "Admin": 2, "Owner": 3}


@dataclass
class Ctx:
    user_id: Optional[str]
    user_name: str
    email: str
    workspace_id: str
    role: str
    ip: str


def get_ctx(request: Request, authorization: Optional[str] = Header(None), x_workspace_id: Optional[str] = Header(None)) -> Ctx:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization[7:].strip()
    ip = request.client.host if request.client else ""
    with db.tx() as tx:
        if token.startswith("lwk_"):  # personal API token
            row = tx.one("SELECT t.id, t.workspace_id, t.scopes, t.name, u.email FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE t.token_hash = %s", (hash_token(token),))
            if not row:
                raise HTTPException(401, "Invalid API token")
            tx.x("UPDATE api_tokens SET last_used = now() WHERE id = %s", (row["id"],))
            role = "Operator" if any(s.endswith(":write") for s in row["scopes"]) else "Viewer"
            return Ctx(None, "token:" + row["name"], row["email"] or "", row["workspace_id"], role, ip)
        user_id = decode_access_token(token)
        if not user_id:
            raise HTTPException(401, "Invalid or expired token")
        user = tx.one("SELECT id, name, email FROM users WHERE id = %s", (user_id,))
        if not user:
            raise HTTPException(401, "Unknown user")
        if x_workspace_id:
            m = tx.one("SELECT workspace_id, role FROM members WHERE user_id = %s AND workspace_id = %s AND status = 'Active'", (user_id, x_workspace_id))
        else:
            m = tx.one("SELECT workspace_id, role FROM members WHERE user_id = %s AND status = 'Active' ORDER BY created_at LIMIT 1", (user_id,))
        if not m:
            raise HTTPException(403, "You are not a member of this workspace")
        tx.x("UPDATE members SET last_active = now() WHERE user_id = %s AND workspace_id = %s", (user_id, m["workspace_id"]))
        return Ctx(user["id"], user["name"], user["email"], m["workspace_id"], m["role"], ip)


def require(min_role: str):
    """Dependency factory: `Depends(require('Operator'))` allows Operator, Admin and Owner."""

    def dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        if ROLE_RANK[ctx.role] < ROLE_RANK[min_role]:
            raise HTTPException(403, f"Requires {min_role} role or higher")
        return ctx

    return dep


viewer, operator, admin, owner = require("Viewer"), require("Operator"), require("Admin"), require("Owner")
