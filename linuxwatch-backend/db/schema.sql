-- LinuxWatch PostgreSQL schema (PostgreSQL 14+). Idempotent: safe to run on every start.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  company       text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  plan       text NOT NULL DEFAULT 'Trial',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('Owner','Admin','Operator','Viewer')),
  status       text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Invited')),
  last_active  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_ws_email_uq ON members (workspace_id, lower(email));
CREATE INDEX IF NOT EXISTS members_user_idx ON members (user_id);

CREATE TABLE IF NOT EXISTS servers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  hostname      text NOT NULL,
  ip            text NOT NULL DEFAULT '—',
  os            text NOT NULL DEFAULT 'Linux',
  os_version    text NOT NULL DEFAULT '—',
  kernel        text NOT NULL DEFAULT '—',
  agent_version text NOT NULL DEFAULT '—',
  client        text NOT NULL,
  env           text NOT NULL CHECK (env IN ('Production','Development','Testing')),
  region        text NOT NULL DEFAULT '',
  tags          text[] NOT NULL DEFAULT '{}',
  description   text NOT NULL DEFAULT '',
  monitoring    jsonb NOT NULL DEFAULT '{}',
  token_hash    text NOT NULL,
  token_prefix  text NOT NULL,
  pending       boolean NOT NULL DEFAULT true,
  agent_online  boolean NOT NULL DEFAULT false,
  last_heartbeat timestamptz,
  uptime_sec    bigint NOT NULL DEFAULT 0,
  cores         int NOT NULL DEFAULT 1,
  ram_total_gb  double precision NOT NULL DEFAULT 0,
  disk_total_gb double precision NOT NULL DEFAULT 0,
  swap_total_gb double precision NOT NULL DEFAULT 0,
  cpu           double precision NOT NULL DEFAULT 0,
  mem           double precision NOT NULL DEFAULT 0,
  disk          double precision NOT NULL DEFAULT 0,
  swap_pct      double precision NOT NULL DEFAULT 0,
  net_in        double precision NOT NULL DEFAULT 0,
  net_out       double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS servers_ws_name_uq ON servers (workspace_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS servers_token_uq ON servers (token_hash);
CREATE INDEX IF NOT EXISTS servers_ws_idx ON servers (workspace_id);

CREATE TABLE IF NOT EXISTS server_services (
  server_id  uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       text NOT NULL,
  unit       text NOT NULL,
  monitored  boolean NOT NULL DEFAULT false,
  status     text NOT NULL DEFAULT 'unknown',
  since      timestamptz NOT NULL DEFAULT now(),
  bad_since  timestamptz,
  PRIMARY KEY (server_id, name)
);

CREATE TABLE IF NOT EXISTS server_snapshots (
  server_id   uuid PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  per_core    jsonb NOT NULL DEFAULT '[]',
  load_avg    jsonb NOT NULL DEFAULT '[0,0,0]',
  filesystems jsonb NOT NULL DEFAULT '[]',
  interfaces  jsonb NOT NULL DEFAULT '[]',
  processes   jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS metrics (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts        timestamptz NOT NULL,
  cpu       double precision,
  mem       double precision,
  disk      double precision,
  swap      double precision,
  net_in    double precision,
  net_out   double precision,
  PRIMARY KEY (server_id, ts)
);
CREATE INDEX IF NOT EXISTS metrics_ts_idx ON metrics (ts);

CREATE TABLE IF NOT EXISTS logs (
  id        bigserial PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts        timestamptz NOT NULL,
  level     text NOT NULL CHECK (level IN ('INFO','WARNING','ERROR','CRITICAL')),
  source    text NOT NULL DEFAULT '',
  message   text NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_server_ts_idx ON logs (server_id, ts DESC);

CREATE TABLE IF NOT EXISTS server_downtime (
  id         bigserial PRIMARY KEY,
  server_id  uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX IF NOT EXISTS downtime_server_idx ON server_downtime (server_id, started_at);

CREATE TABLE IF NOT EXISTS policies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  is_default   boolean NOT NULL DEFAULT false,
  enabled      boolean NOT NULL DEFAULT true,
  config       jsonb NOT NULL,
  assignments  jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS policies_ws_name_uq ON policies (workspace_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS policies_one_default_uq ON policies (workspace_id) WHERE is_default;

CREATE SEQUENCE IF NOT EXISTS alert_seq START 3000;
CREATE SEQUENCE IF NOT EXISTS suppression_seq START 1000;

CREATE TABLE IF NOT EXISTS alerts (
  id           text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  server_id    uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  server_name  text NOT NULL,
  client       text NOT NULL,
  module       text NOT NULL,
  key          text NOT NULL,
  metric       text NOT NULL,
  value        text NOT NULL,
  value_num    double precision,
  unit         text NOT NULL DEFAULT '',
  threshold    text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('warning','critical')),
  status       text NOT NULL CHECK (status IN ('active','acknowledged','resolved','suppressed')),
  prev_status  text,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  ack_by       text,
  resolved_by  text,
  simulated    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS alerts_ws_status_idx ON alerts (workspace_id, status, triggered_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_open_uq ON alerts (server_id, key) WHERE status <> 'resolved' AND NOT simulated;

CREATE TABLE IF NOT EXISTS suppressions (
  id           text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target       text NOT NULL,
  target_label text NOT NULL,
  modules      text[] NOT NULL,
  duration_id  text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  reason       text NOT NULL DEFAULT '',
  created_by   text NOT NULL,
  ended_at     timestamptz,
  ended_by     text
);
CREATE INDEX IF NOT EXISTS suppressions_ws_idx ON suppressions (workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS suppression_audit (
  id             bigserial PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ts             timestamptz NOT NULL DEFAULT now(),
  action         text NOT NULL CHECK (action IN ('suppress','unsuppress','expired')),
  suppression_id text NOT NULL,
  user_name      text NOT NULL,
  details        text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS supaudit_ws_idx ON suppression_audit (workspace_id, ts DESC);

CREATE TABLE IF NOT EXISTS integrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('email','slack','teams','webhook')),
  name         text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'untested',
  last_success timestamptz,
  last_failure timestamptz,
  config       jsonb NOT NULL DEFAULT '{}',
  secrets_enc  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  severities      text[] NOT NULL,
  modules         text[] NOT NULL,
  scope_type      text NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','client','environment','server')),
  scope_value     text NOT NULL DEFAULT '',
  integration_ids uuid[] NOT NULL DEFAULT '{}',
  enabled         boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS deliveries (
  id             bigserial PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ts             timestamptz NOT NULL DEFAULT now(),
  integration_id uuid,
  kind           text NOT NULL,
  alert_id       text,
  status         text NOT NULL,
  summary        text NOT NULL DEFAULT '',
  error          text
);
CREATE INDEX IF NOT EXISTS deliveries_ws_idx ON deliveries (workspace_id, ts DESC);

CREATE TABLE IF NOT EXISTS events (
  id           bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ts           timestamptz NOT NULL DEFAULT now(),
  type         text NOT NULL,
  severity     text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  alert_id     text,
  server_id    uuid
);
CREATE INDEX IF NOT EXISTS events_ws_idx ON events (workspace_id, ts DESC);

CREATE TABLE IF NOT EXISTS api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  scopes       text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used    timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ts           timestamptz NOT NULL DEFAULT now(),
  user_name    text NOT NULL,
  action       text NOT NULL,
  detail       text NOT NULL DEFAULT '',
  ip           text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_ws_idx ON audit_log (workspace_id, ts DESC);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  data         jsonb NOT NULL DEFAULT '{}'
);
