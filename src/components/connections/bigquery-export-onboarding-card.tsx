"use client";

import { Badge, Button, Card, WarningBanner } from "@avenor/ui";
import { CheckCircle2, Database, ExternalLink, ShieldCheck } from "lucide-react";
import * as React from "react";
import type { ValidatedBigQueryExportSummary } from "@/lib/providers/google-cloud-billing/onboarding";
import { BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS } from "@/lib/providers/google-cloud-billing/onboarding-steps";

export interface BigQueryExportOnboardingCardProps {
  workspaceId: string;
  connectionId: string;
  defaultBillingAccountId?: string;
  defaultDatasetProjectId?: string;
  canManageConnections?: boolean;
  onOnboardingCompleted?: (result: {
    validation: ValidatedBigQueryExportSummary;
    connectedResourceId: string;
    externalResourceId: string;
  }) => void;
}

export function BigQueryExportOnboardingCard({
  workspaceId,
  connectionId,
  defaultBillingAccountId = "01A2B3-45C6D7-89E0F1",
  defaultDatasetProjectId = "avenor-finops-prod",
  canManageConnections = true,
  onOnboardingCompleted,
}: BigQueryExportOnboardingCardProps) {
  const [activeStep, setActiveStep] = React.useState<number>(1);
  const [billingAccountId, setBillingAccountId] = React.useState(defaultBillingAccountId);
  const [datasetProjectId, setDatasetProjectId] = React.useState(defaultDatasetProjectId);
  const [queryProjectId, setQueryProjectId] = React.useState(defaultDatasetProjectId);
  const [datasetId, setDatasetId] = React.useState("cloud_billing_export");
  const [exportKind, setExportKind] = React.useState<"standard" | "detailed">("standard");

  const accountSuffix = billingAccountId.trim().replace(/-/g, "_");
  const defaultTableId =
    exportKind === "detailed"
      ? `gcp_billing_export_resource_v1_${accountSuffix}`
      : `gcp_billing_export_v1_${accountSuffix}`;
  const [tableId, setTableId] = React.useState(defaultTableId);

  React.useEffect(() => {
    const suffix = billingAccountId.trim().replace(/-/g, "_");
    setTableId(
      exportKind === "detailed"
        ? `gcp_billing_export_resource_v1_${suffix}`
        : `gcp_billing_export_v1_${suffix}`,
    );
  }, [billingAccountId, exportKind]);

  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [validationResult, setValidationResult] =
    React.useState<ValidatedBigQueryExportSummary | null>(null);

  const currentStepObj =
    BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS.find((s) => s.stepNumber === activeStep) ??
    BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS[0];

  async function handleValidateAndLink(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageConnections) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/connections/gcp-billing/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          connectionId,
          billingAccountId,
          datasetProjectId,
          queryProjectId,
          datasetId,
          tableId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(
          payload?.error?.message ?? "BigQuery Cloud Billing export validation failed.",
        );
        return;
      }
      if (payload?.validation) {
        setValidationResult(payload.validation as ValidatedBigQueryExportSummary);
        onOnboardingCompleted?.(payload);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Network error validating BigQuery export.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      className="p-5 sm:p-6 space-y-5 border-[#CED3FF] bg-[#FFFFFF]"
      data-testid="bigquery-export-onboarding-card"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Database className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h3 className="text-[16px] font-semibold text-[#17243A]">
              Guided BigQuery Cloud Billing Export Onboarding
            </h3>
            <Badge tone="indigo">8-Step Customer-Controlled Setup</Badge>
          </div>
          <p className="text-[12.5px] text-[#30415D]">
            Customers configure Cloud Billing Export in Google Cloud Console. Avenor validates
            dataset location, schema, and read-only dry-run query access without mutating Google
            Cloud settings.
          </p>
        </div>
      </div>

      {/* Step Navigator Pills */}
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="BigQuery Billing Export Setup Steps"
      >
        {BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS.map((step) => {
          const isCurrent = step.stepNumber === activeStep;
          return (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={isCurrent}
              data-testid={`bq-onboarding-step-btn-${step.stepNumber}`}
              onClick={() => setActiveStep(step.stepNumber)}
              className={`rounded-[8px] border px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                isCurrent
                  ? "border-[#5157D9] bg-[#ECEEFF] text-[#4047BD]"
                  : "border-[#DFE6F0] bg-[#F7F9FC] text-[#30415D] hover:bg-[#F0F4FA]"
              }`}
            >
              Step {step.stepNumber}
            </button>
          );
        })}
      </div>

      {/* Active Step Guidance Box */}
      {currentStepObj ? (
        <div
          className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-2 text-[12.5px]"
          data-testid={`bq-onboarding-step-panel-${currentStepObj.stepNumber}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#17243A]">
              Step {currentStepObj.stepNumber}: {currentStepObj.title}
            </span>
            <a
              href={currentStepObj.officialDocUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#5157D9] hover:underline"
            >
              <span>Google Cloud Docs</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
          <p className="text-[#30415D]">{currentStepObj.summary}</p>
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
            <div className="rounded-[8px] border border-[#DFE6F0] bg-[#FFFFFF] p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                Your Action in Google Cloud
              </div>
              <div className="mt-0.5 text-[12px] text-[#17243A]">
                {currentStepObj.requiredActionByCustomer}
              </div>
            </div>
            <div className="rounded-[8px] border border-[#CED3FF] bg-[#ECEEFF]/50 p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4047BD] inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                <span>Avenor Read-Only Boundary</span>
              </div>
              <div className="mt-0.5 text-[12px] text-[#17243A]">
                {currentStepObj.avenorReadOnlyRole}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cost, Location & Latency Guardrail Banner */}
      <WarningBanner
        tone="signal"
        title="Dataset Location, Retroactive History & Query Fee Transparency"
        description="US and EU multi-region datasets receive current + prior calendar month retroactive backfill (up to 5 days initial processing); single-region datasets only record from export enablement forward. Avenor uses 0-byte dry-run checks during validation and enforces maximumBytesBilled on scheduled cost queries."
      />

      {errorMessage ? (
        <div data-testid="bq-onboarding-error-banner">
          <WarningBanner
            tone="warning"
            title="BigQuery Export Validation Failed"
            description={errorMessage}
          />
        </div>
      ) : null}

      {/* Dataset & Export Table Validation Form */}
      <form onSubmit={handleValidateAndLink} className="space-y-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="bq-billing-account-id"
              className="block text-[12px] font-medium text-[#17243A] mb-1"
            >
              Cloud Billing Account ID
            </label>
            <input
              id="bq-billing-account-id"
              data-testid="bq-input-billing-account-id"
              value={billingAccountId}
              onChange={(e) => setBillingAccountId(e.target.value)}
              placeholder="01A2B3-45C6D7-89E0F1"
              disabled={!canManageConnections || submitting}
              className="h-10 w-full rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[13px] text-[#17243A]"
            />
          </div>

          <div>
            <label
              htmlFor="bq-export-kind"
              className="block text-[12px] font-medium text-[#17243A] mb-1"
            >
              Export Table Type (Single Canonical Source)
            </label>
            <select
              id="bq-export-kind"
              data-testid="bq-select-export-kind"
              value={exportKind}
              onChange={(e) =>
                setExportKind(e.target.value === "detailed" ? "detailed" : "standard")
              }
              disabled={!canManageConnections || submitting}
              className="h-10 w-full rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[13px] text-[#17243A]"
            >
              <option value="standard">
                Standard Usage Cost (gcp_billing_export_v1_*) — Recommended
              </option>
              <option value="detailed">
                Detailed Resource Cost (gcp_billing_export_resource_v1_*)
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="bq-dataset-project-id"
              className="block text-[12px] font-medium text-[#17243A] mb-1"
            >
              BigQuery Dataset Host GCP Project ID
            </label>
            <input
              id="bq-dataset-project-id"
              data-testid="bq-input-dataset-project-id"
              value={datasetProjectId}
              onChange={(e) => {
                setDatasetProjectId(e.target.value);
                setQueryProjectId(e.target.value);
              }}
              placeholder="avenor-finops-prod"
              disabled={!canManageConnections || submitting}
              className="h-10 w-full rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[13px] text-[#17243A]"
            />
          </div>

          <div>
            <label
              htmlFor="bq-dataset-id"
              className="block text-[12px] font-medium text-[#17243A] mb-1"
            >
              BigQuery Dataset Name
            </label>
            <input
              id="bq-dataset-id"
              data-testid="bq-input-dataset-id"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              placeholder="cloud_billing_export"
              disabled={!canManageConnections || submitting}
              className="h-10 w-full rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[13px] text-[#17243A]"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="bq-table-id"
              className="block text-[12px] font-medium text-[#17243A] mb-1"
            >
              Allowlisted Export Table Identifier
            </label>
            <input
              id="bq-table-id"
              data-testid="bq-input-table-id"
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              disabled={!canManageConnections || submitting}
              className="h-10 w-full rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[13px] text-[#17243A]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-[11.5px] text-[#64748B]">
            Required IAM: <code>roles/bigquery.dataViewer</code> +{" "}
            <code>roles/bigquery.jobUser</code>
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={!canManageConnections || submitting}
            data-testid="bq-validate-export-submit-btn"
          >
            {submitting ? "Running Dry-Run Validation..." : "Validate & Link BigQuery Export"}
          </Button>
        </div>
      </form>

      {/* Validated Result Card */}
      {validationResult ? (
        <div
          className="rounded-[10px] border border-[#BDE7D4] bg-[#EAF7F1] p-4 space-y-2 text-[12.5px]"
          data-testid="bq-onboarding-validation-result"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#18825D] inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>Validated {validationResult.fullyQualifiedTableRef}</span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="success">Location: {validationResult.datasetLocation}</Badge>
              <Badge tone="indigo">{validationResult.availabilityState}</Badge>
            </div>
          </div>
          <p className="text-[#17243A]">{validationResult.availabilityExplanation}</p>
          <p className="text-[11.5px] text-[#30415D]">
            {validationResult.retroactiveBackfillExplanation}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
