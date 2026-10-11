/** Real delivery state of an outbound message, read from the ChannelMessage `meta.delivered` flag. */
export type DeliveryKind = "delivered" | "dashboard-only" | "simulated";

export type DeliveryState = { kind: DeliveryKind; label: string };

export function deliveryState(meta: Record<string, unknown> | null | undefined): DeliveryState {
  const delivered = meta?.delivered;
  if (delivered === true) return { kind: "delivered", label: "Delivered" };
  if (delivered === false) return { kind: "dashboard-only", label: "Not delivered (dashboard only)" };
  return { kind: "simulated", label: "Simulated phone" };
}
