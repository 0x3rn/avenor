import type { SemanticTone } from "@avenor/types";
import { Loader2, ShieldCheck } from "lucide-react";
import * as React from "react";
import { cn } from "./utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "subtle"
  | "destructive-avenor-only";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const BUTTON_VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#5157D9] text-white border border-[#5157D9] hover:bg-[#4047BD] hover:border-[#4047BD] active:bg-[#363CA6] shadow-xs",
  secondary:
    "bg-[#F0F4FA] text-[#17243A] border border-[#DFE6F0] hover:bg-[#E5ECF6] hover:border-[#C7D2E3] active:bg-[#DAE3F0]",
  outline:
    "bg-white text-[#17243A] border border-[#C7D2E3] hover:bg-[#F7F9FC] hover:border-[#7B899F] active:bg-[#F0F4FA]",
  subtle:
    "bg-transparent text-[#30415D] border border-transparent hover:bg-[#F0F4FA] hover:text-[#17243A] active:bg-[#E5ECF6]",
  "destructive-avenor-only":
    "bg-[#BF4256] text-white border border-[#BF4256] hover:bg-[#A63547] hover:border-[#A63547] active:bg-[#8E2B3B] shadow-xs",
};

const BUTTON_SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-[10px] gap-1.5",
  md: "h-10 px-4 text-[14px] rounded-[10px] gap-2",
  lg: "h-11 px-5 text-[15px] rounded-[11px] gap-2.5",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isDisabled = Boolean(disabled || loading);
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors duration-150 select-none cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5157D9]",
          "disabled:opacity-55 disabled:pointer-events-none disabled:cursor-not-allowed",
          BUTTON_VARIANT_STYLES[variant],
          BUTTON_SIZE_STYLES[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        <span>{children}</span>
        {!loading && rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
      </button>
    );
  },
);
Button.displayName = "Button";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  variant?: "outline" | "subtle" | "secondary";
  size?: "sm" | "md";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = "subtle", size = "md", children, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center rounded-[10px] transition-colors duration-150 cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5157D9]",
          "disabled:opacity-50 disabled:pointer-events-none",
          variant === "outline" &&
            "bg-white border border-[#DFE6F0] text-[#30415D] hover:bg-[#F7F9FC] hover:text-[#17243A]",
          variant === "secondary" &&
            "bg-[#F0F4FA] border border-[#DFE6F0] text-[#17243A] hover:bg-[#E5ECF6]",
          variant === "subtle" &&
            "bg-transparent text-[#30415D] hover:bg-[#F0F4FA] hover:text-[#17243A]",
          size === "sm" ? "h-8 w-8" : "h-9 w-9",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";

export type BadgeTone = SemanticTone | "read-only" | "planned";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
}

const BADGE_TONE_STYLES: Record<BadgeTone, string> = {
  neutral: "bg-[#F0F4FA] text-[#30415D] border-[#DFE6F0]",
  indigo: "bg-[#ECEEFF] text-[#4047BD] border-[#CED3FF]",
  signal: "bg-[#E7F6F7] text-[#168E99] border-[#B8E5E8]",
  success: "bg-[#E7F6EF] text-[#147D63] border-[#B9E6D2]",
  warning: "bg-[#FFF5E5] text-[#A66A16] border-[#F5D9A6]",
  critical: "bg-[#FDECEF] text-[#BF4256] border-[#F6C3CB]",
  "read-only": "bg-[#E7F6F7] text-[#168E99] border-[#B8E5E8]",
  planned: "bg-[#F0F4FA] text-[#64748B] border-[#DFE6F0]",
};

export function Badge({ className, tone = "neutral", icon, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[12px] leading-[18px] font-medium border rounded-[7px] whitespace-nowrap",
        BADGE_TONE_STYLES[tone],
        className,
      )}
      {...props}
    >
      {tone === "read-only" && !icon ? (
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </span>
  );
}

export interface StatusIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: SemanticTone;
  label: string;
  pulse?: boolean;
}

const DOT_TONE_STYLES: Record<SemanticTone, string> = {
  neutral: "bg-[#7B899F]",
  indigo: "bg-[#5157D9]",
  signal: "bg-[#168E99]",
  success: "bg-[#147D63]",
  warning: "bg-[#A66A16]",
  critical: "bg-[#BF4256]",
};

export function StatusIndicator({
  tone = "neutral",
  label,
  pulse = false,
  className,
  ...props
}: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[13px] font-medium text-[#30415D]",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          DOT_TONE_STYLES[tone],
          pulse && "animate-pulse",
        )}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-white border border-[#DFE6F0] rounded-[16px] shadow-[0_1px_2px_rgba(23,36,58,0.04)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-5 sm:p-6 border-b border-[#DFE6F0]", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[16px] leading-[24px] font-semibold text-[#17243A] m-0", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-[13.5px] leading-[20px] text-[#64748B] m-0", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 sm:p-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-5 py-4 sm:px-6 bg-[#F7F9FC] border-t border-[#DFE6F0] rounded-b-[16px]",
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-[10px] bg-[#F0F4FA]", className)}
      {...props}
    />
  );
}
