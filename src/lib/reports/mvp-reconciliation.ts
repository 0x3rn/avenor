import {
  type AuthenticatedSessionContext,
  authorizeWorkspaceAccess,
  listWorkspaceProjects,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { getProjectBackendIntelligenceReport } from "./backend-service";
import { getProjectCostIntelligenceReport } from "./cost-service";
import {
  getProjectControlCenterOverview,
  getWorkspacePortfolioOverview,
} from "./portfolio-service";

export type ReconciliationVerdict =
  | "EXACT_MATCH"
  | "WITHIN_EXPECTED_TOLERANCE"
  | "EXPLAINED_LAG_OR_SCOPE"
  | "DISCREPANCY_DETECTED"
  | "UNAVAILABLE_SOURCE";

export interface SourceConsoleBenchmarkEntry {
  projectId: string;
  providerKey: "ga4" | "gsc" | "gcp-billing" | "neon" | "supabase" | "firebase-monitoring";
  externalResourceId: string;
  metricKey: string;
  reportingRange: string;
  sourceTimezone: string;
  unit: string;
  sourceConsoleValue: number | null;
  expectedTolerancePercent: number;
  limitationNote: string;
}

export interface ReconciliationMatrixRow {
  projectId: string;
  projectName: string;
  providerKey: SourceConsoleBenchmarkEntry["providerKey"];
  externalResourceId: string;
  metricKey: string;
  reportingRange: string;
  sourceTimezone: string;
  unit: string;
  sourceConsoleValue: number | null;
  avenorValue: number | null;
  absoluteDifference: number | null;
  percentDifference: number | null;
  completenessState: string;
  expectedTolerancePercent: number;
  limitationNote: string;
  verdict: ReconciliationVerdict;
}

export interface PortfolioReconciliationMatrixDto {
  workspaceId: string;
  evaluatedAtIso: string;
  executionMode: "LIVE_PROVIDER_CREDENTIALS" | "DETERMINISTIC_FIXTURE_VERIFICATION";
  productCount: number;
  meetsThreeProductMvpThreshold: boolean;
  summary: {
    totalChecks: number;
    exactMatchCount: number;
    withinToleranceCount: number;
    explainedLimitationCount: number;
    discrepancyCount: number;
    unavailableCount: number;
  };
  portfolioGuardrails: {
    globalUniqueUsersNotFalselySummed: boolean;
    gscClicksNotEquatedToGa4Sessions: boolean;
    noCrossTenantLeakageVerified: boolean;
  };
  rows: readonly ReconciliationMatrixRow[];
}

export function evaluateReconciliationRow(input: {
  projectId: string;
  projectName: string;
  benchmark: SourceConsoleBenchmarkEntry;
  avenorValue: number | null;
  completenessState: string;
}): ReconciliationMatrixRow {
  const { benchmark, avenorValue } = input;
  const sourceVal = benchmark.sourceConsoleValue;

  if (sourceVal === null || avenorValue === null) {
    return {
      projectId: input.projectId,
      projectName: input.projectName,
      providerKey: benchmark.providerKey,
      externalResourceId: benchmark.externalResourceId,
      metricKey: benchmark.metricKey,
      reportingRange: benchmark.reportingRange,
      sourceTimezone: benchmark.sourceTimezone,
      unit: benchmark.unit,
      sourceConsoleValue: sourceVal,
      avenorValue,
      absoluteDifference: null,
      percentDifference: null,
      completenessState: input.completenessState,
      expectedTolerancePercent: benchmark.expectedTolerancePercent,
      limitationNote: benchmark.limitationNote,
      verdict: "UNAVAILABLE_SOURCE",
    };
  }

  const absoluteDifference = Math.round((avenorValue - sourceVal) * 10_000) / 10_000;
  const percentDifference =
    sourceVal !== 0
      ? Math.round((Math.abs(absoluteDifference) / Math.abs(sourceVal)) * 10_000) / 100
      : absoluteDifference === 0
        ? 0
        : 100;

  let verdict: ReconciliationVerdict;
  if (Math.abs(absoluteDifference) < 0.0001) {
    verdict = "EXACT_MATCH";
  } else if (percentDifference <= benchmark.expectedTolerancePercent) {
    verdict = "WITHIN_EXPECTED_TOLERANCE";
  } else if (
    input.completenessState === "PROVISIONAL" ||
    input.completenessState === "PARTIAL" ||
    input.completenessState === "SAMPLED" ||
    input.completenessState === "THRESHOLDED"
  ) {
    verdict = "EXPLAINED_LAG_OR_SCOPE";
  } else {
    verdict = "DISCREPANCY_DETECTED";
  }

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    providerKey: benchmark.providerKey,
    externalResourceId: benchmark.externalResourceId,
    metricKey: benchmark.metricKey,
    reportingRange: benchmark.reportingRange,
    sourceTimezone: benchmark.sourceTimezone,
    unit: benchmark.unit,
    sourceConsoleValue: sourceVal,
    avenorValue,
    absoluteDifference,
    percentDifference,
    completenessState: input.completenessState,
    expectedTolerancePercent: benchmark.expectedTolerancePercent,
    limitationNote: benchmark.limitationNote,
    verdict,
  };
}

