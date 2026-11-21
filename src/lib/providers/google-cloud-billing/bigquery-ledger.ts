import {
  type AuthenticatedSessionContext,
  authorizeWorkspaceAccess,
  decryptConnectionCredentialForServer,
  type VaultKeyRing,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import {
  dbQuery,
  generateId,
  getDatabasePool,
  type Queryable,
  withTransaction,
} from "@avenor/database";
import { AppError, ERROR_CODES, PROVIDER_ERROR_CODES, ProviderAdapterError } from "@avenor/types";
import {
  type CanonicalMetricObservationInput,
  type MetricCompletenessState,
  upsertMetricObservationBatch,
} from "@/lib/metrics";
import { sharedReportCache } from "@/lib/reports/cache";
import {
  executeGoogleReadRequest,
  GOOGLE_BIGQUERY_V2_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import { hasBigQueryReadOnlyScope } from "./discovery";
import { parseAndValidateExportTableIdentifier } from "./onboarding";
import { GCP_BILLING_PROVIDER_KEY } from "./types";

export const DEFAULT_MAX_BYTES_BILLED = 524_288_000; // 500 MB safety cap per query job

const FORBIDDEN_BIGQUERY_SQL_TOKEN_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXPORT\s+DATA|CALL|EXECUTE\s+IMMEDIATE|BEGIN\s+TRANSACTION|COMMIT|ROLLBACK)\b/i;

/**
 * Runtime SQL guard ensuring Avenor never executes DDL, DML, scripts, or multi-statement SQL
 * against BigQuery. Only single-statement read-only `SELECT` queries are permitted.
 */
export function assertReadOnlyBigQuerySelectStatement(sql: string): void {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message:
        "Blocked non-SELECT BigQuery statement. Only read-only SELECT queries are permitted.",
    });
  }
  if (trimmed.includes(";")) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: "Blocked multi-statement BigQuery SQL containing semicolon delimiter.",
    });
  }
  const match = trimmed.match(FORBIDDEN_BIGQUERY_SQL_TOKEN_RE);
  if (match) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Blocked prohibited BigQuery SQL keyword "${match[0]}".`,
    });
  }
}

export interface BigQueryParameterValue {
  name: string;
  parameterType: {
    type: "STRING" | "INT64" | "FLOAT64" | "DATE";
  };
  parameterValue: {
    value: string;
  };
}

export interface BuiltBigQueryCostQueryRequest {
  url: string;
  fullyQualifiedTableRef: string;
  body: {
    query: string;
    useLegacySql: false;
    parameterMode: "NAMED";
    queryParameters: BigQueryParameterValue[];
    location: string;
    maximumBytesBilled: string;
    timeoutMs: number;
    maxResults: number;
  };
}

/**
 * Constructs a strictly allowlisted, parameterized BigQuery `jobs.query` request payload
 * bounded by date partition filters and `maximumBytesBilled`.
 */
export function buildAllowlistedBigQueryCostSelectRequest(input: {
  billingAccountId: string;
  datasetProjectId: string;
  queryProjectId?: string;
  datasetId: string;
  tableId: string;
  datasetLocation: string;
  startDate: string;
  endDate: string;
  gcpProjectFilter?: string | null;
  maximumBytesBilled?: number;
  maxResults?: number;
}): BuiltBigQueryCostQueryRequest {
  const parsed = parseAndValidateExportTableIdentifier({
    billingAccountId: input.billingAccountId,
    datasetProjectId: input.datasetProjectId,
    queryProjectId: input.queryProjectId,
    datasetId: input.datasetId,
    tableId: input.tableId,
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "BigQuery cost query requires YYYY-MM-DD startDate and endDate.",
      statusCode: 400,
    });
  }

  const fullyQualifiedTableRef = `${parsed.datasetProjectId}.${parsed.datasetId}.${parsed.tableId}`;
  const hasGcpProjectFilter = Boolean(input.gcpProjectFilter?.trim());

  const sql = [
    "SELECT",
    "  FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS usage_date,",
    "  COALESCE(invoice.month, FORMAT_DATE('%Y%m', DATE(usage_start_time))) AS invoice_month,",
    "  COALESCE(project.id, 'unassigned') AS gcp_project_id,",
    "  COALESCE(service.id, 'unknown_service') AS service_id,",
    "  COALESCE(service.description, 'Unspecified Service') AS service_description,",
    "  COALESCE(sku.id, 'unknown_sku') AS sku_id,",
    "  COALESCE(sku.description, 'Unspecified SKU') AS sku_description,",
    "  COALESCE(location.region, location.location, 'global') AS region,",
    "  COALESCE(cost_type, 'regular') AS cost_type,",
    "  UPPER(COALESCE(currency, 'USD')) AS currency,",
    "  AVG(COALESCE(currency_conversion_rate, 1.0)) AS currency_conversion_rate,",
    "  SUM(COALESCE(cost, 0)) AS gross_cost,",
    "  SUM(COALESCE((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)) AS credits_amount,",
    "  SUM(COALESCE(cost, 0) + COALESCE((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)) AS net_cost,",
    "  SUM(COALESCE(usage.amount, 0)) AS usage_amount,",
    "  ANY_VALUE(usage.unit) AS usage_unit,",
    "  MAX(export_time) AS latest_export_time",
    `FROM \`${fullyQualifiedTableRef}\``,
    "WHERE billing_account_id = @billingAccountId",
    "  AND DATE(usage_start_time) >= PARSE_DATE('%Y-%m-%d', @startDate)",
    "  AND DATE(usage_start_time) <= PARSE_DATE('%Y-%m-%d', @endDate)",
    ...(hasGcpProjectFilter ? ["  AND project.id = @gcpProjectFilter"] : []),
    "GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10",
    "ORDER BY usage_date ASC, gross_cost DESC",
  ].join("\n");

  assertReadOnlyBigQuerySelectStatement(sql);

  const queryParameters: BigQueryParameterValue[] = [
    {
      name: "billingAccountId",
      parameterType: { type: "STRING" },
      parameterValue: { value: parsed.billingAccountId },
    },
    {
      name: "startDate",
      parameterType: { type: "STRING" },
      parameterValue: { value: input.startDate },
    },
    {
      name: "endDate",
      parameterType: { type: "STRING" },
      parameterValue: { value: input.endDate },
    },
  ];

  if (hasGcpProjectFilter && input.gcpProjectFilter) {
    queryParameters.push({
      name: "gcpProjectFilter",
      parameterType: { type: "STRING" },
      parameterValue: { value: input.gcpProjectFilter.trim() },
    });
  }

  const maxBytes = Math.max(10_485_760, input.maximumBytesBilled ?? DEFAULT_MAX_BYTES_BILLED);
  const url = `${GOOGLE_BIGQUERY_V2_BASE}/projects/${encodeURIComponent(
    parsed.queryProjectId,
  )}/queries`;

  return {
    url,
    fullyQualifiedTableRef,
    body: {
      query: sql,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters,
      location: input.datasetLocation.trim() || "US",
      maximumBytesBilled: String(maxBytes),
      timeoutMs: 10_000,
      maxResults: Math.min(Math.max(input.maxResults ?? 2000, 1), 10_000),
    },
  };
}

