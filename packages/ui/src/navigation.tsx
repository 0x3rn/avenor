import { Check, ChevronRight, X } from "lucide-react";
import type * as React from "react";
import { IconButton } from "./primitives";
import { cn } from "./utils";

export function SignalAtlasLogo({
  className,
  showWordmark = true,
  tone = "light",
}: {
  className?: string;
  showWordmark?: boolean;
  tone?: "light" | "dark";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span
        aria-hidden="true"
        className="h-8 w-8 rounded-[10px] bg-[#5157D9] flex items-center justify-center shadow-xs shrink-0"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" stroke="#FFFFFF" strokeWidth="1.8" strokeOpacity="0.85" />
          <path
            d="M12 3.5V20.5M3.5 12H20.5"
            stroke="#ECEEFF"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.6"
          />
          <circle cx="12" cy="12" r="3" fill="#FFFFFF" />
          <circle cx="17.5" cy="7.5" r="2" fill="#168E99" stroke="#FFFFFF" strokeWidth="1.2" />
        </svg>
      </span>
      {showWordmark ? (
        <span
          className={cn(
            "text-[18px] font-semibold tracking-[-0.025em]",
            tone === "dark" ? "text-[#F7F9FE]" : "text-[#17243A]",
          )}
        >
          Avenor
        </span>
      ) : null}
    </span>
  );
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1.5 text-[12.5px]", className)}
    >
      <ol className="flex flex-wrap items-center gap-1.5 list-none p-0 m-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={`${item.label}-${item.href ?? "current"}`}
              className="inline-flex items-center gap-1.5"
            >
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="text-[#64748B] hover:text-[#17243A] transition-colors no-underline"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(isLast ? "text-[#17243A] font-medium" : "text-[#64748B]")}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight className="h-3.5 w-3.5 text-[#7B899F]" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  badges,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 pb-6 border-b border-[#DFE6F0]", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[24px] sm:text-[30px] leading-[1.2] font-semibold tracking-[-0.025em] text-[#17243A] m-0">
              {title}
            </h1>
            {badges}
          </div>
          {description ? (
            <p className="text-[15px] leading-[23px] text-[#30415D] max-w-3xl m-0">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, actions, className }: SectionHeaderProps) {
  return (
    <div
      className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-2", className)}
    >
      <div className="space-y-0.5">
        <h2 className="text-[20px] leading-[28px] font-semibold tracking-[-0.015em] text-[#17243A] m-0">
          {title}
        </h2>
        {description ? (
          <p className="text-[13.5px] leading-[20px] text-[#64748B] m-0">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  badge?: string;
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: {
  ariaLabel: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center p-1 rounded-[11px] bg-[#F0F4FA] border border-[#DFE6F0] gap-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1.5 rounded-[8px] text-[13px] font-medium transition-all cursor-pointer",
              active
                ? "bg-white text-[#17243A] shadow-xs border border-[#DFE6F0]"
                : "text-[#64748B] hover:text-[#17243A]",
            )}
          >
            <span>{opt.label}</span>
            {opt.badge ? (
              <span className="ml-1.5 text-[11px] text-[#64748B] tabular-nums">{opt.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: "completed" | "current" | "upcoming";
}

export function ProgressIndicator({
  steps,
  className,
}: {
  steps: ProgressStep[];
  className?: string;
}) {
  return (
    <ol
      aria-label="Onboarding progress"
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 list-none p-0 m-0",
        className,
      )}
    >
      {steps.map((step, index) => {
        const isCompleted = step.status === "completed";
        const isCurrent = step.status === "current";
        return (
          <li
            key={step.id}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "rounded-[14px] border p-4 flex flex-col gap-1.5 transition-colors",
              isCurrent
                ? "bg-[#ECEEFF] border-[#CED3FF]"
                : isCompleted
                  ? "bg-white border-[#DFE6F0]"
                  : "bg-[#F7F9FC] border-[#DFE6F0]",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-[#64748B] tabular-nums">
                Step 0{index + 1}
              </span>
              <span
                className={cn(
                  "h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums",
                  isCompleted
                    ? "bg-[#147D63] text-white"
                    : isCurrent
                      ? "bg-[#5157D9] text-white"
                      : "bg-[#F0F4FA] text-[#64748B]",
                )}
              >
                {isCompleted ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}
              </span>
            </div>
            <span className="text-[14px] font-semibold text-[#17243A]">{step.title}</span>
            <p className="text-[12.5px] leading-[18px] text-[#64748B] m-0">{step.description}</p>
          </li>
        );
      })}
    </ol>
  );
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#10192B]/50 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className="w-full max-w-lg rounded-[20px] bg-white border border-[#DFE6F0] shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-5 sm:p-6 border-b border-[#DFE6F0]">
          <div className="space-y-1">
            <h2 id="dialog-title" className="text-[18px] font-semibold text-[#17243A] m-0">
              {title}
            </h2>
            {description ? <p className="text-[13.5px] text-[#64748B] m-0">{description}</p> : null}
          </div>
          <IconButton aria-label="Close dialog" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2.5 px-5 py-4 sm:px-6 bg-[#F7F9FC] border-t border-[#DFE6F0]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  emptyState,
  className,
}: {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyState?: React.ReactNode;
  className?: string;
}) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-[16px] bg-white border border-[#DFE6F0]",
        className,
      )}
    >
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[#DFE6F0] bg-[#F7F9FC]">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-[#64748B]",
                  col.numeric && "text-right tabular-nums",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#DFE6F0]">
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="hover:bg-[#F7F9FC] transition-colors">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-4 py-3.5 text-[13.5px] text-[#30415D]",
                    col.numeric && "text-right tabular-nums font-medium text-[#17243A]",
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
