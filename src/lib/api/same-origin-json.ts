export type SameOriginJsonResult =
  | "ok"
  | "unsupported_media_type"
  | "cross_origin_request";

type RequestAuthorityInput = {
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string };
};

/** Classify browser mutations before authentication, parsing, or side effects. */
export function classifySameOriginJsonRequest(
  request: RequestAuthorityInput,
): SameOriginJsonResult {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return "unsupported_media_type";
  }
  const origin = request.headers.get("origin");
  return origin !== null && origin === request.nextUrl.origin
    ? "ok"
    : "cross_origin_request";
}
