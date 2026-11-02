"use client";

import { PageHeader } from "@/components/app/page-header";
import { CostDashboard } from "@/components/costs/cost-dashboard";

export default function CostsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Analyze"
        title="AI costs"
        description="What Claude costs this app, split by activity: which one costs most, what each result costs, and why it runs on the model it does."
      />
      <CostDashboard />
    </div>
  );
}
