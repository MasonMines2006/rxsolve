import type { ReactNode } from "react";

type PanelProps = {
  id: string;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Titled panel card: uppercase heading on the left, optional caption or badge on the right. */
export function Panel({ id, title, aside, className = "", children }: PanelProps) {
  return (
    <section className={`panel panel--stack ${className}`.trim()} aria-labelledby={`${id}-title`}>
      <header className="panel__head">
        <h2 id={`${id}-title`}>{title}</h2>
        {aside != null && <span className="panel__aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}
