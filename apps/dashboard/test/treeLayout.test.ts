import { expect, test } from "bun:test";
import { forkOf, roundAnchor, stackExtent } from "../lib/treeLayout";
import type { NodeStatus, Round } from "../lib/tree";
import type { TreeNode } from "../lib/treeShape";

const r = (n: number, nodes: string[]) => ({ n, nodes, decision: {} }) as unknown as Round;
const kid = (id: string, extra: object = {}) => ({ id, label: id, actor: "agent", ...extra }) as unknown as TreeNode;
const ids = (ns: TreeNode[]) => ns.map((n) => n.id as string);

test("a round anchors on its refile node, else its last node", () => {
  expect(roundAnchor(r(1, ["denied_1", "missing_field_1", "refile_mf_1"]))).toBe("refile_mf_1");
  expect(roundAnchor(r(1, ["denied_1", "dispute_escalated_1"]))).toBe("dispute_escalated_1");
});

test("the taken child stays in line with untaken siblings above and below", () => {
  const kids = [kid("a"), kid("b"), kid("c"), kid("d")];
  const st: Record<string, NodeStatus> = { a: "excluded", b: "excluded", c: "taken", d: "excluded" };
  const f = forkOf(kids, st);
  expect(f.main?.id as string).toBe("c");
  expect(ids(f.above)).toEqual(["a", "b"]);
  expect(ids(f.below)).toEqual(["d"]);
});

test("with nothing taken every child is a chip and onlyIfTaken children are hidden", () => {
  const f = forkOf([kid("a"), kid("p", { onlyIfTaken: true })], { a: "pending", p: "pending" });
  expect(f.main).toBeNull();
  expect(ids(f.chips)).toEqual(["a"]);
});

test("extent reserves room for the largest stack along the taken path", () => {
  const tree = kid("root", { children: [kid("x"), kid("y"), kid("z", { children: [kid("z1"), kid("z2")] })] });
  const st: Record<string, NodeStatus> = { x: "excluded", y: "excluded", z: "taken", z1: "excluded", z2: "taken" };
  expect(stackExtent(tree, st)).toEqual({ above: 2, below: 0 });
});
