import type { FormDefinition, FormSettings, WorkflowEdge, WorkflowGraph, WorkflowHandle, WorkflowNode, WorkflowStage } from '@grids/schema';
import { SUBMISSION_FIELD_KEYS } from '@grids/schema';
import { evalExpr, references, truthy, type Answers } from './expr.js';
import { questionsOf } from './runtime.js';

type NodeOf<T extends WorkflowNode['type']> = Extract<WorkflowNode, { type: T }>;

/** Something the runner must do because the workflow passed through a node. */
export type WorkflowEffect =
  | { kind: 'notify'; node: NodeOf<'notify'> }
  | { kind: 'webhook'; node: NodeOf<'webhook'> }
  | { kind: 'entity'; node: NodeOf<'entity'> }
  /** Wake the submission at `node` after `hours`: an approval's SLA (`timeout` outlet) or a `wait` node (`next`). */
  | { kind: 'timer'; node: string; hours: number; reason: 'sla' | 'wait' };

export type WorkflowStatus = 'in_review' | 'approved' | 'rejected' | 'returned';

export interface WorkflowStep {
  /** The node the submission is now parked on (an approval or wait), or the end node it finished at. */
  node: string;
  status: WorkflowStatus;
  effects: WorkflowEffect[];
}

export class WorkflowError extends Error {}

const MAX_STEPS = 200;

const nodeIn = (g: WorkflowGraph, id: string): WorkflowNode => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new WorkflowError(`Unknown workflow node "${id}"`);
  return n;
};

const outlet = (g: WorkflowGraph, from: string, handle: WorkflowHandle): WorkflowEdge | undefined =>
  g.edges.find((e) => e.from === from && e.handle === handle);

const follow = (g: WorkflowGraph, from: string, handle: WorkflowHandle): WorkflowNode => {
  const e = outlet(g, from, handle);
  if (!e) throw new WorkflowError(`Node "${from}" has no "${handle}" outlet`);
  return nodeIn(g, e.to);
};

/** Runs forward from `node` through automatic nodes until it parks or ends. */
function run(g: WorkflowGraph, start: WorkflowNode, answers: Answers): WorkflowStep {
  const effects: WorkflowEffect[] = [];
  let node = start;
  for (let i = 0; i < MAX_STEPS; i++) {
    switch (node.type) {
      case 'start':
        node = follow(g, node.id, 'next');
        break;
      case 'branch':
        node = follow(g, node.id, truthy(evalExpr(node.condition, answers)) ? 'true' : 'false');
        break;
      case 'notify':
        effects.push({ kind: 'notify', node });
        node = follow(g, node.id, 'next');
        break;
      case 'webhook':
        effects.push({ kind: 'webhook', node });
        node = follow(g, node.id, 'next');
        break;
      case 'entity':
        effects.push({ kind: 'entity', node });
        node = follow(g, node.id, 'next');
        break;
      case 'approval':
        if (node.slaHours) effects.push({ kind: 'timer', node: node.id, hours: node.slaHours, reason: 'sla' });
        return { node: node.id, status: 'in_review', effects };
      case 'wait':
        effects.push({ kind: 'timer', node: node.id, hours: node.hours, reason: 'wait' });
        return { node: node.id, status: 'in_review', effects };
      case 'end':
        return { node: node.id, status: node.outcome, effects };
    }
  }
  throw new WorkflowError('Workflow did not settle (loop?)');
}

/** A submission has just been made (or resubmitted): run from the start node. */
export function begin(g: WorkflowGraph, answers: Answers): WorkflowStep {
  const start = g.nodes.find((n) => n.type === 'start');
  if (!start) throw new WorkflowError('Workflow has no start node');
  return run(g, start, answers);
}

export type WorkflowEvent = 'approved' | 'rejected' | 'returned' | 'timeout';

/**
 * A decision or a timer on the node the submission is parked on.
 * `returned` sends it back to its author: it stays on the node, and a `returned` outlet (if drawn) is
 * followed only for its notify/webhook effects.
 */
export function advance(g: WorkflowGraph, at: string, event: WorkflowEvent, answers: Answers): WorkflowStep {
  const node = nodeIn(g, at);
  if (event === 'returned') {
    const effects: WorkflowEffect[] = [];
    let next = outlet(g, at, 'returned') && follow(g, at, 'returned');
    for (let i = 0; next && i < MAX_STEPS; i++) {
      if (next.type === 'notify' || next.type === 'webhook') {
        effects.push({ kind: next.type, node: next } as WorkflowEffect);
        const e = outlet(g, next.id, 'next');
        next = e && nodeIn(g, e.to);
      } else next = undefined;
    }
    return { node: at, status: 'returned', effects };
  }
  if (node.type === 'wait') {
    if (event !== 'timeout') throw new WorkflowError(`"${at}" is a wait node`);
    return run(g, follow(g, at, 'next'), answers);
  }
  if (node.type !== 'approval') throw new WorkflowError(`"${at}" is not waiting for a decision`);
  if (event === 'timeout') {
    // No `timeout` outlet: the SLA only reminds (the runner may notify), the submission stays put.
    if (!outlet(g, at, 'timeout')) return { node: at, status: 'in_review', effects: [] };
    return run(g, follow(g, at, 'timeout'), answers);
  }
  return run(g, follow(g, at, event), answers);
}

