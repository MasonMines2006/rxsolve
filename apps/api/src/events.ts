/**
 * In-process event bus behind /ws/live. Owner: P1.
 * Anyone emits with `bus.emit("verdict", claimId, verdict)`; every dashboard client gets it.
 * New WebSocket clients first receive recent history so a refresh does not blank the screen.
 */
import type { EventType, LiveEvent, LivePayloads } from "@rxsolve/contracts";

type Listener = (e: LiveEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();
  private recent: LiveEvent[] = [];

  emit<T extends EventType>(type: T, claimId: string | null, payload: LivePayloads[T]) {
    const event = { type, ts: new Date().toISOString(), claim_id: claimId, payload } as LiveEvent;
    this.recent.push(event);
    if (this.recent.length > 1000) this.recent.shift();
    for (const l of this.listeners) l(event);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  history(): LiveEvent[] {
    return [...this.recent];
  }

  clear() { this.recent = []; }
}

export const bus = new EventBus();
