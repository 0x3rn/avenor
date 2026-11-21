import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
  getLogicalProjectById,
  listWorkspaceProjects,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, getDatabasePool } from "@avenor/database";
import type { AvenorUxState, EnvironmentType, LogicalProjectSummary } from "@avenor/types";
import {
  aggregateMetricObservations,
  computeDimensionIdentity,
  type MetricCompletenessState,
  queryMetricObservations,
} from "@/lib/metrics";
import { syncBigQueryBillingCostLedger } from "@/lib/providers/google-cloud-billing";
import { type ReportCacheEnvelopeMetadata, sharedReportCache } from "./cache";
import {
  computeMetricDeltaComparison,
  type PortfolioMetricComparison,
  type ResolvedPortfolioDateWindow,
  resolvePortfolioDateWindow,
} from "./portfolio-service";

export interface CostDailyTrendPoint {
  date: string;
  grossCost: number | null;
  creditsAmount: number | null;
  netCost: number | null;
  currency: string | null;
}

export interface CostServiceBreakdownItem {
  serviceId: string;
  serviceDescription: string;
  currency: string;
  grossCost: number;
  creditsAmount: number;
  netCost: number;
  sharePercentage: number;
}

export interface CostSkuBreakdownItem {
  skuId: string;
  skuDescription: string;
  serviceDescription: string;
  currency: string;
  grossCost: number;
  creditsAmount: number;
  netCost: number;
  usageAmount: number | null;
  usageUnit: string | null;
}

export interface CostGcpProjectBreakdownItem {
  gcpProjectId: string;
  billingAccountId: string;
  mappedAvenorProjectId: string | null;
  mappedAvenorProjectName: string | null;
  currency: string;
  grossCost: number;
  creditsAmount: number;
  netCost: number;
  completenessState: MetricCompletenessState;
}

export interface CostInvoiceMonthItem {
  invoiceMonth: string;
  currency: string;
  grossCost: number;
  creditsAmount: number;
  netCost: number;
  completenessState: MetricCompletenessState;
  isFinalized: boolean;
}

export interface CostCurrencyBucketSummary {
  currency: string;
  grossCost: number;
  creditsAmount: number;
  netCost: number;
  rowCount: number;
}

export interface CostEfficiencyMetricDto {
  available: boolean;
  costPer1kSessions: number | null;
  currency: string | null;
  numeratorNetCost: number | null;
  denominatorSessions: number | null;
  provenanceExplanation: string;
}

export interface CostExportSourceStatusDto {
  hasBillingConnection: boolean;
  hasBigQueryExportDataset: boolean;
  connectedResourceId: string | null;
  externalResourceId: string | null;
  billingAccountId: string | null;
  datasetLocation: string | null;
  exportType: string | null;
  availabilityState: string | null;
  lastExportTimeIso: string | null;
  totalQueryBytesProcessed: number;
}

export interface ProjectCostIntelligenceReportDto {
  organizationId: string;
  workspaceId: string;
  project: LogicalProjectSummary;
  selectedEnvironmentId: string | null;
  selectedEnvironmentType: EnvironmentType;
  dateWindow: ResolvedPortfolioDateWindow;
  uxState: AvenorUxState;
  completenessState: MetricCompletenessState;
  sourceStatus: CostExportSourceStatusDto;
  isMixedCurrency: boolean;
  currencies: string[];
  primaryCurrency: string | null;
  mixedCurrencyWarning: string | null;
  totals: {
    grossCost: number | null;
    creditsAmount: number | null;
    netCost: number | null;
    regularCost: number | null;
    taxAndAdjustmentsCost: number | null;
  };
  comparisons: {
    grossCost: PortfolioMetricComparison;
    netCost: PortfolioMetricComparison;
  };
  efficiency: CostEfficiencyMetricDto;
  currencyBuckets: CostCurrencyBucketSummary[];
  dailyTrend: CostDailyTrendPoint[];
  serviceBreakdown: CostServiceBreakdownItem[];
  skuBreakdown: CostSkuBreakdownItem[];
  gcpProjectBreakdown: CostGcpProjectBreakdownItem[];
  invoiceMonths: CostInvoiceMonthItem[];
  warnings: string[];
  cacheMetadata?: ReportCacheEnvelopeMetadata;
}

