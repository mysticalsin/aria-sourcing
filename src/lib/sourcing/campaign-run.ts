import type { SourceNextBatchResult } from "@/lib/store/contracts";

type SourceNextBatch = (
  campaignId: string,
  options: { count: number; platform?: "Talent Pool" },
) => Promise<SourceNextBatchResult>;

/** One campaign "Run agent" sourcing batch. Live runs leave the platform to the
 *  server-reviewed campaign strategy (in-process sourcing agent); only an
 *  explicit demo deployment uses the synthetic Talent Pool source. */
export async function runCampaignSourcing(input: {
  campaignId: string;
  count: number;
  demoAuthorized: boolean;
  sourceNextBatch: SourceNextBatch;
}): Promise<SourceNextBatchResult> {
  try {
    return await input.sourceNextBatch(
      input.campaignId,
      input.demoAuthorized
        ? { count: input.count, platform: "Talent Pool" }
        : { count: input.count },
    );
  } catch {
    return { ok: false, error: "Sourcing failed unexpectedly.", source: "unavailable" };
  }
}
