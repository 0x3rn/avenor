"use client";

import {
  evaluateCapabilityMatrix,
  type LogicalProjectSummary,
  PROVIDER_CATEGORY_LABELS,
  type ProviderCatalogEntry,
  type ProviderCategory,
  type ProviderConnectionHealthSnapshot,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  Badge,
  Button,
  CapabilityMatrixList,
  Card,
  ConnectionHealthBadge,
  ProviderAvailabilityBadge,
  ReadOnlyGuaranteeCallout,
  SectionHeader,
} from "@avenor/ui";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Layers,
  Link2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  X,
} from "lucide-react";
import * as React from "react";
import type {
  ConnectedResourceRecord,
  ResourceMappingRecord,
  WorkspaceConnectionDetail,
  WorkspaceConnectionSummary,
} from "@/lib/connections";

export interface ConnectionsConsoleProps {
  workspaceId: string;
  workspaceName: string;
  userRole: string;
  canManageConnections: boolean;
  catalog: readonly ProviderCatalogEntry[];
  initialConnections: readonly WorkspaceConnectionSummary[];
  projects: readonly LogicalProjectSummary[];
}

const WIZARD_STEPS = [
  { step: 1, title: "Select Provider", short: "Provider" },
  { step: 2, title: "Permissions & Data", short: "Permissions" },
  { step: 3, title: "Authorize", short: "Authorize" },
  { step: 4, title: "Discover Resources", short: "Discover" },
  { step: 5, title: "Map to Project & Environment", short: "Map" },
  { step: 6, title: "Validate Connection", short: "Validate" },
  { step: 7, title: "Complete", short: "Complete" },
] as const;

type WizardStepNumber = (typeof WIZARD_STEPS)[number]["step"];

