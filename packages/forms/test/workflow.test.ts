import { FormDefinition, WorkflowGraph, type WorkflowStage } from '@grids/schema';
import { describe, expect, it } from 'vitest';
import { advance, begin, graphFromStages, interpolate, lintWorkflow } from '../src/index.js';

const def = FormDefinition.parse({
  title: 'Case report',
  sections: [
    {
      key: 's',
      title: 'S',
      questions: [
        { key: 'cases', type: 'integer', label: 'Cases' },
        { key: 'site', type: 'text', label: 'Site' },
      ],
    },
  ],
});

const stage = (key: string, condition = ''): WorkflowStage => ({
  key,
  name: key,
  description: '',
  approvers: { role: 'manager', group: null, users: [] },
  condition,
  allowReturn: true,
});

const graph = (g: unknown) => WorkflowGraph.parse(g);

describe('graphFromStages', () => {
  it('turns stages into a chain that lints clean', () => {
    const g = graphFromStages([stage('lead'), stage('director', '${cases} > 10')]);
    expect(lintWorkflow(g, def)).toEqual([]);
    expect(WorkflowGraph.safeParse(g).success).toBe(true);
  });

  it('runs the same as the legacy chain', () => {
    const g = graphFromStages([stage('lead'), stage('director', '${cases} > 10')]);
    const small = { cases: 3 };
    let s = begin(g, small);
    expect(s).toMatchObject({ node: 'lead', status: 'in_review' });
    s = advance(g, 'lead', 'approved', small);
    expect(s).toMatchObject({ node: 'end_approved', status: 'approved' }); // director skipped

    const big = { cases: 40 };
    s = advance(g, begin(g, big).node, 'approved', big);
    expect(s).toMatchObject({ node: 'director', status: 'in_review' });
    expect(advance(g, 'director', 'approved', big).status).toBe('approved');
    expect(advance(g, 'director', 'rejected', big).status).toBe('rejected');
  });

  it('skips a conditional first stage and handles no stages', () => {
    const g = graphFromStages([stage('only', '${cases} > 10')]);
    expect(begin(g, { cases: 1 }).status).toBe('approved');
    expect(begin(g, { cases: 11 })).toMatchObject({ node: 'only', status: 'in_review' });
    expect(begin(graphFromStages([]), {}).status).toBe('approved');
  });

  it('returns keep the submission on the node', () => {
    const g = graphFromStages([stage('lead')]);
    expect(advance(g, 'lead', 'returned', {})).toEqual({ node: 'lead', status: 'returned', effects: [] });
  });
});

describe('advance with actions', () => {
  const g = graph({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'ack', type: 'notify', subject: 'Got ${site}', to: { submitter: true } },
      { id: 'big', type: 'branch', condition: '${cases} > 10' },
      { id: 'review', type: 'approval', slaHours: 24 },
      { id: 'hook', type: 'webhook', url: 'https://example.com/hook' },
      { id: 'save', type: 'entity' },
      { id: 'cool', type: 'wait', hours: 2 },
      { id: 'ok', type: 'end', outcome: 'approved' },
      { id: 'no', type: 'end', outcome: 'rejected' },
      { id: 'sorry', type: 'notify', subject: 'Returned', to: { submitter: true } },
    ],
    edges: [
      { id: '1', from: 'start', to: 'ack' },
      { id: '2', from: 'ack', to: 'big' },
      { id: '3', from: 'big', to: 'review', handle: 'true' },
      { id: '4', from: 'big', to: 'save', handle: 'false' },
      { id: '5', from: 'review', to: 'hook', handle: 'approved' },
      { id: '6', from: 'review', to: 'no', handle: 'rejected' },
      { id: '7', from: 'review', to: 'sorry', handle: 'returned' },
      { id: '8', from: 'review', to: 'cool', handle: 'timeout' },
      { id: '9', from: 'hook', to: 'save' },
      { id: '10', from: 'save', to: 'ok' },
      { id: '11', from: 'cool', to: 'review' },
      { id: '12', from: 'sorry', to: 'no' },
    ],
  });

  it('collects effects on the way and parks on approvals with an SLA timer', () => {
    const s = begin(g, { cases: 20, site: 'A' });
    expect(s.node).toBe('review');
    expect(s.effects.map((e) => e.kind)).toEqual(['notify', 'timer']);
    expect(s.effects[1]).toMatchObject({ node: 'review', hours: 24, reason: 'sla' });
  });

  it('takes the false branch straight to the entity write', () => {
    const s = begin(g, { cases: 1 });
    expect(s.status).toBe('approved');
    expect(s.effects.map((e) => e.kind)).toEqual(['notify', 'entity']);
  });

  it('approval runs the webhook and entity effects before ending', () => {
    const s = advance(g, 'review', 'approved', { cases: 20 });
    expect(s).toMatchObject({ node: 'ok', status: 'approved' });
    expect(s.effects.map((e) => e.kind)).toEqual(['webhook', 'entity']);
  });

  it('a timeout escalates through the timeout outlet to a wait, then back to review', () => {
    const w = advance(g, 'review', 'timeout', {});
    expect(w).toMatchObject({ node: 'cool', status: 'in_review' });
    expect(w.effects).toEqual([{ kind: 'timer', node: 'cool', hours: 2, reason: 'wait' }]);
    const back = advance(g, 'cool', 'timeout', {});
    expect(back.node).toBe('review');
  });

  it('a returned outlet only fires notify effects', () => {
    const s = advance(g, 'review', 'returned', {});
    expect(s).toMatchObject({ node: 'review', status: 'returned' });
    expect(s.effects.map((e) => e.kind)).toEqual(['notify']);
  });

  it('rejects decisions on the wrong kind of node', () => {
    expect(() => advance(g, 'cool', 'approved', {})).toThrow();
    expect(() => advance(g, 'ack', 'approved', {})).toThrow();
  });
});

