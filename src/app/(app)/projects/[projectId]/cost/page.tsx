import { roleHasPermission } from "@avenor/types";
import { notFound } from "next/navigation";
import * as React from "react";
import { CostReportView } from "@/components/reports/cost-report-view";
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
  try {
    report = await getProjectCostIntelligenceReport(session, projectId, {
      preset: "28d",
    });
  } catch {
    notFound();
  }

  return (
    <CostReportView
      initialReport={report}
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
      canManageConnections={roleHasPermission(governance.workspace.role, "connection:manage")}
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
