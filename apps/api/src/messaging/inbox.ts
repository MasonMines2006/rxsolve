/**
 * Inbound wholesaler replies (AGT-06). Owner: P2.
 * The negotiation loop registers a waiter before it sends; the inbound handler (Spectrum or the
 * dashboard phone mock) delivers each WhatsApp/SMS message here. An empty contact matches any sender.
 */
type Waiter = { contact: string; resolve: (text: string | null) => void };
const waiters = new Set<Waiter>();

const normalize = (id: string) => (id.includes("@") ? id.trim().toLowerCase() : id.replace(/\D/g, ""));

export function sameContact(a: string, b: string): boolean {
  if (!a || !b) return true;
  const x = normalize(a);
  const y = normalize(b);
  return x !== "" && y !== "" && (x === y || x.endsWith(y) || y.endsWith(x));
}

/** Resolves with the next matching inbound text, or null after timeoutMs. */
export function waitForReply(contact: string, timeoutMs: number): { promise: Promise<string | null>; cancel: () => void } {
  let waiter!: Waiter;
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<string | null>((resolve) => {
    waiter = { contact, resolve };
    waiters.add(waiter);
    timer = setTimeout(() => { waiters.delete(waiter); resolve(null); }, Math.max(0, timeoutMs));
  });
  return { promise, cancel: () => { clearTimeout(timer); waiters.delete(waiter); waiter.resolve(null); } };
}

/** Hands an inbound message to the oldest matching waiter. Returns whether anyone was waiting. */
export function deliverInbound(sender: string, text: string): boolean {
  for (const w of waiters) {
    if (!sameContact(sender, w.contact)) continue;
    waiters.delete(w);
    w.resolve(text);
    return true;
  }
  return false;
}
