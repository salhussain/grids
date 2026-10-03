import { Link, useRouterState } from '@tanstack/react-router';
import type { FormGroupDto, MenuForm } from '@grids/schema';
import { cx } from '@grids/ui';
import { ChevronRight, ClipboardList, Inbox, LayoutGrid } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCan, useWorkspace } from '../../session';
import { iconOf } from '../projects/context';
import { fillHref, groupTree, useFormsMenu } from './FormsHome';
import { useInbox } from './InboxPage';

interface Tone {
  muted: string;
  active: string;
  hover: string;
}

const STORE = 'grids.formsNav';
const readOpen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

/**
 * The Forms section of the sidebar: the organisation's groups as menu items,
 * sub-groups nested beneath, and the forms the person can fill in under each.
 */
export function FormsNav({ tone, onNavigate }: { tone: Tone; onNavigate?: () => void }) {
  const ws = useWorkspace();
  const can = useCan();
  const admin = ws.me.role === 'org_admin' || can('projects.manage');
  const menu = useFormsMenu();
  const inbox = useInbox();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const groupParam = useRouterState({ select: (s) => (s.location.search as { group?: string }).group });
  const [open, setOpen] = useState<Set<string>>(readOpen);
  const base = `/o/${ws.tenant.id}`;

  const { children, formsIn, has } = useMemo(() => {
    const groups = menu.data?.groups ?? [];
    const children = groupTree(groups);
    const known = new Set(groups.map((g) => g.id));
    const formsIn = new Map<string | null, MenuForm[]>();
    for (const f of menu.data?.forms ?? []) {
      const k = f.groupId && known.has(f.groupId) ? f.groupId : null;
      formsIn.set(k, [...(formsIn.get(k) ?? []), f]);
    }
    // Whether a group has anything to show (forms in it or below it).
    const memo = new Map<string, boolean>();
    const has = (id: string): boolean => {
      if (!memo.has(id)) memo.set(id, !!formsIn.get(id)?.length || (children.get(id) ?? []).some((c) => has(c.id)));
      return memo.get(id)!;
    };
    return { children, formsIn, has };
  }, [menu.data]);

  const toReview = inbox.data?.toReview.length ?? 0;
  const returned = inbox.data?.mine.filter((s) => s.status === 'returned').length ?? 0;
  const anyForms = !!menu.data?.forms.length;
  if (!anyForms && !admin && !toReview && !inbox.data?.mine.length) return null;

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
    try {
      localStorage.setItem(STORE, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const row = 'mx-3 mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors';

  const renderGroup = (g: FormGroupDto, depth: number) => {
    if (!admin && !has(g.id)) return null;
    const Icon = iconOf(g.icon);
    const isOpen = open.has(g.id);
    const active = path === `${base}/forms` && groupParam === g.id;
    const subs = children.get(g.id) ?? [];
    const forms = formsIn.get(g.id) ?? [];
    return (
      <li key={g.id}>
        <div className={cx(row, 'group/row relative gap-2 py-1.5 pe-1.5', active ? tone.active : tone.hover)} style={{ marginInlineStart: `${12 + depth * 14}px` }}>
          <Link to={`${base}/forms`} search={{ group: g.id }} onClick={() => (!isOpen && toggle(g.id), onNavigate?.())} className="flex min-w-0 flex-1 items-center gap-3">
            <Icon className={cx('shrink-0', depth ? 'size-4' : 'size-[18px]')} strokeWidth={1.75} />
            <span className="truncate">{g.name}</span>
          </Link>
          {(subs.length > 0 || forms.length > 0) && (
            <button type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen} aria-label={isOpen ? `Collapse ${g.name}` : `Expand ${g.name}`} className={cx('rounded p-1', tone.muted, tone.hover)}>
              <ChevronRight className={cx('size-3.5 transition-transform', isOpen && 'rotate-90')} />
            </button>
          )}
        </div>
        {isOpen && (
          <ul className="relative">
            {subs.map((c) => renderGroup(c, depth + 1))}
            {forms.map((f) => renderForm(f, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  const renderForm = (f: MenuForm, depth: number) => {
    const href = fillHref(ws.tenant.id, f);
    const active = path.startsWith(href);
    return (
      <li key={`${f.project.key}/${f.key}`}>
        <Link
          to={href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cx(row, 'gap-2.5 py-1.5 text-[13px]', active ? tone.active : tone.hover)}
          style={{ marginInlineStart: `${12 + depth * 14}px` }}
          title={`${f.name} · ${f.project.name}`}
        >
          <span className={cx('size-1.5 shrink-0 rounded-full', active ? 'bg-accent-500' : 'bg-current opacity-40')} />
          <span className="truncate">{f.name}</span>
        </Link>
      </li>
    );
  };

  const loose = formsIn.get(null) ?? [];
  return (
    <div className="mb-5">
      <div className={cx('px-6 pb-2 text-[10px] font-semibold tracking-[0.16em] uppercase', tone.muted)}>Forms</div>
      <Link
        to={`${base}/inbox`}
        onClick={onNavigate}
        aria-current={path.startsWith(`${base}/inbox`) ? 'page' : undefined}
        className={cx(row, path.startsWith(`${base}/inbox`) ? tone.active : tone.hover)}
      >
        <Inbox className="size-[18px] shrink-0" strokeWidth={1.75} />
        <span className="flex-1">Submissions</span>
        {toReview + returned > 0 && (
          <span className="num min-w-5 rounded-full bg-accent-600 px-1.5 text-center text-[11px] leading-5 font-semibold text-on-accent" title={`${toReview} to review, ${returned} sent back to you`}>
            {toReview + returned}
          </span>
        )}
      </Link>
      <Link
        to={`${base}/forms`}
        onClick={onNavigate}
        aria-current={path === `${base}/forms` && !groupParam ? 'page' : undefined}
        className={cx(row, path === `${base}/forms` && !groupParam ? tone.active : tone.hover)}
      >
        <LayoutGrid className="size-[18px] shrink-0" strokeWidth={1.75} />
        All forms
      </Link>
      <ul>
        {(children.get(null) ?? []).map((g) => renderGroup(g, 0))}
        {loose.length > 0 && (menu.data?.groups.length ?? 0) > 0 && (
          <li className={cx('mx-6 mt-2 mb-1 flex items-center gap-2 text-[11px]', tone.muted)}>
            <ClipboardList className="size-3" /> Other
          </li>
        )}
        {loose.map((f) => renderForm(f, 0))}
      </ul>
    </div>
  );
}
