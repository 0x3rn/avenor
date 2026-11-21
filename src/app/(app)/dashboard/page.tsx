import * as React from "react";

import { PortfolioOverviewClient } from "@/components/dashboard/portfolio-overview-client";
import { getWorkspacePortfolioOverview } from "@/lib/reports/portfolio-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function DashboardPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const overview = await getWorkspacePortfolioOverview(session);

  return (
    <PortfolioOverviewClient
      initialOverview={overview}
      governance={governance}
      onboardingCompletedAt={session.user.onboardingCompletedAt}
    />
  );
}

export default function DashboardPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <DashboardPageContent />
    </React.Suspense>
  );
}
