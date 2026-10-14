import { Search } from "lucide-react";
import * as React from "react";
import { cn } from "./utils";

export interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  children,
  className,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13.5px] font-medium text-[#17243A]">
        {label}
        {required ? (
          <span className="text-[#BF4256] ml-1" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-[12.5px] leading-[18px] text-[#64748B] m-0">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-[12.5px] leading-[18px] text-[#BF4256] font-medium m-0"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, hasError = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={hasError || undefined}
        className={cn(
          "h-10 w-full rounded-[10px] bg-white px-3.5 text-[14px] text-[#17243A] placeholder:text-[#7B899F]",
          "border transition-colors duration-150",
          hasError
            ? "border-[#BF4256] focus-visible:outline-[#BF4256]"
            : "border-[#DFE6F0] hover:border-[#C7D2E3] focus-visible:outline-[#5157D9]",
          "disabled:bg-[#F0F4FA] disabled:text-[#64748B] disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);
TextInput.displayName = "TextInput";

export interface SearchInputProps extends TextInputProps {
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, ...props }, ref) => {
    return (
      <div className={cn("relative flex items-center", containerClassName)}>
        <Search
          className="h-4 w-4 text-[#64748B] absolute left-3.5 pointer-events-none"
          aria-hidden="true"
        />
        <TextInput ref={ref} type="search" className={cn("pl-9", className)} {...props} />
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, hasError = false, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={hasError || undefined}
        className={cn(
          "h-10 w-full rounded-[10px] bg-white px-3 text-[14px] text-[#17243A]",
          "border transition-colors duration-150",
          hasError
            ? "border-[#BF4256] focus-visible:outline-[#BF4256]"
            : "border-[#DFE6F0] hover:border-[#C7D2E3] focus-visible:outline-[#5157D9]",
          "disabled:bg-[#F0F4FA] disabled:text-[#64748B] disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, hasError = false, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={hasError || undefined}
        className={cn(
          "w-full rounded-[10px] bg-white p-3.5 text-[14px] text-[#17243A] placeholder:text-[#7B899F]",
          "border transition-colors duration-150",
          hasError
            ? "border-[#BF4256] focus-visible:outline-[#BF4256]"
            : "border-[#DFE6F0] hover:border-[#C7D2E3] focus-visible:outline-[#5157D9]",
          "disabled:bg-[#F0F4FA] disabled:text-[#64748B] disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
