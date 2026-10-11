/** Pure helpers for the horizontally growing tree: where later denial rounds attach. Owner: P3. */
import type { NodeStatus, Round } from "./tree";
import type { NodeId, TreeNode } from "./treeShape";

/** The node of round `i` that the next round grows out of: its refile node, else its last node. */
export function roundAnchor(round: Round): NodeId | null {
  return round.nodes.find((n) => n.startsWith("refile")) ?? round.nodes.at(-1) ?? null;
}

export type Fork = {
  /** The one child drawn in line with its parent. */
  main: TreeNode | null;
  above: TreeNode[];
  below: TreeNode[];
  /** Every child as a chip, used when no child was taken. */
  chips: TreeNode[];
};

const walked = (s: NodeStatus | undefined) => s === "taken" || s === "active";

/**
 * Splits a node's children: the taken child (preferring one taken in round 1) stays on the
 * parent's row, untaken siblings become chips stacked above and below it.
 */
export function forkOf(children: readonly TreeNode[], statuses: Record<string, NodeStatus>, firstRound: readonly NodeId[] = []): Fork {
  const kids = children.filter((c) => !c.onlyIfTaken || walked(statuses[c.id]));
  const taken = kids.filter((c) => walked(statuses[c.id]));
  const main = taken.find((c) => firstRound.includes(c.id)) ?? taken[0] ?? null;
  if (!main) return { main: null, above: [], below: [], chips: kids };
  const i = kids.indexOf(main);
  return { main, above: kids.slice(0, i), below: kids.slice(i + 1), chips: [] };
}

/** How many chips stack above and below the main line, so the scroller can reserve room. */
export function stackExtent(root: TreeNode, statuses: Record<string, NodeStatus>, firstRound: readonly NodeId[] = []): { above: number; below: number } {
  let above = 0;
  let below = 0;
  let node: TreeNode | undefined = root;
  while (node?.children?.length) {
    const f = forkOf(node.children, statuses, firstRound);
    if (!f.main) {
      above = Math.max(above, Math.ceil(f.chips.length / 2));
      below = Math.max(below, Math.ceil(f.chips.length / 2));
      break;
    }
    above = Math.max(above, f.above.length);
    below = Math.max(below, f.below.length);
    node = f.main;
  }
  return { above, below };
}
