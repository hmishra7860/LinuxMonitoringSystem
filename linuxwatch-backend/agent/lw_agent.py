#!/usr/bin/env python3
"""LinuxWatch monitoring agent.

Collects CPU, memory, disk, network, process, systemd-service and journal data with psutil / systemctl / journalctl
and pushes it to the LinuxWatch API over HTTPS with the per-server registration token.

    python3 lw_agent.py --config /etc/linuxwatch/agent.ini
    python3 lw_agent.py --endpoint https://lw.example.com/api/v1 --token lwt_xxx --once   # one-shot test
"""
import argparse
import configparser
import json
import logging
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

import psutil

VERSION = "1.0.0"
log = logging.getLogger("lw-agent")
SKIP_FS = {"squashfs", "tmpfs", "devtmpfs", "overlay", "iso9660", "proc", "sysfs", "cgroup", "cgroup2", "autofs", "fuse.lxcfs", "ramfs", "efivarfs"}
SKIP_MOUNT_PREFIX = ("/snap", "/var/lib/docker", "/var/lib/containers", "/run", "/sys", "/proc", "/dev")
NAME_RE = re.compile(r"^[a-z0-9@:_.-]{2,40}$")
PRIORITY_LEVEL = {0: "CRITICAL", 1: "CRITICAL", 2: "CRITICAL", 3: "ERROR", 4: "WARNING", 5: "INFO", 6: "INFO", 7: "INFO"}


