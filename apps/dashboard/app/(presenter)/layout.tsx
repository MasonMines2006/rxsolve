import type { Metadata } from "next";
import "./presenter.css";

export const metadata: Metadata = { title: "Presenter", robots: { index: false, follow: false } };

// Own root layout: no RxSolve theme, header or stylesheet.
export default function PresenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="presenter-body">{children}</body>
    </html>
  );
}