export function ConnectionsConsole({
  workspaceId,
  workspaceName,
  userRole,
  canManageConnections,
  catalog,
  initialConnections,
  projects,
}: ConnectionsConsoleProps) {
  const [connections, setConnections] =
    React.useState<readonly WorkspaceConnectionSummary[]>(initialConnections);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<ProviderCategory | "all">("all");
  const [globalFeedback, setGlobalFeedback] = React.useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  // 7-Step Wizard state
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardStep, setWizardStep] = React.useState<WizardStepNumber>(1);
  const [wizardProviderKey, setWizardProviderKey] = React.useState<string>("avenor-sandbox");
  const [wizardDisplayName, setWizardDisplayName] = React.useState<string>(
    "Avenor Read-Only Sandbox",
  );
  const [wizardSelectedScopes, setWizardSelectedScopes] = React.useState<string[]>([]);
  const [wizardReconnectId, setWizardReconnectId] = React.useState<string | undefined>(undefined);
  const [wizardAuthState, setWizardAuthState] = React.useState<{
    rawStateToken: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    authorizationUrl: string;
    expiresAtIso: string;
  } | null>(null);
  const [wizardConnectionId, setWizardConnectionId] = React.useState<string | null>(null);
  const [wizardDiscoveredResources, setWizardDiscoveredResources] = React.useState<
    readonly ConnectedResourceRecord[]
  >([]);
  const [wizardSelectedResourceId, setWizardSelectedResourceId] = React.useState<string>("");
  const [wizardSelectedProjectId, setWizardSelectedProjectId] = React.useState<string>(
    projects[0]?.id ?? "",
  );
  const [wizardSelectedEnvironmentId, setWizardSelectedEnvironmentId] = React.useState<string>(
    projects[0]?.environments[0]?.id ?? "",
  );
  const [wizardMappings, setWizardMappings] = React.useState<ResourceMappingRecord[]>([]);
  const [wizardHealthSnapshot, setWizardHealthSnapshot] =
    React.useState<ProviderConnectionHealthSnapshot | null>(null);
  const [wizardBusy, setWizardBusy] = React.useState(false);
  const [wizardError, setWizardError] = React.useState<string | null>(null);

  // Connection Detail / Health Drawer state
  const [activeConnectionDetail, setActiveConnectionDetail] =
    React.useState<WorkspaceConnectionDetail | null>(null);
  const [detailActionBusy, setDetailActionBusy] = React.useState(false);
  const [detailFeedback, setDetailFeedback] = React.useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [diagnosticScenario, setDiagnosticScenario] =
    React.useState<NonNullable<ReadOnlyProviderContext["simulationScenario"]>>("healthy");
  const [drawerMapResourceId, setDrawerMapResourceId] = React.useState<string>("");
  const [drawerMapProjectId, setDrawerMapProjectId] = React.useState<string>(projects[0]?.id ?? "");
  const [drawerMapEnvironmentId, setDrawerMapEnvironmentId] = React.useState<string>(
    projects[0]?.environments[0]?.id ?? "",
  );

  const selectedWizardProvider = React.useMemo(
    () => catalog.find((c) => c.providerKey === wizardProviderKey) ?? catalog[0],
    [catalog, wizardProviderKey],
  );

  const wizardCapabilities = React.useMemo(() => {
    if (!selectedWizardProvider) return [];
    return evaluateCapabilityMatrix(selectedWizardProvider.capabilities, wizardSelectedScopes);
  }, [selectedWizardProvider, wizardSelectedScopes]);

  const selectedWizardProject = React.useMemo(
    () => projects.find((p) => p.id === wizardSelectedProjectId) ?? null,
    [projects, wizardSelectedProjectId],
  );

  const selectedDrawerProject = React.useMemo(
    () => projects.find((p) => p.id === drawerMapProjectId) ?? null,
    [projects, drawerMapProjectId],
  );

  const filteredCatalog = React.useMemo(() => {
    return catalog.filter((entry) => {
      if (selectedCategory !== "all" && entry.category !== selectedCategory) {
        return false;
      }
      if (!searchQuery.trim()) {
        return true;
      }
      const q = searchQuery.toLowerCase();
      return (
        entry.displayName.toLowerCase().includes(q) ||
        entry.shortName.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        entry.resourceTypeLabel.toLowerCase().includes(q)
      );
    });
  }, [catalog, searchQuery, selectedCategory]);

  async function refreshConnectionsList() {
    const res = await fetch(`/api/connections?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "GET",
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { connections: WorkspaceConnectionSummary[] };
      setConnections(data.connections);
    }
  }

  function openWizardForProvider(
    provider: ProviderCatalogEntry,
    reconnectConn?: WorkspaceConnectionSummary,
  ) {
    if (!canManageConnections || provider.availabilityStatus === "planned_milestone") {
      return;
    }
    setWizardProviderKey(provider.providerKey);
    setWizardDisplayName(reconnectConn ? reconnectConn.displayName : provider.displayName);
    setWizardSelectedScopes([...provider.defaultScopes]);
    setWizardReconnectId(reconnectConn?.id);
    setWizardAuthState(null);
    setWizardConnectionId(reconnectConn?.id ?? null);
    setWizardDiscoveredResources([]);
    setWizardMappings([]);
    setWizardHealthSnapshot(null);
    setWizardError(null);
    setWizardStep(reconnectConn ? 2 : 1);
    setWizardOpen(true);
  }

  function handleSelectProviderInStep1(provider: ProviderCatalogEntry) {
    if (provider.availabilityStatus === "planned_milestone") return;
    setWizardProviderKey(provider.providerKey);
    setWizardDisplayName(provider.displayName);
    setWizardSelectedScopes([...provider.defaultScopes]);
    setWizardError(null);
  }

  function toggleWizardScope(scope: string) {
    setWizardSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleStep2ProceedToAuthorize() {
    if (!selectedWizardProvider) return;
    if (wizardSelectedScopes.length === 0) {
      setWizardError("Select at least one read-only scope before initiating authorization.");
      return;
    }
    setWizardBusy(true);
    setWizardError(null);
    try {
      const res = await fetch("/api/connections/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          providerKey: selectedWizardProvider.providerKey,
          displayName: wizardDisplayName,
          requestedScopes: wizardSelectedScopes,
          reconnectConnectionId: wizardReconnectId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWizardError(data?.error?.message ?? "Failed to initiate OAuth authorization.");
        return;
      }
      setWizardAuthState(data.authorization);
      setWizardStep(3);
    } catch {
      setWizardError("Network error while initiating OAuth authorization.");
    } finally {
      setWizardBusy(false);
    }
  }

  async function handleStep3CompleteConsent(options?: { simulateDenied?: boolean }) {
    if (!wizardAuthState || !selectedWizardProvider) return;
    setWizardBusy(true);
    setWizardError(null);
    try {
      const res = await fetch("/api/connections/oauth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          providerKey: selectedWizardProvider.providerKey,
          displayName: wizardDisplayName,
          rawStateToken: wizardAuthState.rawStateToken,
          ...(options?.simulateDenied
            ? {
                error: "access_denied",
                errorDescription: "The account owner declined the read-only authorization request.",
              }
            : {
                authorizationCode: `code_${selectedWizardProvider.providerKey}_readonly`,
                grantedScopes: wizardSelectedScopes,
                externalAccountId: `acct_${selectedWizardProvider.providerKey}_${workspaceId.slice(0, 6)}`,
                externalAccountLabel: `${selectedWizardProvider.shortName} Read-Only (${workspaceName})`,
              }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWizardError(data?.error?.message ?? "OAuth callback failed.");
        await refreshConnectionsList();
        return;
      }

      const connId = data.callbackResult.connectionId as string;
      const discovered = (data.discoveredResources ?? []) as ConnectedResourceRecord[];
      setWizardConnectionId(connId);
      setWizardDiscoveredResources(discovered);
      if (discovered.length > 0) {
        setWizardSelectedResourceId(discovered[0].id);
      }
      await refreshConnectionsList();
      setWizardStep(4);
    } catch {
      setWizardError("Network error while completing OAuth callback.");
    } finally {
      setWizardBusy(false);
    }
  }

  async function handleStep4Rediscover() {
    if (!wizardConnectionId) return;
    setWizardBusy(true);
    setWizardError(null);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(wizardConnectionId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          action: "discover",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWizardError(data?.error?.message ?? "Failed to discover external resources.");
        return;
      }
      const discovered = (data.discoveredResources ?? []) as ConnectedResourceRecord[];
      setWizardDiscoveredResources(discovered);
      if (discovered.length > 0 && !wizardSelectedResourceId) {
        setWizardSelectedResourceId(discovered[0].id);
      }
      await refreshConnectionsList();
    } catch {
      setWizardError("Network error during resource discovery.");
    } finally {
      setWizardBusy(false);
    }
  }

  async function handleStep5MapResource(e: React.FormEvent) {
    e.preventDefault();
    if (!wizardSelectedResourceId || !wizardSelectedProjectId) {
      setWizardError("Select both a discovered resource and a logical project.");
      return;
    }
    setWizardBusy(true);
    setWizardError(null);
    try {
      const res = await fetch("/api/connections/mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          connectedResourceId: wizardSelectedResourceId,
          projectId: wizardSelectedProjectId,
          environmentId: wizardSelectedEnvironmentId || null,
          mappingRole: "PRIMARY",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWizardError(data?.error?.message ?? "Failed to map resource to project environment.");
        return;
      }
      setWizardMappings((prev) => [data.mapping as ResourceMappingRecord, ...prev]);
      await refreshConnectionsList();
    } catch {
      setWizardError("Network error while mapping resource.");
    } finally {
      setWizardBusy(false);
    }
  }

  async function handleStep6ValidateConnection() {
    if (!wizardConnectionId) return;
    setWizardBusy(true);
    setWizardError(null);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(wizardConnectionId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          action: "validate",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWizardError(data?.error?.message ?? "Connection validation failed.");
        return;
      }
      setWizardHealthSnapshot(data.healthSnapshot as ProviderConnectionHealthSnapshot);
      await refreshConnectionsList();
    } catch {
      setWizardError("Network error while validating connection health.");
    } finally {
      setWizardBusy(false);
    }
  }

  async function openConnectionDrawer(connectionId: string) {
    setDetailFeedback(null);
    const res = await fetch(
      `/api/connections/${encodeURIComponent(connectionId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "GET", cache: "no-store" },
    );
    const data = await res.json();
    if (res.ok && data.connection) {
      const detail = data.connection as WorkspaceConnectionDetail;
      setActiveConnectionDetail(detail);
      if (detail.connectedResources.length > 0) {
        setDrawerMapResourceId(detail.connectedResources[0].id);
      }
    }
  }

  async function handleDrawerAction(
    action: "discover" | "validate" | "refresh_token" | "disconnect",
    extra?: Record<string, unknown>,
  ) {
    if (!activeConnectionDetail) return;
    setDetailActionBusy(true);
    setDetailFeedback(null);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(activeConnectionDetail.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          action,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDetailFeedback({
          tone: "error",
          message: data?.error?.message ?? `Action "${action}" failed.`,
        });
        await openConnectionDrawer(activeConnectionDetail.id);
        await refreshConnectionsList();
        return;
      }
      if (data.connection) {
        setActiveConnectionDetail(data.connection as WorkspaceConnectionDetail);
      }
      await refreshConnectionsList();

      const actionMessages: Record<typeof action, string> = {
        discover: "Read-only external resources refreshed.",
        validate: `Connection health verified (${data.healthSnapshot?.status ?? "updated"}).`,
        refresh_token: "OAuth access token rotated and re-encrypted in vault.",
        disconnect:
          "Connection disconnected, vault credentials revoked, and active project mappings removed.",
      };
      setDetailFeedback({
        tone: "success",
        message: actionMessages[action],
      });
    } catch {
      setDetailFeedback({
        tone: "error",
        message: "Network error while executing connection action.",
      });
    } finally {
      setDetailActionBusy(false);
    }
  }

  async function handleDrawerMapResource(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConnectionDetail || !drawerMapResourceId || !drawerMapProjectId) return;
    setDetailActionBusy(true);
    setDetailFeedback(null);
    try {
      const res = await fetch("/api/connections/mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          connectedResourceId: drawerMapResourceId,
          projectId: drawerMapProjectId,
          environmentId: drawerMapEnvironmentId || null,
          mappingRole: "PRIMARY",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDetailFeedback({
          tone: "error",
          message: data?.error?.message ?? "Could not map resource.",
        });
        return;
      }
      await openConnectionDrawer(activeConnectionDetail.id);
      await refreshConnectionsList();
      setDetailFeedback({
        tone: "success",
        message: `Mapped ${data.mapping.resourceDisplayName} to ${data.mapping.projectName}.`,
      });
    } finally {
      setDetailActionBusy(false);
    }
  }

  async function handleUnmapResource(mappingId: string) {
    setDetailActionBusy(true);
    setDetailFeedback(null);
    try {
      const res = await fetch(
        `/api/connections/mappings?workspaceId=${encodeURIComponent(workspaceId)}&mappingId=${encodeURIComponent(mappingId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setDetailFeedback({
          tone: "error",
          message: data?.error?.message ?? "Failed to unmap resource.",
        });
        return;
      }
      setWizardMappings((prev) => prev.filter((m) => m.id !== mappingId));
      if (activeConnectionDetail) {
        await openConnectionDrawer(activeConnectionDetail.id);
      }
      await refreshConnectionsList();
      setDetailFeedback({
        tone: "success",
        message: "Resource unmapped from project while keeping provider connection intact.",
      });
      setGlobalFeedback({
        tone: "success",
        message: "Resource unmapped from project while keeping provider connection intact.",
      });
    } finally {
      setDetailActionBusy(false);
    }
  }

  const activeConnectionsCount = connections.filter((c) => c.status !== "DISCONNECTED").length;
  const totalMappingsCount = connections.reduce((acc, c) => acc + c.mappings.length, 0);

  return (
    <div className="space-y-8">
      {/* Summary KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              Workspace Connections
            </span>
            <Link2 className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          </div>
          <p
            className="mt-2 text-[26px] font-semibold text-[#17243A] tabular-nums"
            data-testid="active-connections-count"
          >
            {activeConnectionsCount}
          </p>
          <p className="mt-1 text-[12px] text-[#64748B]">
            Scoped to <span className="font-medium text-[#30415D]">{workspaceName}</span>
          </p>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              Mapped Project Resources
            </span>
            <Layers className="h-4 w-4 text-[#168E99]" aria-hidden="true" />
          </div>
          <p
            className="mt-2 text-[26px] font-semibold text-[#17243A] tabular-nums"
            data-testid="mapped-resources-count"
          >
            {totalMappingsCount}
          </p>
          <p className="mt-1 text-[12px] text-[#64748B]">
            Across{" "}
            <span className="font-medium text-[#30415D] tabular-nums">{projects.length}</span>{" "}
            active logical product(s)
          </p>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              Credential Vault & Access
            </span>
            <Lock className="h-4 w-4 text-[#147D63]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone="read-only">AES-256-GCM Vault</Badge>
            <Badge tone="neutral">{userRole}</Badge>
          </div>
          <p className="mt-2 text-[12px] text-[#64748B]">
            {canManageConnections
              ? "Full connection & mapping governance enabled."
              : "Read-only observer mode — management actions hidden."}
          </p>
        </Card>
      </div>

      {globalFeedback ? (
        <div
          className={`flex items-center justify-between rounded-[10px] border px-4 py-3 text-[13px] ${
            globalFeedback.tone === "success"
              ? "border-[#147D63]/30 bg-[#147D63]/8 text-[#147D63]"
              : "border-[#BF4256]/30 bg-[#BF4256]/8 text-[#BF4256]"
          }`}
          data-testid="connections-global-feedback"
        >
          <span>{globalFeedback.message}</span>
          <button
            type="button"
            onClick={() => setGlobalFeedback(null)}
            className="text-xs underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* 7-Step Connection Wizard */}
      {wizardOpen && selectedWizardProvider ? (
        <Card
          className="border-[#5157D9]/40 bg-[#FFFFFF] p-5 sm:p-6 shadow-md space-y-6"
          data-testid="connection-wizard-panel"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#DFE6F0] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone="indigo">7-Step Read-Only Connection Wizard</Badge>
                <Badge tone="read-only">PKCE S256 + AES-256-GCM</Badge>
              </div>
              <h2 className="mt-2 text-[20px] font-semibold text-[#17243A]">
                Connect {selectedWizardProvider.displayName}
              </h2>
              <p className="text-[13px] text-[#64748B]">
                Step {wizardStep} of 7 — {WIZARD_STEPS.find((s) => s.step === wizardStep)?.title}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setWizardOpen(false)}
              data-testid="close-wizard-button"
            >
              Close Wizard
            </Button>
          </div>

          {/* Stepper Bar */}
          <ol
            className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
            aria-label="Connection Wizard Steps"
          >
            {WIZARD_STEPS.map((s) => {
              const isCurrent = wizardStep === s.step;
              const isCompleted = wizardStep > s.step;
              return (
                <li
                  key={s.step}
                  className={`flex items-center gap-2 rounded-[8px] border px-2.5 py-2 text-[12px] ${
                    isCurrent
                      ? "border-[#5157D9] bg-[#5157D9]/8 font-semibold text-[#17243A]"
                      : isCompleted
                        ? "border-[#147D63]/30 bg-[#147D63]/6 font-medium text-[#147D63]"
                        : "border-[#DFE6F0] bg-[#F7F9FC] text-[#64748B]"
                  }`}
                  data-testid={`wizard-step-indicator-${s.step}`}
                >
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold shadow-2xs tabular-nums">
                    {isCompleted ? "✓" : s.step}
                  </span>
                  <span className="truncate">{s.short}</span>
                </li>
              );
            })}
          </ol>

          {wizardError ? (
            <div
              className="rounded-[10px] border border-[#BF4256]/30 bg-[#BF4256]/8 px-4 py-3 text-[13px] text-[#BF4256]"
              data-testid="wizard-error-banner"
            >
              {wizardError}
            </div>
          ) : null}

          {/* STEP 1: SELECT PROVIDER */}
          {wizardStep === 1 ? (
            <div className="space-y-5" data-testid="wizard-step-1">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {catalog
                  .filter((c) => c.availabilityStatus !== "planned_milestone")
                  .map((entry) => {
                    const selected = entry.providerKey === wizardProviderKey;
                    return (
                      <button
                        key={entry.providerKey}
                        type="button"
                        onClick={() => handleSelectProviderInStep1(entry)}
                        className={`flex flex-col items-start rounded-[12px] border p-4 text-left transition ${
                          selected
                            ? "border-[#5157D9] bg-[#5157D9]/5 ring-2 ring-[#5157D9]/20"
                            : "border-[#DFE6F0] bg-white hover:border-[#C8D4E6]"
                        }`}
                        data-testid={`wizard-select-provider-${entry.providerKey}`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-[14px] font-semibold text-[#17243A]">
                            {entry.displayName}
                          </span>
                          <ProviderAvailabilityBadge
                            availabilityStatus={entry.availabilityStatus}
                            targetMilestone={entry.targetMilestone}
                          />
                        </div>
                        <p className="mt-1.5 text-[12px] text-[#30415D]">{entry.summary}</p>
                      </button>
                    );
                  })}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="wizard-connection-display-name"
                  className="block text-[13px] font-medium text-[#17243A]"
                >
                  Connection Label in Workspace
                </label>
                <input
                  id="wizard-connection-display-name"
                  type="text"
                  value={wizardDisplayName}
                  onChange={(e) => setWizardDisplayName(e.target.value)}
                  className="w-full max-w-md rounded-[8px] border border-[#C8D4E6] bg-white px-3 py-2 text-[14px] text-[#17243A]"
                  data-testid="wizard-display-name-input"
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  data-testid="wizard-next-to-step-2"
                >
                  Continue to Permissions & Data
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* STEP 2: PERMISSIONS & DATA */}
          {wizardStep === 2 ? (
            <div className="space-y-5" data-testid="wizard-step-2">
              <ReadOnlyGuaranteeCallout
                providerName={selectedWizardProvider.displayName}
                guaranteeText={selectedWizardProvider.readOnlyGuaranteeText}
                requiredScopes={selectedWizardProvider.defaultScopes}
                prohibitedOperations={selectedWizardProvider.prohibitedOperationsSummary}
              />

              <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#17243A]">
                      Requested Read-Only OAuth Scopes
                    </h3>
                    <p className="text-[12px] text-[#64748B]">
                      All write, admin, and mutation scopes are rejected by Avenor’s OAuth guard.
                      Uncheck a secondary scope below to preview partial-consent capability
                      degradation.
                    </p>
                  </div>
                  <Badge tone="read-only">Viewer Scopes Only</Badge>
                </div>

                <div className="space-y-2">
                  {selectedWizardProvider.defaultScopes.map((scope) => {
                    const checked = wizardSelectedScopes.includes(scope);
                    return (
                      <label
                        key={scope}
                        className="flex items-center gap-2.5 rounded-[8px] border border-[#DFE6F0] bg-white px-3 py-2 text-[13px] text-[#17243A]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWizardScope(scope)}
                          data-testid={`wizard-scope-checkbox-${scope}`}
                        />
                        <code className="font-mono text-[12px] text-[#168E99]">{scope}</code>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-[14px] font-semibold text-[#17243A]">
                  Granular Capability Discovery Matrix
                </h3>
                <CapabilityMatrixList capabilities={wizardCapabilities} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="secondary" onClick={() => setWizardStep(1)}>
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={wizardBusy}
                  onClick={handleStep2ProceedToAuthorize}
                  data-testid="wizard-initiate-oauth-button"
                >
                  {wizardBusy ? "Generating PKCE State..." : "Continue to Authorize"}
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* STEP 3: AUTHORIZE */}
          {wizardStep === 3 && wizardAuthState ? (
            <div className="space-y-5" data-testid="wizard-step-3">
              <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                    <h3 className="text-[15px] font-semibold text-[#17243A]">
                      OAuth 2.0 PKCE + CSRF State Prepared
                    </h3>
                  </div>
                  <Badge tone="read-only">Challenge: {wizardAuthState.codeChallengeMethod}</Badge>
                </div>
                <p className="text-[13px] text-[#30415D]">
                  Avenor generated a single-use cryptographic state token bound to your user session
                  and workspace{" "}
                  <strong className="font-semibold text-[#17243A]">{workspaceName}</strong>. Raw
                  tokens will be sealed inside Avenor’s AES-256-GCM vault upon callback.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-[12px]">
                  <div className="rounded-[8px] border border-[#DFE6F0] bg-white p-2.5">
                    <span className="block text-[11px] font-medium uppercase text-[#64748B]">
                      PKCE S256 Challenge
                    </span>
                    <code className="mt-0.5 block truncate font-mono text-[#17243A]">
                      {wizardAuthState.codeChallenge}
                    </code>
                  </div>
                  <div className="rounded-[8px] border border-[#DFE6F0] bg-white p-2.5">
                    <span className="block text-[11px] font-medium uppercase text-[#64748B]">
                      State Expiration (15m Window)
                    </span>
                    <span className="mt-0.5 block font-mono text-[#17243A] tabular-nums">
                      {new Date(wizardAuthState.expiresAtIso).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={wizardBusy}
                  onClick={() => handleStep3CompleteConsent({ simulateDenied: true })}
                  data-testid="wizard-simulate-consent-denied"
                >
                  Simulate Consent Denied
                </Button>
                <Button
                  type="button"
                  disabled={wizardBusy}
                  onClick={() => handleStep3CompleteConsent({ simulateDenied: false })}
                  data-testid="wizard-complete-oauth-consent"
                >
                  {wizardBusy
                    ? "Exchanging Code & Encrypting Token..."
                    : `Authorize ${selectedWizardProvider.shortName} (Read-Only)`}
                </Button>
              </div>
            </div>
          ) : null}

          {/* STEP 4: DISCOVER RESOURCES */}
          {wizardStep === 4 ? (
            <div className="space-y-5" data-testid="wizard-step-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-[#17243A]">
                    Discovered External {selectedWizardProvider.resourceTypeLabel}s
                  </h3>
                  <p className="text-[13px] text-[#64748B]">
                    Avenor queried {selectedWizardProvider.displayName} using your read-only grant
                    and discovered{" "}
                    <span className="font-semibold text-[#17243A] tabular-nums">
                      {wizardDiscoveredResources.length}
                    </span>{" "}
                    accessible resource(s).
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={wizardBusy}
                  onClick={handleStep4Rediscover}
                  data-testid="wizard-rediscover-resources-button"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Re-scan Resources
                </Button>
              </div>

              {wizardDiscoveredResources.length === 0 ? (
                <div className="rounded-[12px] border border-[#B86B11]/30 bg-[#B86B11]/8 p-4 text-[13px] text-[#B86B11]">
                  No resources were returned. Verify that the discovery read-only scope was granted,
                  then re-scan or proceed to health validation.
                </div>
              ) : (
                <div
                  className="grid grid-cols-1 gap-3"
                  data-testid="wizard-discovered-resources-list"
                >
                  {wizardDiscoveredResources.map((res) => {
                    const isSelected = wizardSelectedResourceId === res.id;
                    return (
                      <label
                        key={res.id}
                        className={`flex cursor-pointer items-start justify-between gap-3 rounded-[10px] border p-3.5 transition ${
                          isSelected
                            ? "border-[#5157D9] bg-[#5157D9]/5"
                            : "border-[#DFE6F0] bg-white"
                        }`}
                        data-testid={`discovered-resource-card-${res.externalResourceId}`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="wizardSelectedResource"
                            checked={isSelected}
                            onChange={() => setWizardSelectedResourceId(res.id)}
                            className="mt-1"
                          />
                          <div>
                            <p className="text-[14px] font-semibold text-[#17243A]">
                              {res.displayName}
                            </p>
                            <p className="font-mono text-[12px] text-[#64748B]">
                              ID: {res.externalResourceId} • Type: {res.resourceType}
                            </p>
                          </div>
                        </div>
                        <Badge tone="read-only">
                          {String(res.metadata?.environmentHint ?? "READ_ONLY")}
                        </Badge>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => setWizardStep(5)}
                  data-testid="wizard-next-to-step-5"
                >
                  Continue to Project Mapping
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* STEP 5: MAP TO PROJECT & ENVIRONMENT */}
          {wizardStep === 5 ? (
            <div className="space-y-5" data-testid="wizard-step-5">
              <div>
                <h3 className="text-[15px] font-semibold text-[#17243A]">
                  Map External Resource to Logical Product & Environment
                </h3>
                <p className="text-[13px] text-[#64748B]">
                  Avenor organizes intelligence around your logical products and environments
                  (Production, Staging, Development)—never disconnected vendor accounts.
                </p>
              </div>

              {projects.length === 0 ? (
                <div className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 text-[13px] text-[#30415D]">
                  No active logical projects exist in this workspace yet. Create a project on{" "}
                  <a href="/projects" className="font-semibold text-[#5157D9] underline">
                    /projects
                  </a>{" "}
                  or skip directly to Step 6 to validate connection health.
                </div>
              ) : (
                <form
                  onSubmit={handleStep5MapResource}
                  className="grid grid-cols-1 gap-4 rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 md:grid-cols-3"
                >
                  <div>
                    <label
                      htmlFor="wizard-map-resource-select"
                      className="block text-[12px] font-medium text-[#17243A]"
                    >
                      Discovered Resource
                    </label>
                    <select
                      id="wizard-map-resource-select"
                      value={wizardSelectedResourceId}
                      onChange={(e) => setWizardSelectedResourceId(e.target.value)}
                      className="mt-1 w-full rounded-[8px] border border-[#C8D4E6] bg-white px-3 py-2 text-[13px] text-[#17243A]"
                      data-testid="wizard-map-resource-select"
                    >
                      {wizardDiscoveredResources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName} ({r.externalResourceId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="wizard-map-project-select"
                      className="block text-[12px] font-medium text-[#17243A]"
                    >
                      Logical Product
                    </label>
                    <select
                      id="wizard-map-project-select"
                      value={wizardSelectedProjectId}
                      onChange={(e) => {
                        const nextPrjId = e.target.value;
                        setWizardSelectedProjectId(nextPrjId);
                        const prj = projects.find((p) => p.id === nextPrjId);
                        setWizardSelectedEnvironmentId(prj?.environments[0]?.id ?? "");
                      }}
                      className="mt-1 w-full rounded-[8px] border border-[#C8D4E6] bg-white px-3 py-2 text-[13px] text-[#17243A]"
                      data-testid="wizard-map-project-select"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.slug})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="wizard-map-environment-select"
                      className="block text-[12px] font-medium text-[#17243A]"
                    >
                      Target Environment
                    </label>
                    <select
                      id="wizard-map-environment-select"
                      value={wizardSelectedEnvironmentId}
                      onChange={(e) => setWizardSelectedEnvironmentId(e.target.value)}
                      className="mt-1 w-full rounded-[8px] border border-[#C8D4E6] bg-white px-3 py-2 text-[13px] text-[#17243A]"
                      data-testid="wizard-map-environment-select"
                    >
                      <option value="">All Environments (Project-Wide)</option>
                      {(selectedWizardProject?.environments ?? []).map((env) => (
                        <option key={env.id} value={env.id}>
                          {env.type} ({env.name})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3 flex justify-end">
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={wizardBusy || wizardDiscoveredResources.length === 0}
                      data-testid="wizard-create-mapping-button"
                    >
                      <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Bind Resource to Product Environment
                    </Button>
                  </div>
                </form>
              )}

              {wizardMappings.length > 0 ? (
                <div className="space-y-2" data-testid="wizard-created-mappings-list">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-[#147D63]">
                    Mapped in this session ({wizardMappings.length})
                  </p>
                  {wizardMappings.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#147D63]/30 bg-[#147D63]/6 px-3.5 py-2.5 text-[13px]"
                    >
                      <div>
                        <span className="font-semibold text-[#17243A]">
                          {m.resourceDisplayName}
                        </span>{" "}
                        <span className="font-mono text-[12px] text-[#64748B]">
                          ({m.externalResourceId})
                        </span>{" "}
                        → <span className="font-semibold text-[#5157D9]">{m.projectName}</span>{" "}
                        {m.environmentType ? (
                          <Badge tone="read-only">{m.environmentType}</Badge>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnmapResource(m.id)}
                        className="text-[12px] font-medium text-[#BF4256] hover:underline"
                      >
                        Unmap
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="secondary" onClick={() => setWizardStep(4)}>
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => setWizardStep(6)}
                  data-testid="wizard-next-to-step-6"
                >
                  Continue to Health Validation
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* STEP 6: VALIDATE CONNECTION */}
          {wizardStep === 6 ? (
            <div className="space-y-5" data-testid="wizard-step-6">
              <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#17243A]">
                      Verify Read-Only Connection Health
                    </h3>
                    <p className="text-[13px] text-[#64748B]">
                      Execute a lightweight read-only probe to confirm credential decryption, viewer
                      scope sufficiency, and upstream API reachability.
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={wizardBusy}
                    onClick={handleStep6ValidateConnection}
                    data-testid="wizard-run-validation-button"
                  >
                    <Activity className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {wizardBusy ? "Probing Read-Only Endpoint..." : "Run Health Check"}
                  </Button>
                </div>

                {wizardHealthSnapshot ? (
                  <div
                    className="rounded-[10px] border border-[#DFE6F0] bg-white p-4 space-y-2"
                    data-testid="wizard-validation-result"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ConnectionHealthBadge status={wizardHealthSnapshot.status} />
                      <span className="font-mono text-[12px] text-[#64748B] tabular-nums">
                        Latency: {wizardHealthSnapshot.latencyMs}ms • Verified at{" "}
                        {new Date(wizardHealthSnapshot.checkedAtIso).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#17243A]">{wizardHealthSnapshot.message}</p>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="secondary" onClick={() => setWizardStep(5)}>
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={!wizardHealthSnapshot}
                  onClick={() => setWizardStep(7)}
                  data-testid="wizard-next-to-step-7"
                >
                  Complete Connection Setup
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* STEP 7: COMPLETE */}
          {wizardStep === 7 ? (
            <div className="space-y-5" data-testid="wizard-step-7">
              <div className="rounded-[12px] border border-[#147D63]/30 bg-[#147D63]/6 p-5 space-y-3">
                <div className="flex items-center gap-2 text-[#147D63]">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                  <h3 className="text-[17px] font-semibold text-[#17243A]">
                    {selectedWizardProvider.displayName} Connected in Read-Only Mode
                  </h3>
                </div>
                <p className="text-[13px] text-[#30415D]">
                  Credentials are encrypted at rest with AES-256-GCM bound to{" "}
                  <strong className="font-semibold text-[#17243A]">{workspaceName}</strong>.
                  Discovered resources:{" "}
                  <strong className="font-semibold text-[#17243A] tabular-nums">
                    {wizardDiscoveredResources.length}
                  </strong>
                  . Mapped project environments:{" "}
                  <strong className="font-semibold text-[#17243A] tabular-nums">
                    {wizardMappings.length}
                  </strong>
                  .
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setWizardOpen(false);
                    if (wizardConnectionId) {
                      void openConnectionDrawer(wizardConnectionId);
                    }
                  }}
                  data-testid="wizard-finish-button"
                >
                  Finish & Inspect Connection
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Active & Historical Workspace Connections */}
      <div className="space-y-4">
        <SectionHeader
          title="Workspace Provider Connections"
          description="Inspect connection health, granted read-only scopes, encrypted vault metadata, and logical project mappings."
        />

        {connections.length === 0 ? (
          <Card className="p-6 text-center space-y-3" data-testid="empty-connections-state">
            <p className="text-[15px] font-semibold text-[#17243A]">
              No provider connections configured in {workspaceName} yet
            </p>
            <p className="mx-auto max-w-xl text-[13px] text-[#64748B]">
              Select a provider from the Signal Atlas catalog below to launch the 7-step read-only
              connection wizard, discover external resources, and map them to your logical products.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4" data-testid="workspace-connections-list">
            {connections.map((conn) => {
              const catalogEntry = catalog.find((c) => c.providerKey === conn.providerKey);
              return (
                <Card
                  key={conn.id}
                  className="p-5 sm:p-6 space-y-4"
                  data-testid={`workspace-connection-card-${conn.providerKey}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[17px] font-semibold text-[#17243A]">
                          {conn.displayName}
                        </h3>
                        <ConnectionHealthBadge status={conn.status} />
                        <Badge tone="read-only">
                          Vault v{conn.encryptionKeyVersion} • AES-256-GCM
                        </Badge>
                      </div>
                      <p className="text-[12px] text-[#64748B]">
                        Provider:{" "}
                        <span className="font-medium text-[#30415D]">
                          {conn.providerDisplayName}
                        </span>
                        {conn.externalAccountLabel
                          ? ` • Account: ${conn.externalAccountLabel}`
                          : ""}
                        {conn.lastVerifiedAtIso
                          ? ` • Verified: ${new Date(conn.lastVerifiedAtIso).toLocaleTimeString()}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {canManageConnections && catalogEntry && conn.status !== "HEALTHY" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => openWizardForProvider(catalogEntry, conn)}
                          data-testid={`reconnect-connection-${conn.providerKey}`}
                        >
                          Re-authorize Scopes
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openConnectionDrawer(conn.id)}
                        data-testid={`inspect-provider-${conn.providerKey}`}
                      >
                        Inspect & Health
                      </Button>
                    </div>
                  </div>

                  {conn.lastErrorSummary ? (
                    <div
                      className="flex items-start gap-2 rounded-[8px] border border-[#B86B11]/30 bg-[#B86B11]/8 px-3 py-2 text-[12px] text-[#B86B11]"
                      data-testid={`connection-error-summary-${conn.providerKey}`}
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <div>
                        <span className="font-semibold">{conn.lastErrorCode ?? "DIAGNOSTIC"}:</span>{" "}
                        {conn.lastErrorSummary}
                      </div>
                    </div>
                  ) : null}

                  {/* Mapped Resources Summary */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DFE6F0] pt-3 text-[12px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[#64748B] tabular-nums">
                        Resources ({conn.connectedResources.length}) • Mappings (
                        {conn.mappings.length}):
                      </span>
                      {conn.mappings.length === 0 ? (
                        <span className="text-[#64748B]">No active project mappings</span>
                      ) : (
                        conn.mappings.map((m) => (
                          <span
                            key={m.id}
                            className="inline-flex items-center gap-1 rounded-md border border-[#DFE6F0] bg-[#F7F9FC] px-2 py-0.5 text-[11px] font-medium text-[#17243A]"
                          >
                            {m.resourceDisplayName} → {m.projectName}
                            {m.environmentType ? ` (${m.environmentType})` : ""}
                          </span>
                        ))
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                      Granted scopes: {conn.grantedScopes.length}/{conn.requestedScopes.length}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Connection Detail & Health Drawer / Inspector */}
      {activeConnectionDetail ? (
        <Card
          className="border-[#168E99]/40 bg-white p-5 sm:p-6 shadow-md space-y-6"
          data-testid="connection-detail-drawer"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#DFE6F0] pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[19px] font-semibold text-[#17243A]">
                  {activeConnectionDetail.displayName} — Health & Provenance Inspector
                </h2>
                <ConnectionHealthBadge status={activeConnectionDetail.status} />
              </div>
              <p className="font-mono text-[12px] text-[#64748B] tabular-nums">
                ID: {activeConnectionDetail.id} • Provider: {activeConnectionDetail.providerKey} •
                Vault Status: {activeConnectionDetail.credentialSummary?.status ?? "NONE"} (Key v
                {activeConnectionDetail.encryptionKeyVersion})
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveConnectionDetail(null)}
              className="inline-flex items-center gap-1 rounded-[8px] border border-[#DFE6F0] px-2.5 py-1.5 text-[12px] font-medium text-[#30415D] hover:bg-[#F7F9FC]"
              data-testid="close-detail-drawer-button"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Close Inspector
            </button>
          </div>

          {detailFeedback ? (
            <div
              className={`rounded-[10px] border px-4 py-3 text-[13px] ${
                detailFeedback.tone === "success"
                  ? "border-[#147D63]/30 bg-[#147D63]/8 text-[#147D63]"
                  : "border-[#BF4256]/30 bg-[#BF4256]/8 text-[#BF4256]"
              }`}
              data-testid="drawer-feedback-banner"
            >
              {detailFeedback.message}
            </div>
          ) : null}

          {/* Governance & Health Actions (Hidden for VIEWER / ANALYST) */}
          {canManageConnections ? (
            <div
              className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-4"
              data-testid="drawer-management-actions"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-semibold text-[#17243A]">
                    Connection Lifecycle & Health Verification
                  </h3>
                  <p className="text-[12px] text-[#64748B]">
                    Run on-demand read-only probes, rotate OAuth tokens in the vault, or disconnect
                    and purge credentials.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Diagnostic health scenario"
                    value={diagnosticScenario}
                    onChange={(e) =>
                      setDiagnosticScenario(
                        e.target.value as NonNullable<
                          ReadOnlyProviderContext["simulationScenario"]
                        >,
                      )
                    }
                    className="rounded-[8px] border border-[#C8D4E6] bg-white px-2.5 py-1.5 text-[12px] text-[#17243A]"
                    data-testid="drawer-diagnostic-scenario-select"
                  >
                    <option value="healthy">Probe: Healthy</option>
                    <option value="missing_scope">Simulate: Missing Scope</option>
                    <option value="rate_limited">Simulate: Rate Limited (429)</option>
                    <option value="expired_token">Simulate: Token Expired</option>
                    <option value="revoked_token">Simulate: Upstream Revoked</option>
                    <option value="provider_unavailable">Simulate: Provider 503</option>
                    <option value="stale_data">Simulate: Stale Freshness</option>
                  </select>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={detailActionBusy || activeConnectionDetail.status === "DISCONNECTED"}
                    onClick={() =>
                      handleDrawerAction("validate", {
                        simulationScenario: diagnosticScenario,
                      })
                    }
                    data-testid="drawer-validate-health-button"
                  >
                    <Activity className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Validate Health
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={detailActionBusy || activeConnectionDetail.status === "DISCONNECTED"}
                    onClick={() => handleDrawerAction("refresh_token")}
                    data-testid="drawer-refresh-token-button"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Refresh Token
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={detailActionBusy || activeConnectionDetail.status === "DISCONNECTED"}
                    onClick={() => handleDrawerAction("disconnect")}
                    data-testid="drawer-disconnect-button"
                  >
                    <Unlink className="mr-1.5 h-3.5 w-3.5 text-[#BF4256]" aria-hidden="true" />
                    <span className="text-[#BF4256]">Disconnect</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Resource Mappings in Drawer */}
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-[#17243A]">
              Mapped Product & Environment Bindings ({activeConnectionDetail.mappings.length})
            </h3>

            {activeConnectionDetail.mappings.length === 0 ? (
              <p className="text-[13px] text-[#64748B]" data-testid="drawer-no-mappings">
                No external resources from this connection are currently mapped to a project.
              </p>
            ) : (
              <div className="space-y-2" data-testid="drawer-mappings-list">
                {activeConnectionDetail.mappings.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3.5 py-2.5 text-[13px]"
                    data-testid={`drawer-mapping-row-${m.id}`}
                  >
                    <div>
                      <span className="font-semibold text-[#17243A]">{m.resourceDisplayName}</span>{" "}
                      <span className="font-mono text-[12px] text-[#64748B]">
                        ({m.externalResourceId})
                      </span>{" "}
                      → <span className="font-semibold text-[#5157D9]">{m.projectName}</span>{" "}
                      {m.environmentType ? (
                        <Badge tone="read-only">{m.environmentType}</Badge>
                      ) : null}
                    </div>
                    {canManageConnections ? (
                      <button
                        type="button"
                        onClick={() => handleUnmapResource(m.id)}
                        className="text-[12px] font-medium text-[#BF4256] hover:underline"
                        data-testid={`unmap-resource-${m.id}`}
                      >
                        Unmap Resource
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {canManageConnections &&
            activeConnectionDetail.status !== "DISCONNECTED" &&
            activeConnectionDetail.connectedResources.length > 0 &&
            projects.length > 0 ? (
              <form
                onSubmit={handleDrawerMapResource}
                className="grid grid-cols-1 gap-3 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-3.5 sm:grid-cols-4"
                data-testid="drawer-map-resource-form"
              >
                <select
                  aria-label="Resource to map"
                  value={drawerMapResourceId}
                  onChange={(e) => setDrawerMapResourceId(e.target.value)}
                  className="rounded-[8px] border border-[#C8D4E6] bg-white px-2.5 py-1.5 text-[12px] text-[#17243A]"
                  data-testid="drawer-map-resource-select"
                >
                  {activeConnectionDetail.connectedResources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Target logical project"
                  value={drawerMapProjectId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setDrawerMapProjectId(nextId);
                    const prj = projects.find((p) => p.id === nextId);
                    setDrawerMapEnvironmentId(prj?.environments[0]?.id ?? "");
                  }}
                  className="rounded-[8px] border border-[#C8D4E6] bg-white px-2.5 py-1.5 text-[12px] text-[#17243A]"
                  data-testid="drawer-map-project-select"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Target project environment"
                  value={drawerMapEnvironmentId}
                  onChange={(e) => setDrawerMapEnvironmentId(e.target.value)}
                  className="rounded-[8px] border border-[#C8D4E6] bg-white px-2.5 py-1.5 text-[12px] text-[#17243A]"
                  data-testid="drawer-map-environment-select"
                >
                  <option value="">All Environments</option>
                  {(selectedDrawerProject?.environments ?? []).map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.type} ({env.name})
                    </option>
                  ))}
                </select>

                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={detailActionBusy}
                  data-testid="drawer-submit-mapping-button"
                >
                  Add Mapping
                </Button>
              </form>
            ) : null}
          </div>

          {/* Capability Matrix */}
          <div className="space-y-2">
            <h3 className="text-[14px] font-semibold text-[#17243A]">
              Evaluated Capability & Permission Status
            </h3>
            <CapabilityMatrixList capabilities={activeConnectionDetail.capabilities} />
          </div>

          {/* Sanitized Connection Audit Trail */}
          <div className="space-y-2" data-testid="connection-audit-trail">
            <h3 className="text-[14px] font-semibold text-[#17243A]">
              Immutable Connection Security & Lifecycle Audit Trail
            </h3>
            <div className="divide-y divide-[#DFE6F0] rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC]">
              {activeConnectionDetail.auditLogs.length === 0 ? (
                <p className="p-3 text-[12px] text-[#64748B]">No audit events recorded yet.</p>
              ) : (
                activeConnectionDetail.auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[12px]"
                  >
                    <div>
                      <code className="font-mono font-semibold text-[#5157D9]">{log.action}</code>{" "}
                      <span className="text-[#17243A]">{log.summary}</span>
                    </div>
                    <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Signal Atlas Provider Catalog */}
      <div className="space-y-4" data-testid="provider-catalog-section">
        <SectionHeader
          title="Signal Atlas Read-Only Provider Catalog"
          description="Every adapter is governed by compile-time and runtime read-only contracts. Planned connectors are labeled transparently by target milestone."
        />

        {/* Search & Category Filter Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#64748B]"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search providers or resource types..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-[8px] border border-[#C8D4E6] bg-white pl-9 pr-3 py-1.5 text-[13px] text-[#17243A]"
              data-testid="catalog-search-input"
            />
          </div>

          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Provider Categories">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                selectedCategory === "all"
                  ? "bg-[#5157D9] text-white"
                  : "border border-[#DFE6F0] bg-white text-[#30415D] hover:bg-[#F7F9FC]"
              }`}
              data-testid="catalog-filter-all"
            >
              All ({catalog.length})
            </button>
            {(Object.keys(PROVIDER_CATEGORY_LABELS) as ProviderCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                  selectedCategory === cat
                    ? "bg-[#5157D9] text-white"
                    : "border border-[#DFE6F0] bg-white text-[#30415D] hover:bg-[#F7F9FC]"
                }`}
                data-testid={`catalog-filter-${cat}`}
              >
                {PROVIDER_CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Provider Cards Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredCatalog.map((entry) => {
            const existingConn = connections.find(
              (c) => c.providerKey === entry.providerKey && c.status !== "DISCONNECTED",
            );
            const isPlanned = entry.availabilityStatus === "planned_milestone";

            return (
              <Card
                key={entry.providerKey}
                className="flex flex-col justify-between p-5 sm:p-6 space-y-4"
                data-testid={`catalog-card-${entry.providerKey}`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5157D9]">
                        {PROVIDER_CATEGORY_LABELS[entry.category]}
                      </p>
                      <h3 className="mt-0.5 text-[17px] font-semibold text-[#17243A]">
                        {entry.displayName}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {existingConn ? <ConnectionHealthBadge status={existingConn.status} /> : null}
                      <ProviderAvailabilityBadge
                        availabilityStatus={entry.availabilityStatus}
                        targetMilestone={entry.targetMilestone}
                      />
                    </div>
                  </div>

                  <p className="text-[13px] text-[#30415D]">{entry.summary}</p>

                  <div className="rounded-[8px] border border-[#168E99]/20 bg-[#168E99]/5 px-3 py-2 text-[12px] text-[#17243A]">
                    <span className="font-semibold text-[#168E99]">Read-Only Boundary:</span>{" "}
                    {entry.readOnlyGuaranteeText}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {entry.capabilities.map((cap) => (
                      <span
                        key={cap.capabilityKey}
                        className="inline-flex items-center gap-1 rounded-md border border-[#DFE6F0] bg-[#F7F9FC] px-2 py-0.5 text-[11px] text-[#30415D]"
                      >
                        <span>{cap.label}</span>
                        <span className="font-mono text-[10px] text-[#64748B] tabular-nums">
                          ({cap.freshnessWindowMinutes}m)
                        </span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DFE6F0] pt-3 text-[12px]">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#64748B]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
                    <span>Resource: {entry.resourceTypeLabel}</span>
                  </span>

                  {isPlanned ? (
                    <span
                      className="inline-flex items-center rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-1.5 text-[12px] font-medium text-[#64748B]"
                      data-testid={`planned-provider-badge-${entry.providerKey}`}
                    >
                      Planned • {entry.targetMilestone}
                    </span>
                  ) : canManageConnections ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={existingConn ? "secondary" : "primary"}
                      onClick={() => openWizardForProvider(entry, existingConn)}
                      data-testid={`connect-provider-${entry.providerKey}`}
                    >
                      {existingConn ? "Re-configure / Map" : "Connect Provider"}
                    </Button>
                  ) : (
                    <Badge tone="neutral">Read-Only Role ({userRole})</Badge>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
