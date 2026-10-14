import { Card } from "@avenor/ui";
import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F7F9FC] px-4 py-12 text-[#30415D]">
      <Card className="p-6 sm:p-8 max-w-md w-full text-center space-y-5">
        <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] text-[#17243A]">
          <Compass className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#5157D9] m-0">
            404 · PAGE NOT FOUND
          </p>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-[#17243A] m-0">
            This route isn’t mapped in Avenor.
          </h1>
          <p className="text-[14px] leading-[21px] text-[#64748B] m-0">
            The page you requested doesn’t exist or has moved to a new URL. Use the links below to
            return to the homepage or open your workspace.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-2.5 pt-2">
          <Link
            href="/"
            className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white no-underline hover:bg-[#4047BD] transition-colors"
          >
            Return to homepage
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[14px] font-medium text-[#17243A] no-underline hover:bg-[#F0F4FA] transition-colors"
          >
            Sign in to workspace
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-[10px] px-3 text-[13.5px] font-medium text-[#5157D9] no-underline hover:bg-[#ECEEFF] transition-colors"
          >
            Create free workspace
          </Link>
        </div>
      </Card>
    </div>
  );
}
