import type { Metadata } from "next";
import "../globals.css";
import "../panels.css";

export const metadata: Metadata = { title: "RxSolve", description: "Every claim resolves at or above cost." };

// Applies the saved theme before paint so switching never flashes or reloads.
const themeBoot = `try{document.documentElement.dataset.theme=localStorage.getItem("rxsolve-theme")||"dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
