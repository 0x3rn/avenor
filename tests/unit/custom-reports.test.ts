import { describe, expect, it } from "vitest";
import {
  assertComparableBenchmarkMetrics,
  type ExecutedReportBenchmark,
  renderReportToPrintableHtml,
  sanitizeCsvCell,
  serializeReportToSafeCsv,
} from "@/lib/reports/custom-reports";

describe("THE-154: Cross-project benchmark compatibility, CSV formula safety, and XSS-safe HTML reports", () => {
  it("flags incompatible metric layers, non-additive metrics, and refuses mixed currencies", () => {
    const check = assertComparableBenchmarkMetrics([
      "ga4.sessions",
      "ga4.active_users",
      "cloudflare.http_requests_total",
    ]);
    expect(check.warnings.some((w) => /GA4 sessions and Cloudflare HTTP requests/i.test(w))).toBe(
      true,
    );
    expect(check.warnings.some((w) => /Non-additive metric/i.test(w))).toBe(true);

    expect(() =>
      assertComparableBenchmarkMetrics(["gcp.billing.net_cost"], { currencies: ["USD", "EUR"] }),
    ).toThrow(/heterogeneous currencies/i);
  });

  it("neutralizes CSV formula injection payloads and escapes HTML/XSS in printable reports", () => {
    expect(sanitizeCsvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("+SUM(A1:A9)")).toBe("'+SUM(A1:A9)");
    expect(sanitizeCsvCell("-1+2")).toBe("'-1+2");
    expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe('"\'@HYPERLINK(""http://evil"")"');

    const sample: ExecutedReportBenchmark = {
      report: {
        id: "srep_1",
        organizationId: "org_1",
        workspaceId: "ws_1",
        createdByUserId: "usr_1",
        name: '=HYPERLINK("evil") <script>alert(1)</script>',
        description: null,
        projectIds: ["prj_1"],
        environmentFilter: "PRODUCTION",
        metricKeys: ["ga4.sessions"],
        datePreset: "28d",
        visualizationType: "COMPARISON_TABLE",
        comparisonEnabled: true,
        definitionVersion: 1,
        createdAtIso: "2026-11-21T00:00:00.000Z",
        updatedAtIso: "2026-11-21T00:00:00.000Z",
      },
      generatedAtIso: "2026-11-21T12:00:00.000Z",
      dateStart: "2026-10-24",
      dateEnd: "2026-11-21",
      rows: [
        {
          projectId: "prj_1",
          projectName: "+EvilProject <img src=x onerror=alert(1)>",
          metricKey: "ga4.sessions",
          providerKey: "ga4",
          value: null,
          unit: "sessions",
          currency: null,
          observationCount: 0,
          freshnessLabel: "No observations in window",
          nonAdditiveWarning: null,
        },
      ],
      warnings: [],
      provenanceSummary: "Workspace ws_1 • 1 product",
    };

    const csv = serializeReportToSafeCsv(sample);
    expect(csv).toContain("'+EvilProject");
    expect(csv).toContain("UNAVAILABLE");
    expect(csv).not.toMatch(/\n\+EvilProject/);

    const html = renderReportToPrintableHtml(sample);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Unavailable");
  });
});
