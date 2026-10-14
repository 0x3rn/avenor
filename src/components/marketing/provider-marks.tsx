import type * as React from "react";

export function SectionEyebrow({
  children,
  tone = "light",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 text-[12px] font-mono font-semibold uppercase tracking-[0.08em] ${
        tone === "dark" ? "text-[#38BDF8]" : "text-[#5157D9]"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-[1px] shrink-0 ${
          tone === "dark" ? "bg-[#38BDF8]" : "bg-[#5157D9]"
        }`}
      />
      <span>{children}</span>
    </div>
  );
}

export function ArchitecturalIconTile({
  children,
  tone = "light",
  accent = "ink",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "light" | "dark";
  accent?: "ink" | "indigo" | "teal";
  className?: string;
}) {
  const colorClasses =
    tone === "dark"
      ? "bg-[#10192B] border-[#263554] text-[#38BDF8]"
      : accent === "indigo"
        ? "bg-[#F0F4FA] border-[#DFE6F0] text-[#5157D9]"
        : accent === "teal"
          ? "bg-[#F0F4FA] border-[#DFE6F0] text-[#168E99]"
          : "bg-[#F0F4FA] border-[#DFE6F0] text-[#17243A]";

  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${colorClasses} ${className}`}
    >
      {children}
    </span>
  );
}

export function GA4Icon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="13" width="4" height="7" rx="1.5" fill="currentColor" fillOpacity="0.45" />
      <rect x="10" y="9" width="4" height="11" rx="1.5" fill="currentColor" fillOpacity="0.7" />
      <rect x="16" y="4" width="4" height="16" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function GSCIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="10.5" cy="11.5" r="3.2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M13 14L15.8 16.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M7 7.5H17" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" />
    </svg>
  );
}

export function GCPIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7.5 18.5H16.8C19.1 18.5 21 16.7 21 14.4C21 12.3 19.4 10.6 17.4 10.3C16.7 7.3 14 5 10.8 5C7.1 5 4.1 7.9 4 11.6C2.8 12.3 2 13.6 2 15.1C2 17 3.5 18.5 5.5 18.5H7.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="2.2" fill="currentColor" fillOpacity="0.65" />
    </svg>
  );
}

export function NeonIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 19V5L13.5 14.5V5H19V19L10.5 9.5V19H5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SupabaseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M13.2 3.2L5.5 13.2H12L10.8 20.8L18.5 10.8H12L13.2 3.2Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloudflareIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.2 17.5H17.8C19.6 17.5 21 16.1 21 14.3C21 12.6 19.7 11.2 18 11.1C17.3 8.2 14.7 6 11.6 6C8.4 6 5.7 8.3 5.2 11.4C3.9 11.8 3 13.1 3 14.5C3 16.2 4.4 17.5 6.2 17.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 14.2H15.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
    </svg>
  );
}

export function VercelIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 4L21 19.5H3L12 4Z" fill="currentColor" />
    </svg>
  );
}

export function GitHubIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.475 2 2 6.588 2 12.253C2 16.784 4.862 20.625 8.838 21.98C9.338 22.075 9.52 21.758 9.52 21.486C9.52 21.242 9.512 20.594 9.507 19.736C6.726 20.354 6.139 18.362 6.139 18.362C5.685 17.178 5.029 16.863 5.029 16.863C4.122 16.228 5.098 16.241 5.098 16.241C6.101 16.313 6.629 17.297 6.629 17.297C7.521 18.863 8.969 18.411 9.54 18.149C9.631 17.486 9.889 17.034 10.175 16.778C7.955 16.519 5.62 15.64 5.62 11.714C5.62 10.595 6.01 9.68 6.649 8.964C6.546 8.705 6.203 7.661 6.747 6.248C6.747 6.248 7.586 5.973 9.497 7.299C10.312 7.067 11.162 6.95 12.012 6.947C12.862 6.95 13.712 7.067 14.529 7.299C16.438 5.973 17.275 6.248 17.275 6.248C17.821 7.661 17.478 8.705 17.375 8.964C18.016 9.68 18.404 10.595 18.404 11.714C18.404 15.65 16.065 16.516 13.835 16.77C14.194 17.087 14.514 17.714 14.514 18.672C14.514 20.045 14.502 21.152 14.502 21.486C14.502 21.76 14.682 22.08 15.192 21.979C19.163 20.621 22 16.782 22 12.253C22 6.588 17.523 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SentryIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M13.5 4.5C12.8 3.3 11.2 3.3 10.5 4.5L3.3 17C2.6 18.2 3.5 19.7 4.8 19.7H8.2C8.2 16.5 10.5 14 13.5 14V11.2C9.2 11.2 5.8 14.5 5.5 18.5H4.8L12 6L18.5 17.3H15.8C15.5 15.5 14 14.1 12.1 14.1V16.8C12.8 16.8 13.4 17.4 13.4 18.1V19.7H19.2C20.5 19.7 21.4 18.2 20.7 17L13.5 4.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