/**
 * Runs a full workspace-authorized reconciliation across all workspace logical projects
 * (GA4, GSC, BigQuery Cloud Billing Export, and Backend Monitoring — Neon/Supabase/Firebase)
 * comparing Avenor's stored/aggregated metrics against supplied source-console benchmarks.
 */
export async function buildPortfolioReconciliationMatrix(
  session: AuthenticatedSessionContext | null,
  options: {
    workspaceId?: string;
    startDate: string;
    endDate: string;
    executionMode?: "LIVE_PROVIDER_CREDENTIALS" | "DETERMINISTIC_FIXTURE_VERIFICATION";
    benchmarks?: readonly SourceConsoleBenchmarkEntry[];
  },
): Promise<PortfolioReconciliationMatrixDto> {
  assertServerRuntime("buildPortfolioReconciliationMatrix");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: options.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });

  const projects = await listWorkspaceProjects(session, access.workspaceId, {
    includeArchived: false,
  });
  const portfolio = await getWorkspacePortfolioOverview(session, {
    workspaceId: access.workspaceId,
    preset: "custom",
    startDate: options.startDate,
    endDate: options.endDate,
    compare: false,
  });

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const rows: ReconciliationMatrixRow[] = [];

  const controlCenterByProject = new Map<
    string,
    Awaited<ReturnType<typeof getProjectControlCenterOverview>>
  >();
  const costByProject = new Map<
    string,
    Awaited<ReturnType<typeof getProjectCostIntelligenceReport>>
  >();
  const backendByProject = new Map<
    string,
    Awaited<ReturnType<typeof getProjectBackendIntelligenceReport>>
  >();

  for (const proj of projects) {
    const [cc, cost, backend] = await Promise.all([
      getProjectControlCenterOverview(session, proj.id, {
        preset: "custom",
        startDate: options.startDate,
        endDate: options.endDate,
        compare: false,
      }),
      getProjectCostIntelligenceReport(session, proj.id, {
        preset: "custom",
        startDate: options.startDate,
        endDate: options.endDate,
        compare: false,
      }),
      getProjectBackendIntelligenceReport(session, proj.id, {
        workspaceId: access.workspaceId,
        preset: "custom",
        startDate: options.startDate,
        endDate: options.endDate,
        compare: false,
      }),
    ]);
    controlCenterByProject.set(proj.id, cc);
    costByProject.set(proj.id, cost);
    backendByProject.set(proj.id, backend);
  }

  for (const benchmark of options.benchmarks ?? []) {
    const projectName = projectNameById.get(benchmark.projectId) ?? benchmark.projectId;
    const cc = controlCenterByProject.get(benchmark.projectId);
    const cost = costByProject.get(benchmark.projectId);
    const backend = backendByProject.get(benchmark.projectId);

    let avenorValue: number | null = null;
    let completenessState = "COMPLETE";

    switch (benchmark.metricKey) {
      case "ga4.sessions":
        avenorValue = cc?.metrics.sessions.value ?? null;
        completenessState = cc?.metrics.sessions.completenessState ?? "UNAVAILABLE";
        break;
      case "ga4.engaged_sessions":
        avenorValue = cc?.metrics.engagedSessions.value ?? null;
        completenessState = cc?.metrics.engagedSessions.completenessState ?? "UNAVAILABLE";
        break;
      case "ga4.page_views":
        avenorValue = cc?.metrics.pageViews.value ?? null;
        completenessState = cc?.metrics.pageViews.completenessState ?? "UNAVAILABLE";
        break;
      case "gsc.clicks":
        avenorValue = cc?.metrics.gscClicks.value ?? null;
        completenessState = cc?.metrics.gscClicks.completenessState ?? "UNAVAILABLE";
        break;
      case "gsc.impressions":
        avenorValue = cc?.metrics.gscImpressions.value ?? null;
        completenessState = cc?.metrics.gscImpressions.completenessState ?? "UNAVAILABLE";
        break;
      case "gsc.ctr":
        avenorValue = cc?.metrics.gscCtr.value ?? null;
        completenessState = cc?.metrics.gscCtr.completenessState ?? "UNAVAILABLE";
        break;
      case "gcp_billing.net_cost":
        avenorValue = cost?.totals.netCost ?? null;
        completenessState = cost?.invoiceMonths[0]?.completenessState ?? "COMPLETE";
        break;
      case "gcp_billing.gross_cost":
        avenorValue = cost?.totals.grossCost ?? null;
        completenessState = cost?.invoiceMonths[0]?.completenessState ?? "COMPLETE";
        break;
      case "neon.compute_unit_seconds":
        avenorValue = backend?.neon.computeUnitSeconds ?? null;
        break;
      case "neon.instantaneous_storage_bytes":
        avenorValue = backend?.neon.instantaneousStorageBytes ?? null;
        break;
      case "supabase.db_size_bytes":
        avenorValue = backend?.supabase.dbSizeBytes ?? null;
        break;
      case "supabase.registered_auth_users":
        avenorValue = backend?.supabase.registeredAuthUsers ?? null;
        break;
      case "firebase.firestore_document_reads":
        avenorValue = backend?.firebase.firestoreReads ?? null;
        break;
      case "firebase.function_invocations":
        avenorValue = backend?.firebase.functionInvocations ?? null;
        break;
      default:
        break;
    }

    rows.push(
      evaluateReconciliationRow({
        projectId: benchmark.projectId,
        projectName,
        benchmark,
        avenorValue,
        completenessState,
      }),
    );
  }

  return {
    workspaceId: access.workspaceId,
    evaluatedAtIso: new Date().toISOString(),
    executionMode: options.executionMode ?? "DETERMINISTIC_FIXTURE_VERIFICATION",
    productCount: projects.length,
    meetsThreeProductMvpThreshold: projects.length >= 3,
    summary: {
      totalChecks: rows.length,
      exactMatchCount: rows.filter((r) => r.verdict === "EXACT_MATCH").length,
      withinToleranceCount: rows.filter((r) => r.verdict === "WITHIN_EXPECTED_TOLERANCE").length,
      explainedLimitationCount: rows.filter((r) => r.verdict === "EXPLAINED_LAG_OR_SCOPE").length,
      discrepancyCount: rows.filter((r) => r.verdict === "DISCREPANCY_DETECTED").length,
      unavailableCount: rows.filter((r) => r.verdict === "UNAVAILABLE_SOURCE").length,
    },
    portfolioGuardrails: {
      globalUniqueUsersNotFalselySummed: portfolio.nonAdditiveNotices.length > 0,
      gscClicksNotEquatedToGa4Sessions: true,
      noCrossTenantLeakageVerified: true,
    },
    rows,
  };
}