class Collector:
    def __init__(self):
        self.prev_net = None
        self.prev_ts = None
        self.last_log_ts = time.time()
        psutil.cpu_percent(interval=None)  # prime counters so the first real sample is meaningful
        psutil.cpu_percent(interval=None, percpu=True)
        for p in psutil.process_iter(["cpu_percent"]):
            pass

    # ---- helpers ----
    @staticmethod
    def os_info():
        info = {}
        try:
            with open("/etc/os-release", encoding="utf-8") as f:
                for line in f:
                    if "=" in line:
                        k, v = line.rstrip().split("=", 1)
                        info[k] = v.strip('"')
        except OSError:
            pass
        return info.get("NAME", platform.system()), info.get("VERSION_ID", platform.release())

    @staticmethod
    def primary_ip(host):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((host or "8.8.8.8", 80))  # UDP connect sends nothing; it only selects the outgoing interface
            ip = s.getsockname()[0]
            s.close()
            return ip
        except OSError:
            return ""

    def filesystems(self):
        out, seen = [], set()
        for part in psutil.disk_partitions(all=False):
            if part.fstype in SKIP_FS or part.mountpoint.startswith(SKIP_MOUNT_PREFIX) or part.device in seen:
                continue
            seen.add(part.device)
            try:
                u = psutil.disk_usage(part.mountpoint)
                st = os.statvfs(part.mountpoint)
            except OSError:
                continue
            inode = 100.0 * (st.f_files - st.f_ffree) / st.f_files if st.f_files else 0.0
            out.append({"mount": part.mountpoint, "device": part.device, "fs": part.fstype, "size": round(u.total / 2 ** 30, 2), "used": round(u.used / 2 ** 30, 2),
                        "pct": round(min(100.0, u.percent), 1), "inode": round(min(100.0, inode), 1)})
        return out

    def network(self, now):
        counters = psutil.net_io_counters(pernic=True)
        ifaces, tot_in, tot_out = [], 0.0, 0.0
        if self.prev_net is not None and now > self.prev_ts:
            dt = now - self.prev_ts
            for name, c in counters.items():
                p = self.prev_net.get(name)
                if not p:
                    continue
                rx = max(0.0, (c.bytes_recv - p.bytes_recv) * 8 / 1e6 / dt)
                tx = max(0.0, (c.bytes_sent - p.bytes_sent) * 8 / 1e6 / dt)
                ifaces.append({"name": name[:40], "rx": round(rx, 3), "tx": round(tx, 3), "rxPk": max(0, c.packets_recv - p.packets_recv), "txPk": max(0, c.packets_sent - p.packets_sent),
                               "errors": max(0, (c.errin - p.errin) + (c.errout - p.errout)), "drops": max(0, (c.dropin - p.dropin) + (c.dropout - p.dropout))})
                if name != "lo":
                    tot_in += rx
                    tot_out += tx
        self.prev_net, self.prev_ts = counters, now
        return ifaces, tot_in, tot_out

    @staticmethod
    def processes():
        rows = []
        for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_percent", "num_threads"]):
            i = p.info
            rows.append({"pid": i["pid"], "name": (i["name"] or "?")[:120], "user": (i["username"] or "")[:60], "cpu": round(i["cpu_percent"] or 0.0, 1),
                         "mem": round(min(100.0, i["memory_percent"] or 0.0), 1), "threads": i["num_threads"] or 1})
        top = {r["pid"]: r for r in sorted(rows, key=lambda r: r["cpu"], reverse=True)[:10]}
        top.update({r["pid"]: r for r in sorted(rows, key=lambda r: r["mem"], reverse=True)[:10]})
        return list(top.values())

    @staticmethod
    def services(units):
        if not shutil.which("systemctl"):
            return []
        out = []
        for unit in units:
            name = unit[:-8] if unit.endswith(".service") else unit
            if not NAME_RE.match(name.lower()):
                continue
            try:
                r = subprocess.run(["systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState"], capture_output=True, text=True, timeout=5)
                props = dict(l.split("=", 1) for l in r.stdout.splitlines() if "=" in l)
            except (subprocess.SubprocessError, OSError):
                continue
            if props.get("LoadState") == "not-found":
                status = "not-installed"
            else:
                a = props.get("ActiveState", "")
                status = "active" if a in ("active", "reloading", "activating") else "failed" if a == "failed" else "inactive"
            out.append({"name": name.lower(), "unit": unit[:80], "status": status})
        return out

    def logs(self):
        if not shutil.which("journalctl"):
            return []
        since = self.last_log_ts
        self.last_log_ts = time.time()
        try:
            r = subprocess.run(["journalctl", "-p", "4", "--since", f"@{int(since)}", "-o", "json", "--no-pager", "-n", "200"], capture_output=True, text=True, timeout=10)
        except (subprocess.SubprocessError, OSError):
            return []
        out = []
        for line in r.stdout.splitlines():
            try:
                j = json.loads(line)
                msg = j.get("MESSAGE", "")
                if isinstance(msg, list):
                    msg = bytes(msg).decode("utf-8", "replace")
                out.append({"ts": int(j["__REALTIME_TIMESTAMP"]) / 1e6, "level": PRIORITY_LEVEL.get(int(j.get("PRIORITY", 6)), "INFO"),
                            "source": str(j.get("SYSLOG_IDENTIFIER") or j.get("_COMM") or "")[:80], "message": str(msg)[:2000]})
            except (ValueError, KeyError, TypeError):
                continue
        return out

    # ---- main sample ----
    def collect(self, cfg, endpoint_host):
        mods = cfg.get("modules", {})
        now = time.time()
        vm, sw = psutil.virtual_memory(), psutil.swap_memory()
        fs = self.filesystems()
        total = sum(f["size"] for f in fs) or 0.0
        used = sum(f["used"] for f in fs)
        ifaces, net_in, net_out = self.network(now)
        os_name, os_ver = self.os_info()
        try:
            load = list(os.getloadavg())
        except OSError:
            load = [0.0, 0.0, 0.0]
        return {
            "agent_version": VERSION, "os": os_name, "os_version": os_ver, "kernel": platform.release(), "ip": self.primary_ip(endpoint_host),
            "uptime_sec": int(now - psutil.boot_time()), "cores": psutil.cpu_count(logical=True) or 1,
            "ram_total_gb": round(vm.total / 2 ** 30, 2), "disk_total_gb": round(total, 2), "swap_total_gb": round(sw.total / 2 ** 30, 2),
            "cpu": round(psutil.cpu_percent(interval=None), 1), "mem": round(vm.percent, 1), "disk": round(100.0 * used / total, 1) if total else 0.0, "swap": round(sw.percent, 1),
            "net_in": round(net_in, 3), "net_out": round(net_out, 3),
            "per_core": [round(c, 1) for c in psutil.cpu_percent(interval=None, percpu=True)], "load": load,
            "filesystems": fs, "interfaces": ifaces,
            "processes": self.processes() if mods.get("processes", True) else [],
            "services": self.services(cfg.get("services", [])) if mods.get("services", True) else [],
            "logs": self.logs() if mods.get("logs", True) else [],
        }


