-- Milestone 07: Private MVP Access Requests, Resumable Onboarding, Baseline Alert Rules/Incidents, In-App & Email Notification Delivery, and Persistent Notification Preferences

CREATE TABLE IF NOT EXISTS private_access_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  product_count_hint TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  ),
  source_ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_private_access_requests_email UNIQUE (normalized_email)
);

CREATE INDEX IF NOT EXISTS idx_private_access_requests_status_created
  ON private_access_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_private_access_requests_ip_created
  ON private_access_requests(source_ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  current_step TEXT NOT NULL DEFAULT 'workspace' CHECK (
    current_step IN ('workspace', 'project', 'environments', 'connections', 'sync', 'completed')
  ),
  completed_steps TEXT[] NOT NULL DEFAULT ARRAY['workspace']::TEXT[],
  draft_project_id TEXT REFERENCES logical_projects(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_onboarding_progress_user_workspace UNIQUE (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_workspace
  ON onboarding_progress(workspace_id, current_step);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES logical_projects(id) ON DELETE CASCADE,
  connected_resource_id TEXT REFERENCES connected_resources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'PROVIDER_CONNECTION_FAILURE',
      'STALE_DATA',
      'KPI_THRESHOLD',
      'CLOUD_SPENDING_THRESHOLD'
    )
  ),
  metric_key TEXT,
  operator TEXT NOT NULL DEFAULT 'GT' CHECK (
    operator IN ('GT', 'GTE', 'LT', 'LTE', 'STATUS_MATCH')
  ),
  threshold_value NUMERIC(20, 6),
  unit TEXT,
  currency TEXT,
  evaluation_window_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (evaluation_window_minutes > 0),
  freshness_required_minutes INTEGER NOT NULL DEFAULT 360 CHECK (freshness_required_minutes > 0),
  severity TEXT NOT NULL DEFAULT 'WARNING' CHECK (
    severity IN ('INFO', 'WARNING', 'CRITICAL')
  ),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace_enabled
  ON alert_rules(workspace_id, is_enabled, category);

CREATE INDEX IF NOT EXISTS idx_alert_rules_project
  ON alert_rules(project_id);

CREATE TABLE IF NOT EXISTS alert_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES logical_projects(id) ON DELETE SET NULL,
  connected_resource_id TEXT REFERENCES connected_resources(id) ON DELETE SET NULL,
  alert_rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'PROVIDER_CONNECTION_FAILURE',
      'STALE_DATA',
      'KPI_THRESHOLD',
      'CLOUD_SPENDING_THRESHOLD'
    )
  ),
  severity TEXT NOT NULL CHECK (
    severity IN ('INFO', 'WARNING', 'CRITICAL')
  ),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')
  ),
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  observed_value NUMERIC(20, 6),
  threshold_value NUMERIC(20, 6),
  unit TEXT,
  currency TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_alert_incidents_workspace_dedupe UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_workspace_status
  ON alert_incidents(workspace_id, status, last_evaluated_at DESC);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  incident_id TEXT REFERENCES alert_incidents(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_in_app_notifications_user_incident UNIQUE (workspace_id, user_id, incident_id)
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user_unread
  ON in_app_notifications(workspace_id, user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
  recipient_address TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'QUEUED',
      'ACCEPTED',
      'DELIVERED',
      'FAILED',
      'DEFERRED_QUIET_HOURS',
      'SUPPRESSED_PREFERENCE'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
  provider_name TEXT NOT NULL DEFAULT 'avenor_in_app',
  provider_message_id TEXT,
  error_summary TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_delivery_incident_user_channel UNIQUE (
    workspace_id,
    incident_id,
    user_id,
    channel
  )
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_workspace_status
  ON notification_deliveries(workspace_id, channel, status, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  enabled_categories TEXT[] NOT NULL DEFAULT ARRAY[
    'PROVIDER_CONNECTION_FAILURE',
    'STALE_DATA',
    'KPI_THRESHOLD',
    'CLOUD_SPENDING_THRESHOLD'
  ]::TEXT[],
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  quiet_hours_timezone TEXT NOT NULL DEFAULT 'UTC',
  quiet_hours_policy TEXT NOT NULL DEFAULT 'IN_APP_ONLY' CHECK (
    quiet_hours_policy IN ('DEFER', 'IN_APP_ONLY', 'DISABLED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_preferences_user_workspace UNIQUE (workspace_id, user_id)
);
