import type { Metadata } from "next";
import { DesignSystemGallery } from "@/design-system/gallery/gallery";
import "@/design-system/theme/aria-ds.css";

export const metadata: Metadata = {
  title: "Design system",
  description: "Aria design gallery. Synthetic data only. Not linked from the product navigation.",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  return <DesignSystemGallery />;
}
