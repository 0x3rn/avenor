"use client";

import type { WorkspaceGovernanceDetails, WorkspaceMemberRecord } from "@avenor/auth";
import type { AuditLogEntry } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Select,
  TextInput,
} from "@avenor/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface WorkspaceSettingsViewProps {
  governance: WorkspaceGovernanceDetails;
  canUpdateWorkspace: boolean;
}

export function WorkspaceSettingsView({
  governance,
  canUpdateWorkspace,
}: WorkspaceSettingsViewProps) {
  const router = useRouter();

  const [workspaceName, setWorkspaceName] = React.useState(governance.workspace.name);
  const [workspaceSlug, setWorkspaceSlug] = React.useState(governance.workspace.slug);
  const [organizationName, setOrganizationName] = React.useState(governance.organization.name);
  const [defaultTimezone, setDefaultTimezone] = React.useState(
    governance.workspace.defaultTimezone,
  );
  const [defaultCurrency, setDefaultCurrency] = React.useState(
    governance.workspace.defaultCurrency,
  );

  const [saving, setSaving] = React.useState(false);
  const [savedFeedback, setSavedFeedback] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setWorkspaceName(governance.workspace.name);
    setWorkspaceSlug(governance.workspace.slug);
    setOrganizationName(governance.organization.name);
    setDefaultTimezone(governance.workspace.defaultTimezone);
    setDefaultCurrency(governance.workspace.defaultCurrency);
  }, [governance]);

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setSavedFeedback(null);

    if (workspaceName.trim().length < 2) {
      setErrorMessage("Workspace name must be at least 2 characters.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: governance.workspace.id,
          name: workspaceName.trim(),
          slug: workspaceSlug.trim(),
          organizationName: organizationName.trim(),
          defaultTimezone,
          defaultCurrency,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setErrorMessage(payload.error?.message ?? "Unable to update workspace settings.");
        return;
      }

      setSavedFeedback("Workspace & organization settings saved.");
      router.refresh();
    } catch {
      setErrorMessage("Network error while saving workspace settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8" data-testid="workspace-settings-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Settings" },
        ]}
        title="Workspace & Governance Settings"
        description="Manage tenant identity, reporting timezone, currency normalization, role-based workspace access, and immutable audit logs."
        badges={<Badge tone="indigo">Role: {governance.workspace.role}</Badge>}
      />

      {/* Workspace & Organization Configuration Card */}
      <Card className="p-5 sm:p-6 space-y-5">
        <SectionHeader
          title="Workspace & Organization Identity"
          description="Changes here update Avenor's local tenant records and write an immutable audit log entry."
        />

        <form
          onSubmit={handleSaveSettings}
          className="space-y-4"
          data-testid="workspace-settings-form"
        >
          {errorMessage ? (
            <div
              role="alert"
              className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
            >
              {errorMessage}
            </div>
          ) : null}
          {savedFeedback ? (
            <div
              data-testid="settings-saved-feedback"
              className="rounded-[10px] border border-[#147D63]/30 bg-[#E7F6EF] px-3.5 py-2.5 text-[13px] font-medium text-[#147D63]"
            >
              {savedFeedback}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField id="settings-org-name" label="Organization name" required>
              <TextInput
                id="settings-org-name"
                data-testid="settings-organization-name-input"
                value={organizationName}
                disabled={!canUpdateWorkspace}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
              />
            </FormField>

            <FormField id="settings-workspace-name" label="Workspace name" required>
              <TextInput
                id="settings-workspace-name"
                data-testid="settings-workspace-name-input"
                value={workspaceName}
                disabled={!canUpdateWorkspace}
                onChange={(e) => setWorkspaceName(e.target.value)}
                required
              />
            </FormField>

            <FormField id="settings-workspace-slug" label="Workspace slug" required>
              <TextInput
                id="settings-workspace-slug"
                data-testid="settings-workspace-slug-input"
                value={workspaceSlug}
                disabled={!canUpdateWorkspace}
                onChange={(e) => setWorkspaceSlug(e.target.value)}
                required
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id="settings-timezone"
              label="Default reporting timezone"
              hint="Used for daily/monthly aggregation windows across connected sources."
            >
              <Select
                id="settings-timezone"
                data-testid="settings-timezone-select"
                value={defaultTimezone}
                disabled={!canUpdateWorkspace}
                onChange={(e) => setDefaultTimezone(e.target.value)}
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
              </Select>
            </FormField>

            <FormField
              id="settings-currency"
              label="Default reporting currency"
              hint="Used for normalized cloud cost and budget views."
            >
              <Select
                id="settings-currency"
                data-testid="settings-currency-select"
                value={defaultCurrency}
                disabled={!canUpdateWorkspace}
                onChange={(e) => setDefaultCurrency(e.target.value)}
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD ($)</option>
                <option value="AUD">AUD ($)</option>
                <option value="JPY">JPY (¥)</option>
              </Select>
            </FormField>
          </div>

          {canUpdateWorkspace ? (
            <div className="flex items-center justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                data-testid="settings-save-button"
                disabled={saving}
              >
                {saving ? "Saving settings..." : "Save Workspace Settings"}
              </Button>
            </div>
          ) : null}
        </form>
      </Card>

      {/* Workspace Member Roster */}
      <div className="space-y-3">
        <SectionHeader
          title="Workspace Members & RBAC Roles"
          description="Every server entry point verifies membership and role permissions (`OWNER`, `ADMIN`, `ANALYST`, `VIEWER`) against PostgreSQL."
        />

        <DataTable<WorkspaceMemberRecord>
          caption="Authorized workspace members"
          rows={governance.members}
          getRowKey={(member) => member.userId}
          columns={[
            {
              key: "name",
              header: "Member",
              render: (member) => (
                <span className="font-semibold text-[#17243A]">{member.name}</span>
              ),
            },
            {
              key: "email",
              header: "Email",
              render: (member) => <span className="text-[#30415D]">{member.email}</span>,
            },
            {
              key: "role",
              header: "Role",
              render: (member) => <Badge tone="indigo">{member.role}</Badge>,
            },
            {
              key: "joined",
              header: "Joined (UTC)",
              numeric: true,
              render: (member) =>
                new Date(member.joinedAt).toISOString().slice(0, 16).replace("T", " "),
            },
          ]}
        />
      </div>

      {/* Immutable Audit Ledger */}
      <div className="space-y-3">
        <SectionHeader
          title="Immutable Workspace Audit Ledger"
          description="Transactional audit events for workspace, logical product, environment, and session mutations (sensitive tokens automatically redacted)."
        />

        <DataTable<AuditLogEntry>
          caption="Recent workspace audit events"
          rows={governance.auditLogs}
          getRowKey={(log) => log.id}
          columns={[
            {
              key: "action",
              header: "Action",
              render: (log) => (
                <span className="font-mono text-[12px] font-semibold text-[#17243A]">
                  {log.action}
                </span>
              ),
            },
            {
              key: "entityType",
              header: "Entity Type",
              render: (log) => <Badge tone="neutral">{log.entityType}</Badge>,
            },
            {
              key: "summary",
              header: "Summary",
              render: (log) => <span className="text-[#30415D]">{log.summary}</span>,
            },
            {
              key: "createdAt",
              header: "Timestamp (UTC)",
              numeric: true,
              render: (log) => new Date(log.createdAt).toISOString().slice(0, 19).replace("T", " "),
            },
          ]}
        />
      </div>
    </div>
  );
}