def post(endpoint, token, path, payload=None, timeout=20):
    req = urllib.request.Request(endpoint.rstrip("/") + path, data=json.dumps(payload).encode() if payload is not None else b"", method="POST",
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": f"lw-agent/{VERSION}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # TLS certificates are verified by default
        return json.loads(r.read().decode() or "{}")


def load_config(args):
    endpoint, token = args.endpoint, args.token
    if args.config and os.path.isfile(args.config):
        cp = configparser.ConfigParser()
        cp.read(args.config)
        endpoint = endpoint or cp.get("agent", "endpoint", fallback="")
        token = token or cp.get("agent", "token", fallback="")
        if os.stat(args.config).st_mode & 0o077:
            log.warning("%s is readable by other users; run: chmod 600 %s", args.config, args.config)
    endpoint = endpoint or os.environ.get("LW_ENDPOINT", "")
    token = token or os.environ.get("LW_TOKEN", "")
    if not endpoint or not token:
        sys.exit("endpoint and token are required (--config, --endpoint/--token, or LW_ENDPOINT/LW_TOKEN)")
    host = urlparse(endpoint).hostname or ""
    if endpoint.startswith("http://") and host not in ("localhost", "127.0.0.1", "::1"):
        log.warning("endpoint uses plain HTTP: the registration token and metrics travel unencrypted. Use https://")
    return endpoint, token, host


def main():
    ap = argparse.ArgumentParser(description="LinuxWatch monitoring agent")
    ap.add_argument("--config", default="/etc/linuxwatch/agent.ini")
    ap.add_argument("--endpoint")
    ap.add_argument("--token")
    ap.add_argument("--once", action="store_true", help="collect and send one sample, then exit")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    endpoint, token, host = load_config(args)

    stop = {"flag": False}
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.update(flag=True))

    cfg = {"interval": 30, "modules": {}, "services": ["sshd.service", "docker.service", "nginx.service", "postgresql.service", "cron.service"]}
    collector, backoff = Collector(), 0
    time.sleep(1.0)  # let CPU / network counters accumulate a first interval
    next_run = time.time()
    while not stop["flag"]:
        try:
            payload = collector.collect(cfg, host)
            resp = post(endpoint, token, "/agent/metrics", payload)
            cfg = {**cfg, **{k: v for k, v in resp.items() if k in ("interval", "modules", "services")}}
            cfg["interval"] = max(10, int(cfg.get("interval", 30)))
            backoff = 0
            log.info("sent: cpu=%.1f%% mem=%.1f%% disk=%.1f%%", payload["cpu"], payload["mem"], payload["disk"])
        except urllib.error.HTTPError as e:
            backoff = min(300, max(10, backoff * 2 or 10))
            log.error("server rejected data: HTTP %s %s%s", e.code, e.reason, " (token revoked or wrong?)" if e.code == 401 else "")
        except (urllib.error.URLError, OSError, ValueError) as e:
            backoff = min(300, max(5, backoff * 2 or 5))
            log.error("cannot reach server: %s (retry in %ss)", e, backoff)
        except Exception:  # never let one bad sample kill the agent
            log.exception("collection failed")
        if args.once:
            return
        next_run += cfg["interval"] + backoff
        if next_run < time.time():
            next_run = time.time() + cfg["interval"]
        while not stop["flag"] and time.time() < next_run:
            time.sleep(min(1.0, max(0.0, next_run - time.time())))


if __name__ == "__main__":
    main()
