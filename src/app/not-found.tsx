import { Card } from "@avenor/ui";
import { Activity, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F7F9FC] px-4 py-12 text-[#30415D]">
      <Card className="p-6 sm:p-8 max-w-md w-full text-center space-y-4">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#ECEEFF] text-[#5157D9]">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[#5157D9]">
            404 • Route Not Found
          </p>
          <h1 className="text-[24px] font-semibold text-[#17243A]">Signal route unavailable</h1>
          <p className="text-[14px] text-[#64748B]">
            The requested page or logical product could not be found in your current workspace
            context.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Open Portfolio Overview</span>
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
          >
            Public Home
          </Link>
        </div>
      </Card>
    </div>
  );
}
