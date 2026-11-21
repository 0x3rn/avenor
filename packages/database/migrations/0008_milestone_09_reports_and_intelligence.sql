-- Milestone 09: Configurable Reports, Statistical Anomalies, Scheduled Digests, Outbound Channels, Evidence-Linked Insights, Data Exports, and Retention Policies

CREATE TABLE IF NOT EXISTS saved_reports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  project_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  environment_filter TEXT NOT NULL DEFAULT 'PRODUCTION',
  metric_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  date_preset TEXT NOT NULL DEFAULT '28d',
  visualization_type TEXT NOT NULL DEFAULT 'COMPARISON_TABLE' CHECK (
    visualization_type IN (
      'SUMMARY_CARDS',
      'LINE_CHART',
      'BAR_CHART',
      'COMPARISON_TABLE',
      'BREAKDOWN_TABLE',
      'INCIDENT_TIMELINE'
    )
  ),
  comparison_enabled BOOLEAN NOT NULL DEFAULT true,
  definition_version INTEGER NOT NULL DEFAULT 1,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_workspace
  ON saved_reports(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES logical_projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'ROBUST_MAD_ZSCORE',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'INVALIDATED_BY_REVISION')
  ),
  severity TEXT NOT NULL DEFAULT 'WARNING' CHECK (
    severity IN ('INFO', 'WARNING', 'CRITICAL')
  ),
  observed_value NUMERIC(20, 6) NOT NULL,
  baseline_median NUMERIC(20, 6) NOT NULL,
  baseline_mad NUMERIC(20, 6) NOT NULL,
  z_score NUMERIC(12, 4) NOT NULL,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 1),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  explanation TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_workspace_status
  ON anomaly_detections(workspace_id, project_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS digest_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  project_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  channels TEXT[] NOT NULL DEFAULT ARRAY['IN_APP', 'EMAIL']::TEXT[],
  recipient_user_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_window_key TEXT,
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digest_schedules_workspace
  ON digest_schedules(workspace_id, is_enabled, cadence);

CREATE TABLE IF NOT EXISTS outbound_webhook_channels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('SLACK', 'TELEGRAM', 'SIGNED_WEBHOOK')),
  name TEXT NOT NULL,
  target_url_encrypted TEXT NOT NULL,
  signing_secret_encrypted TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_channels_workspace
  ON outbound_webhook_channels(workspace_id, channel_type, is_enabled);

CREATE TABLE IF NOT EXISTS insight_summaries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES logical_projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('DETERMINISTIC', 'AI_ASSISTED')),
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  caveats TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  suggested_checks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  verified_numeric_claims BOOLEAN NOT NULL DEFAULT true,
  provider_model TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insight_summaries_workspace
  ON insight_summaries(workspace_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_export_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  export_type TEXT NOT NULL CHECK (
    export_type IN (
      'REPORT_CSV',
      'REPORT_PDF',
      'HISTORICAL_METRICS_CSV',
      'HISTORICAL_METRICS_JSON',
      'PERSONAL_ACCOUNT_JSON'
    )
  ),
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('QUEUED', 'READY', 'EXPIRED', 'FAILED')),
  project_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  date_start TEXT,
  date_end TEXT,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  checksum_sha256 TEXT NOT NULL,
  content_payload TEXT NOT NULL,
  provenance_header TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_export_jobs_workspace
  ON data_export_jobs(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_retention_policies (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_retention_days INTEGER NOT NULL DEFAULT 365 CHECK (metric_retention_days BETWEEN 30 AND 1095),
  event_retention_days INTEGER NOT NULL DEFAULT 180 CHECK (event_retention_days BETWEEN 14 AND 730),
  export_expiry_hours INTEGER NOT NULL DEFAULT 24 CHECK (export_expiry_hours BETWEEN 1 AND 168),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
