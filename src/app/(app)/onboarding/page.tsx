import * as React from "react";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function OnboardingPageContent() {
  const { session, governance, projects } = await requireAuthenticatedAppContext();
  return (
    <OnboardingFlow
      governance={governance}
      onboardingCompletedAt={session.user.onboardingCompletedAt}
      initialProjects={projects}
    />
  );
}

export default function OnboardingPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <OnboardingPageContent />
    </React.Suspense>
  );
}
