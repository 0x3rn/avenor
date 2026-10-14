"use client";

import { Button, ErrorState } from "@avenor/ui";

export default function GlobalApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F7F9FC] px-4 py-12">
      <div className="max-w-lg w-full">
        <ErrorState
          title="Unable to render Signal Atlas view"
          message={
            error.message ||
            "An unexpected application error occurred. No external provider data was mutated."
          }
          retryAction={
            <Button type="button" variant="primary" onClick={reset}>
              Retry view
            </Button>
          }
        />
      </div>
    </div>
  );
}
