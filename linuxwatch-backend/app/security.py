"""Passwords, JWTs, API/agent tokens, secret encryption, SSRF guard, login rate limiting."""
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import threading
import time
from urllib.parse import urlparse

import jwt
from cryptography.fernet import Fernet, InvalidToken

from .config import settings

# ---------- passwords (scrypt, stdlib) ----------
_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt$%d$%d$%d$%s$%s" % (_N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except Exception:
        return False


def password_issues(p: str) -> list:
    out = []
    if len(p) < 8:
        out.append("at least 8 characters")
    if not any(c.islower() for c in p):
        out.append("a lowercase letter")
    if not any(c.isupper() for c in p):
        out.append("an uppercase letter")
    if not any(c.isdigit() for c in p):
        out.append("a number")
    return out


# ---------- JWT ----------
def create_access_token(user_id: str, remember: bool = False) -> tuple:
    ttl = settings.remember_me_days * 86400 if remember else settings.access_token_hours * 3600
    now = int(time.time())
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + ttl, "typ": "access"}, settings.secret_key, algorithm="HS256"), ttl


def decode_access_token(token: str):
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        return data["sub"] if data.get("typ") == "access" else None
    except Exception:
        return None


# ---------- opaque tokens (agent registration tokens, API tokens) ----------
def new_token(prefix: str, nbytes: int = 30) -> str:
    return prefix + secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Tokens are high-entropy random strings, so a fast SHA-256 is appropriate (and allows indexed lookup)."""
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- encryption of integration secrets ----------
def _fernet() -> Fernet:
    key = settings.encryption_key
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(("lw-enc:" + settings.secret_key).encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt_json(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_json(blob: str) -> dict:
    if not blob:
        return {}
    try:
        return json.loads(_fernet().decrypt(blob.encode()).decode())
    except (InvalidToken, ValueError):
        return {}


# ---------- SSRF guard for outbound webhooks ----------
def assert_public_url(url: str) -> None:
    """Raise ValueError if the URL is not http(s) or points at a private/loopback/link-local address."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("URL must start with http:// or https://")
    if settings.allow_private_webhooks:
        return
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError("Host name could not be resolved")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise ValueError("URL resolves to a private or reserved address (blocked). Set ALLOW_PRIVATE_WEBHOOKS=true to permit internal targets.")


# ---------- login throttling (per process) ----------
class LoginLimiter:
    def __init__(self, max_fail: int = 6, window: int = 900):
        self.max_fail, self.window = max_fail, window
        self.fails = {}
        self.lock = threading.Lock()

    def _prune(self, key, now):
        self.fails[key] = [t for t in self.fails.get(key, []) if now - t < self.window]

    def blocked(self, key: str) -> bool:
        with self.lock:
            now = time.time()
            self._prune(key, now)
            return len(self.fails[key]) >= self.max_fail

    def fail(self, key: str):
        with self.lock:
            self.fails.setdefault(key, []).append(time.time())

    def reset(self, key: str):
        with self.lock:
            self.fails.pop(key, None)


login_limiter = LoginLimiter()
