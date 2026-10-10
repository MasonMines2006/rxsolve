/** Minimal text-only PDF writer (Helvetica, US Letter). Local and dependency-free; no network. */

const PAGE_LINES = 56;
const WRAP = 92;

const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
const esc = (s: string) => ascii(s).replace(/([\\()])/g, "\\$1");

export function wrap(text: string, width = WRAP): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

/** Renders lines of text to PDF bytes, wrapping long lines and paginating as needed. */
export function renderPdf(lines: string[], title: string): Uint8Array {
  const wrapped = lines.flatMap((l) => wrap(l));
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length || i === 0; i += PAGE_LINES) pages.push(wrapped.slice(i, i + PAGE_LINES));

  // Object ids: 1 catalog, 2 pages, 3 font, 4 info, then (page, content) pairs.
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = `<< /Title (${esc(title)}) /Producer (RxSolve) >>`;
  pages.forEach((p, i) => {
    const body = ["BT", "/F1 10 Tf", "13 TL", "50 750 Td", ...p.map((l) => `(${esc(l)}) '`), "ET"].join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