export interface WorkspaceCostIntelligenceReportDto {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  dateWindow: ResolvedPortfolioDateWindow;
  uxState: AvenorUxState;
  isMixedCurrency: boolean;
  currencies: string[];
  primaryCurrency: string | null;
  mixedCurrencyWarning: string | null;
  totals: {
    grossCost: number | null;
    creditsAmount: number | null;
    netCost: number | null;
  };
  comparisons: {
    grossCost: PortfolioMetricComparison;
    netCost: PortfolioMetricComparison;
  };
  currencyBuckets: CostCurrencyBucketSummary[];
  dailyTrend: CostDailyTrendPoint[];
  serviceBreakdown: CostServiceBreakdownItem[];
  projectCosts: Array<{
    projectId: string;
    projectName: string;
    projectSlug: string;
    currency: string | null;
    grossCost: number | null;
    creditsAmount: number | null;
    netCost: number | null;
    costPer1kSessions: number | null;
    uxState: AvenorUxState;
  }>;
  warnings: string[];
  cacheMetadata?: ReportCacheEnvelopeMetadata;
}

interface DbBillingLedgerRow {
  id: string;
  project_id: string | null;
  environment_id: string | null;
  connected_resource_id: string;
  billing_account_id: string;
  gcp_project_id: string;
  usage_date: string;
  invoice_month: string;
  service_id: string;
  service_description: string;
  sku_id: string;
  sku_description: string;
  region: string;
  cost_type: string;
  currency: string;
  gross_cost: string;
  credits_amount: string;
  net_cost: string;
  usage_amount: string | null;
  usage_unit: string | null;
  completeness_state: string;
  export_time: Date | null;
  query_bytes_processed: string;
}

/**
 * Loads the authorized Project Cost Intelligence Report for an Avenor logical product.
 */
export async function getProjectCostIntelligenceReport(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  query?: {
    environmentId?: string | null;
    environmentType?: EnvironmentType | null;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    compare?: boolean;
    currencyFilter?: string | null;
    autoHydrateIfEmpty?: boolean;
    bypassCache?: boolean;
    now?: Date;
  },
  options?: { connectionString?: string },
): Promise<ProjectCostIntelligenceReportDto> {
  assertServerRuntime("getProjectCostIntelligenceReport");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });

  const project = await getLogicalProjectById(session, access.projectId, access.workspaceId);
  const pool = getDatabasePool(options?.connectionString);

  const wsRes = await dbQuery<{ default_timezone: string; default_currency: string }>(
    `SELECT default_timezone, default_currency FROM workspaces WHERE id = $1 LIMIT 1`,
    [access.workspaceId],
    pool,
  );
  const defaultTimezone = wsRes.rows[0]?.default_timezone ?? "UTC";

  const selectedEnv =
    (query?.environmentId
      ? project.environments.find((e) => e.id === query.environmentId)
      : null) ??
    (query?.environmentType
      ? project.environments.find((e) => e.type === query.environmentType)
      : null) ??
    project.environments.find((e) => e.isDefault) ??
    project.environments[0] ??
    null;

  const selectedEnvironmentId = selectedEnv?.id ?? null;
  const selectedEnvironmentType: EnvironmentType = selectedEnv?.type ?? "PRODUCTION";

  const dateWindow = resolvePortfolioDateWindow({
    preset: query?.preset,
    startDate: query?.startDate,
    endDate: query?.endDate,
    compare: query?.compare ?? true,
    timeZone: defaultTimezone,
    now: query?.now,
  });

  const cached = await sharedReportCache.getOrLoad(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      environmentId: selectedEnvironmentId,
      role: access.role,
      surface: "project_control_center",
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      compareEnabled: dateWindow.compareEnabled,
      filters: {
        reportKind: "project_cost_intelligence",
        preset: dateWindow.preset,
        environmentType: selectedEnvironmentType,
        currencyFilter: query?.currencyFilter ?? null,
      },
    },
    async () => {
      return computeProjectCostIntelligenceUncached({
        session,
        access,
        project,
        selectedEnvironmentId,
        selectedEnvironmentType,
        dateWindow,
        currencyFilter: query?.currencyFilter ?? null,
        autoHydrateIfEmpty: query?.autoHydrateIfEmpty ?? false,
        options,
      });
    },
    { bypassCache: query?.bypassCache },
  );

  return {
    ...cached.value,
    cacheMetadata: cached.metadata,
  };
}

