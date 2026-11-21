export type LinkedInBackendKind = "assisted-manual" | "vendor-api";

/**
 * LinkedIn delivery is refused. There is no vendor adapter and no assisted
 * send from this process. A later channel module may send only behind its
 * default-off flag and a recorded approval of the exact text.
 */
export function linkedInBackendForProvider(_provider: string | null | undefined): null {
  return null;
}

export function linkedInAdapterForProvider(_provider: string | null | undefined): null {
  return null;
}
