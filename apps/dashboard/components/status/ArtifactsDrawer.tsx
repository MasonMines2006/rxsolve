"use client";
/** Per-node "Artifacts" disclosure: each file a step produced, opened inside the page. Owner: P3. */
import { useEffect, useRef, useState } from "react";
import { fitPopover } from "./popover";
import { type ArtifactItem, type ArtifactKind, artifactUrl, limitText } from "@/lib/artifacts";

type Loaded =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "ok"; text?: string; truncated?: boolean; objectUrl?: string };

function useArtifact(name: string, kind: ArtifactKind): Loaded {
  const [got, setGot] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let dead = false;
    let made: string | null = null;
    setGot({ state: "loading" });
    (async () => {
      try {
        const r = await fetch(artifactUrl(name));
        if (!r.ok) throw new Error(String(r.status));
        if (kind === "html" || kind === "txt") {
          const { text, truncated } = limitText(await r.text());
          if (!dead) setGot({ state: "ok", text, truncated });
        } else {
          made = URL.createObjectURL(await r.blob());
          if (!dead) setGot({ state: "ok", objectUrl: made });
        }
      } catch {
        if (!dead) setGot({ state: "missing" });
      }
    })();
    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [name, kind]);
  return got;
}

function FileItem({ item }: { item: Extract<ArtifactItem, { type: "file" }> }) {
  const got = useArtifact(item.name, item.kind);
  const href = artifactUrl(item.name);
  return (
    <li className="artifact">
      <p className="artifact__label">
        <strong>{item.label}</strong><span className="sr-only"> ({item.name})</span>
      </p>
      {item.caption && <p className="caption">{item.caption}</p>}
      {got.state === "loading" && <p className="caption" role="status">Loading...</p>}
      {got.state === "missing" && <p className="artifact__missing" role="status">artifact not available</p>}
      {got.state === "ok" && item.kind === "html" && (
        <iframe className="artifact__frame" sandbox="" srcDoc={got.text} title={`${item.label} (${item.name})`} />
      )}
      {got.state === "ok" && item.kind === "png" && got.objectUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="artifact__img" src={got.objectUrl} alt={`${item.label}: ${item.name}`} />
      )}
      {got.state === "ok" && item.kind === "pdf" && got.objectUrl && (
        <embed className="artifact__frame" src={got.objectUrl} type="application/pdf" title={`${item.label} (${item.name})`} />
      )}
      {got.state === "ok" && item.kind === "txt" && (
        <>
          <pre className="artifact__pre" tabIndex={0}>{got.text}</pre>
          {got.truncated && <p className="caption">Shortened for display.</p>}
        </>
      )}
      {got.state === "ok" && (
        <a className="artifact__open" href={href} target="_blank" rel="noreferrer">
          Open in new tab<span className="sr-only"> ({item.name})</span>
        </a>
      )}
    </li>
  );
}

function ArtifactBody({ item }: { item: ArtifactItem }) {
  if (item.type === "file") return <FileItem item={item} />;
  if (item.type === "text") {
    return (
      <li className="artifact">
        <p className="artifact__label"><strong>{item.label}</strong></p>
        <pre className="artifact__pre" tabIndex={0}>{item.text}</pre>
      </li>
    );
  }
  return (
    <li className="artifact">
      <p className="artifact__label"><strong>{item.label}</strong></p>
      <table className="artifact__table">
        <tbody>
          {Object.entries(item.fields).map(([k, v]) => (
            <tr key={k}><th scope="row">{k.replaceAll("_", " ")}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

/** Content mounts only once opened, so closed drawers fetch nothing. */
export function ArtifactsDrawer({ items }: { items: ArtifactItem[] }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => fitPopover(list.current));
  }, [open, items.length]);
  if (items.length === 0) return null;
  return (
    <details
      className="artifacts"
      onToggle={(e) => {
        const d = e.currentTarget;
        d.closest(".tnode__card")?.classList.toggle("tnode__card--open", d.open);
        setOpen(d.open);
      }}
    >
      <summary>Artifacts ({items.length})</summary>
      {open && (
        <ul className="plain artifacts__list" ref={list}>
          {items.map((it, i) => <ArtifactBody key={`${it.type}-${i}`} item={it} />)}
        </ul>
      )}
    </details>
  );
}