export type BillingCostType = "regular" | "tax" | "adjustment" | "rounding error";

export interface NormalizedBillingLedgerRow {
  billingAccountId: string;
  gcpProjectId: string;
  usageDate: string;
  invoiceMonth: string;
  serviceId: string;
  serviceDescription: string;
  skuId: string;
  skuDescription: string;
  region: string;
  costType: BillingCostType;
  currency: string;
  currencyConversionRate: number;
  grossCost: number;
  /** Signed negative credit impact (e.g. -14.25 reduces gross cost by 14.25) */
  creditsAmount: number;
  /** Net cost after credits = grossCost + creditsAmount */
  netCost: number;
  usageAmount: number | null;
  usageUnit: string | null;
  completenessState: MetricCompletenessState;
  exportTimeIso: string | null;
}

export interface RawBigQueryQueryResponse {
  jobComplete?: boolean;
  totalBytesProcessed?: string;
  totalRows?: string;
  pageToken?: string;
  schema?: {
    fields?: Array<{ name?: string; type?: string }>;
  };
  rows?: Array<{
    f?: Array<{ v?: unknown }>;
  }>;
}

function normalizeCostType(raw: unknown): BillingCostType {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "regular";
  if (s === "tax" || s === "adjustment" || s === "rounding error") {
    return s;
  }
  return "regular";
}