/** The approval nodes in order (the legacy "stages", for display). */
export function approvalNodes(g: WorkflowGraph): NodeOf<'approval'>[] {
  return g.nodes.filter((n): n is NodeOf<'approval'> => n.type === 'approval');
}

/** The workflow graph a form runs, or null without a workflow. A linear `stages` chain runs as a graph too. */
export const graphOf = (settings: FormSettings): WorkflowGraph | null =>
  settings.workflow.enabled ? (settings.workflow.graph ?? graphFromStages(settings.workflow.stages)) : null;

/** The approval steps a submission to this form goes through, in order. */
export const approvalsOf = (settings: FormSettings): NodeOf<'approval'>[] => {
  const g = graphOf(settings);
  return g ? approvalNodes(g) : [];
};

/**
 * The approval steps a submission goes through, in order, if each is approved: steps whose branch
 * condition doesn't apply to its answers are left out. Falls back to every approval node.
 */
export function plannedApprovals(g: WorkflowGraph, answers: Answers): NodeOf<'approval'>[] {
  const out: NodeOf<'approval'>[] = [];
  try {
    let step = begin(g, answers);
    for (let i = 0; i < MAX_STEPS && step.status === 'in_review'; i++) {
      const node = nodeIn(g, step.node);
      if (node.type === 'approval' && !out.some((n) => n.id === node.id)) out.push(node);
      step = advance(g, step.node, node.type === 'approval' ? 'approved' : 'timeout', answers);
    }
  } catch {
    return approvalNodes(g);
  }
  return out;
}

/** The linear `stages` chain as a graph: start → [if cond →] approval → … → approved, with rejection ending the run. */
export function graphFromStages(stages: WorkflowStage[]): WorkflowGraph {
  const nodes: WorkflowNode[] = [{ id: 'start', type: 'start', name: 'Submitted', position: { x: 0, y: 0 } }];
  const edges: WorkflowEdge[] = [];
  let y = 170;
  const link = (from: string, to: string, handle: WorkflowHandle = 'next') =>
    edges.push({ id: `${from}:${handle}`, from, to, handle });
  const approved: WorkflowNode = { id: 'end_approved', type: 'end', name: 'Approved', outcome: 'approved', position: { x: 0, y: 0 } };
  const rejected: WorkflowNode = { id: 'end_rejected', type: 'end', name: 'Rejected', outcome: 'rejected', position: { x: 0, y: 0 } };
  let tail: { id: string; handle: WorkflowHandle } = { id: 'start', handle: 'next' };
  const connect = (to: string) => link(tail.id, to, tail.handle);
  for (const s of stages) {
    const stage: WorkflowNode = {
      id: s.key,
      type: 'approval',
      name: s.name,
      description: s.description,
      approvers: s.approvers,
      allowReturn: s.allowReturn,
      color: s.color,
      slaHours: null,
      position: { x: 0, y },
    };
    if (s.condition) {
      const gate = `if_${s.key}`;
      nodes.push({ id: gate, type: 'branch', name: `${s.name}?`, condition: s.condition, position: { x: 0, y } });
      connect(gate);
      y += 170;
      stage.position = { x: 0, y };
      link(gate, s.key, 'true');
      nodes.push(stage);
      link(s.key, 'end_rejected', 'rejected');
      // A skipped stage joins the chain at whatever follows it.
      tail = { id: s.key, handle: 'approved' };
      const after = stages[stages.indexOf(s) + 1];
      const joinTo = after ? (after.condition ? `if_${after.key}` : after.key) : 'end_approved';
      link(gate, joinTo, 'false');
    } else {
      nodes.push(stage);
      connect(s.key);
      link(s.key, 'end_rejected', 'rejected');
      tail = { id: s.key, handle: 'approved' };
    }
    y += 170;
  }
  connect('end_approved');
  approved.position = { x: 0, y };
  rejected.position = { x: 300, y };
  nodes.push(approved, rejected);
  return { nodes, edges };
}

const needs: Record<WorkflowNode['type'], WorkflowHandle[]> = {
  start: ['next'],
  approval: ['approved', 'rejected'],
  branch: ['true', 'false'],
  notify: ['next'],
  webhook: ['next'],
  entity: ['next'],
  wait: ['next'],
  end: [],
};
const optional: Partial<Record<WorkflowNode['type'], WorkflowHandle[]>> = { approval: ['returned', 'timeout'] };

