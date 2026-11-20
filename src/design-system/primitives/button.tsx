import type { ButtonHTMLAttributes } from "react";
import { cx } from "../tokens";

type Variant = "primary" | "quiet";

export function DsButton({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={cx("ds-btn", variant === "primary" ? "ds-btn-primary" : "ds-btn-quiet", className)} {...props} />;
}