function classifyBillingRowCompleteness(
  usageDate: string,
  invoiceMonth: string,
  now = new Date(),
): MetricCompletenessState {
  const currentYearMonth = now.toISOString().slice(0, 7).replace("-", "");
  if (invoiceMonth >= currentYearMonth) {
    return "PROVISIONAL";
  }
  const usageMs = Date.parse(`${usageDate}T00:00:00.000Z`);
  if (Number.isFinite(usageMs) && now.getTime() - usageMs < 72 * 3_600_000) {
    return "PROVISIONAL";
  }
  return "COMPLETE";
}

/**
 * Parses a BigQuery `jobs.query` tabular response into normalized billing ledger rows
 * while preserving currency, credit signs, invoice month, and estimated vs finalized state.
 */
export function parseBigQueryCostQueryResponse(
  raw: RawBigQueryQueryResponse,
  options: {
    billingAccountId: string;
    now?: Date;
  },
): {
  rows: NormalizedBillingLedgerRow[];
  totalBytesProcessed: number;
} {
  if (raw.jobComplete === false) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: "BigQuery cost query job exceeded bounded synchronous execution timeout.",
      retryable: true,
    });
  }

  const fields = raw.schema?.fields ?? [];
  const colIndex = new Map<string, number>();
  fields.forEach((f, idx) => {
    if (f.name) {
      colIndex.set(f.name.toLowerCase(), idx);
    }
  });

  const getCell = (cells: Array<{ v?: unknown }>, colName: string): unknown => {
    const idx = colIndex.get(colName.toLowerCase());
    if (idx === undefined) return null;
    return cells[idx]?.v ?? null;
  };

  const rows: NormalizedBillingLedgerRow[] = [];
  const now = options.now ?? new Date();

  for (const r of raw.rows ?? []) {
    const cells = r.f ?? [];
    const usageDate = String(getCell(cells, "usage_date") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(usageDate)) continue;

    const invoiceMonthRaw = String(
      getCell(cells, "invoice_month") ?? usageDate.slice(0, 7).replace("-", ""),
    ).trim();
    const invoiceMonth = /^\d{6}$/.test(invoiceMonthRaw)
      ? invoiceMonthRaw
      : usageDate.slice(0, 7).replace("-", "");

    const gcpProjectId = String(getCell(cells, "gcp_project_id") ?? "unassigned").trim();
    const serviceId = String(getCell(cells, "service_id") ?? "unknown_service").trim();
    const serviceDescription = String(
      getCell(cells, "service_description") ?? "Unspecified Service",
    ).trim();
    const skuId = String(getCell(cells, "sku_id") ?? "unknown_sku").trim();
    const skuDescription = String(getCell(cells, "sku_description") ?? "Unspecified SKU").trim();
    const region = String(getCell(cells, "region") ?? "global").trim();
    const costType = normalizeCostType(getCell(cells, "cost_type"));
    const currency = String(getCell(cells, "currency") ?? "USD")
      .trim()
      .toUpperCase();

    const rateNum = Number(getCell(cells, "currency_conversion_rate") ?? 1);
    const currencyConversionRate =
      Number.isFinite(rateNum) && rateNum > 0 ? Number(rateNum.toFixed(8)) : 1;

    const rawGross = Number(getCell(cells, "gross_cost") ?? 0);
    const grossCost = Number.isFinite(rawGross) ? Number(rawGross.toFixed(6)) : 0;

    const rawCredits = Number(getCell(cells, "credits_amount") ?? 0);
    // In GCP Billing Exports, credits are negative numbers that reduce gross cost.
    // If a fixture provides positive credits magnitude, normalize to negative credit reduction.
    const normalizedCredits = Number.isFinite(rawCredits)
      ? rawCredits > 0
        ? -Number(rawCredits.toFixed(6))
        : Number(rawCredits.toFixed(6))
      : 0;

    const explicitNet = getCell(cells, "net_cost");
    const parsedNet =
      explicitNet !== null && explicitNet !== undefined && Number.isFinite(Number(explicitNet))
        ? Number(Number(explicitNet).toFixed(6))
        : Number((grossCost + normalizedCredits).toFixed(6));

    const rawUsage = getCell(cells, "usage_amount");
    const usageAmount =
      rawUsage !== null && rawUsage !== undefined && Number.isFinite(Number(rawUsage))
        ? Number(Number(rawUsage).toFixed(6))
        : null;
    const usageUnitRaw = getCell(cells, "usage_unit");
    const usageUnit =
      typeof usageUnitRaw === "string" && usageUnitRaw.trim() ? usageUnitRaw.trim() : null;

    const rawExportTime = getCell(cells, "latest_export_time");
    let exportTimeIso: string | null = null;
    if (typeof rawExportTime === "string" && rawExportTime.trim()) {
      const asEpochSec = Number(rawExportTime);
      if (Number.isFinite(asEpochSec) && asEpochSec > 1_000_000_000) {
        exportTimeIso = new Date(asEpochSec * 1000).toISOString();
      } else if (Number.isFinite(Date.parse(rawExportTime))) {
        exportTimeIso = new Date(rawExportTime).toISOString();
      }
    }

    rows.push({
      billingAccountId: options.billingAccountId,
      gcpProjectId,
      usageDate,
      invoiceMonth,
      serviceId,
      serviceDescription,
      skuId,
      skuDescription,
      region,
      costType,
      currency,
      currencyConversionRate,
      grossCost,
      creditsAmount: normalizedCredits,
      netCost: parsedNet,
      usageAmount,
      usageUnit,
      completenessState: classifyBillingRowCompleteness(usageDate, invoiceMonth, now),
      exportTimeIso,
    });
  }

  const totalBytesProcessed =
    raw.totalBytesProcessed !== undefined && Number.isFinite(Number(raw.totalBytesProcessed))
      ? Number(raw.totalBytesProcessed)
      : 0;

  return {
    rows,
    totalBytesProcessed,
  };
}

