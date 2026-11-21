-- Milestone 08: Safe Uptime Monitoring, Incident Timelines, Operational Events, and GitHub Webhook Deduplication

CREATE TABLE IF NOT EXISTS uptime_monitors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES logical_projects(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES project_environments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  http_method TEXT NOT NULL DEFAULT 'HEAD' CHECK (http_method IN ('HEAD', 'GET')),
  expected_status_min INTEGER NOT NULL DEFAULT 200 CHECK (expected_status_min BETWEEN 100 AND 599),
  expected_status_max INTEGER NOT NULL DEFAULT 399 CHECK (expected_status_max BETWEEN 100 AND 599),
  interval_seconds INTEGER NOT NULL DEFAULT 600 CHECK (interval_seconds >= 300),
  timeout_ms INTEGER NOT NULL DEFAULT 8000 CHECK (timeout_ms BETWEEN 1000 AND 15000),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 2 AND 10),
  recovery_threshold INTEGER NOT NULL DEFAULT 2 CHECK (recovery_threshold BETWEEN 2 AND 10),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN (
      'PENDING',
      'HEALTHY',
      'DEGRADED',
      'SUSPECTED_OUTAGE',
      'CONFIRMED_OUTAGE',
      'RECOVERING',
      'PAUSED'
    )
  ),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  consecutive_successes INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_successes >= 0),
  probe_region TEXT NOT NULL DEFAULT 'us-east-primary',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_checked_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uptime_monitors_workspace_project
  ON uptime_monitors(workspace_id, project_id, is_enabled);

CREATE TABLE IF NOT EXISTS uptime_probe_results (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES uptime_monitors(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES logical_projects(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  probe_region TEXT NOT NULL DEFAULT 'us-east-primary',
  resolved_ip TEXT,
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'OK',
      'HTTP_STATUS_MISMATCH',
      'TIMEOUT',
      'TLS_ERROR',
      'DNS_ERROR',
      'SSRF_BLOCKED',
      'CONNECTION_ERROR'
    )
  ),
  http_status INTEGER,
  response_time_ms INTEGER,
  tls_valid BOOLEAN,
  tls_expires_at TIMESTAMPTZ,
  error_category TEXT
);

