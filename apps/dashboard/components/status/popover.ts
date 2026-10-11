/** Keeps an open disclosure popover inside the tree's scroll box by flipping it left or up. */
export function fitPopover(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("pop--left", "pop--up");
  el.style.maxHeight = "";
  const box = el.closest<HTMLElement>(".tree-scroll");
  if (!box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.right > b.right) el.classList.add("pop--left");
  const anchor = el.parentElement?.getBoundingClientRect();
  if (r.bottom > b.bottom) {
    if (anchor && anchor.top - b.top > r.height) el.classList.add("pop--up");
    else el.style.maxHeight = `${Math.max(160, b.bottom - r.top - 8)}px`;
  }
}
