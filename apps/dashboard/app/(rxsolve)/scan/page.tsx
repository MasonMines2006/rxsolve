import Link from "next/link";
import { OpportunityScan } from "@/components/scan/OpportunityScan";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export default function OpportunityScanPage() {
  return (
    <div className="dashboard-shell scan-shell">
      <header className="scan-header">
        <div>
          <Link className="status-back" href="/">← RxSolve dashboard</Link>
          <h1>Recovery opportunity scan</h1>
          <p>Measure the loss before authorizing the recovery.</p>
        </div>
        <ThemeSwitcher />
      </header>
      <main><OpportunityScan /></main>
    </div>
  );
}
