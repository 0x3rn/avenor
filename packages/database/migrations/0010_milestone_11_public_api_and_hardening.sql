-- Milestone 11: Public Read-Only API Tokens, Outgoing Webhooks, SLO Telemetry & Feature Kill Switches

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['projects:read', 'metrics:read'],
  allowed_project_ids TEXT[],
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_workspace
  ON api_tokens (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outgoing_webhook_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  encrypted_signing_secret TEXT NOT NULL,
  subscribed_events TEXT[] NOT NULL DEFAULT ARRAY['incident.opened', 'incident.resolved', 'anomaly.detected'],
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_delivered_at TIMESTAMPTZ,
  last_status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outgoing_webhook_subscriptions_workspace
  ON outgoing_webhook_subscriptions (workspace_id, enabled);

CREATE TABLE IF NOT EXISTS slo_measurements (
  id TEXT PRIMARY KEY,
  service_surface TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  total_requests INTEGER NOT NULL DEFAULT 0,
  client_4xx_requests INTEGER NOT NULL DEFAULT 0,
  server_5xx_requests INTEGER NOT NULL DEFAULT 0,
  p50_latency_ms NUMERIC(12, 2),
  p95_latency_ms NUMERIC(12, 2),
  p99_latency_ms NUMERIC(12, 2),
  availability_ratio NUMERIC(8, 6),
  error_budget_burn_rate NUMERIC(10, 4),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slo_measurements_surface_window
  ON slo_measurements (service_surface, window_end DESC);

CREATE TABLE IF NOT EXISTS feature_kill_switches (
  switch_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite performance indexes for high-scale multi-project queries
CREATE INDEX IF NOT EXISTS idx_metric_observations_ws_proj_metric_date
  ON metric_observations (workspace_id, project_id, canonical_metric_key, period_start_date DESC);

CREATE INDEX IF NOT EXISTS idx_operational_events_ws_provider_occurred
  ON operational_events (workspace_id, provider_key, occurred_at DESC);
