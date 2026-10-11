/** Static shape of the orchestrator decision tree plus actor metadata for each step. Owner: P3. */

export type Actor = "rule" | "agent" | "external";

export type RoundNo = 1 | 2 | 3;
export const MAX_ROUNDS = 3;
export type PerRound =
  | "decision" | "approved" | "denied" | "noreply" | "missing_field" | "refile_mf" | "disputed"
  | "refile_rebut" | "phone" | "dispute_escalated" | "unrecoverable" | "window_closed" | "too_many";

export type NodeId =
  | "received" | "intake_rejected" | "verdict"
  | "clear" | "marginal" | "m_immaterial" | "m_appeal" | "m_unavailable"
  | "underwater" | "evidence" | "ex_incomplete" | "ex_policy" | "door" | "door_portal" | "door_email" | "door_fax"
  | "settle" | "settled"
  | `${PerRound}_${RoundNo}`;

/** Round-suffixed id, clamped to the three rounds the orchestrator allows. */
export const rid = (base: PerRound, n: number): NodeId => `${base}_${Math.min(Math.max(n, 1), MAX_ROUNDS) as RoundNo}`;
/** Splits "denied_2" into its base and round. */
export const splitRid = (id: string): { base: string; n: number } | null => {
  const m = /^(.*)_([1-3])$/.exec(id);
  return m ? { base: m[1]!, n: Number(m[2]) } : null;
};

export type TreeNode = {
  id: NodeId;
  label: string;
  /** Set only for steps that do work or wait; outcomes and the start marker carry none. */
  actor?: Actor;
  /** Which end state this node is, for the legend and the dimming rule. */
  end?: "good" | "warn" | "bad" | "muted";
  /** Node is drawn only when the claim actually took it (the phone branch). */
  onlyIfTaken?: boolean;
  /** Plain-language pointer for nodes that jump back up the tree. */
  loopTo?: string;
  children?: TreeNode[];
};