const refsIn = (text: string) => [...text.matchAll(/\$\{([a-z_][a-z0-9_]*)\}/g)].map((m) => m[1]!);

/** Fills `${question}` references from the answers (missing ones become empty). */
export function interpolate(text: string, answers: Answers): string {
  return text.replace(/\$\{([a-z_][a-z0-9_]*)\}/g, (_, k: string) => {
    const v = answers[k];
    return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  });
}

/** Hosts a workflow webhook may not call: loopback, private ranges, link-local and internal names. */
export function isPrivateHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.includes(':')) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(':')) return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:');
  return false;
}

/** Everything wrong with a workflow graph, in words; empty when it can run. */
export function lintWorkflow(g: WorkflowGraph, def: FormDefinition): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) problems.push(`Duplicate node "${n.id}"`);
    ids.add(n.id);
  }
  const label = (id: string) => g.nodes.find((n) => n.id === id)?.name || id;
  const starts = g.nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) problems.push('A workflow needs exactly one start node');
  if (!g.nodes.some((n) => n.type === 'end')) problems.push('A workflow needs at least one end node');

  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) problems.push(`Connection "${e.id}" points at a missing node`);
  }
  const keys = new Set(questionsOf(def).map((q) => q.key));
  const checkRefs = (where: string, refs: () => string[]) => {
    try {
      for (const r of refs()) if (!keys.has(r) && !SUBMISSION_FIELD_KEYS.has(r)) problems.push(`${where}: unknown question \${${r}}`);
    } catch (e) {
      problems.push(`${where}: ${(e as Error).message}`);
    }
  };

  for (const n of g.nodes) {
    const out = g.edges.filter((e) => e.from === n.id);
    for (const h of needs[n.type]) {
      const count = out.filter((e) => e.handle === h).length;
      if (count === 0) problems.push(`"${label(n.id)}" has no "${h}" connection`);
      if (count > 1) problems.push(`"${label(n.id)}" has more than one "${h}" connection`);
    }
    const allowed = new Set([...needs[n.type], ...(optional[n.type] ?? [])]);
    for (const e of out) {
      if (!allowed.has(e.handle)) problems.push(`"${label(n.id)}" cannot have a "${e.handle}" connection`);
    }
    if (n.type === 'branch') {
      if (!n.condition) problems.push(`"${label(n.id)}" needs a condition`);
      else checkRefs(`"${label(n.id)}" condition`, () => references(n.condition));
    }
    if (n.type === 'notify') {
      checkRefs(`"${label(n.id)}" message`, () => [...refsIn(n.subject), ...refsIn(n.body)]);
      if (!n.to.submitter && !n.to.approvers && !n.to.emails.length && !n.to.questions.length) problems.push(`"${label(n.id)}" has no recipients`);
      const typeOf = new Map(questionsOf(def).map((q) => [q.key, q.type]));
      for (const k of n.to.questions) if (typeOf.get(k) !== 'email') problems.push(`"${label(n.id)}" sends to "${k}", which is not an email question`);
      for (const k of n.attachQuestions) if (!['file', 'image', 'signature'].includes(typeOf.get(k) ?? '')) problems.push(`"${label(n.id)}" attaches "${k}", which is not a file, photo or signature question`);
    }
    if (n.type === 'webhook') {
      // An address that is still being typed (like "https://") is simply not valid yet.
      const ok = (() => {
        try {
          return /^https?:$/.test(new URL(n.url).protocol) && !isPrivateHost(n.url);
        } catch {
          return false;
        }
      })();
      if (!ok) problems.push(`"${label(n.id)}" must call a public http(s) address`);
      for (const [name, value] of Object.entries(n.headers)) {
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) problems.push(`"${label(n.id)}" has a header name that is not allowed: "${name}"`);
        checkRefs(`"${label(n.id)}" header ${name}`, () => refsIn(value));
      }
    }
    if (n.type === 'approval') {
      const a = n.approvers;
      if (!a.role && !a.group && !a.users.length) problems.push(`"${label(n.id)}" has no approvers`);
    }
  }

  // Reachability and cycles, over the connections a run can actually take (a `returned` outlet only fires effects).
  const next = (id: string) =>
    g.edges.filter((e) => e.from === id && e.handle !== 'returned' && ids.has(e.to)).map((e) => e.to);
  if (starts.length === 1) {
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      next(id).forEach(visit);
    };
    visit(starts[0]!.id);
    for (const n of g.nodes) if (!seen.has(n.id)) problems.push(`"${label(n.id)}" is not reachable from the start`);
  }
  const state = new Map<string, 1 | 2>();
  const cyclic = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    const found = next(id).some(cyclic);
    state.set(id, 2);
    return found;
  };
  if (g.nodes.some((n) => cyclic(n.id))) problems.push('The workflow loops back on itself');
  return problems;
}
