# LinuxWatch

LinuxWatch is a full-stack, real-time infrastructure monitoring platform. It consists of a lightweight Python agent installed on your Linux servers, a high-performance FastAPI backend, a PostgreSQL database, and a reactive React dashboard.

## 🌟 Key Features

*   **Real-Time Monitoring:** Live metrics for CPU, memory, disk, network throughput, processes, systemd services, and journalctl logs.
*   **Live Dashboard:** WebSocket-powered React frontend that updates instantly without page refreshes.
*   **Advanced Alerting Engine:** 
    *   Define thresholds (Warning/Critical) based on duration (e.g., "CPU > 90% for 5 minutes").
    *   Inheritance-based alert policies assigned globally, by tag, by environment, or to specific servers.
*   **Smart Routing & Notifications:** Route alerts to Email (SMTP), Slack, Microsoft Teams, or custom Webhooks based on severity, module, and server groups.
*   **Alert Suppression:** Temporarily silence alerts and notifications during maintenance windows while metric collection continues uninterrupted.
*   **Role-Based Access Control (RBAC):** Built-in user management with Owner, Admin, Operator, and Viewer roles.
*   **Reporting:** Generate historical availability and metric reports with PDF and CSV exports.

---

## 🏗️ Architecture

The project is split into three main components:

1.  **Frontend (React 19 + Vite):** A single-page application served via Nginx. It communicates with the backend via REST APIs and WebSockets.
2.  **Backend (FastAPI + Python 3.12):** A high-concurrency API server utilizing `psycopg 3` for PostgreSQL connections, pure pure JWT authentication, and in-memory WebSocket hubs.
3.  **Agent (`lw_agent.py`):** A zero-configuration Python daemon using `psutil`. It registers via a secure token and pushes metrics to the API over HTTPS.

---

## 🚀 Getting Started (Docker Deployment)

The easiest way to run the platform is using the provided `docker-compose.yml` file, which spins up the Database, Backend, and Frontend.

### 1. Prerequisites
*   Docker and Docker Compose installed.
*   Port `80` available for the Web UI.
*   Port `8000` available for the API backend.

### 2. Configure Environment Variables
Ensure your `docker-compose.yml` has the correct environment variables set under the `api` service. 

*Note: The `DATABASE_URL` must use standard `postgresql://`, and `LW_SECRET_KEY` must be at least 32 characters.*

```yaml
    environment:
      - DATABASE_URL=postgresql://linuxwatch:lwpassword@db:5432/linuxwatch
      - LW_SECRET_KEY=your_super_secret_random_string_min_32_chars
      - ENVIRONMENT=development
      - AUTO_CREATE_TABLES=true
      - CORS_ORIGINS=http://localhost,http://localhost:80,http://localhost:5173
```

### 3. Start the Platform
Run the following command in the root directory:

```bash
docker compose up -d --build
```

### 4. Access the Application
*   **Web Dashboard:** `http://localhost`
*   **API Interactive Docs (Swagger):** `http://localhost:8000/docs`

Create your first account on the Web Dashboard (the first user creates a Workspace and becomes the Owner).

---

## 📡 Adding a Server & Installing the Agent

To monitor a Linux server, you must install the LinuxWatch agent on it.

1.  Log into the Web Dashboard.
2.  Navigate to **Infrastructure** -> **Add Server**.
3.  Fill out the server details (Name, Environment, Tags).
4.  Copy the generated **Quick Install** command.

### Virtual Machine Note (VirtualBox / VMware)
If your LinuxWatch platform is running on a Windows Host, and you are installing the agent on a local Linux VM (like RHEL or Ubuntu) using NAT networking, **you must change `localhost` in the curl command to your host's gateway IP** (typically `10.0.2.2` for VirtualBox).

**Example VM Installation Command:**
```bash
curl -fsSL http://10.0.2.2:8000/api/v1/agent/install.sh | sudo LW_TOKEN=lwt_YourUniqueTokenHere LW_ENDPOINT=http://10.0.2.2:8000/api/v1 bash
```

The script will automatically:
1. Create an isolated Python virtual environment at `/opt/linuxwatch`.
2. Install `psutil`.
3. Configure a systemd service (`linuxwatch-agent.service`).
4. Start streaming metrics to your dashboard immediately.

---

## 🛠️ Local Development

If you wish to develop without Docker:

**Backend:**
```bash
cd linuxwatch-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="postgresql://user:pass@localhost:5432/linuxwatch"
export LW_SECRET_KEY="your-32-char-secret"
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd linuxwatch-frontend-live
npm install
npm run dev
```
*(Ensure `public/config.js` points to `http://localhost:8000/api/v1`)*

---

## 🛡️ Security Notes

*   **API Tokens & Agent Tokens:** Stored exclusively as SHA-256 hashes in the database.
*   **Integration Secrets:** (Webhook tokens, SMTP passwords) are encrypted at rest using Fernet symmetric encryption.
*   **SSRF Protection:** Outbound webhooks block private, loopback, and link-local IP addresses by default to prevent Server-Side Request Forgery.