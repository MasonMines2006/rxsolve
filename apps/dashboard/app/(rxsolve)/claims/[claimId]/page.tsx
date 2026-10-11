"use client";
/** Per-claim status tree route. Owner: P3. Derived entirely from the existing /ws/live events. */
import { use } from "react";
import { ClaimStatusScreen } from "@/components/status/ClaimStatusScreen";

export default function ClaimStatusPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = use(params);
  return <ClaimStatusScreen claimId={decodeURIComponent(claimId)} />;
}
