"use client";
/**
 * Recovered-over-time chart. Owner: P3. Reads GET /api/ledger/series (a TigerData continuous aggregate when the
 * API runs on TigerData) and refetches whenever the ledger moves, so it climbs live during the demo.
 */
import { useEffect, useRef, useState } from "react";
import type { RecoveryPoint } from "@rxsolve/contracts";
import { type PanelProps, usd } from "./types";

const H = 180;
const PAD = { top: 12, right: 12, bottom: 22, left: 52 };

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** A round axis maximum: 1, 2 or 5 times a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

export function RecoveryChart({ live }: PanelProps) {
  const [series, setSeries] = useState<RecoveryPoint[]>([]);
  const [source, setSource] = useState<string>("");
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(480);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((h) => setSource(h.db === "tigerdata" ? "TigerData continuous aggregate" : "in-memory buckets")).catch(() => {});
  }, []);

  // Every settlement emits ledger.balances, so a new summary means a new point.
  useEffect(() => {
    fetch("/api/ledger/series").then((r) => r.json()).then(setSeries).catch(() => {});
  }, [live.ledger]);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  let running = 0;
  const points = series.map((p) => ({ ...p, total: (running = Math.round((running + p.recovered) * 100) / 100) }));
  const total = points.at(-1)?.total ?? 0;

  const t0 = points.length ? Date.parse(points[0]!.bucket) : 0;
  const step = points.length > 1 ? Date.parse(points[1]!.bucket) - t0 : 15_000;
  const t1 = points.length ? Date.parse(points.at(-1)!.bucket) + step : 1;
  const yMax = niceMax(total);
  const iw = width - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v: number) => PAD.top + ih - (v / yMax) * ih;

  // Step line: flat through each bucket, rising at its end to the new running total.
  let d = points.length ? `M${x(t0)},${y(0)}` : "";
  for (const p of points) {
    const end = Date.parse(p.bucket) + step;
    d += ` H${x(end)} V${y(p.total)}`;
  }
  const area = d ? `${d} V${y(0)} Z` : "";
  const ticks = [0, yMax / 2, yMax];
  const h = hover != null ? points[hover] : undefined;

  return (
    <div className="panel">
      <h2>Recovered over time</h2>
      <p style={{ margin: "0 0 8px" }}>
        <strong className="money" style={{ fontSize: 22 }}>{usd(total)}</strong>{" "}
        <span className="muted">across {points.reduce((n, p) => n + p.settlements, 0)} settlements</span>
      </p>
      <div ref={box} style={{ position: "relative" }}>
        {!points.length ? <p className="muted" style={{ height: H, margin: 0 }}>No settlements yet.</p> : (
          <svg width={width} height={H} role="img" aria-label={`Cumulative recovered dollars, now ${usd(total)}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)" className="money">{usd(v)}</text>
              </g>
            ))}
            <text x={PAD.left} y={H - 6} fontSize={11} fill="var(--text-muted)">{clock(points[0]!.bucket)}</text>
            <text x={width - PAD.right} y={H - 6} textAnchor="end" fontSize={11} fill="var(--text-muted)">{clock(new Date(t1).toISOString())}</text>
            <path d={area} fill="var(--accent)" opacity={0.15} />
            <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
            {points.map((p, i) => {
              const cx = x(Date.parse(p.bucket) + step);
              return (
                <g key={p.bucket} onMouseEnter={() => setHover(i)}>
                  <rect x={cx - iw / points.length / 2} y={PAD.top} width={iw / points.length} height={ih} fill="transparent" />
                  {hover === i && <line x1={cx} x2={cx} y1={PAD.top} y2={PAD.top + ih} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" />}
                  <circle cx={cx} cy={y(p.total)} r={hover === i ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              );
            })}
          </svg>
        )}
        {h && (
          <div className="pill" style={{ position: "absolute", top: 4, left: Math.min(x(Date.parse(h.bucket) + step) + 8, width - 180), pointerEvents: "none", borderRadius: "var(--radius)", padding: "6px 8px", lineHeight: 1.4 }}>
            <div className="muted">{clock(h.bucket)}</div>
            <div>+<span className="money">{usd(h.recovered)}</span> · {h.settlements} settled</div>
            <div>Total <span className="money">{usd(h.total)}</span></div>
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Source: {source || "…"}</p>
      <details style={{ fontSize: 12 }}>
        <summary className="muted">Table</summary>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th align="left">Bucket</th><th align="right">Recovered</th><th align="right">Fees</th><th align="right">Settled</th><th align="right">Total</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.bucket}>
                <td>{clock(p.bucket)}</td><td align="right" className="money">{usd(p.recovered)}</td>
                <td align="right" className="money">{usd(p.fees)}</td><td align="right">{p.settlements}</td>
                <td align="right" className="money">{usd(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
