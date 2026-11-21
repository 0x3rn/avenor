import { roleHasPermission } from "@avenor/types";
import { notFound } from "next/navigation";
import * as React from "react";
import { CostReportView } from "@/components/reports/cost-report-view";
import { CostThresholdsPanel } from "@/components/reports/cost-thresholds-panel";
import { listCostSpendingThresholds } from "@/lib/billing/thresholds";
import {
  getProjectCostIntelligenceReport,
  type ProjectCostIntelligenceReportDto,
} from "@/lib/reports/cost-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectCostPageContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { session, governance } = await requireAuthenticatedAppContext();

  let report: ProjectCostIntelligenceReportDto;
  let thresholdsData: Awaited<ReturnType<typeof listCostSpendingThresholds>>;
  try {
    [report, thresholdsData] = await Promise.all([
      getProjectCostIntelligenceReport(session, projectId, {
        preset: "28d",
      }),
      listCostSpendingThresholds(session, { projectId }),
    ]);
  } catch {
    notFound();
  }

  const canManage =
    roleHasPermission(governance.workspace.role, "connection:manage") ||
    roleHasPermission(governance.workspace.role, "project:update");

  return (
    <CostReportView
      initialReport={report}
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
      canManageConnections={roleHasPermission(governance.workspace.role, "connection:manage")}
      thresholdsSlot={
        <CostThresholdsPanel
          projectId={projectId}
          defaultCurrency={report.primaryCurrency ?? "USD"}
          canManageThresholds={canManage}
          initialThresholds={thresholdsData.thresholds}
          initialEvaluations={thresholdsData.evaluations}
        />
      }
    />
  );
}

export default function ProjectCostPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectCostPageContent params={params} />
    </React.Suspense>
  );
}