async function computeProjectCostIntelligenceUncached(input: {
  session: AuthenticatedSessionContext | null;
  access: { organizationId: string; workspaceId: string; projectId: string };
  project: LogicalProjectSummary;
  selectedEnvironmentId: string | null;
  selectedEnvironmentType: EnvironmentType;
  dateWindow: ResolvedPortfolioDateWindow;
  currencyFilter: string | null;
  autoHydrateIfEmpty: boolean;
  options?: { connectionString?: string };
}): Promise<ProjectCostIntelligenceReportDto> {
  const {
    session,
    access,
    project,
    selectedEnvironmentId,
    selectedEnvironmentType,
    dateWindow,
    currencyFilter,
    autoHydrateIfEmpty,
    options,
  } = input;
  const pool = getDatabasePool(options?.connectionString);

  // Inspect mapped or workspace-linked gcp-billing resources
  const billingRes = await dbQuery<{
    connected_resource_id: string;
    external_resource_id: string;
    resource_type: string;
    metadata: Record<string, unknown>;
    connection_status: string;
    project_id: string | null;
  }>(
    `SELECT
       cr.id AS connected_resource_id,
       cr.external_resource_id,
       cr.resource_type,
       cr.metadata,
       pc.status AS connection_status,
       rm.project_id
     FROM connected_resources cr
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     LEFT JOIN resource_mappings rm ON rm.connected_resource_id = cr.id AND rm.project_id = $2
     WHERE cr.workspace_id = $1 AND pc.provider_key = 'gcp-billing'
     ORDER BY (rm.project_id IS NOT NULL) DESC, cr.created_at DESC`,
    [access.workspaceId, access.projectId],
    pool,
  );

  const exportResource = billingRes.rows.find(
    (r) =>
      r.resource_type === "gcp_billing_dataset" &&
      r.metadata?.hasHistoricalCostAccess === true &&
      (r.project_id === access.projectId || r.project_id === null),
  );
  const metadataOnlyResource = billingRes.rows.find(
    (r) => r.resource_type === "gcp_billing_project" || r.resource_type === "gcp_billing_account",
  );

  const earliestDate = dateWindow.compareStartDate ?? dateWindow.startDate;

  let ledgerRes = await dbQuery<DbBillingLedgerRow>(
    `SELECT *
     FROM billing_cost_ledger_entries
     WHERE organization_id = $1
       AND workspace_id = $2
       AND (project_id = $3 OR project_id IS NULL)
       AND usage_date >= $4
       AND usage_date <= $5
     ORDER BY usage_date ASC`,
    [access.organizationId, access.workspaceId, access.projectId, earliestDate, dateWindow.endDate],
    pool,
  );

  if (ledgerRes.rows.length === 0 && exportResource && autoHydrateIfEmpty) {
    try {
      await syncBigQueryBillingCostLedger(
        session,
        {
          workspaceId: access.workspaceId,
          connectedResourceId: exportResource.connected_resource_id,
          projectId: access.projectId,
          environmentId: selectedEnvironmentId,
          startDate: earliestDate,
          endDate: dateWindow.endDate,
        },
        options,
      );
      ledgerRes = await dbQuery<DbBillingLedgerRow>(
        `SELECT *
         FROM billing_cost_ledger_entries
         WHERE organization_id = $1
           AND workspace_id = $2
           AND (project_id = $3 OR project_id IS NULL)
           AND usage_date >= $4
           AND usage_date <= $5
         ORDER BY usage_date ASC`,
        [
          access.organizationId,
          access.workspaceId,
          access.projectId,
          earliestDate,
          dateWindow.endDate,
        ],
        pool,
      );
    } catch {
      // Do not fail report read path if background auto-hydration encounters an error
    }
  }

  const allRows = ledgerRes.rows.filter((r) =>
    currencyFilter ? r.currency.toUpperCase() === currencyFilter.toUpperCase() : true,
  );

  const currentRows = allRows.filter(
    (r) => r.usage_date >= dateWindow.startDate && r.usage_date <= dateWindow.endDate,
  );
  const compareStart = dateWindow.compareStartDate;
  const compareEnd = dateWindow.compareEndDate;
  const previousRows =
    dateWindow.compareEnabled && compareStart && compareEnd
      ? allRows.filter((r) => r.usage_date >= compareStart && r.usage_date <= compareEnd)
      : [];

  const currencies = Array.from(new Set(currentRows.map((r) => r.currency)));
  const isMixedCurrency = currencies.length > 1;
  const primaryCurrency =
    currencies.length === 1
      ? (currencies[0] ?? null)
      : !isMixedCurrency && exportResource?.metadata?.currencyCode
        ? String(exportResource.metadata.currencyCode)
        : null;

  const warnings: string[] = [];
  if (!exportResource && metadataOnlyResource) {
    warnings.push(
      "Cloud Billing account metadata is connected, but no BigQuery Cloud Billing Export dataset has been linked yet. Historical spend is unavailable (not $0.00) until BigQuery export onboarding is completed.",
    );
  }
  if (exportResource && currentRows.length === 0) {
    warnings.push(
      "No billing export rows were returned for the selected date range. If the BigQuery export was recently enabled, initial Google Cloud population may still be in progress.",
    );
  }

  const mixedCurrencyWarning = isMixedCurrency
    ? `Multiple billing currencies detected (${currencies.join(", ")}). Avenor refuses to sum distinct currencies without an explicit conversion ledger; select a currency filter or inspect per-currency buckets below.`
    : null;
  if (mixedCurrencyWarning) {
    warnings.push(mixedCurrencyWarning);
  }

  // Currency buckets
  const bucketMap = new Map<string, CostCurrencyBucketSummary>();
  for (const r of currentRows) {
    const bucket = bucketMap.get(r.currency) ?? {
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      rowCount: 0,
    };
    bucket.grossCost = Number((bucket.grossCost + Number(r.gross_cost)).toFixed(6));
    bucket.creditsAmount = Number((bucket.creditsAmount + Number(r.credits_amount)).toFixed(6));
    bucket.netCost = Number((bucket.netCost + Number(r.net_cost)).toFixed(6));
    bucket.rowCount += 1;
    bucketMap.set(r.currency, bucket);
  }
  const currencyBuckets = Array.from(bucketMap.values());

  const hasValidSingleCurrencyRows = currentRows.length > 0 && !isMixedCurrency;

  const sumRows = (rows: readonly DbBillingLedgerRow[]) => {
    let gross = 0;
    let credits = 0;
    let net = 0;
    let regular = 0;
    let taxAdj = 0;
    for (const r of rows) {
      const g = Number(r.gross_cost);
      const c = Number(r.credits_amount);
      const n = Number(r.net_cost);
      gross += g;
      credits += c;
      net += n;
      if (r.cost_type === "regular") {
        regular += n;
      } else {
        taxAdj += n;
      }
    }
    return {
      grossCost: Number(gross.toFixed(6)),
      creditsAmount: Number(credits.toFixed(6)),
      netCost: Number(net.toFixed(6)),
      regularCost: Number(regular.toFixed(6)),
      taxAndAdjustmentsCost: Number(taxAdj.toFixed(6)),
    };
  };

  const currentTotals = hasValidSingleCurrencyRows
    ? sumRows(currentRows)
    : {
        grossCost: null,
        creditsAmount: null,
        netCost: null,
        regularCost: null,
        taxAndAdjustmentsCost: null,
      };

  const prevCurrencies = new Set(previousRows.map((r) => r.currency));
  const hasComparablePrev =
    hasValidSingleCurrencyRows &&
    previousRows.length > 0 &&
    prevCurrencies.size === 1 &&
    prevCurrencies.has(primaryCurrency ?? "");
  const previousTotals = hasComparablePrev
    ? sumRows(previousRows)
    : {
        grossCost: null,
        creditsAmount: null,
        netCost: null,
        regularCost: null,
        taxAndAdjustmentsCost: null,
      };

  const comparisons = {
    grossCost: computeMetricDeltaComparison(currentTotals.grossCost, previousTotals.grossCost, {
      invertPolarity: true,
    }),
    netCost: computeMetricDeltaComparison(currentTotals.netCost, previousTotals.netCost, {
      invertPolarity: true,
    }),
  };

  // Daily trend
  const byDate = new Map<string, { gross: number; credits: number; net: number }>();
  if (hasValidSingleCurrencyRows) {
    for (const r of currentRows) {
      const entry = byDate.get(r.usage_date) ?? { gross: 0, credits: 0, net: 0 };
      entry.gross = Number((entry.gross + Number(r.gross_cost)).toFixed(6));
      entry.credits = Number((entry.credits + Number(r.credits_amount)).toFixed(6));
      entry.net = Number((entry.net + Number(r.net_cost)).toFixed(6));
      byDate.set(r.usage_date, entry);
    }
  }
  const dailyTrend: CostDailyTrendPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      grossCost: vals.gross,
      creditsAmount: vals.credits,
      netCost: vals.net,
      currency: primaryCurrency,
    }));

  // Service breakdown
  const byService = new Map<string, CostServiceBreakdownItem>();
  for (const r of currentRows) {
    const key = `${r.service_id}::${r.currency}`;
    const item = byService.get(key) ?? {
      serviceId: r.service_id,
      serviceDescription: r.service_description,
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      sharePercentage: 0,
    };
    item.grossCost = Number((item.grossCost + Number(r.gross_cost)).toFixed(6));
    item.creditsAmount = Number((item.creditsAmount + Number(r.credits_amount)).toFixed(6));
    item.netCost = Number((item.netCost + Number(r.net_cost)).toFixed(6));
    byService.set(key, item);
  }
  const totalNetForShare = currentTotals.netCost ?? 0;
  const serviceBreakdown = Array.from(byService.values())
    .map((s) => ({
      ...s,
      sharePercentage:
        !isMixedCurrency && totalNetForShare > 0
          ? Number(((s.netCost / totalNetForShare) * 100).toFixed(2))
          : 0,
    }))
    .sort((a, b) => b.netCost - a.netCost);

  // SKU breakdown
  const bySku = new Map<string, CostSkuBreakdownItem>();
  for (const r of currentRows) {
    const key = `${r.sku_id}::${r.currency}`;
    const item = bySku.get(key) ?? {
      skuId: r.sku_id,
      skuDescription: r.sku_description,
      serviceDescription: r.service_description,
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      usageAmount: r.usage_amount !== null ? 0 : null,
      usageUnit: r.usage_unit,
    };
    item.grossCost = Number((item.grossCost + Number(r.gross_cost)).toFixed(6));
    item.creditsAmount = Number((item.creditsAmount + Number(r.credits_amount)).toFixed(6));
    item.netCost = Number((item.netCost + Number(r.net_cost)).toFixed(6));
    if (r.usage_amount !== null && item.usageAmount !== null) {
      item.usageAmount = Number((item.usageAmount + Number(r.usage_amount)).toFixed(6));
    }
    bySku.set(key, item);
  }
  const skuBreakdown = Array.from(bySku.values())
    .sort((a, b) => b.netCost - a.netCost)
    .slice(0, 10);

  // GCP Project breakdown
  const byGcpProj = new Map<string, CostGcpProjectBreakdownItem>();
  for (const r of currentRows) {
    const key = `${r.gcp_project_id}::${r.currency}`;
    const item = byGcpProj.get(key) ?? {
      gcpProjectId: r.gcp_project_id,
      billingAccountId: r.billing_account_id,
      mappedAvenorProjectId: project.id,
      mappedAvenorProjectName: project.name,
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      completenessState: (r.completeness_state as MetricCompletenessState) ?? "PROVISIONAL",
    };
    item.grossCost = Number((item.grossCost + Number(r.gross_cost)).toFixed(6));
    item.creditsAmount = Number((item.creditsAmount + Number(r.credits_amount)).toFixed(6));
    item.netCost = Number((item.netCost + Number(r.net_cost)).toFixed(6));
    if (r.completeness_state === "PROVISIONAL") {
      item.completenessState = "PROVISIONAL";
    }
    byGcpProj.set(key, item);
  }
  const gcpProjectBreakdown = Array.from(byGcpProj.values()).sort((a, b) => b.netCost - a.netCost);

  // Invoice months
  const byInvoice = new Map<string, CostInvoiceMonthItem>();
  for (const r of currentRows) {
    const key = `${r.invoice_month}::${r.currency}`;
    const item = byInvoice.get(key) ?? {
      invoiceMonth: r.invoice_month,
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      completenessState: (r.completeness_state as MetricCompletenessState) ?? "PROVISIONAL",
      isFinalized: r.completeness_state === "COMPLETE",
    };
    item.grossCost = Number((item.grossCost + Number(r.gross_cost)).toFixed(6));
    item.creditsAmount = Number((item.creditsAmount + Number(r.credits_amount)).toFixed(6));
    item.netCost = Number((item.netCost + Number(r.net_cost)).toFixed(6));
    if (r.completeness_state !== "COMPLETE") {
      item.completenessState = "PROVISIONAL";
      item.isFinalized = false;
    }
    byInvoice.set(key, item);
  }
  const invoiceMonths = Array.from(byInvoice.values()).sort((a, b) =>
    b.invoiceMonth.localeCompare(a.invoiceMonth),
  );

  // Cost per 1,000 GA4 sessions efficiency metric
  const ga4SessionObs = await queryMetricObservations(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      canonicalMetricKeys: ["ga4.sessions"],
      granularity: "DAILY",
      periodStartDate: dateWindow.startDate,
      periodEndDate: dateWindow.endDate,
      dimensionKeyHash: computeDimensionIdentity({}).hash,
    },
    { executor: pool },
  );
  const sessionsAgg = aggregateMetricObservations({
    canonicalMetricKey: "ga4.sessions",
    observations: ga4SessionObs,
    requestedStartDate: dateWindow.startDate,
    requestedEndDate: dateWindow.endDate,
  });

  let efficiency: CostEfficiencyMetricDto;
  if (
    hasValidSingleCurrencyRows &&
    currentTotals.netCost !== null &&
    sessionsAgg.value !== null &&
    sessionsAgg.value > 0
  ) {
    const costPer1k = Number(((currentTotals.netCost / sessionsAgg.value) * 1000).toFixed(4));
    efficiency = {
      available: true,
      costPer1kSessions: costPer1k,
      currency: primaryCurrency,
      numeratorNetCost: currentTotals.netCost,
      denominatorSessions: sessionsAgg.value,
      provenanceExplanation: `Derived from BigQuery Net Cloud Cost (${primaryCurrency} ${currentTotals.netCost.toFixed(2)}) divided by stored GA4 Sessions (${sessionsAgg.value.toLocaleString()} sessions) across ${dateWindow.startDate}..${dateWindow.endDate}.`,
    };
  } else {
    efficiency = {
      available: false,
      costPer1kSessions: null,
      currency: primaryCurrency,
      numeratorNetCost: currentTotals.netCost,
      denominatorSessions: sessionsAgg.value,
      provenanceExplanation: isMixedCurrency
        ? "Cannot compute Cost per 1,000 Sessions across mixed billing currencies."
        : sessionsAgg.value === null || sessionsAgg.value === 0
          ? "Requires both BigQuery Net Cost and non-zero GA4 Sessions for this project and reporting window."
          : "Requires single-currency BigQuery Net Cost observations for this window.",
    };
  }

  const latestExportDate = currentRows.reduce<Date | null>((latest, r) => {
    if (!r.export_time) return latest;
    const d = new Date(r.export_time);
    return !latest || d > latest ? d : latest;
  }, null);

  const totalQueryBytesProcessed = currentRows.reduce(
    (max, r) => Math.max(max, Number(r.query_bytes_processed ?? 0)),
    0,
  );

  const hasAnyProvisional = currentRows.some((r) => r.completeness_state !== "COMPLETE");
  const completenessState: MetricCompletenessState =
    currentRows.length === 0 ? "UNAVAILABLE" : hasAnyProvisional ? "PROVISIONAL" : "COMPLETE";

  const uxState: AvenorUxState =
    !exportResource && currentRows.length === 0
      ? "unconnected"
      : isMixedCurrency
        ? "partial_coverage"
        : currentRows.length === 0
          ? "empty_first_use"
          : "connected_healthy";

  return {
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    project,
    selectedEnvironmentId,
    selectedEnvironmentType,
    dateWindow,
    uxState,
    completenessState,
    sourceStatus: {
      hasBillingConnection: billingRes.rows.length > 0,
      hasBigQueryExportDataset: Boolean(exportResource),
      connectedResourceId: exportResource?.connected_resource_id ?? null,
      externalResourceId: exportResource?.external_resource_id ?? null,
      billingAccountId: exportResource?.metadata?.billingAccountId
        ? String(exportResource.metadata.billingAccountId)
        : (currentRows[0]?.billing_account_id ?? null),
      datasetLocation: exportResource?.metadata?.datasetLocation
        ? String(exportResource.metadata.datasetLocation)
        : null,
      exportType: exportResource?.metadata?.exportType
        ? String(exportResource.metadata.exportType)
        : null,
      availabilityState: exportResource?.metadata?.availabilityState
        ? String(exportResource.metadata.availabilityState)
        : null,
      lastExportTimeIso: latestExportDate ? latestExportDate.toISOString() : null,
      totalQueryBytesProcessed,
    },
    isMixedCurrency,
    currencies,
    primaryCurrency,
    mixedCurrencyWarning,
    totals: currentTotals,
    comparisons,
    efficiency,
    currencyBuckets,
    dailyTrend,
    serviceBreakdown,
    skuBreakdown,
    gcpProjectBreakdown,
    invoiceMonths,
    warnings,
  };
}

