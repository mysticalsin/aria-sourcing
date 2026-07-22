import type { NextRequest } from "next/server";

import {
  handleNeedIngressRequest,
  needIngressSharedThrottleConfigured,
  type NeedIngressRpcClient,
} from "@/lib/needs/ingress";
import { getServiceSupabase } from "@/lib/supabase/server";
import { withCriticalPathTelemetry } from "@/lib/observability/critical-path.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withCriticalPathTelemetry(
    "need_ingress",
    () => handleNeedIngressRequest(req, {
      sharedThrottleConfigured: needIngressSharedThrottleConfigured(),
      getServiceClient: () => getServiceSupabase() as NeedIngressRpcClient | null,
    }),
    {
      classify: (response) => ({
        status: response.status < 400 ? "ok" : response.status < 500 ? "rejected" : "degraded",
        code: `http_${response.status}`,
      }),
    },
  );
}
