-- Milestone 02: Read-Only Provider Framework, Encrypted Vault, and OAuth State Lifecycle

ALTER TABLE provider_connections
  DROP CONSTRAINT IF EXISTS provider_connections_status_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_status_check CHECK (
    status IN (
      'NOT_CONNECTED',
      'CONNECTING',
      'SYNCING',
      'HEALTHY',
      'DEGRADED',
      'STALE',
      'WARNING',
      'PERMISSION_MISSING',
      'TOKEN_EXPIRED',
      'REVOKED',
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'FAILED',
      'DISCONNECTED'
    )
  );

ALTER TABLE provider_connections
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'oauth2',
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS external_account_label TEXT,
  ADD COLUMN IF NOT EXISTS requested_scopes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_summary TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('oauth_tokens', 'api_token', 'service_account')),
  key_id TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm' CHECK (algorithm = 'aes-256-gcm'),
  nonce_base64 TEXT NOT NULL,
  ciphertext_base64 TEXT NOT NULL,
  auth_tag_base64 TEXT NOT NULL,
  aad_hash TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  refresh_token_present BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ROTATED', 'REVOKED')),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_provider_credentials_connection UNIQUE (provider_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_workspace_id ON provider_credentials(workspace_id);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_org_id ON provider_credentials(organization_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_states (
  id TEXT PRIMARY KEY,
  state_token_hash TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('connect', 'reconsent')),
  target_connection_id TEXT REFERENCES provider_connections(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL DEFAULT '{}',
  code_verifier_ciphertext TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_oauth_authorization_states_token_hash UNIQUE (state_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_states_workspace_id ON oauth_authorization_states(workspace_id);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_states_user_id ON oauth_authorization_states(user_id);