/**
 * Persists normalized billing ledger entries idempotently and populates corresponding
 * canonical `metric_observations` (`gcp_billing.gross_cost`, `gcp_billing.credits`, `gcp_billing.net_cost`).
 */
export async function persistBillingCostLedgerBatch(
  context: {
    organizationId: string;
    workspaceId: string;
    projectId: string | null;
    environmentId: string | null;
    providerConnectionId: string;
    connectedResourceId: string;
    externalResourceId: string;
    queryBytesProcessed?: number;
  },
  rows: readonly NormalizedBillingLedgerRow[],
  options?: {
    connectionString?: string;
    client?: Queryable;
  },
): Promise<{
  ledgerRowCount: number;
  observationsInserted: number;
  observationsUpdated: number;
  observationsUnchanged: number;
  currencies: string[];
}> {
  if (rows.length === 0) {
    return {
      ledgerRowCount: 0,
      observationsInserted: 0,
      observationsUpdated: 0,
      observationsUnchanged: 0,
      currencies: [],
    };
  }

  const runInTx = async (tx: Queryable) => {
    for (const row of rows) {
      await dbQuery(
        `INSERT INTO billing_cost_ledger_entries (
           id,
           organization_id,
           workspace_id,
           project_id,
           environment_id,
           provider_connection_id,
           connected_resource_id,
           billing_account_id,
           gcp_project_id,
           usage_date,
           invoice_month,
           service_id,
           service_description,
           sku_id,
           sku_description,
           region,
           cost_type,
           currency,
           currency_conversion_rate,
           gross_cost,
           credits_amount,
           net_cost,
           usage_amount,
           usage_unit,
           completeness_state,
           export_time,
           query_bytes_processed
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           $21, $22, $23, $24, $25, $26, $27
         )
         ON CONFLICT ON CONSTRAINT uq_billing_cost_ledger_identity DO UPDATE SET
           project_id = COALESCE(EXCLUDED.project_id, billing_cost_ledger_entries.project_id),
           environment_id = COALESCE(EXCLUDED.environment_id, billing_cost_ledger_entries.environment_id),
           service_description = EXCLUDED.service_description,
           sku_description = EXCLUDED.sku_description,
           currency_conversion_rate = EXCLUDED.currency_conversion_rate,
           gross_cost = EXCLUDED.gross_cost,
           credits_amount = EXCLUDED.credits_amount,
           net_cost = EXCLUDED.net_cost,
           usage_amount = EXCLUDED.usage_amount,
           usage_unit = EXCLUDED.usage_unit,
           completeness_state = EXCLUDED.completeness_state,
           export_time = COALESCE(EXCLUDED.export_time, billing_cost_ledger_entries.export_time),
           query_bytes_processed = EXCLUDED.query_bytes_processed,
           updated_at = now()`,
        [
          generateId("bcl"),
          context.organizationId,
          context.workspaceId,
          context.projectId,
          context.environmentId,
          context.providerConnectionId,
          context.connectedResourceId,
          row.billingAccountId,
          row.gcpProjectId,
          row.usageDate,
          row.invoiceMonth,
          row.serviceId,
          row.serviceDescription,
          row.skuId,
          row.skuDescription,
          row.region,
          row.costType,
          row.currency,
          row.currencyConversionRate,
          row.grossCost,
          row.creditsAmount,
          row.netCost,
          row.usageAmount,
          row.usageUnit,
          row.completenessState,
          row.exportTimeIso ? new Date(row.exportTimeIso) : null,
          context.queryBytesProcessed ?? 0,
        ],
        tx,
      );
    }

    // Roll up daily observations by (usageDate, currency) for summary scope and by (usageDate, currency, service, project)
    const dailyByDateCurrency = new Map<
      string,
      {
        usageDate: string;
        currency: string;
        invoiceMonth: string;
        grossCost: number;
        creditsAmount: number;
        netCost: number;
        completenessState: MetricCompletenessState;
      }
    >();

    const dailyByService = new Map<
      string,
      {
        usageDate: string;
        currency: string;
        invoiceMonth: string;
        serviceDescription: string;
        gcpProjectId: string;
        grossCost: number;
        creditsAmount: number;
        netCost: number;
        completenessState: MetricCompletenessState;
      }
    >();

    for (const row of rows) {
      const sumKey = `${row.usageDate}::${row.currency}`;
      const existingSum = dailyByDateCurrency.get(sumKey) ?? {
        usageDate: row.usageDate,
        currency: row.currency,
        invoiceMonth: row.invoiceMonth,
        grossCost: 0,
        creditsAmount: 0,
        netCost: 0,
        completenessState: row.completenessState,
      };
      existingSum.grossCost = Number((existingSum.grossCost + row.grossCost).toFixed(6));
      existingSum.creditsAmount = Number(
        (existingSum.creditsAmount + row.creditsAmount).toFixed(6),
      );
      existingSum.netCost = Number((existingSum.netCost + row.netCost).toFixed(6));
      if (row.completenessState === "PROVISIONAL") {
        existingSum.completenessState = "PROVISIONAL";
      }
      dailyByDateCurrency.set(sumKey, existingSum);

      const svcKey = `${row.usageDate}::${row.currency}::${row.serviceDescription}::${row.gcpProjectId}`;
      const existingSvc = dailyByService.get(svcKey) ?? {
        usageDate: row.usageDate,
        currency: row.currency,
        invoiceMonth: row.invoiceMonth,
        serviceDescription: row.serviceDescription,
        gcpProjectId: row.gcpProjectId,
        grossCost: 0,
        creditsAmount: 0,
        netCost: 0,
        completenessState: row.completenessState,
      };
      existingSvc.grossCost = Number((existingSvc.grossCost + row.grossCost).toFixed(6));
      existingSvc.creditsAmount = Number(
        (existingSvc.creditsAmount + row.creditsAmount).toFixed(6),
      );
      existingSvc.netCost = Number((existingSvc.netCost + row.netCost).toFixed(6));
      if (row.completenessState === "PROVISIONAL") {
        existingSvc.completenessState = "PROVISIONAL";
      }
      dailyByService.set(svcKey, existingSvc);
    }

    const observationInputs: CanonicalMetricObservationInput[] = [];

    for (const summary of dailyByDateCurrency.values()) {
      for (const [metricKey, val] of [
        ["gcp_billing.gross_cost", summary.grossCost],
        ["gcp_billing.credits", summary.creditsAmount],
        ["gcp_billing.net_cost", summary.netCost],
      ] as const) {
        observationInputs.push({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          environmentId: context.environmentId,
          providerConnectionId: context.providerConnectionId,
          connectedResourceId: context.connectedResourceId,
          providerKey: GCP_BILLING_PROVIDER_KEY,
          externalResourceId: context.externalResourceId,
          canonicalMetricKey: metricKey,
          granularity: "DAILY",
          periodStartDate: summary.usageDate,
          periodEndDate: summary.usageDate,
          reportingTimezone: "UTC",
          currency: summary.currency,
          numericValue: val,
          completenessState: summary.completenessState,
        });
      }
    }

    for (const svc of dailyByService.values()) {
      for (const [metricKey, val] of [
        ["gcp_billing.gross_cost", svc.grossCost],
        ["gcp_billing.credits", svc.creditsAmount],
        ["gcp_billing.net_cost", svc.netCost],
      ] as const) {
        observationInputs.push({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          environmentId: context.environmentId,
          providerConnectionId: context.providerConnectionId,
          connectedResourceId: context.connectedResourceId,
          providerKey: GCP_BILLING_PROVIDER_KEY,
          externalResourceId: context.externalResourceId,
          canonicalMetricKey: metricKey,
          granularity: "DAILY",
          periodStartDate: svc.usageDate,
          periodEndDate: svc.usageDate,
          reportingTimezone: "UTC",
          dimensions: {
            service: svc.serviceDescription,
            project: svc.gcpProjectId,
            currency: svc.currency,
            invoiceMonth: svc.invoiceMonth,
          },
          currency: svc.currency,
          numericValue: val,
          completenessState: svc.completenessState,
        });
      }
    }

    const batchRes = await upsertMetricObservationBatch(observationInputs, { client: tx });
    return batchRes;
  };

  const batchRes = options?.client
    ? await runInTx(options.client)
    : await withTransaction(runInTx, { connectionString: options?.connectionString });

  sharedReportCache.invalidateWorkspace(context.organizationId, context.workspaceId);

  const currencies = Array.from(new Set(rows.map((r) => r.currency)));
  return {
    ledgerRowCount: rows.length,
    observationsInserted: batchRes.insertedCount,
    observationsUpdated: batchRes.updatedCount,
    observationsUnchanged: batchRes.unchangedCount,
    currencies,
  };
}

