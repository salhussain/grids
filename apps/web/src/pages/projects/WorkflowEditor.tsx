import {
  formState,
  graphFromStages,
  lintWorkflow,
  plannedApprovals,
  questionsOf,
} from '@grids/forms';
import {
  SUBMISSION_FIELDS,
  withRecord,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowHandle,
  type WorkflowNode,
} from '@grids/schema';
import { Button, Dialog, Field, Input, Listbox, Select, Textarea, cx } from '@grids/ui';
import { ToggleRow } from './FormQuestions';
import {
  applyNodeChanges,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  CheckCircle2,
  Hash,
  X,
  Clock,
  Database,
  GitBranch,
  Mail,
  Paperclip,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  Variable,
  Webhook,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { references } from '@grids/forms';
import type { Draft } from './FormBuilder';
import { FormRenderer, type Answers } from './FormRenderer';
import { ApproverFields } from './FormBuilderPanels';
import { RichTextField, answerOption } from './RichText';
import { useProject } from './context';
import { api } from '../../api';

type NodeType = WorkflowNode['type'];
type Of<T extends NodeType> = Extract<WorkflowNode, { type: T }>;

const INFO: Record<NodeType, { label: string; icon: LucideIcon; tone: string; hint: string }> = {
  start: {
    label: 'Submitted',
    icon: Play,
    tone: 'bg-zinc-900 text-white',
    hint: 'Where every submission starts.',
  },
  approval: {
    label: 'Approval',
    icon: UserCheck,
    tone: 'bg-accent-600 text-on-accent',
    hint: 'Someone approves, rejects or sends it back.',
  },
  branch: {
    label: 'Condition',
    icon: GitBranch,
    tone: 'bg-violet-600 text-white',
    hint: 'Follow one path or the other, depending on the answers.',
  },
  notify: {
    label: 'Send email',
    icon: Mail,
    tone: 'bg-sky-600 text-white',
    hint: 'Email the submitter, approvers or anyone else.',
  },
  webhook: {
    label: 'Call webhook',
    icon: Webhook,
    tone: 'bg-amber-600 text-white',
    hint: 'Send the submission to another system.',
  },
  entity: {
    label: 'Update records',
    icon: Database,
    tone: 'bg-teal-600 text-white',
    hint: 'Write the bound answers to the entity and its data.',
  },
  wait: {
    label: 'Wait',
    icon: Clock,
    tone: 'bg-zinc-500 text-white',
    hint: 'Pause for some hours, then carry on.',
  },
  end: {
    label: 'Outcome',
    icon: CheckCircle2,
    tone: 'bg-emerald-600 text-white',
    hint: 'How the workflow ends. Name it (Verified, Escalated, …) and say whether the data takes effect. Add as many as you need.',
  },
};

/** The outlets a node can be left by, with the ones that must be connected first. */
const OUTLETS: Record<NodeType, { handle: WorkflowHandle; label: string }[]> = {
  start: [{ handle: 'next', label: '' }],
  approval: [
    { handle: 'approved', label: 'approved' },
    { handle: 'rejected', label: 'rejected' },
    { handle: 'returned', label: 'sent back' },
    { handle: 'timeout', label: 'timeout' },
  ],
  branch: [
    { handle: 'true', label: 'yes' },
    { handle: 'false', label: 'no' },
  ],
  notify: [{ handle: 'next', label: '' }],
  webhook: [{ handle: 'next', label: '' }],
  entity: [{ handle: 'next', label: '' }],
  wait: [{ handle: 'next', label: '' }],
  end: [],
};

const ROLE_NAME: Record<string, string> = {
  manager: 'Project managers',
  viewer: 'Any project member',
};
const summary = (n: WorkflowNode): string => {
  switch (n.type) {
    case 'approval':
      return (
        [
          n.approvers.role ? ROLE_NAME[n.approvers.role] : '',
          n.approvers.users.length
            ? `${n.approvers.users.length} ${n.approvers.users.length === 1 ? 'person' : 'people'}`
            : '',
        ]
          .filter(Boolean)
          .join(' + ') || 'Choose who approves'
      );
    case 'branch':
      return n.condition || 'Add a condition';
    case 'notify':
      return n.subject;
    case 'webhook':
      return n.url.replace(/^https?:\/\//, '');
    case 'wait':
      return `${n.hours} hours`;
    default:
      return '';
  }
};

function FlowCard({ data, selected }: NodeProps<Node<{ node: WorkflowNode; bad: boolean }>>) {
  const n = data.node;
  const info = INFO[n.type];
  const outlets = OUTLETS[n.type];
  const rejected = n.type === 'end' && n.outcome === 'rejected';
  return (
    <div
      className={cx(
        'w-56 border bg-snow shadow-sm',
        selected
          ? 'border-2 border-accent-600 shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand-600)_18%,transparent)]'
          : data.bad
            ? 'border-red-400'
            : 'border-zinc-300',
      )}
    >
      {n.type !== 'start' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!size-2.5 !rounded-none !bg-zinc-500"
        />
      )}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={cx(
            'flex size-8 shrink-0 items-center justify-center',
            rejected ? 'bg-red-600 text-white' : info.tone,
          )}
        >
          {rejected ? <XCircle className="size-4" /> : <info.icon className="size-4" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{n.name || info.label}</div>
          <div className="truncate text-xs text-zinc-500">
            {summary(n) || (n.name ? info.label : '')}
          </div>
          {n.type === 'approval' && n.slaHours ? (
            <div className="text-xs text-amber-800">Escalates after {n.slaHours} h</div>
          ) : null}
        </div>
      </div>
      {outlets.length > 1 && (
        <div className="flex border-t border-zinc-100 text-[10px] font-medium text-zinc-500">
          {outlets.map((o) => (
            <span key={o.handle} className="flex-1 pb-3 pt-1 text-center">
              {o.label}
            </span>
          ))}
        </div>
      )}
      {outlets.map((o, i) => (
        <Handle
          key={o.handle}
          id={o.handle}
          type="source"
          position={Position.Bottom}
          style={{ left: outlets.length === 1 ? '50%' : `${((i + 0.5) / outlets.length) * 100}%` }}
          className={cx(
            '!size-2.5 !rounded-none',
            o.handle === 'rejected'
              ? '!bg-red-500'
              : o.handle === 'approved' || o.handle === 'true'
                ? '!bg-emerald-500'
                : o.handle === 'timeout'
                  ? '!bg-amber-500'
                  : '!bg-zinc-500',
          )}
        />
      ))}
    </div>
  );
}
/** A connection: its label, and a button to remove it once it is picked. */
function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  selected,
  data,
}: EdgeProps) {
  const [path, x, y] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const onDelete = (data as { onDelete?(id: string): void } | undefined)?.onDelete;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, ...(selected && { stroke: 'var(--brand-600)', strokeWidth: 2 }) }}
        interactionWidth={28}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            pointerEvents: 'all',
          }}
        >
          {label ? (
            <span className="bg-zinc-50 px-1.5 text-[11px] font-medium text-zinc-600">{label}</span>
          ) : null}
          {selected && onDelete && (
            <button
              type="button"
              aria-label="Remove this connection"
              title="Remove this connection"
              onClick={() => onDelete(id)}
              className="flex size-5 items-center justify-center bg-red-600 text-white shadow hover:bg-red-700"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { wf: FlowCard };
const edgeTypes = { wf: FlowEdge };

const toNodes = (
  g: WorkflowGraph,
  bad: Set<string>,
): Node<{ node: WorkflowNode; bad: boolean }>[] =>
  g.nodes.map((n) => ({
    id: n.id,
    type: 'wf',
    position: n.position,
    data: { node: n, bad: bad.has(n.id) },
    deletable: n.type !== 'start',
  }));
const toEdges = (g: WorkflowGraph, onDelete: (id: string) => void): Edge[] =>
  g.edges.map((e) => ({
    id: e.id,
    type: 'wf',
    data: { onDelete },
    source: e.from,
    target: e.to,
    sourceHandle: e.handle,
    label:
      e.handle === 'next'
        ? undefined
        : (OUTLETS[g.nodes.find((n) => n.id === e.from)?.type ?? 'start'].find(
            (o) => o.handle === e.handle,
          )?.label ?? e.handle),
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: e.handle === 'rejected' ? '#dc2626' : e.handle === 'timeout' ? '#d97706' : undefined,
    },
  }));

/** Every form starts with this: it is submitted, and that is that. People add approvals, emails and so on between the two. */
const plainGraph = (): WorkflowGraph => ({
  nodes: [
    { id: 'start', type: 'start', name: 'Submitted', position: { x: 0, y: 0 } },
    { id: 'end_approved', type: 'end', name: '', outcome: 'approved', position: { x: 0, y: 170 } },
  ],
  edges: [{ id: 'start:next', from: 'start', to: 'end_approved', handle: 'next' }],
});

/** Whether a graph is still the plain one. Such a form needs no workflow engine: its submissions are simply complete. */
const isPlain = (g: WorkflowGraph) => {
  const end = g.nodes.find((n) => n.type === 'end');
  return (
    g.nodes.length === 2 &&
    g.nodes.some((n) => n.type === 'start') &&
    !!end &&
    !end.name &&
    g.edges.length === 1 &&
    g.edges[0]!.from === 'start' &&
    g.edges[0]!.to === end.id &&
    g.edges[0]!.handle === 'next'
  );
};

const freeId = (g: WorkflowGraph, stem: string) => {
  let id = stem;
  for (let n = 2; g.nodes.some((x) => x.id === id); n++) id = `${stem}_${n}`;
  return id;
};

const fresh = (id: string, type: NodeType, position: { x: number; y: number }): WorkflowNode => {
  const base = { id, position, name: '' };
  switch (type) {
    case 'approval':
      return {
        ...base,
        type,
        name: 'Review',
        description: '',
        approvers: { role: 'manager', group: null, users: [] },
        allowReturn: true,
        color: null,
        slaHours: null,
      };
    case 'branch':
      return { ...base, type, condition: '' };
    case 'notify':
      return {
        ...base,
        type,
        to: { submitter: true, approvers: null, emails: [], questions: [] },
        subject: 'Your submission was received',
        body: '',
        attachments: [],
        attachQuestions: [],
        documents: [],
      };
    case 'webhook':
      return { ...base, type, url: 'https://', method: 'POST', headers: {} };
    case 'wait':
      return { ...base, type, hours: 24 };
    case 'end':
      return { ...base, type, name: 'Declined', outcome: 'rejected' };
    case 'entity':
      return { ...base, type };
    default:
      throw new Error('Cannot add a start node');
  }
};

/**
 * The form's workflow as a graph on a canvas: drag nodes, connect their outlets, and edit
 * the selected node on the right. Forms with a simple stage list open as the equivalent graph.
 */
export function WorkflowPanel({
  draft,
  set,
  formKey,
}: {
  draft: Draft;
  set(p: Partial<Draft>): void;
  formKey: string;
}) {
  const wf = draft.settings.workflow;
  const graph = useMemo(
    () => wf.graph ?? (wf.enabled ? graphFromStages(wf.stages) : plainGraph()),
    [wf.graph, wf.enabled, wf.stages],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const problems = useMemo(() => lintWorkflow(graph, draft.def), [graph, draft.def]);
  const badNodes = useMemo(
    () =>
      new Set(
        graph.nodes
          .filter((n) => problems.some((p) => p.includes(`"${n.name || n.id}"`)))
          .map((n) => n.id),
      ),
    [graph, problems],
  );

  const commit = useCallback(
    (g: WorkflowGraph) =>
      set({ settings: { ...draft.settings, workflow: { ...wf, enabled: !isPlain(g), graph: g } } }),
    [set, draft.settings, wf],
  );

  const nodeOf = graph.nodes.find((n) => n.id === selected) ?? null;
  const update = (id: string, patch: Partial<WorkflowNode>) =>
    commit({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as WorkflowNode) : n)),
    });
  const remove = (id: string) => {
    commit({
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
    });
    setSelected(null);
  };
  const add = (type: NodeType) => {
    const y = Math.max(0, ...graph.nodes.map((n) => n.position.y)) + 140;
    const id = freeId(graph, type);
    commit({ ...graph, nodes: [...graph.nodes, fresh(id, type, { x: 0, y })] });
    setSelected(id);
  };

  return (
    <div className="grid h-full min-h-[34rem] xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
      <aside className="hidden flex-col gap-2 overflow-y-auto border-e border-zinc-200 bg-zinc-50 p-4 xl:flex">
        <div className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
          Add a step
        </div>
        {(['approval', 'branch', 'notify', 'webhook', 'wait', 'entity', 'end'] as const).map(
          (t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              title={INFO[t].hint}
              className="flex h-10 items-center gap-2.5 border border-zinc-200 bg-snow px-2 text-start text-[13px] hover:border-accent-600"
            >
              <span className={cx('flex size-6 items-center justify-center', INFO[t].tone)}>
                <INFO_ICON type={t} />
              </span>
              {INFO[t].label}
            </button>
          ),
        )}
        <div
          className={cx(
            'mt-auto flex gap-2 border bg-snow p-3 text-xs',
            problems.length ? 'border-amber-300 text-amber-900' : 'border-zinc-200 text-zinc-600',
          )}
        >
          {problems.length ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
          )}
          {problems.length
            ? `${problems.length} thing${problems.length === 1 ? '' : 's'} to fix`
            : 'Every path reaches an end. No loose steps.'}
        </div>
      </aside>
      <div className="relative min-h-0 min-w-0">
        <Canvas
          graph={graph}
          bad={badNodes}
          selected={selected}
          setSelected={setSelected}
          commit={commit}
        />
        <div className="absolute end-3 top-3">
          <Button variant="secondary" size="sm" icon={Play} onClick={() => setSimulating(true)}>
            Simulate a submission
          </Button>
        </div>
        {simulating && (
          <SimulateDialog graph={graph} draft={draft} onClose={() => setSimulating(false)} />
        )}
        {problems.length > 0 && (
          <div
            className="absolute inset-x-3 bottom-3 max-h-40 overflow-y-auto border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow"
            role="status"
          >
            <div className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" /> Fix before saving
            </div>
            <ul className="list-disc ps-6">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <aside className="flex min-h-0 flex-col overflow-y-auto border-s border-zinc-200 bg-snow">
        {nodeOf ? (
          <Inspector
            key={nodeOf.id}
            node={nodeOf}
            draft={draft}
            formKey={formKey}
            update={(p) => update(nodeOf.id, p)}
            remove={() => remove(nodeOf.id)}
          />
        ) : (
          <div className="space-y-3 p-5 text-sm text-zinc-600">
            <h3 className="flex items-center gap-2 font-semibold text-ink">
              <ShieldCheck className="size-4 text-accent-600" /> How workflows run
            </h3>
            <p>
              Drag from a step’s coloured dot to the next step to connect them. Click a connection
              to remove it with its red button, or drag its end to another step to change it. Select
              a step to edit it, and press Delete to remove it.
            </p>
            <p>
              An <b>approval</b> waits for someone to approve, reject or send it back. Set an
              escalation time and draw its <i>timeout</i> outlet to escalate. Without one the
              approvers get a reminder.
            </p>
            <p>
              <b>Update records</b> writes the bound answers to the entity. With none on the canvas,
              that happens once the submission is final.
            </p>
            <p className="text-xs text-zinc-500">
              Saved workflows apply right away. No need to publish a new version.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

const INFO_ICON = ({ type }: { type: NodeType }) => {
  const I = INFO[type].icon;
  return <I className="size-3.5" />;
};

function Canvas({
  graph,
  bad,
  selected,
  setSelected,
  commit,
}: {
  graph: WorkflowGraph;
  bad: Set<string>;
  selected: string | null;
  setSelected(id: string | null): void;
  commit(g: WorkflowGraph): void;
}) {
  // React Flow tracks node sizes and selection itself; positions and edits flow back to the draft.
  const [overlay, setOverlay] = useState<Record<string, { x: number; y: number }>>({});
  const nodes = useMemo(
    () =>
      toNodes(graph, bad).map((n) => ({
        ...n,
        position: overlay[n.id] ?? n.position,
        selected: n.id === selected,
      })),
    [graph, bad, overlay, selected],
  );
  const removeEdge = (id: string) =>
    commit({ ...graph, edges: graph.edges.filter((e) => e.id !== id) });
  const edges = useMemo(() => toEdges(graph, removeEdge), [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = (changes: NodeChange<Node<{ node: WorkflowNode; bad: boolean }>>[]) => {
    const next = applyNodeChanges(changes, nodes);
    const moved = changes.flatMap((c) => (c.type === 'position' && c.position ? [c.id] : []));
    if (moved.length)
      setOverlay((o) => ({
        ...o,
        ...Object.fromEntries(
          next.filter((n) => moved.includes(n.id)).map((n) => [n.id, n.position]),
        ),
      }));
    const ended = changes.some((c) => c.type === 'position' && c.dragging === false);
    if (ended) {
      commit({
        ...graph,
        nodes: graph.nodes.map((n) => ({
          ...n,
          position: next.find((x) => x.id === n.id)?.position ?? n.position,
        })),
      });
      setOverlay({});
    }
    const picked = changes.find((c) => c.type === 'select' && c.selected);
    if (picked && picked.type === 'select') setSelected(picked.id);
    const removed = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []));
    if (removed.length) {
      commit({
        nodes: graph.nodes.filter((n) => !removed.includes(n.id)),
        edges: graph.edges.filter((e) => !removed.includes(e.from) && !removed.includes(e.to)),
      });
      setSelected(null);
    }
  };
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const from = graph.nodes.find((n) => n.id === c.source);
    const handle = (c.sourceHandle ??
      OUTLETS[from?.type ?? 'start'][0]?.handle ??
      'next') as WorkflowHandle;
    // An outlet leads to one place: connecting it again replaces the old connection.
    const edge: WorkflowEdge = {
      id: `${c.source}:${handle}`,
      from: c.source,
      to: c.target,
      handle,
    };
    commit({
      ...graph,
      edges: [...graph.edges.filter((e) => !(e.from === c.source && e.handle === handle)), edge],
    });
  };
  /** Drag the end of a connection onto another step to change where it leads (or onto another outlet to change where it starts). */
  const onReconnect = (old: Edge, c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const from = graph.nodes.find((n) => n.id === c.source);
    const handle = (c.sourceHandle ??
      OUTLETS[from?.type ?? 'start'][0]?.handle ??
      'next') as WorkflowHandle;
    const edge: WorkflowEdge = {
      id: `${c.source}:${handle}`,
      from: c.source,
      to: c.target,
      handle,
    };
    commit({
      ...graph,
      edges: [
        ...graph.edges.filter(
          (e) => e.id !== old.id && !(e.from === c.source && e.handle === handle),
        ),
        edge,
      ],
    });
  };
  const onEdgesDelete = (gone: Edge[]) =>
    commit({ ...graph, edges: graph.edges.filter((e) => !gone.some((g) => g.id === e.id)) });

  return (
    <div className="h-full min-h-[30rem] overflow-hidden bg-zinc-50" dir="ltr">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        edgesReconnectable
        onReconnect={onReconnect}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onPaneClick={() => setSelected(null)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.3}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

const HEADER_NAMES = ['Authorization', 'Content-Type', 'Accept', 'X-API-Key', 'User-Agent'];

/** Header name and value rows. Names and values can be left half-filled while typing; only complete rows are kept. */
function HeadersEditor({
  value,
  questions,
  onChange,
}: {
  value: Record<string, string>;
  questions: { key: string; label: string }[];
  onChange(v: Record<string, string>): void;
}) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(value).map(([k, v]) => ({ k, v })),
  );
  const list = useId();
  const put = (next: { k: string; v: string }[]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])));
  };
  return (
    <div className="space-y-2">
      <datalist id={list}>
        {HEADER_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {rows.map((r, i) => (
        <div key={i} className="space-y-1.5 border border-zinc-200 bg-snow p-2">
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="Header name"
              list={list}
              placeholder="Name, e.g. Authorization"
              value={r.k}
              onChange={(e) => put(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
              className="font-mono text-xs"
            />
            <button
              type="button"
              aria-label="Remove this header"
              title="Remove"
              onClick={() => put(rows.filter((_, j) => j !== i))}
              className="p-1.5 text-zinc-500 hover:text-red-700"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="Header value"
              placeholder="Value"
              value={r.v}
              onChange={(e) => put(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
              className="font-mono text-xs"
            />
            {questions.length > 0 && (
              <Listbox
                searchable
                label="Put an answer in the value"
                value={null}
                align="end"
                trigger={{
                  className:
                    'inline-flex h-9 shrink-0 items-center gap-1 border border-zinc-300 bg-snow px-2 text-xs font-medium text-accent-700 hover:border-zinc-500',
                  children: (
                    <>
                      <Variable className="size-3.5" /> Answer
                    </>
                  ),
                }}
                options={questions.map(answerOption)}
                onChange={(k) =>
                  put(rows.map((x, j) => (j === i ? { ...x, v: `${x.v}\${${k}}` } : x)))
                }
              />
            )}
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        icon={Plus}
        onClick={() => setRows([...rows, { k: '', v: '' }])}
      >
        Add a header
      </Button>
    </div>
  );
}

function Inspector({
  node,
  draft,
  formKey,
  update,
  remove,
}: {
  node: WorkflowNode;
  draft: Draft;
  formKey: string;
  update(p: Partial<WorkflowNode>): void;
  remove(): void;
}) {
  const info = INFO[node.type];
  const { tenantId, project } = useProject();
  const questions = useMemo(() => questionsOf(draft.def), [draft.def]);
  const emailQuestions = questions.filter((q) => q.type === 'email');
  // What can be put into a message: the answers, and details of the submission itself (when, by whom…).
  const insertable = [
    ...questions.filter((q) => q.type !== 'note').map((q) => ({ key: q.key, label: q.label })),
    ...SUBMISSION_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  ];
  const fileQuestions = questions.filter(
    (q) => q.type === 'file' || q.type === 'image' || q.type === 'signature',
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const upload = async (files: FileList | null) => {
    if (node.type !== 'notify') return;
    const file = files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setUploadProblem('The file is larger than 10 MB');
    setUploading(true);
    setUploadProblem(null);
    try {
      const stored = await api.uploadAttachment(tenantId, project.key, formKey, file, file.name);
      update({
        attachments: [...(node.attachments ?? []), { id: stored.id, name: stored.name }],
      } as Partial<WorkflowNode>);
    } catch (e) {
      setUploadProblem(e instanceof Error ? e.message : 'The file could not be uploaded');
    } finally {
      setUploading(false);
    }
  };
  const keys = useMemo(
    () => new Set(draft.def.sections.flatMap((s) => s.questions.map((q) => q.key))),
    [draft.def],
  );
  const set = <T extends NodeType>(patch: Partial<Of<T>>) => update(patch as Partial<WorkflowNode>);
  let conditionProblem: string | null = null;
  if (node.type === 'branch' && node.condition)
    try {
      const bad = references(node.condition).filter((r) => !keys.has(r));
      if (bad.length) conditionProblem = `Unknown question \${${bad[0]}}`;
    } catch (e) {
      conditionProblem = (e as Error).message;
    }
  return (
    <div className="space-y-4 p-5">
      <div className="-mx-5 -mt-5 flex items-center gap-3 border-b border-zinc-200 px-5 py-3.5">
        <span className={cx('flex size-8 items-center justify-center', info.tone)}>
          <info.icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{info.label}</h3>
          <p className="truncate text-xs text-zinc-500" title={info.hint}>
            {info.hint}
          </p>
        </div>
        {node.type !== 'start' && (
          <button
            type="button"
            aria-label="Delete step"
            title="Delete step"
            onClick={remove}
            className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {node.type !== 'start' && (
        <Field
          label={node.type === 'end' ? 'Outcome name' : 'Name'}
          intro={
            node.type === 'end'
              ? 'Shown on the submission instead of Approved or Rejected'
              : 'Shown on this step in the workflow'
          }
        >
          <Input
            aria-label="Step name"
            value={node.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={
              node.type === 'end'
                ? node.outcome === 'approved'
                  ? 'e.g. Verified'
                  : 'e.g. Declined'
                : info.label
            }
          />
        </Field>
      )}
      {node.type === 'approval' && (
        <>
          <Field label="Instructions for reviewers" intro="Shown to reviewers above the answers">
            <Textarea
              value={node.description}
              onChange={(e) => set<'approval'>({ description: e.target.value })}
              placeholder="e.g. Check the case counts against the register"
              className="min-h-20"
            />
          </Field>
          <ApproverFields
            value={node.approvers}
            onChange={(approvers) => set<'approval'>({ approvers })}
          />
          <ToggleRow
            label="Reviewers can send it back"
            help="They can return the submission to its author to fix and send again"
            checked={node.allowReturn}
            onChange={(allowReturn) => set<'approval'>({ allowReturn })}
          />
          <Field
            label="Badge colour"
            intro="The colour of the status badge while a submission waits here. Leave on standard for blue"
          >
            <div className="flex flex-wrap items-center gap-2">
              {[
                null,
                '#0f62fe',
                '#007d79',
                '#198038',
                '#b28600',
                '#ff832b',
                '#8a3ffc',
                '#d12771',
                '#525252',
              ].map((c) => (
                <button
                  key={c ?? 'standard'}
                  type="button"
                  aria-label={c ? `Use ${c}` : 'Standard colour'}
                  aria-pressed={node.color === c}
                  onClick={() => set<'approval'>({ color: c })}
                  className={cx(
                    'flex size-7 items-center justify-center border',
                    node.color === c ? 'border-ink ring-2 ring-accent-600/40' : 'border-zinc-300',
                  )}
                  style={c ? { background: c } : undefined}
                >
                  {!c && <span className="text-[10px] text-zinc-500">Std</span>}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="Escalate after (hours)"
            intro="Hours without a decision before the Timeout outlet is used. Leave empty for no deadline"
          >
            <Input
              type="number"
              min={1}
              placeholder="No deadline"
              value={node.slaHours ?? ''}
              onChange={(e) =>
                set<'approval'>({ slaHours: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
        </>
      )}
      {node.type === 'branch' && (
        <Field label="Condition" intro="Yes if true, e.g. ${cases} > 10">
          <Input
            value={node.condition}
            onChange={(e) => set<'branch'>({ condition: e.target.value })}
            className="font-mono text-xs"
            aria-invalid={!!conditionProblem || undefined}
          />
        </Field>
      )}
      {node.type === 'branch' && conditionProblem && (
        <p className="-mt-2 text-xs text-red-700">{conditionProblem}</p>
      )}
      {node.type === 'notify' && (
        <>
          <ToggleRow
            label="Email the person who submitted"
            help="Sent to the author of the submission"
            checked={node.to.submitter}
            onChange={(submitter) => set<'notify'>({ to: { ...node.to, submitter } })}
          />
          <ToggleRow
            label="Email the approvers"
            help="Sent to everyone who can approve at this point"
            checked={!!node.to.approvers}
            onChange={(on) =>
              set<'notify'>({
                to: {
                  ...node.to,
                  approvers: on ? { role: 'manager', group: null, users: [] } : null,
                },
              })
            }
          />
          {node.to.approvers && (
            <ApproverFields
              value={node.to.approvers}
              onChange={(approvers) => set<'notify'>({ to: { ...node.to, approvers } })}
            />
          )}
          <Field label="Other addresses" intro="Separate with commas">
            <Input
              defaultValue={node.to.emails.join(', ')}
              onBlur={(e) =>
                set<'notify'>({
                  to: { ...node.to, emails: e.target.value.split(/[,\s]+/).filter(Boolean) },
                })
              }
              placeholder="qa@example.org"
            />
          </Field>
          <Field
            label="Addresses from the form"
            intro="Also send it to the email addresses people entered in these questions"
          >
            <Listbox
              label="Email questions"
              placeholder={
                emailQuestions.length ? 'Choose questions' : 'The form has no email question'
              }
              value={null}
              values={node.to.questions ?? []}
              disabled={!emailQuestions.length}
              options={emailQuestions.map((q) => ({
                value: q.key,
                label: q.label || q.key,
                description: q.key,
                icon: Mail,
              }))}
              onChangeMany={(qs) => set<'notify'>({ to: { ...node.to, questions: qs } })}
            />
          </Field>
          <Field label="Subject" intro="Use ${question} to include an answer">
            <Input
              value={node.subject}
              onChange={(e) => set<'notify'>({ subject: e.target.value })}
            />
          </Field>
          <Field
            label="Message"
            intro="Formatting is kept. Put answers from the form in with Insert answer"
          >
            <RichTextField
              label="Message"
              value={node.body}
              answers={insertable}
              onChange={(body) => set<'notify'>({ body })}
            />
          </Field>
          <Field
            label="Attachments"
            intro="Up to 5 files, 10 MB each, sent with every email from this step"
          >
            <div className="space-y-2">
              {(node.attachments ?? []).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 border border-zinc-200 px-3 py-2 text-sm"
                >
                  <Paperclip className="size-4 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      set<'notify'>({ attachments: node.attachments.filter((x) => x.id !== a.id) })
                    }
                    className="p-1 text-zinc-500 hover:text-red-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {(node.attachments ?? []).length < 5 && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-accent-700 hover:underline">
                  <Upload className="size-4" /> {uploading ? 'Uploading…' : 'Add a file'}
                  <input
                    type="file"
                    hidden
                    disabled={uploading}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,image/*"
                    onChange={(e) => (void upload(e.target.files), (e.target.value = ''))}
                  />
                </label>
              )}
              {uploadProblem && <p className="text-xs text-red-700">{uploadProblem}</p>}
            </div>
          </Field>
          <Field
            label="Documents"
            intro="Made from the submission as it stands when the email is sent, and attached. Write them on the Documents tab"
          >
            <Listbox
              label="Documents to attach"
              placeholder="Choose documents"
              value={null}
              values={(node.documents ?? []).map((d) => `${d.id}|${d.format}`)}
              options={withRecord(
                (draft.settings.documents ?? []).filter((d) => d.visibility !== 'internal'),
              ).flatMap((d) => [
                ...(
                  [
                    ['pdf', 'PDF'],
                    ['docx', 'Word'],
                    ['xlsx', 'Excel'],
                  ] as const
                )
                  .filter(([f]) => d.formats.includes(f))
                  .map(([f, name]) => ({
                    value: `${d.id}|${f}`,
                    label: `${d.name} (${name})`,
                    description: d.description || undefined,
                  })),
              ])}
              onChangeMany={(vs) =>
                set<'notify'>({
                  documents: vs.slice(0, 5).map((v) => ({
                    id: v.split('|')[0]!,
                    format: v.split('|')[1] as 'pdf' | 'docx' | 'xlsx',
                  })),
                })
              }
            />
          </Field>
          <Field
            label="Files from the form"
            intro="Also attach what people uploaded in these questions"
          >
            <Listbox
              label="Questions whose files are attached"
              placeholder={
                fileQuestions.length
                  ? 'Choose questions'
                  : 'The form has no file, photo or signature question'
              }
              value={null}
              values={node.attachQuestions ?? []}
              disabled={!fileQuestions.length}
              options={fileQuestions.map((q) => ({
                value: q.key,
                label: q.label || q.key,
                description: q.key,
              }))}
              onChangeMany={(attachQuestions) => set<'notify'>({ attachQuestions })}
            />
          </Field>
        </>
      )}
      {node.type === 'webhook' && (
        <>
          <Field
            label="URL"
            intro="A public web address. The submission is sent as JSON, and failures retry"
          >
            <Input
              value={node.url}
              onChange={(e) => set<'webhook'>({ url: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Method">
            <Select
              value={node.method}
              onChange={(e) => set<'webhook'>({ method: e.target.value as 'POST' | 'PUT' })}
            >
              <option>POST</option>
              <option>PUT</option>
            </Select>
          </Field>
          <Field
            label="Headers"
            intro="Sent with the request. A value can include answers from the form, like Bearer ${token}"
          >
            <HeadersEditor
              value={node.headers}
              questions={insertable}
              onChange={(headers) => set<'webhook'>({ headers })}
            />
          </Field>
        </>
      )}
      {node.type === 'wait' && (
        <Field label="Wait for" intro="Hours before it carries on">
          <Input
            icon={Hash}
            type="number"
            min={1}
            value={node.hours}
            onChange={(e) => set<'wait'>({ hours: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      )}
      {node.type === 'end' && (
        <Field label="Result" intro="Whether the submission’s data is applied">
          <Select
            value={node.outcome}
            onChange={(e) => set<'end'>({ outcome: e.target.value as 'approved' | 'rejected' })}
          >
            <option value="approved">Approved — the data takes effect</option>
            <option value="rejected">Rejected — nothing is applied</option>
          </Select>
        </Field>
      )}
      {node.type === 'entity' && (
        <p className="text-sm text-zinc-600">
          Writes every answer bound to an entity attribute or data element, as of this point in the
          workflow.
        </p>
      )}
    </div>
  );
}

/** Try answers and see which approval steps a submission would go through. */
function SimulateDialog({
  graph,
  draft,
  onClose,
}: {
  graph: WorkflowGraph;
  draft: Draft;
  onClose(): void;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const def = draft.def;
  const values = useMemo(() => formState(def, answers).values, [def, answers]);
  const path = useMemo(() => {
    try {
      return plannedApprovals(graph, values);
    } catch {
      return null;
    }
  }, [graph, values]);
  const roleOf = (n: Of<'approval'>) =>
    [
      n.approvers.role === 'manager'
        ? 'Project managers'
        : n.approvers.role === 'viewer'
          ? 'Any project member'
          : '',
      n.approvers.users.length ? `${n.approvers.users.length} named` : '',
    ]
      .filter(Boolean)
      .join(' + ') || 'Nobody chosen';
  return (
    <Dialog
      open
      wide="full"
      onClose={onClose}
      title="Simulate a submission"
      description="Answer the questions and see the steps it would go through. Nothing is sent."
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <FormRenderer definition={def} answers={answers} onChange={setAnswers} />
        <aside className="space-y-3 lg:sticky lg:top-0">
          <div className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
            Its path
          </div>
          <ol className="border border-zinc-200 bg-snow">
            <li className="flex items-center gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-sm">
              <Play className="size-4 text-zinc-500" /> Submitted
            </li>
            {path === null && (
              <li className="px-3 py-3 text-sm text-red-700">
                The workflow can’t be followed yet. Fix the problems on the canvas.
              </li>
            )}
            {path?.length === 0 && (
              <li className="px-3 py-3 text-sm text-zinc-600">
                No approval is needed for these answers.
              </li>
            )}
            {path?.map((n, i) => (
              <li
                key={n.id}
                className="flex items-start gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-sm last:border-0"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center bg-accent-600 text-[11px] font-semibold text-on-accent">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-medium">{n.name || 'Approval'}</div>
                  <div className="text-xs text-zinc-500">{roleOf(n)}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-zinc-500">
            Steps hidden behind a condition appear only when the answers meet it.
          </p>
        </aside>
      </div>
    </Dialog>
  );
}
