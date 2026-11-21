-- Milestone 05: Google Cloud Cost Intelligence, Normalized Billing Ledger, and User-Owned Spending Thresholds

CREATE TABLE IF NOT EXISTS billing_cost_ledger_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES logical_projects(id) ON DELETE SET NULL,
  environment_id TEXT REFERENCES project_environments(id) ON DELETE SET NULL,
  provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  connected_resource_id TEXT NOT NULL REFERENCES connected_resources(id) ON DELETE CASCADE,
  billing_account_id TEXT NOT NULL,
  gcp_project_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  invoice_month TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_description TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  sku_description TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'global',
  cost_type TEXT NOT NULL DEFAULT 'regular' CHECK (
    cost_type IN ('regular', 'tax', 'adjustment', 'rounding error')
  ),
  currency TEXT NOT NULL,
  currency_conversion_rate NUMERIC(20, 8) NOT NULL DEFAULT 1.0,
  gross_cost NUMERIC(20, 6) NOT NULL,
  credits_amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
  net_cost NUMERIC(20, 6) NOT NULL,
  credit_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage_amount NUMERIC(20, 6),
  usage_unit TEXT,
  completeness_state TEXT NOT NULL DEFAULT 'PROVISIONAL' CHECK (
    completeness_state IN ('COMPLETE', 'PROVISIONAL', 'PARTIAL', 'STALE', 'UNAVAILABLE')
  ),
  export_time TIMESTAMPTZ,
  query_bytes_processed BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_billing_cost_ledger_identity UNIQUE (
    workspace_id,
    connected_resource_id,
    billing_account_id,
    gcp_project_id,
    usage_date,
    invoice_month,
    service_id,
    sku_id,
    region,
    cost_type,
    currency
  )
);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_workspace_date
  ON billing_cost_ledger_entries(workspace_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_project_date
  ON billing_cost_ledger_entries(project_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_invoice_month
  ON billing_cost_ledger_entries(workspace_id, invoice_month, currency);

CREATE TABLE IF NOT EXISTS cost_spending_thresholds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES logical_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'PROJECT' CHECK (
    scope_type IN ('WORKSPACE', 'PROJECT', 'GCP_PROJECT', 'SERVICE')
  ),
  gcp_project_id TEXT,
  service_description TEXT,
  metric_basis TEXT NOT NULL DEFAULT 'NET_COST' CHECK (
    metric_basis IN ('NET_COST', 'GROSS_COST')
  ),
  period_type TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (
    period_type IN ('DAILY', 'WEEKLY_ROLLING', 'MONTHLY')
  ),
  currency TEXT NOT NULL,
  warning_amount NUMERIC(20, 6) CHECK (warning_amount IS NULL OR warning_amount > 0),
  critical_amount NUMERIC(20, 6) NOT NULL CHECK (critical_amount > 0),
  evaluation_frequency TEXT NOT NULL DEFAULT 'EVERY_SYNC' CHECK (
    evaluation_frequency IN ('EVERY_SYNC', 'DAILY', 'HOURLY')
  ),
  notification_channels TEXT[] NOT NULL DEFAULT ARRAY['IN_APP']::TEXT[],
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_evaluated_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'OK' CHECK (
    last_status IN ('OK', 'WARNING', 'CRITICAL', 'CURRENCY_MISMATCH', 'INSUFFICIENT_DATA')
  ),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_thresholds_workspace_enabled
  ON cost_spending_thresholds(workspace_id, is_enabled);

CREATE INDEX IF NOT EXISTS idx_cost_thresholds_project_id
  ON cost_spending_thresholds(project_id);

CREATE TABLE IF NOT EXISTS cost_threshold_evaluations (
  id TEXT PRIMARY KEY,
  threshold_id TEXT NOT NULL REFERENCES cost_spending_thresholds(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES logical_projects(id) ON DELETE SET NULL,
  period_key TEXT NOT NULL,
  period_start_date TEXT NOT NULL,
  period_end_date TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN ('OK', 'WARNING', 'CRITICAL', 'CURRENCY_MISMATCH', 'INSUFFICIENT_DATA')
  ),
  observed_amount NUMERIC(20, 6),
  threshold_amount NUMERIC(20, 6) NOT NULL,
  currency TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  alert_triggered BOOLEAN NOT NULL DEFAULT false,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cost_threshold_eval_dedupe UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_cost_threshold_evals_threshold_time
  ON cost_threshold_evaluations(threshold_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_threshold_evals_workspace_time
  ON cost_threshold_evaluations(workspace_id, evaluated_at DESC);

-- Seed Milestone 05 Canonical Google Cloud Billing Cost Metric Definitions
INSERT INTO metric_definitions (
  id,
  canonical_key,
  provider_key,
  provider_metric_name,
  display_name,
  description,
  category,
  unit,
  value_type,
  aggregation_rule,
  numerator_metric_key,
  denominator_metric_key,
  weight_metric_key,
  is_additive_across_dates,
  is_additive_across_resources,
  supported_dimensions,
  supported_granularities,
  timezone_behavior,
  freshness_window_minutes,
  capability_key,
  schema_version
) VALUES
  (
    'mdef_gcp_billing_gross_cost_v1',
    'gcp_billing.gross_cost',
    'gcp-billing',
    'gross_cost',
    'Gross Cloud Cost (Before Credits)',
    'Google Cloud usage cost before promotional, sustained-use, committed-use, or free-tier credits from BigQuery Cloud Billing Export.',
    'cost',
    'currency',
    'CURRENCY',
    'SUM',
    NULL,
    NULL,
    NULL,
    true,
    true,
    ARRAY['date', 'service', 'sku', 'project', 'region', 'currency', 'invoiceMonth', 'costType'],
    ARRAY['DAILY', 'MONTHLY', 'WINDOW_TOTAL'],
    'BILLING_ACCOUNT_LOCAL',
    720,
    'billing_cost_export',
    1
  ),
  (
    'mdef_gcp_billing_credits_v1',
    'gcp_billing.credits',
    'gcp-billing',
    'credits',
    'Cloud Billing Credits & Discounts',
    'Total applied Google Cloud credits (sustained-use discounts, committed-use discounts, free tier, promotions) from BigQuery Cloud Billing Export.',
    'cost',
    'currency',
    'CURRENCY',
    'SUM',
    NULL,
    NULL,
    NULL,
    true,
    true,
    ARRAY['date', 'service', 'sku', 'project', 'region', 'currency', 'invoiceMonth', 'creditType'],
    ARRAY['DAILY', 'MONTHLY', 'WINDOW_TOTAL'],
    'BILLING_ACCOUNT_LOCAL',
    720,
    'billing_cost_export',
    1
  ),
  (
    'mdef_gcp_billing_net_cost_v1',
    'gcp_billing.net_cost',
    'gcp-billing',
    'net_cost',
    'Net Cloud Cost (After Credits)',
    'Actual net Google Cloud spend after subtracting applicable usage credits and discounts (cost + credits.amount) from BigQuery Cloud Billing Export.',
    'cost',
    'currency',
    'CURRENCY',
    'SUM',
    NULL,
    NULL,
    NULL,
    true,
    true,
    ARRAY['date', 'service', 'sku', 'project', 'region', 'currency', 'invoiceMonth', 'costType'],
    ARRAY['DAILY', 'MONTHLY', 'WINDOW_TOTAL'],
    'BILLING_ACCOUNT_LOCAL',
    720,
    'billing_cost_export',
    1
  )
ON CONFLICT (canonical_key) DO UPDATE SET
  provider_key = EXCLUDED.provider_key,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  supported_dimensions = EXCLUDED.supported_dimensions,
  supported_granularities = EXCLUDED.supported_granularities,
  updated_at = now();