/**
 * Loads the Workspace-Wide Cloud Cost Intelligence Report across all logical projects.
 */
export async function getWorkspaceCostIntelligenceReport(
  session: AuthenticatedSessionContext | null,
  query?: {
    workspaceId?: string;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    compare?: boolean;
    currencyFilter?: string | null;
    bypassCache?: boolean;
    now?: Date;
  },
  options?: { connectionString?: string },
): Promise<WorkspaceCostIntelligenceReportDto> {
  assertServerRuntime("getWorkspaceCostIntelligenceReport");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: query?.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });

  const pool = getDatabasePool(options?.connectionString);
  const wsRes = await dbQuery<{ name: string; default_timezone: string }>(
    `SELECT name, default_timezone FROM workspaces WHERE id = $1 LIMIT 1`,
    [access.workspaceId],
    pool,
  );
  const workspaceName = wsRes.rows[0]?.name ?? "Workspace";
  const defaultTimezone = wsRes.rows[0]?.default_timezone ?? "UTC";

  const dateWindow = resolvePortfolioDateWindow({
    preset: query?.preset,
    startDate: query?.startDate,
    endDate: query?.endDate,
    compare: query?.compare ?? true,
    timeZone: defaultTimezone,
    now: query?.now,
  });

  const projects = await listWorkspaceProjects(session, access.workspaceId, {
    includeArchived: false,
  });

  const projectReports = await Promise.all(
    projects.map((p) =>
      getProjectCostIntelligenceReport(
        session,
        p.id,
        {
          preset: dateWindow.preset,
          startDate: dateWindow.startDate,
          endDate: dateWindow.endDate,
          compare: dateWindow.compareEnabled,
          currencyFilter: query?.currencyFilter,
          bypassCache: query?.bypassCache,
          now: query?.now,
        },
        options,
      ),
    ),
  );

  const earliestDate = dateWindow.compareStartDate ?? dateWindow.startDate;
  const ledgerRes = await dbQuery<DbBillingLedgerRow>(
    `SELECT *
     FROM billing_cost_ledger_entries
     WHERE organization_id = $1
       AND workspace_id = $2
       AND usage_date >= $3
       AND usage_date <= $4
     ORDER BY usage_date ASC`,
    [access.organizationId, access.workspaceId, earliestDate, dateWindow.endDate],
    pool,
  );

  const filteredRows = ledgerRes.rows.filter((r) =>
    query?.currencyFilter ? r.currency.toUpperCase() === query.currencyFilter.toUpperCase() : true,
  );
  const currentRows = filteredRows.filter(
    (r) => r.usage_date >= dateWindow.startDate && r.usage_date <= dateWindow.endDate,
  );
  const compareStart = dateWindow.compareStartDate;
  const compareEnd = dateWindow.compareEndDate;
  const previousRows =
    dateWindow.compareEnabled && compareStart && compareEnd
      ? filteredRows.filter((r) => r.usage_date >= compareStart && r.usage_date <= compareEnd)
      : [];

  const currencies = Array.from(new Set(currentRows.map((r) => r.currency)));
  const isMixedCurrency = currencies.length > 1;
  const primaryCurrency = currencies.length === 1 ? (currencies[0] ?? null) : null;

  const bucketMap = new Map<string, CostCurrencyBucketSummary>();
  for (const r of currentRows) {
    const b = bucketMap.get(r.currency) ?? {
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      rowCount: 0,
    };
    b.grossCost = Number((b.grossCost + Number(r.gross_cost)).toFixed(6));
    b.creditsAmount = Number((b.creditsAmount + Number(r.credits_amount)).toFixed(6));
    b.netCost = Number((b.netCost + Number(r.net_cost)).toFixed(6));
    b.rowCount += 1;
    bucketMap.set(r.currency, b);
  }

  const hasSingleCurrency = currentRows.length > 0 && !isMixedCurrency;
  const sumSimple = (rows: readonly DbBillingLedgerRow[]) => {
    let gross = 0;
    let credits = 0;
    let net = 0;
    for (const r of rows) {
      gross += Number(r.gross_cost);
      credits += Number(r.credits_amount);
      net += Number(r.net_cost);
    }
    return {
      grossCost: Number(gross.toFixed(6)),
      creditsAmount: Number(credits.toFixed(6)),
      netCost: Number(net.toFixed(6)),
    };
  };

  const totals = hasSingleCurrency
    ? sumSimple(currentRows)
    : { grossCost: null, creditsAmount: null, netCost: null };

  const prevCurrencies = new Set(previousRows.map((r) => r.currency));
  const prevTotals =
    hasSingleCurrency &&
    previousRows.length > 0 &&
    prevCurrencies.size === 1 &&
    prevCurrencies.has(primaryCurrency ?? "")
      ? sumSimple(previousRows)
      : { grossCost: null, creditsAmount: null, netCost: null };

  const byDate = new Map<string, { gross: number; credits: number; net: number }>();
  if (hasSingleCurrency) {
    for (const r of currentRows) {
      const d = byDate.get(r.usage_date) ?? { gross: 0, credits: 0, net: 0 };
      d.gross = Number((d.gross + Number(r.gross_cost)).toFixed(6));
      d.credits = Number((d.credits + Number(r.credits_amount)).toFixed(6));
      d.net = Number((d.net + Number(r.net_cost)).toFixed(6));
      byDate.set(r.usage_date, d);
    }
  }

  const byService = new Map<string, CostServiceBreakdownItem>();
  for (const r of currentRows) {
    const key = `${r.service_id}::${r.currency}`;
    const item = byService.get(key) ?? {
      serviceId: r.service_id,
      serviceDescription: r.service_description,
      currency: r.currency,
      grossCost: 0,
      creditsAmount: 0,
      netCost: 0,
      sharePercentage: 0,
    };
    item.grossCost = Number((item.grossCost + Number(r.gross_cost)).toFixed(6));
    item.creditsAmount = Number((item.creditsAmount + Number(r.credits_amount)).toFixed(6));
    item.netCost = Number((item.netCost + Number(r.net_cost)).toFixed(6));
    byService.set(key, item);
  }

  const mixedCurrencyWarning = isMixedCurrency
    ? `Workspace contains multiple billing currencies (${currencies.join(", ")}). Totals are segmented by currency to prevent invalid cross-currency addition.`
    : null;

  return {
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    workspaceName,
    dateWindow,
    uxState: isMixedCurrency
      ? "partial_coverage"
      : currentRows.length === 0
        ? "unconnected"
        : "connected_healthy",
    isMixedCurrency,
    currencies,
    primaryCurrency,
    mixedCurrencyWarning,
    totals,
    comparisons: {
      grossCost: computeMetricDeltaComparison(totals.grossCost, prevTotals.grossCost, {
        invertPolarity: true,
      }),
      netCost: computeMetricDeltaComparison(totals.netCost, prevTotals.netCost, {
        invertPolarity: true,
      }),
    },
    currencyBuckets: Array.from(bucketMap.values()),
    dailyTrend: Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        grossCost: v.gross,
        creditsAmount: v.credits,
        netCost: v.net,
        currency: primaryCurrency,
      })),
    serviceBreakdown: Array.from(byService.values()).sort((a, b) => b.netCost - a.netCost),
    projectCosts: projectReports.map((pr) => ({
      projectId: pr.project.id,
      projectName: pr.project.name,
      projectSlug: pr.project.slug,
      currency: pr.primaryCurrency,
      grossCost: pr.totals.grossCost,
      creditsAmount: pr.totals.creditsAmount,
      netCost: pr.totals.netCost,
      costPer1kSessions: pr.efficiency.costPer1kSessions,
      uxState: pr.uxState,
    })),
    warnings: mixedCurrencyWarning ? [mixedCurrencyWarning] : [],
  };
}
