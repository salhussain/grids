import { DEFAULT_WORK_STATES, uuidv7 } from '@grids/schema';
import { insertWork } from '../services/work.js';
import { dashboard, form, rng, types, type TemplateCtx, type Tx } from './kit.js';

const CATEGORIES = ['Accounts and access', 'Hardware', 'Software', 'Network', 'Facilities', 'Something else'] as const;
const SAMPLES: { title: string; category: (typeof CATEGORIES)[number]; priority: 'low' | 'normal' | 'high' | 'urgent'; state: string; by: string; hoursAgo: number }[] = [
  { title: 'Cannot sign in to the finance system', category: 'Accounts and access', priority: 'high', state: 'in_progress', by: 'Mere Tuilagi', hoursAgo: 5 },
  { title: 'Projector in meeting room 2 has no signal', category: 'Hardware', priority: 'normal', state: 'new', by: 'Sione Kaufusi', hoursAgo: 20 },
  { title: 'Wi-Fi drops every few minutes on the second floor', category: 'Network', priority: 'urgent', state: 'in_progress', by: 'Priya Narayan', hoursAgo: 3 },
  { title: 'Need the survey tool installed on a new laptop', category: 'Software', priority: 'low', state: 'waiting', by: 'Joseph Waqa', hoursAgo: 52 },
  { title: 'Air conditioning in the server room is warm', category: 'Facilities', priority: 'high', state: 'new', by: 'Litia Taufa', hoursAgo: 9 },
  { title: 'Reset my password', category: 'Accounts and access', priority: 'normal', state: 'resolved', by: 'Tomasi Lal', hoursAgo: 30 },
  { title: 'Printer on level 1 is jammed', category: 'Hardware', priority: 'normal', state: 'closed', by: 'Salote Vunibola', hoursAgo: 80 },
  { title: 'Spreadsheet macros stopped working after the update', category: 'Software', priority: 'normal', state: 'in_progress', by: 'Rajesh Ratu', hoursAgo: 28 },
  { title: 'Access to the shared drive for the new intern', category: 'Accounts and access', priority: 'low', state: 'resolved', by: 'Grace Havili', hoursAgo: 120 },
  { title: 'Broken chair in the training room', category: 'Facilities', priority: 'low', state: 'new', by: 'Epeli Singh', hoursAgo: 70 },
];

/**
 * A helpdesk: people send requests through a form (it can be made public, so anyone can), each becomes a ticket with a
 * number, a priority and service times, and the team works them through to resolved. A second type is for the team's
 * own tasks. Comes with a few example tickets.
 */