function buildSandboxBillingLedgerRows(
  billingAccountId: string,
  startDate: string,
  endDate: string,
): NormalizedBillingLedgerRow[] {
  const sampleDates = [startDate, endDate].filter((v, i, a) => a.indexOf(v) === i);
  const rows: NormalizedBillingLedgerRow[] = [];

  for (const date of sampleDates) {
    const invoiceMonth = date.slice(0, 7).replace("-", "");
    rows.push(
      {
        billingAccountId,
        gcpProjectId: "avenor-cloud-prod",
        usageDate: date,
        invoiceMonth,
        serviceId: "6F81-5844-456A",
        serviceDescription: "Cloud Run",
        skuId: "D97E-32A1-8102",
        skuDescription: "CPU Allocation Time",
        region: "us-central1",
        costType: "regular",
        currency: "USD",
        currencyConversionRate: 1,
        grossCost: 42.5,
        creditsAmount: -6.5,
        netCost: 36.0,
        usageAmount: 180_000,
        usageUnit: "vCPU-seconds",
        completenessState: "PROVISIONAL",
        exportTimeIso: `${date}T23:55:00.000Z`,
      },
      {
        billingAccountId,
        gcpProjectId: "avenor-cloud-prod",
        usageDate: date,
        invoiceMonth,
        serviceId: "9662-B51E-5089",
        serviceDescription: "Cloud SQL",
        skuId: "A104-99B2-44C1",
        skuDescription: "Postgres Enterprise vCPU",
        region: "us-central1",
        costType: "regular",
        currency: "USD",
        currencyConversionRate: 1,
        grossCost: 28.0,
        creditsAmount: -3.0,
        netCost: 25.0,
        usageAmount: 86_400,
        usageUnit: "seconds",
        completenessState: "PROVISIONAL",
        exportTimeIso: `${date}T23:55:00.000Z`,
      },
    );
  }

  return rows;
}

