import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible table wrapper. Always pass a `caption` (visually hidden by default)
 * so screen readers announce the table's purpose.
 */
export function Table({
  caption,
  captionVisible,
  className,
  children,
}: {
  caption: string;
  captionVisible?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)}>
        <caption
          className={cn(
            captionVisible ? "mb-3 text-left text-sm text-muted" : "sr-only",
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-b border-line/70 last:border-0", className)} {...props}>
      {children}
    </tr>
  );
}

export function TH({
  className,
  children,
  scope = "col",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-3 py-3 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-3 py-3 align-middle text-ink", className)} {...props}>
      {children}
    </td>
  );
}
