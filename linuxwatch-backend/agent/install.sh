#!/usr/bin/env bash
# LinuxWatch agent installer. Usage:
#   curl -fsSL __ENDPOINT__/agent/install.sh | sudo LW_TOKEN=lwt_xxx LW_ENDPOINT=__ENDPOINT__ bash
set -euo pipefail
: "${LW_TOKEN:?Set LW_TOKEN to the server registration token}"
LW_ENDPOINT="${LW_ENDPOINT:-__ENDPOINT__}"
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }

install -d -m 755 /opt/linuxwatch
install -d -m 700 /etc/linuxwatch
python3 -m venv /opt/linuxwatch/venv
/opt/linuxwatch/venv/bin/pip install --quiet --upgrade pip psutil
curl -fsSL "$LW_ENDPOINT/agent/lw_agent.py" -o /opt/linuxwatch/lw_agent.py
chmod 755 /opt/linuxwatch/lw_agent.py

umask 077
printf '[agent]\nendpoint = %s\ntoken = %s\n' "$LW_ENDPOINT" "$LW_TOKEN" > /etc/linuxwatch/agent.ini
chmod 600 /etc/linuxwatch/agent.ini

cat > /etc/systemd/system/linuxwatch-agent.service <<'UNIT'
[Unit]
Description=LinuxWatch monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/opt/linuxwatch/venv/bin/python /opt/linuxwatch/lw_agent.py --config /etc/linuxwatch/agent.ini
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now linuxwatch-agent
echo "LinuxWatch agent installed. Check: systemctl status linuxwatch-agent"