export const TREE: TreeNode = {
  id: "received", label: "Claim received from the pharmacy's claim feed",
  children: [
    { id: "intake_rejected", label: "No ledger account for the pharmacy: given up", end: "muted" },
    {
      id: "verdict", label: "Underpayment check", actor: "rule",
      children: [
        { id: "clear", label: "Paid fairly: no recovery needed", end: "good" },
        {
          id: "marginal", label: "Borderline: $0.50 or less short, the agent decides", actor: "agent",
          children: [
            { id: "m_immaterial", label: "Agent: not worth appealing, no recovery needed", end: "good" },
            { id: "m_appeal", label: "Agent: worth appealing, continue as underpaid", loopTo: "Underpaid" },
            { id: "m_unavailable", label: "Agent unavailable: the pharmacist decides", end: "bad" },
          ],
        },
        {
          id: "underwater", label: "Underpaid: more than $0.50 short",
          children: [
            {
              id: "evidence", label: "Build the proof", actor: "agent",
              children: [
                { id: "ex_incomplete", label: "Proof incomplete: stop, never file incomplete", end: "bad" },
                { id: "ex_policy", label: "Outside the pharmacist's standing rules: ask the pharmacist", end: "bad" },
                {
                  id: "door", label: "Choose how to file", actor: "agent",
                  children: [
                    { id: "door_portal", label: "Portal", },
                    { id: "door_email", label: "Email" },
                    { id: "door_fax", label: "Fax" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Who spends the time in a step. Anything that waits on another party is "external". */
export type StepKind =
  | "intake" | "verdict" | "verdict_agent" | "gate" | "evidence" | "filing" | "pbm_wait"
  | "diagnose" | "wholesaler_wait" | "phone_call" | "refile" | "ledger" | "pharmacist" | "terminal";

export const STEP_ACTOR: Record<StepKind, Actor> = {
  intake: "rule",
  verdict: "rule",
  verdict_agent: "agent",
  gate: "rule",
  evidence: "agent",
  filing: "agent",
  pbm_wait: "external",
  diagnose: "agent",
  wholesaler_wait: "external",
  phone_call: "external",
  refile: "agent",
  ledger: "external",
  pharmacist: "external",
  terminal: "rule",
};

export const ACTOR_LABEL: Record<Actor, string> = {
  rule: "rule check",
  agent: "agent",
  external: "External",
};

export function flatten(node: TreeNode = TREE): TreeNode[] {
  return [node, ...(node.children ?? []).flatMap((c) => flatten(c))];
}

export type RoundShape = {
  /** Round whose APPROVED outcome continues to settlement. */
  approvedRound: number | null;
  /** Rounds drawn, 1..count. */
  count: number;
  /** For round n (index n-1): the node the next round hangs under. */
  anchors: (NodeId | null)[];
};

/** One round: the PBM's decision, then its outcome fork; a denial continues right into the next round. */
function roundNode(n: number, shape: RoundShape, withNext: TreeNode | null, anchor: NodeId | null): TreeNode {
  const at = (id: NodeId, node: Omit<TreeNode, "id">): TreeNode => ({ id, ...node, ...(anchor === id && withNext ? { children: [withNext] } : {}) });
  const approved: TreeNode = {
    id: rid("approved", n), label: "Approved",
    ...(shape.approvedRound === n
      ? { children: [{ id: "settle", label: "Pay out on the ledger", actor: "external", children: [{ id: "settled", label: "Recovered", end: "good" }] } as TreeNode] }
      : {}),
  };
  return {
    id: rid("decision", n), label: n === 1 ? "Filed: waiting for the PBM (round 1)" : `Waiting for the PBM (round ${n})`, actor: "external",
    children: [
      approved,
      {
        id: rid("denied", n), label: "Denied: work on the reason, then try again (up to 3 rounds)", actor: "agent",
        children: [
          { id: rid("missing_field", n), label: "Missing paper: ask the wholesaler for it", actor: "agent",
            children: [at(rid("refile_mf", n), { label: "File again with the missing paper", actor: "agent" })] },
          { id: rid("disputed", n), label: "Disputed: send one written reply", actor: "agent",
            children: [
              at(rid("refile_rebut", n), { label: "File again with the reply", actor: "agent" }),
              { id: rid("dispute_escalated", n), label: "Still disputed: escalated to a supervisor", end: "warn" },
            ] },
          at(rid("phone", n), { label: "Call the PBM rep once", actor: "agent", onlyIfTaken: true }),
          { id: rid("unrecoverable", n), label: "Can't be recovered: given up", end: "muted" },
          { id: rid("window_closed", n), label: "Appeal window closed: sent to an outside appeal", end: "warn" },
          { id: rid("too_many", n), label: "Too many rounds: escalated", end: "warn" },
        ],
      },
      { id: rid("noreply", n), label: "No reply before the deadline: escalated", end: "warn" },
    ],
  };
}

/** The rounds chain for `shape`, round 1 outermost, each later round under the previous round's refile node. */
function roundsChain(shape: RoundShape): TreeNode {
  let node: TreeNode | null = null;
  for (let n = shape.count; n >= 1; n--) node = roundNode(n, shape, node, shape.anchors[n - 1] ?? null);
  return node!;
}

/** Static tree plus the rounds a claim has reached, hung under the door it used. */
export function treeFor(door: string | null, shape: RoundShape | null = null): TreeNode {
  const move = (n: TreeNode): TreeNode => {
    if (n.id === "door") {
      return {
        ...n,
        children: n.children!.map((c) => ({
          ...c,
          children: door && shape && c.id === `door_${door}` ? [roundsChain(shape)] : undefined,
        })),
      };
    }
    return n.children ? { ...n, children: n.children.map(move) } : n;
  };
  return move(TREE);
}

const ALL: TreeNode[] = [
  ...flatten(),
  ...[1, 2, 3].flatMap((n) => flatten(roundNode(n, { approvedRound: n, count: 3, anchors: [] }, null, null))),
];
export const NODE_BY_ID: Record<string, TreeNode> = Object.fromEntries(ALL.map((n) => [n.id, n]));
