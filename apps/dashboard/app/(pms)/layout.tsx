import type { Metadata } from "next";
import "./pms.css";

export const metadata: Metadata = { title: "Meadowbrook Pharmacy · Dispensing", description: "Pharmacy dispensing system" };

// A separate root layout: no RxSolve theme script, tokens or header reach this surface.
export default function PmsRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="pms-html">
      <body className="pms-body">{children}</body>
    </html>
  );
}
