import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS,
  completeBigQueryBillingExportOnboarding,
} from "@/lib/providers/google-cloud-billing";

export async function GET() {
  return NextResponse.json(
    {
      steps: BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS,
      readOnlyGuarantee:
        "Avenor never creates or modifies Google Cloud Billing exports, datasets, or IAM bindings. Users configure the export in Google Cloud Console and authorize Avenor to validate and query it read-only.",
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      connectionId: string;
      billingAccountId: string;
      datasetProjectId: string;
      queryProjectId?: string;
      datasetId: string;
      tableId: string;
      projectId?: string | null;
      environmentId?: string | null;
    };

    const result = await completeBigQueryBillingExportOnboarding(session, body);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