/**
 * Executes an authorized BigQuery Cloud Billing export cost synchronization for an onboarded
 * `gcp_billing_dataset` connected resource and persists the normalized ledger and canonical metrics.
 */
export async function syncBigQueryBillingCostLedger(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    connectedResourceId: string;
    projectId?: string | null;
    environmentId?: string | null;
    startDate: string;
    endDate: string;
    gcpProjectFilter?: string | null;
    maximumBytesBilled?: number;
  },
  options?: {
    connectionString?: string;
    fetchFn?: typeof fetch;
    keyRing?: VaultKeyRing;
    now?: Date;
  },
): Promise<{
  connectedResourceId: string;
  externalResourceId: string;
  ledgerRowCount: number;
  observationsInserted: number;
  observationsUpdated: number;
  observationsUnchanged: number;
  totalBytesProcessed: number;
  currencies: string[];
}> {
  assertServerRuntime("syncBigQueryBillingCostLedger");

  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:manage",
  });

  const pool = getDatabasePool(options?.connectionString);
  const resQuery = await dbQuery<{
    id: string;
    provider_connection_id: string;
    external_resource_id: string;
    resource_type: string;
    metadata: Record<string, unknown>;
    granted_scopes: string[];
  }>(
    `SELECT
       cr.id,
       cr.provider_connection_id,
       cr.external_resource_id,
       cr.resource_type,
       cr.metadata,
       pc.granted_scopes
     FROM connected_resources cr
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     WHERE cr.id = $1 AND cr.workspace_id = $2
     LIMIT 1`,
    [input.connectedResourceId, access.workspaceId],
    pool,
  );

  const resource = resQuery.rows[0];
  if (!resource) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Connected BigQuery billing export resource not found in this workspace.",
      statusCode: 404,
    });
  }

  if (
    resource.resource_type !== "gcp_billing_dataset" ||
    resource.metadata?.hasHistoricalCostAccess !== true
  ) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        "Selected resource is a Cloud Billing metadata resource without a validated BigQuery export dataset. Complete BigQuery export onboarding first.",
      statusCode: 400,
    });
  }

  if (!hasBigQueryReadOnlyScope(resource.granted_scopes)) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message: "BigQuery cost query requires https://www.googleapis.com/auth/bigquery.readonly.",
    });
  }

  const billingAccountId = String(resource.metadata.billingAccountId ?? "");
  const datasetProjectId = String(resource.metadata.datasetProjectId ?? "");
  const queryProjectId = String(resource.metadata.queryProjectId ?? datasetProjectId);
  const datasetId = String(resource.metadata.datasetId ?? "");
  const tableId = String(resource.metadata.tableId ?? "");
  const datasetLocation = String(resource.metadata.datasetLocation ?? "US");

  const queryReq = buildAllowlistedBigQueryCostSelectRequest({
    billingAccountId,
    datasetProjectId,
    queryProjectId,
    datasetId,
    tableId,
    datasetLocation,
    startDate: input.startDate,
    endDate: input.endDate,
    gcpProjectFilter: input.gcpProjectFilter,
    maximumBytesBilled: input.maximumBytesBilled,
  });

  const credHandle = await decryptConnectionCredentialForServer({
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    connectionId: resource.provider_connection_id,
    keyRing: options?.keyRing,
  });
  const secret = credHandle.exposeSecretForServerAdapter();

  let normalizedRows: NormalizedBillingLedgerRow[];
  let totalBytesProcessed = 0;

  if (
    !shouldExecuteLiveGoogleApi(
      {
        accessToken: secret.accessToken ?? secret.apiToken,
      },
      Boolean(options?.fetchFn),
      GCP_BILLING_PROVIDER_KEY,
    )
  ) {
    normalizedRows = buildSandboxBillingLedgerRows(
      billingAccountId,
      input.startDate,
      input.endDate,
    );
    totalBytesProcessed = 1_048_576;
  } else {
    const rawResponse = await executeGoogleReadRequest<RawBigQueryQueryResponse>({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      url: queryReq.url,
      method: "POST",
      accessToken: secret.accessToken ?? secret.apiToken ?? "",
      fetchFn: options?.fetchFn,
      body: queryReq.body,
    });

    const parsed = parseBigQueryCostQueryResponse(rawResponse, {
      billingAccountId,
      now: options?.now,
    });
    normalizedRows = parsed.rows;
    totalBytesProcessed = parsed.totalBytesProcessed;
  }

  const persisted = await persistBillingCostLedgerBatch(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: input.projectId ?? null,
      environmentId: input.environmentId ?? null,
      providerConnectionId: resource.provider_connection_id,
      connectedResourceId: resource.id,
      externalResourceId: resource.external_resource_id,
      queryBytesProcessed: totalBytesProcessed,
    },
    normalizedRows,
    { connectionString: options?.connectionString },
  );

  return {
    connectedResourceId: resource.id,
    externalResourceId: resource.external_resource_id,
    ...persisted,
    totalBytesProcessed,
  };
}
