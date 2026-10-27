import { Link, useRouterState } from '@tanstack/react-router';
import type { FormGroupDto, MenuForm } from '@grids/schema';
import { cx } from '@grids/ui';
import { ChevronRight, FolderKanban } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCan, useWorkspace } from '../../session';
import { iconOf } from '../projects/context';
import { groupTree, useFormsMenu } from './FormsHome';
import { formHref, useInbox } from './InboxPage';

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
export function FormsNav({ tone, onNavigate, compact }: { tone: Tone; onNavigate?: () => void; compact?: boolean }) {
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

  const inGroup = (f: MenuForm, groupId: string): boolean => {
    for (let g: string | null | undefined = f.groupId; g; g = menu.data?.groups.find((x) => x.id === g)?.parentId) if (g === groupId) return true;
    return false;
  };
  const anyForms = !!menu.data?.forms.length;
  if (!anyForms) return null;

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
  const row =
    'relative mb-0.5 flex min-h-9 items-center gap-3 px-3 text-sm transition-colors before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-transparent';

  const renderGroup = (g: FormGroupDto, depth: number) => {
    if (!admin && !has(g.id)) return null;
    const Icon = iconOf(g.icon);
    const isOpen = open.has(g.id);
    const active = path === `${base}/forms` && groupParam === g.id;
    const subs = children.get(g.id) ?? [];
    const forms = formsIn.get(g.id) ?? [];
    return (
      <li key={g.id}>
        <div className={cx(row, 'group/row relative gap-2 py-1.5 pe-1.5', active ? tone.active : tone.hover)} style={{ marginInlineStart: `${depth * 14}px` }}>
          <Link to={`${base}/forms`} search={{ group: g.id }} onClick={() => (!isOpen && toggle(g.id), onNavigate?.())} className="flex min-w-0 flex-1 items-center gap-3">
            <Icon className={cx('shrink-0', depth ? 'size-4' : 'size-[18px]')} strokeWidth={1.75} />
            <span className="truncate">{g.name}</span>
          </Link>
          {(subs.length > 0 || forms.length > 0) && (
            <button type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen} aria-label={isOpen ? `Collapse ${g.name}` : `Expand ${g.name}`} className={cx('p-1', tone.muted, tone.hover)}>
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
    const href = formHref(ws.tenant.id, f);
    const waiting = inbox.data?.toReview.filter((r) => r.project.key === f.project.key && r.formKey === f.key).length ?? 0;
    const active = path.startsWith(href);
    const FormIcon = iconOf(f.icon ?? 'clipboard');
    return (
      <li key={`${f.project.key}/${f.key}`}>
        <Link
          to={href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cx(row, 'gap-2.5 py-1.5 text-[13px]', active ? tone.active : tone.hover)}
          style={{ marginInlineStart: `${depth * 14}px` }}
          title={`${f.name} · ${f.project.name}`}
        >
          <FormIcon className={cx('size-4 shrink-0', active && 'text-accent-500')} strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {waiting > 0 && (
            <span className="num min-w-5 bg-accent-600 px-1.5 text-center text-[11px] leading-5 font-semibold text-on-accent" title={`${waiting} waiting on you`}>
              {waiting}
            </span>
          )}
        </Link>
      </li>
    );
  };

  // Project → its form groups → forms (groups without forms are hidden).
  const projects = [...new Map((menu.data?.forms ?? []).map((f) => [f.project.id, f.project])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const renderProject = (p: MenuForm['project']) => {
    const id = `p:${p.id}`;
    const isOpen = open.has(id);
    const mine = (menu.data?.forms ?? []).filter((f) => f.project.id === p.id);
    const tops = (children.get(null) ?? []).filter((g) => (g.projectId === p.id || g.projectId === null) && has(g.id) && mine.some((f) => inGroup(f, g.id)));
    const loose = mine.filter((f) => !f.groupId || !(menu.data?.groups ?? []).some((g) => g.id === f.groupId));
    return (
      <li key={id}>
        <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className={cx(row, 'w-full gap-2 py-1.5 text-start', tone.hover)}>
          <FolderKanban className="size-[18px] shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <ChevronRight className={cx('size-3.5 shrink-0 transition-transform', tone.muted, isOpen && 'rotate-90')} />
        </button>
        {isOpen && (
          <ul>
            {tops.map((g) => renderGroup(g, 1))}
            {loose.map((f) => renderForm(f, 1))}
          </ul>
        )}
      </li>
    );
  };
  // Icon rail: the inbox and one link to the forms home (the tree needs the full menu).
  if (compact)
    return (
      <div className="mb-4">
        <Link to={`${base}/forms`} onClick={onNavigate} title="Forms" aria-label="Forms" className={cx(row, 'justify-center px-0', path === `${base}/forms` ? tone.active : tone.hover)}>
          <FolderKanban className="size-[18px] shrink-0" strokeWidth={1.75} />
        </Link>
      </div>
    );
  return (
    <div className="mb-4">
      <div className={cx('px-3 pb-1.5 font-mono text-[10px] tracking-[0.12em] uppercase', tone.muted)}>Forms</div>
      <ul>{projects.map(renderProject)}</ul>
    </div>
  );
}
