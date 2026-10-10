/**
 * INF-03/AGT-05 | Fax line: POST /fax/:pbm accepts a PDF (cover sheet + evidence); the decision is
 * rendered as a scanned-look PDF on GET /fax/:pbm/return/:ticket. Kill-switch: text-layer PDF.
 * Every door parses what it receives into fields and calls engine.decide; only the wrapping differs.
 */
export const faxRoutes = {};
