-- Milestone 10: Team Invitations, Per-Project Grants, Lemon Squeezy Subscriptions & Invoices, Atomic Quotas, Privacy Consents, and Support Requests

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'ANALYST', 'VIEWER')),
  project_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')
  ),
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace_status
  ON workspace_invitations(workspace_id, status, expires_at);

CREATE TABLE IF NOT EXISTS project_access_grants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES logical_projects(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'READ' CHECK (access_level IN ('READ', 'WRITE', 'ADMIN')),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_access_grants_user_project UNIQUE (workspace_id, user_id, project_id)
);

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'FREE' CHECK (plan_code IN ('FREE', 'PRO', 'TEAM')),
  billing_interval TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (billing_interval IN ('MONTHLY', 'ANNUAL')),
  provider_name TEXT NOT NULL DEFAULT 'LOCAL_FREE' CHECK (
    provider_name IN ('LOCAL_FREE', 'LOCAL_TRIAL', 'LEMON_SQUEEZY')
  ),
  provider_store_id TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  provider_variant_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'on_trial', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired')
  ),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_ends_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_webhook_events (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL DEFAULT 'LEMON_SQUEEZY',
  delivery_fingerprint TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  is_test_mode BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
  sanitized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_subscription_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'failed', 'pending')),
  invoice_url TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_workspace
  ON subscription_invoices(workspace_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS usage_quota_reservations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_usage_quota_reservation_op UNIQUE (workspace_id, resource_key, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_quota_reservations_lookup
  ON usage_quota_reservations(workspace_id, resource_key, period_key, status);

CREATE TABLE IF NOT EXISTS privacy_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (
    consent_type IN ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING_OPT_IN', 'AI_PROCESSING')
  ),
  policy_version TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_consents_user
  ON privacy_consents(user_id, consent_type, recorded_at DESC);

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  contact_email TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('BUG', 'BILLING', 'INTEGRATION', 'SECURITY', 'FEEDBACK', 'GENERAL')
  ),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_workspace
  ON support_requests(workspace_id, created_at DESC);