export async function helpdesk(tx: Tx, c: TemplateCtx, now = new Date()) {
  await types(tx, c, []);
  const kinds = [
    {
      key: 'ticket',
      name: 'Ticket',
      description: 'A request for help from someone.',
      icon: 'ticket',
      color: '#0f62fe',
      prefix: 'TKT',
      sla: { respondHours: { urgent: 1, high: 4, normal: 8, low: 24 }, resolveHours: { urgent: 8, high: 24, normal: 72, low: 168 } },
    },
    { key: 'task', name: 'Task', description: 'Something the team needs to do, not asked for by anyone.', icon: 'list-checks', color: '#007d79', prefix: 'TSK', sla: {} },
  ];
  for (const k of kinds)
    await tx.insertInto('work_type').values({ id: uuidv7(), tenant_id: c.tenantId, project_id: c.projectId, key: k.key, name: k.name, description: k.description, icon: k.icon, color: k.color, prefix: k.prefix, states: JSON.stringify(DEFAULT_WORK_STATES), sla: JSON.stringify(k.sla) }).execute();

  await form(tx, c, {
    key: 'new_request',
    name: 'Ask for help',
    description: 'Tell us what you need. It becomes a ticket, and you hear back when it moves.',
    subjectType: null,
    definition: {
      title: 'Ask for help',
      description: 'It takes a minute. The more you tell us, the faster we can fix it.',
      layout: 'single',
      thankYou: 'Thank you. Your request has been logged as a ticket and someone will be in touch.',
      sections: [
        {
          key: 'request',
          title: 'Your request',
          questions: [
            { key: 'summary', type: 'text', label: 'In a few words, what is the problem?', required: true },
            { key: 'category', type: 'select', label: 'What is it about?', required: true, options: CATEGORIES.map((x) => ({ value: x.toLowerCase().replace(/[^a-z]+/g, '_'), label: x })) },
            { key: 'urgency', type: 'select', label: 'How urgent is it?', required: true, options: [{ value: 'low', label: 'Whenever you can' }, { value: 'normal', label: 'This week' }, { value: 'high', label: 'Today' }, { value: 'urgent', label: 'Right now, I cannot work' }] },
            { key: 'details', type: 'textarea', label: 'Tell us more', hint: 'What you were doing, what you saw, and anything you tried.' },
            { key: 'phone', type: 'phone', label: 'A number to reach you on', hint: 'Optional' },
          ],
        },
      ],
    },
    settings: { work: { type: 'ticket', title: '${summary}', description: '${details}', priority: 'normal', priorityFrom: 'urgency', assigneeId: null, dueInHours: null } },
  });

  // A few tickets to start with.
  const r = rng(77);
  let n = 0;
  for (const s of SAMPLES) {
    const at = new Date(now.getTime() - s.hoursAgo * 3_600_000);
    const clock = { db: undefined as never, now: () => at };
    const made = await insertWork(clock, tx, { tenantId: c.tenantId, projectId: c.projectId, type: 'ticket', title: s.title, description: `${s.category}. Reported by ${s.by}.`, priority: s.priority, requesterName: s.by, createdBy: c.actorId, source: 'manual' });
    const done = s.state === 'resolved' || s.state === 'closed';
    const took = s.state !== 'new';
    await tx
      .updateTable('work_item')
      .set({
        state: s.state,
        assignee_id: took ? c.actorId : null,
        first_response_at: took ? new Date(at.getTime() + (20 + r.int(0, 120)) * 60_000) : null,
        resolved_at: done ? new Date(at.getTime() + (3 + r.int(0, 20)) * 3_600_000) : null,
        due_at: n++ % 3 === 0 && !done ? new Date(now.getTime() + (r.int(-2, 3) * 86_400_000)) : null,
        updated_at: now,
      })
      .where('id', '=', made.id)
      .execute();
    if (took) await tx.insertInto('work_event').values({ id: uuidv7(), tenant_id: c.tenantId, item_id: made.id, actor_id: c.actorId, kind: 'comment', body: done ? 'All sorted. Let us know if it comes back.' : 'Looking into this now.', created_at: new Date(at.getTime() + 45 * 60_000) }).execute();
  }

  await dashboard(tx, c, {
    key: 'helpdesk',
    name: 'Help desk',
    description: 'Open tickets, response times and who is carrying the load.',
    widgets: [
      { id: 'open', type: 'kpi', title: 'Open tickets', w: 3, h: 1, query: { kind: 'work', measure: 'count', type: 'ticket', state: 'open' } },
      { id: 'overdue', type: 'kpi', title: 'Overdue', w: 3, h: 1, options: { invert: true }, query: { kind: 'work', measure: 'count', type: 'ticket', overdue: true } },
      { id: 'breached', type: 'kpi', title: 'Past SLA', w: 3, h: 1, options: { invert: true }, query: { kind: 'work', measure: 'count', type: 'ticket', breached: true } },
      { id: 'resolve', type: 'kpi', title: 'Avg. hours to resolve', w: 3, h: 1, options: { invert: true }, query: { kind: 'work', measure: 'avg_resolve_hours', type: 'ticket', state: 'done' } },
      { id: 'by_state', type: 'pie', title: 'By status', w: 4, h: 3, query: { kind: 'work', measure: 'count', type: 'ticket', by: 'state' } },
      { id: 'by_priority', type: 'bar', title: 'By priority', w: 4, h: 3, query: { kind: 'work', measure: 'count', type: 'ticket', by: 'priority' } },
      { id: 'by_assignee', type: 'bar', title: 'By assignee', w: 4, h: 3, options: { horizontal: true }, query: { kind: 'work', measure: 'count', type: 'ticket', state: 'open', by: 'assignee' } },
      { id: 'weekly', type: 'line', title: 'Tickets per week', w: 12, h: 3, query: { kind: 'work', measure: 'count', type: 'ticket', by: 'week', range: { lastHours: 24 * 90 } } },
    ],
  });
}