describe('lintWorkflow', () => {
  const base = {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'a', type: 'approval' },
      { id: 'ok', type: 'end', outcome: 'approved' },
      { id: 'no', type: 'end', outcome: 'rejected' },
    ],
    edges: [
      { id: '1', from: 'start', to: 'a' },
      { id: '2', from: 'a', to: 'ok', handle: 'approved' },
      { id: '3', from: 'a', to: 'no', handle: 'rejected' },
    ],
  };
  it('accepts a minimal graph', () => expect(lintWorkflow(graph(base), def)).toEqual([]));

  it('does not choke on a webhook address that is still being typed', () => {
    // The editor checks the graph as it is typed, before the schema would accept it.
    const parsed = graph({ ...base, nodes: [...base.nodes, { id: 'w', type: 'webhook', url: 'https://example.org' }] });
    const typing = { ...parsed, nodes: parsed.nodes.map((n) => (n.type === 'webhook' ? { ...n, url: 'https://' } : n)) };
    expect(lintWorkflow(typing, def)).toContain('"w" must call a public http(s) address');
  });

  it('checks the questions an email takes addresses and files from', () => {
    const withMail = FormDefinition.parse({
      title: 'T',
      sections: [{ key: 's', title: 'S', questions: [{ key: 'mail', type: 'email', label: 'Email' }, { key: 'site', type: 'text', label: 'Site' }, { key: 'doc', type: 'file', label: 'Doc' }] }],
    });
    const mail = (extra: object) => graph({ ...base, nodes: [...base.nodes, { id: 'n', type: 'notify', subject: 'Hi', to: { questions: ['mail'] }, ...extra }] });
    const fine = lintWorkflow(mail({ attachQuestions: ['doc'] }), withMail);
    expect(fine.some((p) => p.includes('email question') || p.includes('attaches') || p.includes('no recipients'))).toBe(false);
    expect(lintWorkflow(mail({ to: { questions: ['site'] } }), withMail)).toContain('"n" sends to "site", which is not an email question');
    expect(lintWorkflow(mail({ attachQuestions: ['site'] }), withMail)).toContain('"n" attaches "site", which is not a file, photo or signature question');
  });

  it('flags missing outlets, orphans, unknown references and loops', () => {
    const bad = graph({
      nodes: [
        ...base.nodes,
        { id: 'b', type: 'branch', condition: '${nope} > 1' },
        { id: 'orphan', type: 'notify', subject: 'x ${ghost}', to: { submitter: true } },
      ],
      edges: [
        { id: '1', from: 'start', to: 'b' },
        { id: '2', from: 'b', to: 'a', handle: 'true' },
        { id: '3', from: 'a', to: 'ok', handle: 'approved' },
        { id: '4', from: 'a', to: 'b', handle: 'rejected' },
      ],
    });
    const problems = lintWorkflow(bad, def).join('\n');
    expect(problems).toContain('"b" has no "false" connection');
    expect(problems).toContain('unknown question ${nope}');
    expect(problems).toContain('unknown question ${ghost}');
    expect(problems).toContain('"orphan" is not reachable');
    expect(problems).toContain('loops back');
  });

  it('flags duplicate outlets, a missing start and approvals nobody can decide', () => {
    const g = graph({
      nodes: [
        { id: 'a', type: 'approval', approvers: { role: null, group: null, users: [] } },
        { id: 'ok', type: 'end', outcome: 'approved' },
      ],
      edges: [
        { id: '1', from: 'a', to: 'ok', handle: 'approved' },
        { id: '2', from: 'a', to: 'ok', handle: 'approved' },
      ],
    });
    const problems = lintWorkflow(g, def).join('\n');
    expect(problems).toContain('exactly one start');
    expect(problems).toContain('more than one "approved"');
    expect(problems).toContain('no approvers');
  });
});

describe('interpolate', () => {
  it('fills answers and blanks the missing', () =>
    expect(interpolate('${site}: ${cases} (${x}) ${tags}', { site: 'A', cases: 3, tags: ['a', 'b'] })).toBe('A: 3 () a, b'));
});

import { isPrivateHost } from '../src/index.js';
describe('isPrivateHost', () => {
  it.each(['http://localhost/x', 'http://127.0.0.1', 'http://10.1.2.3', 'http://192.168.0.5', 'http://169.254.169.254/latest', 'http://172.20.0.1', 'http://[::1]/', 'http://db.internal', 'http://intranet'])('%s is private', (u) =>
    expect(isPrivateHost(u)).toBe(true),
  );
  it.each(['https://example.com/hook', 'https://hooks.slack.com/a', 'http://8.8.8.8'])('%s is public', (u) => expect(isPrivateHost(u)).toBe(false));
});
