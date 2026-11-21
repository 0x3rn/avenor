import {
  type DiscoveredExternalResource,
  evaluateCapabilityMatrix,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderCatalogEntry,
  type ProviderConnectionHealthSnapshot,
  type ProviderCredentialValidationResult,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderAdapter,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  assertVercelContext,
  executeVercelReadOnlyGet,
  parseVercelFocusChargesNdjson,
  shouldExecuteLiveVercelApi,
} from "./http";
import {
  VERCEL_API_BASE_URL,
  VERCEL_CANONICAL_METRIC_KEYS,
  VERCEL_PROVIDER_KEY,
  type VercelDeploymentRecord,
  type VercelFocusChargeRecord,
  type VercelProjectRecord,
} from "./types";

interface VercelProjectsApiResponse {
  projects?: Array<{
    id?: string;
    name?: string;
    framework?: string | null;
    accountId?: string;
    updatedAt?: number;
  }>;
}

interface VercelDeploymentsApiResponse {
  deployments?: Array<{
    uid?: string;
    name?: string;
    target?: string | null;
    readyState?: string;
    state?: string;
    created?: number;
    buildingAt?: number;
    ready?: number;
    meta?: {
      githubCommitSha?: string;
      githubCommitRef?: string;
    };
  }>;
}

const DETERMINISTIC_VERCEL_PROJECTS: readonly VercelProjectRecord[] = [
  {
    id: "prj_vercel_avenor_web",
    name: "avenor-web",
    framework: "nextjs",
    accountId: "team_corstack",
    updatedAtIso: "2026-11-21T10:00:00.000Z",
  },
];

const DETERMINISTIC_VERCEL_DEPLOYMENTS: readonly VercelDeploymentRecord[] = [
  {
    uid: "dpl_01",
    projectId: "prj_vercel_avenor_web",
    name: "avenor-web",
    target: "production",
    state: "READY",
    commitSha: "a1b2c3d4e5f6",
    commitBranch: "main",
    createdAtIso: "2026-11-20T09:00:00.000Z",
    readyAtIso: "2026-11-20T09:01:12.000Z",
    buildDurationMs: 72_000,
  },
  {
    uid: "dpl_02",
    projectId: "prj_vercel_avenor_web",
    name: "avenor-web",
    target: "production",
    state: "READY",
    commitSha: "b2c3d4e5f6a7",
    commitBranch: "main",
    createdAtIso: "2026-11-20T16:00:00.000Z",
    readyAtIso: "2026-11-20T16:01:08.000Z",
    buildDurationMs: 68_000,
  },
  {
    uid: "dpl_03",
    projectId: "prj_vercel_avenor_web",
    name: "avenor-web",
    target: "preview",
    state: "ERROR",
    commitSha: "c3d4e5f6a7b8",
    commitBranch: "feat/dashboard-polish",
    createdAtIso: "2026-11-21T08:00:00.000Z",
    readyAtIso: null,
    buildDurationMs: null,
  },
];

const DETERMINISTIC_VERCEL_CHARGES: readonly VercelFocusChargeRecord[] = [
  {
    serviceName: "Fluid Compute",
    chargeCategory: "Usage",
    billingCurrency: "USD",
    billedCost: 14.5,
    effectiveCost: 14.5,
    consumedQuantity: 1820,
    consumedUnit: "GB-Hours",
    chargePeriodStartIso: "2026-11-20T00:00:00.000Z",
    chargePeriodEndIso: "2026-11-21T00:00:00.000Z",
  },
  {
    serviceName: "Fast Data Transfer",
    chargeCategory: "Usage",
    billingCurrency: "USD",
    billedCost: 6.25,
    effectiveCost: 6.25,
    consumedQuantity: 42,
    consumedUnit: "GB",
    chargePeriodStartIso: "2026-11-20T00:00:00.000Z",
    chargePeriodEndIso: "2026-11-21T00:00:00.000Z",
  },
];

