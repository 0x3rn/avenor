import { notFound } from "next/navigation";
import * as React from "react";
import { BackendReportView } from "@/components/reports/backend-report-view";
import { SecurityPosturePanel } from "@/components/reports/security-posture-panel";
import {
  getProjectBackendIntelligenceReport,
  type ProjectBackendIntelligenceReportDto,
} from "@/lib/reports/backend-service";
import {
  getAndPersistProjectSecurityPosture,
  type ProjectSecurityPostureReportDto,
} from "@/lib/reports/security-posture";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectBackendPageContent({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { session, governance } = await requireAuthenticatedAppContext();

  let report: ProjectBackendIntelligenceReportDto;
  let posture: ProjectSecurityPostureReportDto;
  try {
    [report, posture] = await Promise.all([
      getProjectBackendIntelligenceReport(session, projectId, {
        preset: "28d",
      }),
      getAndPersistProjectSecurityPosture(session, projectId),
    ]);
  } catch {
    notFound();
  }

  return (
    <BackendReportView
      initialReport={report}
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
      securityPostureSlot={<SecurityPosturePanel report={posture} />}
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