CREATE INDEX IF NOT EXISTS idx_uptime_probe_results_monitor_checked
  ON uptime_probe_results(monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS uptime_incidents (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES uptime_monitors(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES logical_projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'CONFIRMED_OUTAGE' CHECK (
    status IN ('CONFIRMED_OUTAGE', 'RECOVERED')
  ),
  first_failed_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  last_failed_at TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ,
  failure_category TEXT NOT NULL,
  probe_region TEXT NOT NULL DEFAULT 'us-east-primary',
  consecutive_failure_count INTEGER NOT NULL DEFAULT 1,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uptime_incidents_workspace_project_status
  ON uptime_incidents(workspace_id, project_id, status, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS operational_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES logical_projects(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES project_environments(id) ON DELETE SET NULL,
  provider_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'DEPLOYMENT',
      'CI_WORKFLOW',
      'ERROR_SPIKE',
      'UPTIME_INCIDENT',
      'EDGE_ANOMALY',
      'BACKEND_PRESSURE',
      'TRAFFIC_DAILY_SUMMARY'
    )
  ),
  external_event_id TEXT NOT NULL,
  environment_name TEXT NOT NULL DEFAULT 'PRODUCTION',
  commit_sha TEXT,
  release_tag TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_granularity TEXT NOT NULL DEFAULT 'EVENT' CHECK (
    source_granularity IN ('EVENT', 'MINUTE', 'HOURLY', 'DAILY')
  ),
  source_timezone TEXT NOT NULL DEFAULT 'UTC',
  source_url TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_operational_events_workspace_provider_external UNIQUE (
    workspace_id,
    provider_key,
    external_event_id
  )
);

CREATE INDEX IF NOT EXISTS idx_operational_events_project_occurred
  ON operational_events(workspace_id, project_id, environment_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  installation_id BIGINT,
  repository_full_name TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed canonical Milestone 08 hosting, developer, and reliability metric definitions
INSERT INTO metric_definitions (
  id, canonical_key, provider_key, provider_metric_name, display_name, description,
  category, unit, value_type, aggregation_rule, numerator_metric_key, denominator_metric_key,
  weight_metric_key, is_additive_across_dates, is_additive_across_resources,
  supported_dimensions, supported_granularities, timezone_behavior,
  freshness_window_minutes, capability_key, schema_version
)
VALUES
  ('mdef_cf_http_requests_v1', 'cloudflare.http_requests_total', 'cloudflare', 'requests', 'Cloudflare HTTP Requests', 'Total HTTP edge requests served by Cloudflare zone (distinct from GA4 sessions).', 'reliability', 'requests', 'COUNT', 'SUM', NULL, NULL, NULL, true, true, ARRAY['date', 'zoneTag'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 30, 'edge_traffic', 1),
  ('mdef_cf_cache_hit_ratio_v1', 'cloudflare.cache_hit_ratio', 'cloudflare', 'cacheHitRatio', 'Cloudflare Cache Hit Ratio', 'Weighted cache hit ratio computed as sum(cachedRequests) / sum(totalRequests).', 'reliability', 'ratio', 'RATIO', 'WEIGHTED_RATIO', 'cloudflare.cached_requests', 'cloudflare.http_requests_total', NULL, false, false, ARRAY['date', 'zoneTag'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 30, 'edge_traffic', 1),
  ('mdef_cf_http_5xx_v1', 'cloudflare.http_5xx_responses', 'cloudflare', 'http5xxResponses', 'Cloudflare 5xx Responses', 'Total HTTP 5xx edge/origin error responses observed by Cloudflare.', 'reliability', 'requests', 'COUNT', 'SUM', NULL, NULL, NULL, true, true, ARRAY['date', 'zoneTag'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 30, 'edge_traffic', 1),
  ('mdef_vercel_deployments_v1', 'vercel.deployments_total', 'vercel', 'deployments', 'Vercel Deployments', 'Total Vercel deployments observed across the reporting window.', 'reliability', 'deployments', 'COUNT', 'SUM', NULL, NULL, NULL, true, true, ARRAY['date', 'projectId', 'target'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'deployment_reliability', 1),
  ('mdef_vercel_success_rate_v1', 'vercel.deployment_success_rate', 'vercel', 'deploymentSuccessRate', 'Vercel Deployment Success Rate', 'Completed READY deployments divided by READY + ERROR deployments.', 'reliability', 'ratio', 'RATIO', 'WEIGHTED_RATIO', 'vercel.deployments_ready', 'vercel.deployments_total', NULL, false, false, ARRAY['date', 'projectId'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'deployment_reliability', 1),
  ('mdef_vercel_billed_cost_v1', 'vercel.billed_cost', 'vercel', 'BilledCost', 'Vercel FOCUS Billed Cost', 'Vercel FOCUS 1.3 billed charges in billing currency (never summing heterogeneous currencies).', 'cost', 'currency', 'CURRENCY', 'SUM', NULL, NULL, NULL, true, false, ARRAY['date', 'serviceName', 'billingCurrency'], ARRAY['DAILY', 'MONTHLY'], 'UTC', 120, 'billing_focus_charges', 1),
  ('mdef_github_runs_v1', 'github.workflow_runs_total', 'github', 'workflow_runs', 'GitHub Workflow Runs', 'GitHub Actions workflow run attempts observed via read-only GitHub App.', 'reliability', 'runs', 'COUNT', 'SUM', NULL, NULL, NULL, true, true, ARRAY['date', 'repository'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'repository_activity', 1),
  ('mdef_github_success_rate_v1', 'github.workflow_success_rate', 'github', 'workflowSuccessRate', 'GitHub Workflow Success Rate', 'Passed workflow runs divided by passed + failed/timed-out runs.', 'reliability', 'ratio', 'RATIO', 'WEIGHTED_RATIO', 'github.workflow_runs_succeeded', 'github.workflow_runs_total', NULL, false, false, ARRAY['date', 'repository'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'repository_activity', 1),
  ('mdef_sentry_error_events_v1', 'sentry.error_events_total', 'sentry', 'error_events', 'Sentry Error Events', 'Aggregated Sentry error event volume (distinct from unique affected users).', 'reliability', 'events', 'COUNT', 'SUM', NULL, NULL, NULL, true, true, ARRAY['date', 'environment'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'issue_telemetry', 1),
  ('mdef_sentry_crash_free_v1', 'sentry.crash_free_session_rate', 'sentry', 'crashFreeSessionRate', 'Sentry Crash-Free Session Rate', 'Provider-reported crash-free session ratio from Sentry Release Health.', 'reliability', 'ratio', 'RATIO', 'WEIGHTED_RATIO', NULL, NULL, NULL, false, false, ARRAY['date', 'environment'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'issue_telemetry', 1),
  ('mdef_sentry_p95_ms_v1', 'sentry.transaction_p95_ms', 'sentry', 'p95', 'Sentry Transaction p95 Latency', 'Provider-computed p95 transaction latency (never extrapolated from averages).', 'reliability', 'ms', 'DURATION', 'LATEST_GAUGE', NULL, NULL, NULL, false, false, ARRAY['date', 'environment'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'issue_telemetry', 1),
  ('mdef_avenor_uptime_ratio_v1', 'avenor.uptime_availability_ratio', 'avenor-uptime', 'availabilityRatio', 'Avenor Observed Uptime Ratio', 'Single-region observed probe success ratio across authorized public monitors.', 'reliability', 'ratio', 'RATIO', 'WEIGHTED_RATIO', NULL, NULL, NULL, false, false, ARRAY['date', 'probeRegion'], ARRAY['DAILY', 'WINDOW_TOTAL'], 'UTC', 15, 'uptime_monitoring', 1)
ON CONFLICT (id) DO NOTHING;