export async function listVercelProjectDeployments(
  context: ReadOnlyProviderContext,
  projectId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<readonly VercelDeploymentRecord[]> {
  const { apiToken } = assertVercelContext(context);
  if (!shouldExecuteLiveVercelApi(context, Boolean(options?.fetchFn))) {
    return DETERMINISTIC_VERCEL_DEPLOYMENTS.filter((d) => d.projectId === projectId);
  }

  const res = await executeVercelReadOnlyGet({
    url: `${VERCEL_API_BASE_URL}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=50`,
    apiToken,
    fetchFn: options?.fetchFn,
  });
  const payload = (await res.json()) as VercelDeploymentsApiResponse;

  return (payload.deployments ?? [])
    .filter((d) => Boolean(d.uid))
    .map((d) => {
      const rawState = (d.readyState ?? d.state ?? "READY").toUpperCase();
      const state: VercelDeploymentRecord["state"] =
        rawState === "ERROR" ||
        rawState === "BUILDING" ||
        rawState === "QUEUED" ||
        rawState === "CANCELED"
          ? rawState
          : "READY";
      const createdMs = typeof d.created === "number" ? d.created : Date.now();
      const readyMs = typeof d.ready === "number" ? d.ready : null;
      const startMs = typeof d.buildingAt === "number" ? d.buildingAt : createdMs;
      return {
        uid: String(d.uid),
        projectId,
        name: d.name ?? projectId,
        target: d.target === "production" ? "production" : "preview",
        state,
        commitSha: d.meta?.githubCommitSha ?? null,
        commitBranch: d.meta?.githubCommitRef ?? null,
        createdAtIso: new Date(createdMs).toISOString(),
        readyAtIso: readyMs !== null ? new Date(readyMs).toISOString() : null,
        buildDurationMs: readyMs !== null && readyMs >= startMs ? readyMs - startMs : null,
      };
    });
}

export async function fetchVercelFocusBillingCharges(
  context: ReadOnlyProviderContext,
  options: { startDateIso: string; endDateIso: string; fetchFn?: typeof fetch },
): Promise<readonly VercelFocusChargeRecord[]> {
  const { apiToken } = assertVercelContext(context);
  if (!shouldExecuteLiveVercelApi(context, Boolean(options.fetchFn))) {
    return DETERMINISTIC_VERCEL_CHARGES;
  }

  const url = new URL(`${VERCEL_API_BASE_URL}/v1/billing/charges`);
  url.searchParams.set("from", options.startDateIso);
  url.searchParams.set("to", options.endDateIso);

  const res = await executeVercelReadOnlyGet({
    url: url.toString(),
    apiToken,
    fetchFn: options.fetchFn,
  });
  const ndjsonText = await res.text();
  return parseVercelFocusChargesNdjson(ndjsonText);
}

export function createVercelReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  return {
    providerKey: VERCEL_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { apiToken } = assertVercelContext(context);
      if (shouldExecuteLiveVercelApi(context, Boolean(fetchFn))) {
        await executeVercelReadOnlyGet({
          url: `${VERCEL_API_BASE_URL}/v9/projects?limit=1`,
          apiToken,
          fetchFn,
        });
      }

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (s) => !context.grantedScopes.includes(s),
      );
      return {
        valid: true,
        externalAccountId: `vercel_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "Vercel Read-Only Projects & Deployments",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities: evaluateCapabilityMatrix(catalogEntry.capabilities, context.grantedScopes, {
          providerPlanTier: context.providerPlanTier ?? "pro",
        }),
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const { apiToken } = assertVercelContext(context);
      let projects: readonly VercelProjectRecord[] = DETERMINISTIC_VERCEL_PROJECTS;

      if (shouldExecuteLiveVercelApi(context, Boolean(fetchFn))) {
        const res = await executeVercelReadOnlyGet({
          url: `${VERCEL_API_BASE_URL}/v9/projects?limit=50`,
          apiToken,
          fetchFn,
        });
        const payload = (await res.json()) as VercelProjectsApiResponse;
        projects = (payload.projects ?? [])
          .filter((p) => Boolean(p.id && p.name))
          .map((p) => ({
            id: String(p.id),
            name: String(p.name),
            framework: p.framework ?? null,
            accountId: p.accountId ?? "vercel_team",
            updatedAtIso:
              typeof p.updatedAt === "number"
                ? new Date(p.updatedAt).toISOString()
                : new Date().toISOString(),
          }));
      }

      return projects.map((p) => ({
        externalResourceId: p.id,
        externalResourceName: p.name,
        resourceType: "vercel_project",
        regionOrLocation: "Global Edge",
        parentAccountOrOrg: p.accountId,
        availableCapabilities: ["deployment_reliability"],
        metadata: {
          environmentHint: "PRODUCTION",
          framework: p.framework,
          envVarReadsBlocked: true,
          redeployMutationsBlocked: true,
        },
      }));
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertVercelContext(context);
      return evaluateCapabilityMatrix(catalogEntry.capabilities, context.grantedScopes, {
        providerPlanTier: context.providerPlanTier ?? "pro",
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const started = Date.now();
      try {
        const { apiToken } = assertVercelContext(context);
        if (shouldExecuteLiveVercelApi(context, Boolean(fetchFn))) {
          await executeVercelReadOnlyGet({
            url: `${VERCEL_API_BASE_URL}/v9/projects?limit=1`,
            apiToken,
            fetchFn,
          });
        }
        return {
          providerKey: VERCEL_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "Vercel read-only connection verified (redeploy, rollback, and decrypted env reads blocked).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: VERCEL_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message: err instanceof Error ? err.message : "Vercel health check failed.",
              });
        return {
          providerKey: VERCEL_PROVIDER_KEY,
          status: adapterErr.healthStatus,
          uxState: adapterErr.uxState,
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: adapterErr.missingScopes,
          errorCode: adapterErr.code,
          message: adapterErr.message,
        };
      }
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      assertVercelContext(context);
      const observedAtIso = new Date().toISOString();

      if (query.metricKey === VERCEL_CANONICAL_METRIC_KEYS.BILLED_COST) {
        if (
          context.providerPlanTier === "free" ||
          context.simulationScenario === "plan_restricted"
        ) {
          return {
            providerKey: VERCEL_PROVIDER_KEY,
            externalResourceId: query.externalResourceId,
            capabilityKey: query.capabilityKey,
            metricKey: query.metricKey,
            capabilityStatus: "PLAN_RESTRICTED",
            uxState: "unsupported_plan",
            observedAtIso,
            sourceFreshnessMinutes: 60,
            provenanceLabel: `Vercel FOCUS Billing • ${query.externalResourceId}`,
            statusExplanation:
              "Vercel `/v1/billing/charges` requires Pro or Enterprise plan access. Returning transparent non-numeric state instead of 0.",
            points: [
              {
                timestampIso: query.endDateIso,
                metricKey: query.metricKey,
                value: null,
                unit: "currency",
              },
            ],
          };
        }

        const charges = await fetchVercelFocusBillingCharges(context, {
          startDateIso: query.startDateIso,
          endDateIso: query.endDateIso,
          fetchFn,
        });
        const currencies = Array.from(new Set(charges.map((c) => c.billingCurrency)));
        const totalCost =
          currencies.length <= 1
            ? Math.round(charges.reduce((acc, c) => acc + c.billedCost, 0) * 100) / 100
            : null;

        return {
          providerKey: VERCEL_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "SUPPORTED",
          uxState: "connected_healthy",
          observedAtIso,
          sourceFreshnessMinutes: 60,
          provenanceLabel: `Vercel FOCUS NDJSON Charges • ${currencies.join("/") || "USD"}`,
          statusExplanation:
            currencies.length > 1
              ? "Multi-currency charges detected; refusing to sum heterogeneous currencies."
              : `Parsed ${charges.length} FOCUS charge records (${currencies[0] ?? "USD"}).`,
          points: [
            {
              timestampIso: query.endDateIso,
              metricKey: query.metricKey,
              value: totalCost,
              unit: currencies[0] ?? "USD",
            },
          ],
        };
      }

      const deployments = await listVercelProjectDeployments(context, query.externalResourceId, {
        fetchFn,
      });
      const ready = deployments.filter((d) => d.state === "READY");
      const failed = deployments.filter((d) => d.state === "ERROR");
      const completed = ready.length + failed.length;
      const durations = ready.map((d) => d.buildDurationMs).filter((v): v is number => v !== null);
      const meanDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null;

      let value: number | null = deployments.length;
      let unit = "count";
      switch (query.metricKey) {
        case VERCEL_CANONICAL_METRIC_KEYS.DEPLOYMENTS_TOTAL:
          value = deployments.length;
          break;
        case VERCEL_CANONICAL_METRIC_KEYS.DEPLOYMENTS_READY:
          value = ready.length;
          break;
        case VERCEL_CANONICAL_METRIC_KEYS.DEPLOYMENTS_FAILED:
          value = failed.length;
          break;
        case VERCEL_CANONICAL_METRIC_KEYS.DEPLOYMENT_SUCCESS_RATE:
          value = completed > 0 ? Math.round((ready.length / completed) * 10_000) / 10_000 : null;
          unit = "ratio";
          break;
        case VERCEL_CANONICAL_METRIC_KEYS.MEAN_BUILD_DURATION_MS:
          value = meanDurationMs;
          unit = "ms";
          break;
        default:
          value = deployments.length;
          break;
      }

      return {
        providerKey: VERCEL_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "SUPPORTED",
        uxState: "connected_healthy",
        observedAtIso,
        sourceFreshnessMinutes: 5,
        provenanceLabel: `Vercel Deployments API • ${query.externalResourceId}`,
        statusExplanation: `Observed ${deployments.length} deployments (${ready.length} READY, ${failed.length} ERROR).`,
        points: [
          {
            timestampIso: query.endDateIso,
            metricKey: query.metricKey,
            value,
            unit,
            dimensions: { projectId: query.externalResourceId },
          },
        ],
      };
    },
  };
}
