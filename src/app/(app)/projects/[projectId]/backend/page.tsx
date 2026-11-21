import { notFound } from "next/navigation";
import * as React from "react";
import { BackendReportView } from "@/components/reports/backend-report-view";
import {
  getProjectBackendIntelligenceReport,
  type ProjectBackendIntelligenceReportDto,
} from "@/lib/reports/backend-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectBackendPageContent({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { session, governance } = await requireAuthenticatedAppContext();

  let report: ProjectBackendIntelligenceReportDto;
  try {
    report = await getProjectBackendIntelligenceReport(session, projectId, {
      preset: "28d",
    });
  } catch {
    notFound();
  }

  return (
    <BackendReportView
      initialReport={report}
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
    />
  );
}

export default function ProjectBackendPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectBackendPageContent params={params} />
    </React.Suspense>
  );
}
