export interface GuidedOnboardingStepDescriptor {
  stepNumber: number;
  id: string;
  title: string;
  summary: string;
  requiredActionByCustomer: string;
  avenorReadOnlyRole: string;
  officialDocUrl: string;
}

export const BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS: readonly GuidedOnboardingStepDescriptor[] = [
  {
    stepNumber: 1,
    id: "why_bigquery_export",
    title: "Understand Why BigQuery Billing Export Is Required",
    summary:
      "The Google Cloud Billing REST API exposes account status and project links only. Detailed historical spend, SKU usage, credits, and invoice months are delivered exclusively through BigQuery Cloud Billing Export.",
    requiredActionByCustomer:
      "Confirm which Cloud Billing account owns the workloads you want to observe.",
    avenorReadOnlyRole:
      "Avenor never modifies Cloud Billing account settings or enables exports remotely.",
    officialDocUrl: "https://cloud.google.com/billing/docs/how-to/export-data-bigquery",
  },
  {
    stepNumber: 2,
    id: "select_export_type",
    title: "Choose Standard or Detailed Usage Cost Export",
    summary:
      "Standard Usage Cost (gcp_billing_export_v1_*) covers service, SKU, project, cost, credits, and invoice month. Detailed Usage Cost (gcp_billing_export_resource_v1_*) adds resource-level GKE/Compute attribution. Never sum both tables together because their costs overlap.",
    requiredActionByCustomer:
      "Select Standard Usage Cost (recommended default) or Detailed Usage Cost in Google Cloud Console.",
    avenorReadOnlyRole:
      "Avenor links one canonical export table per billing account to prevent double-counting.",
    officialDocUrl:
      "https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage",
  },
  {
    stepNumber: 3,
    id: "dataset_host_project",
    title: "Select the BigQuery Dataset Host Project",
    summary:
      "Google Cloud recommends hosting the billing export dataset in a dedicated FinOps/billing administration GCP project, which can be separate from the application projects generating cloud costs.",
    requiredActionByCustomer:
      "Create or select the BigQuery dataset in your chosen GCP host project.",
    avenorReadOnlyRole:
      "Avenor tracks the BigQuery dataset host project separately from workload GCP projects and Avenor logical products.",
    officialDocUrl: "https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup",
  },
  {
    stepNumber: 4,
    id: "dataset_location_backfill",
    title: "Verify Dataset Location & Retroactive Backfill Behavior",
    summary:
      "Multi-region US and EU datasets automatically receive retroactive billing data for the current and prior calendar month (taking up to 5 days). Single-region datasets only record billing usage from the day export is enabled forward.",
    requiredActionByCustomer:
      "Choose US or EU multi-region when creating the dataset if you need prior-month retroactive backfill.",
    avenorReadOnlyRole:
      "Avenor inspects the dataset's actual location via BigQuery metadata and runs query jobs in that exact region.",
    officialDocUrl:
      "https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup#create-bq-dataset",
  },
  {
    stepNumber: 5,
    id: "least_privilege_iam",
    title: "Grant Least-Privilege Read-Only IAM Roles",
    summary:
      "Reading export tables requires BigQuery Data Viewer (roles/bigquery.dataViewer) on the billing dataset and BigQuery Job User (roles/bigquery.jobUser) on the query-execution project. BigQuery Admin or Project Editor is never required.",
    requiredActionByCustomer:
      "Ensure the Google account connecting to Avenor holds Data Viewer on the dataset and Job User on the query project.",
    avenorReadOnlyRole: "Avenor never modifies IAM policies or service account bindings.",
    officialDocUrl: "https://cloud.google.com/bigquery/docs/access-control",
  },
  {
    stepNumber: 6,
    id: "oauth_readonly_consent",
    title: "Authorize Avenor with Read-Only BigQuery Scope",
    summary:
      "Billing account metadata scope (cloud-billing.readonly) cannot read BigQuery tables. Querying the export requires https://www.googleapis.com/auth/bigquery.readonly.",
    requiredActionByCustomer:
      "Complete read-only OAuth consent granting bigquery.readonly alongside cloud-billing.readonly.",
    avenorReadOnlyRole:
      "Avenor enforces an application-level SQL allowlist permitting only parameterized SELECT queries against validated export tables.",
    officialDocUrl: "https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query",
  },
  {
    stepNumber: 7,
    id: "query_cost_and_dry_run",
    title: "Review BigQuery Query Cost Guardrails & Dry-Run Validation",
    summary:
      "BigQuery charges for bytes scanned by SELECT jobs. Avenor validates setup using metadata checks and a 0-byte-billed dryRun query, and enforces maximumBytesBilled + partition date filters on every scheduled sync.",
    requiredActionByCustomer:
      "Run the bounded dry-run validation below to verify permissions and estimated scan bytes.",
    avenorReadOnlyRole:
      "Avenor rejects unbounded table scans, DDL, DML, EXPORT DATA, and ad-hoc user SQL.",
    officialDocUrl: "https://cloud.google.com/bigquery/docs/best-practices-costs",
  },
  {
    stepNumber: 8,
    id: "export_latency_and_readiness",
    title: "Confirm Export Population & Ongoing Latency Expectations",
    summary:
      "Newly enabled exports typically take several hours before initial rows appear and up to 5 days for multi-region retroactive backfill. Late usage credits and invoice adjustments continue arriving until monthly invoice close.",
    requiredActionByCustomer:
      "Save the validated export dataset resource and map it to your Avenor workspace/projects.",
    avenorReadOnlyRole:
      "Avenor distinguishes empty/backfilling exports from genuine $0 spend and re-reads a bounded lookback window for late credits.",
    officialDocUrl:
      "https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables#data-availability",
  },
];
