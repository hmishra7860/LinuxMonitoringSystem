"""Outbound notification senders (email/SMTP, Slack, Microsoft Teams, generic webhook). Blocking; run in a worker thread."""
import base64
import json
import re
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage

from ..security import assert_public_url

TIMEOUT = 15


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):  # a redirect could bounce us to an internal address (SSRF)
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def alert_context(alert: dict, server_name: str) -> dict:
    return {
        "alert.id": alert["id"], "alert.severity": alert["severity"], "alert.metric": alert["metric"],
        "alert.value": f'{alert["value"]}{alert.get("unit", "")}', "alert.threshold": f'{alert["threshold"]}{alert.get("unit", "")}',
        "alert.status": alert["status"], "alert.module": alert["module"], "server.name": server_name, "server.client": alert.get("client", ""),
    }


def render_template(template: str, ctx: dict) -> str:
    """Replace {{key}} placeholders. Values are JSON-string-escaped so the result stays valid JSON."""
    def sub(m):
        return json.dumps(str(ctx.get(m.group(1).strip(), "")))[1:-1]
    return re.sub(r"\{\{\s*([\w.]+)\s*\}\}", sub, template)


def summary_line(ctx: dict) -> str:
    return f'{ctx["alert.severity"].upper()}: {ctx["alert.metric"]} is {ctx["alert.value"]} on {ctx["server.name"]} (threshold {ctx["alert.threshold"]}) [{ctx["alert.id"]}]'


def test_context() -> dict:
    return {"alert.id": "TEST-0001", "alert.severity": "critical", "alert.metric": "CPU usage (test)", "alert.value": "97%", "alert.threshold": "90%",
            "alert.status": "active", "alert.module": "cpu", "server.name": "linuxwatch-test", "server.client": "LinuxWatch"}


def _post_json(url: str, body: bytes, headers: dict, method: str = "POST"):
    assert_public_url(url)
    req = urllib.request.Request(url, data=body, method=method, headers={"Content-Type": "application/json", "User-Agent": "LinuxWatch/1.0", **headers})
    try:
        with _opener.open(req, timeout=TIMEOUT) as resp:
            return True, f"HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        return False, f"Endpoint returned HTTP {e.code}"
    except Exception as e:  # DNS, TLS, timeout...
        return False, f"{type(e).__name__}: {e}"[:200]


def send_email(config: dict, secrets: dict, ctx: dict):
    host, port, sec = config.get("host"), int(config.get("port") or 587), config.get("security", "STARTTLS")
    msg = EmailMessage()
    msg["Subject"] = f'[LinuxWatch] {ctx["alert.severity"].upper()} {ctx["alert.metric"]} on {ctx["server.name"]}'
    msg["From"], msg["To"] = config["sender"], ", ".join(config.get("recipients") or [])
    msg.set_content(summary_line(ctx) + f'\n\nClient: {ctx["server.client"]}\nModule: {ctx["alert.module"]}\nStatus: {ctx["alert.status"]}\n')
    try:
        if sec == "SSL/TLS":
            smtp = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(host, port, timeout=TIMEOUT)
        with smtp:
            smtp.ehlo()
            if sec == "STARTTLS":
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if config.get("username"):
                smtp.login(config["username"], secrets.get("password", ""))
            smtp.send_message(msg)
        return True, "Email accepted by SMTP server"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"[:200]


def send_slack(config: dict, secrets: dict, ctx: dict):
    color = {"critical": "#f0525a", "warning": "#f5b82e"}.get(ctx["alert.severity"], "#4c8dff")
    body = {"text": summary_line(ctx), "attachments": [{"color": color, "fields": [
        {"title": "Server", "value": ctx["server.name"], "short": True}, {"title": "Metric", "value": ctx["alert.metric"], "short": True},
        {"title": "Value", "value": ctx["alert.value"], "short": True}, {"title": "Threshold", "value": ctx["alert.threshold"], "short": True}]}]}
    if config.get("channel"):
        body["channel"] = config["channel"]
    return _post_json(secrets["webhookUrl"], json.dumps(body).encode(), {})


def send_teams(config: dict, secrets: dict, ctx: dict):
    body = {"@type": "MessageCard", "@context": "http://schema.org/extensions", "summary": summary_line(ctx),
            "themeColor": "F0525A" if ctx["alert.severity"] == "critical" else "F5B82E",
            "title": f'{ctx["alert.severity"].upper()}: {ctx["alert.metric"]}',
            "sections": [{"facts": [{"name": "Server", "value": ctx["server.name"]}, {"name": "Value", "value": ctx["alert.value"]},
                                    {"name": "Threshold", "value": ctx["alert.threshold"]}, {"name": "Alert", "value": ctx["alert.id"]}]}]}
    return _post_json(secrets["webhookUrl"], json.dumps(body).encode(), {})


def send_webhook(config: dict, secrets: dict, ctx: dict):
    headers = {h["k"]: h["v"] for h in config.get("headers") or [] if h.get("k")}
    auth, token = config.get("auth", "none"), secrets.get("token", "")
    if auth == "bearer":
        headers["Authorization"] = f"Bearer {token}"
    elif auth == "basic":
        headers["Authorization"] = "Basic " + base64.b64encode(token.encode()).decode()
    elif auth == "header":
        headers["X-API-Key"] = token
    body = render_template(config.get("template") or '{"alert": "{{alert.id}}"}', ctx).encode()
    return _post_json(config["url"], body, headers, config.get("method", "POST"))


SENDERS = {"email": send_email, "slack": send_slack, "teams": send_teams, "webhook": send_webhook}
REQUIRED_SECRET = {"email": "password", "slack": "webhookUrl", "teams": "webhookUrl", "webhook": None}


def send(integration_type: str, config: dict, secrets: dict, ctx: dict):
    need = REQUIRED_SECRET[integration_type]
    if need and not secrets.get(need):
        return False, "Required secret is missing"
    try:
        return SENDERS[integration_type](config, secrets, ctx)
    except ValueError as e:  # SSRF guard
        return False, str(e)
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"[:200]
