/**
 * INF-03/AGT-04 | Mailbox with HTTP API; inbound mail triggers a templated reply after the persona delay.
 * Suggested routes: POST /inbox/:pbm/messages (subject, body, attachments), GET /inbox/:pbm/replies/:thread
 * Every door parses what it receives into fields and calls engine.decide; only the wrapping differs.
 */
export const inboxRoutes = {};
