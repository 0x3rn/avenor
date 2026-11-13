"use client";

import { Badge, Button, Card, DataTable, type DataTableColumn } from "@avenor/ui";
import { BarChart3, Clock, Table2 } from "lucide-react";
import * as React from "react";

export interface TrendSeriesPoint {
  date: string;
  primaryValue: number | null;
  secondaryValue?: number | null;
  comparisonValue?: number | null;
}

export interface TrendMetricOption {
  key: string;
  label: string;
  unitLabel: string;
  colorHex?: string;
  formatValue: (val: number | null) => string;
}

export interface TrendChartCardProps {
  testId: string;
  title: string;
  subtitle: string;
  timeZoneLabel: string;
  comparisonPeriodLabel?: string | null;
  points: TrendSeriesPoint[];
  metrics: TrendMetricOption[];
  activeMetricKey: string;
  onMetricChange: (nextKey: string) => void;
  secondaryColumnHeader?: string;
  formatSecondaryValue?: (val: number | null) => string;
}

export function TrendChartCard({
  testId,
  title,
  subtitle,
  timeZoneLabel,
  comparisonPeriodLabel,
  points,
  metrics,
  activeMetricKey,
  onMetricChange,
  secondaryColumnHeader,
  formatSecondaryValue,
}: TrendChartCardProps) {
  const [viewMode, setViewMode] = React.useState<"chart" | "table">("chart");

  const activeMetric = metrics.find((m) => m.key === activeMetricKey) ?? metrics[0];
  const strokeColor = activeMetric.colorHex ?? "#5157D9";

  const numericPrimary = points
    .map((p) => p.primaryValue)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const numericCompare = points
    .map((p) => p.comparisonValue ?? null)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const maxVal = Math.max(1, ...numericPrimary, ...numericCompare);
  const svgWidth = 760;
  const svgHeight = 230;
  const padLeft = 48;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 34;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const toCoords = (values: Array<number | null>) => {
    const len = values.length;
    if (len === 0) return [];
    return values
      .map((val, idx) => {
        if (val === null || !Number.isFinite(val)) return null;
        const x = len === 1 ? padLeft + plotW / 2 : padLeft + (idx / (len - 1)) * plotW;
        const y = padTop + plotH - (val / maxVal) * plotH;
        return { x, y, val, date: points[idx]?.date ?? "" };
      })
      .filter((pt): pt is { x: number; y: number; val: number; date: string } => pt !== null);
  };

  const primaryCoords = toCoords(points.map((p) => p.primaryValue));
  const compareCoords = toCoords(points.map((p) => p.comparisonValue ?? null));

  const linePath = primaryCoords
    .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");

  const areaPath =
    primaryCoords.length > 0
      ? `${linePath} L ${primaryCoords[primaryCoords.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${primaryCoords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : "";

  const comparePath = compareCoords
    .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    y: padTop + plotH - frac * plotH,
    value: frac * maxVal,
  }));

  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const firstDate = points[0]?.date ?? "";
  const lastDate = points[points.length - 1]?.date ?? "";

  const columns: DataTableColumn<TrendSeriesPoint>[] = [
    {
      key: "date",
      header: `Date (${timeZoneLabel})`,
      render: (row) => <span className="font-mono text-[12.5px] text-[#17243A]">{row.date}</span>,
    },
    {
      key: "primary",
      header: activeMetric.label,
      numeric: true,
      render: (row) => (
        <span className="tabular-nums font-semibold text-[#17243A]">
          {activeMetric.formatValue(row.primaryValue)}
        </span>
      ),
    },
  ];

  if (secondaryColumnHeader && formatSecondaryValue) {
    columns.push({
      key: "secondary",
      header: secondaryColumnHeader,
      numeric: true,
      render: (row) => (
        <span className="tabular-nums text-[#30415D]">
          {formatSecondaryValue(row.secondaryValue ?? null)}
        </span>
      ),
    });
  }

  if (numericCompare.length > 0) {
    columns.push({
      key: "comparison",
      header: "Prior Window",
      numeric: true,
      render: (row) => (
        <span className="tabular-nums text-[#64748B]">
          {activeMetric.formatValue(row.comparisonValue ?? null)}
        </span>
      ),
    });
  }

  return (
    <Card className="p-5 sm:p-6 space-y-4 min-w-0" data-testid={`trend-card-${testId}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold text-[#17243A] m-0">{title}</h2>
            <Badge tone="neutral">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {timeZoneLabel}
              </span>
            </Badge>
            {comparisonPeriodLabel ? <Badge tone="indigo">vs {comparisonPeriodLabel}</Badge> : null}
          </div>
          <p className="text-[13px] text-[#64748B] m-0">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {metrics.length > 1 ? (
            <fieldset className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-1 m-0">
              <legend className="sr-only">Select chart metric</legend>
              {metrics.map((m) => {
                const active = m.key === activeMetric.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    data-testid={`metric-toggle-${testId}-${m.key}`}
                    onClick={() => onMetricChange(m.key)}
                    aria-pressed={active}
                    className={`rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                      active
                        ? "bg-white text-[#17243A] border border-[#DFE6F0] shadow-xs"
                        : "text-[#64748B] hover:text-[#17243A]"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </fieldset>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid={`toggle-chart-table-${testId}`}
            aria-pressed={viewMode === "table"}
            leftIcon={
              viewMode === "chart" ? (
                <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
            onClick={() => setViewMode((prev) => (prev === "chart" ? "table" : "chart"))}
          >
            {viewMode === "chart" ? "View Data Table" : "View Trend Chart"}
          </Button>
        </div>
      </div>

      {points.length === 0 ? (
        <div
          className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] px-4 py-8 text-center text-[13.5px] text-[#64748B]"
          data-testid={`trend-empty-${testId}`}
        >
          No daily observations returned for this reporting window.
        </div>
      ) : viewMode === "table" ? (
        <div data-testid={`trend-table-panel-${testId}`} className="max-h-[360px] overflow-y-auto">
          <DataTable
            caption={`${title} (${activeMetric.label}, timezone ${timeZoneLabel})`}
            columns={columns}
            rows={points}
            getRowKey={(row) => row.date}
          />
        </div>
      ) : (
        <div data-testid={`trend-svg-panel-${testId}`} className="space-y-2.5 min-w-0">
          <div className="w-full overflow-hidden rounded-[12px] border border-[#DFE6F0] bg-[#FAFBFD] p-2 sm:p-3">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto block"
              role="img"
              aria-label={`${title}: ${activeMetric.label} trend from ${firstDate} to ${lastDate} in ${timeZoneLabel}`}
            >
              {yTicks.map((tick, idx) => (
                <g key={String(idx)}>
                  <line
                    x1={padLeft}
                    y1={tick.y}
                    x2={svgWidth - padRight}
                    y2={tick.y}
                    stroke="#E5ECF6"
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    fontSize="10.5"
                    fill="#64748B"
                  >
                    {activeMetric.formatValue(tick.value)}
                  </text>
                </g>
              ))}

              {comparePath ? (
                <path
                  d={comparePath}
                  fill="none"
                  stroke="#94A3B8"
                  strokeWidth="1.75"
                  strokeDasharray="4 4"
                />
              ) : null}

              {areaPath ? <path d={areaPath} fill={strokeColor} fillOpacity="0.1" /> : null}
              {linePath ? (
                <path
                  d={linePath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}

              {primaryCoords.map((pt) => (
                <circle key={pt.date} cx={pt.x} cy={pt.y} r="3" fill={strokeColor}>
                  <title>{`${pt.date}: ${activeMetric.formatValue(pt.val)} (${activeMetric.unitLabel})`}</title>
                </circle>
              ))}

              {points.map((pt, idx) => {
                if (idx % labelStep !== 0 && idx !== points.length - 1) return null;
                const x =
                  points.length === 1
                    ? padLeft + plotW / 2
                    : padLeft + (idx / (points.length - 1)) * plotW;
                return (
                  <text
                    key={pt.date}
                    x={x}
                    y={svgHeight - 10}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill="#64748B"
                  >
                    {pt.date.slice(5)}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#64748B]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: strokeColor }}
                  aria-hidden="true"
                />
                <span>
                  Current window ({firstDate} to {lastDate})
                </span>
              </span>
              {numericCompare.length > 0 && comparisonPeriodLabel ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-4 border-t-2 border-dashed border-[#94A3B8]"
                    aria-hidden="true"
                  />
                  <span>Prior comparison ({comparisonPeriodLabel})</span>
                </span>
              ) : null}
            </div>
            <span className="tabular-nums">
              {points.length} daily bucket{points.length === 1 ? "" : "s"} •{" "}
              {activeMetric.unitLabel}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
