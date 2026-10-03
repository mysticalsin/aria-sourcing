export type FailedDeliveryState = "not-sent" | "unknown";

/**
 * Classify a failed provider HTTP response by retry safety.
 *
 * HTTP 408 and server failures may be returned after the provider processed
 * the mutation. Retrying those responses could duplicate candidate contact.
 * Other client responses prove that the provider rejected this request.
 */
export function classifyFailedHttpDeliveryState(status: number): FailedDeliveryState {
  return status === 408 || status >= 500 ? "unknown" : "not-sent";
}
