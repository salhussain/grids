import { useQuery } from '@tanstack/react-query';
import {
  approvalsOf,
  availabilityProblems,
  defaultAnswers,
  fillState,
  formState,
  validate,
} from '@grids/forms';
import {
  CURRENCIES,
  FORM_LAYOUTS,
  FORM_LAYOUT_INFO,
  formTexts,
  localizeForm,
  roleAtLeast,
  type ApproverRule,
  type FormDefinition,
  type FormLayout,
  type ProjectRole,
  type Question,
} from '@grids/schema';
import {
  Button,
  confirmDialog,
  cx,
  DateTimePicker,
  Dialog,
  Field,
  Input,
  Listbox,
  relTime,
  Switch,
  Textarea,
  useToast,
} from '@grids/ui';
import { LOCALES } from '@grids/i18n';
import {
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  CircleX,
  ClipboardList,
  Clock,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe,
  Mail,
  ImagePlus,
  Languages,
  ListChecks,
  Lock,
  MapPinned,
  Monitor,
  Palette,
  Plus,
  RotateCw,
  Rows2,
  Rows4,
  Search,
  ShieldCheck,
  Smartphone,
  Square,
  SquareRoundCorner,
  Tablet,
  Tag,
  Trash2,
  Type,
  Upload,
  User,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useWorkspace } from '../../session';
import { ChoiceCards, IconPicker } from './fields';
import { useProject } from './context';
import { Card } from './PanelCard';
import { WorkFromSubmissions } from './WorkFromForm';
import { PublicAccessFields } from './PublicAccess';
import { ToggleRow } from './FormQuestions';
import type { Draft } from './FormBuilder';
import { AttachmentImage, FormEnv, HeaderImage, shrink } from './FormInputs';
import { DEFAULT_MODELS, DEVICE_MODELS, DeviceFrame, modelById } from './DeviceFrame';
import { FormRunner, type Answers } from './FormRenderer';
import { usePermissionGroups } from './permissions';

// ---------------------------------------------------------------- layout & design

/** A tiny drawing of each layout. */
function LayoutArt({ layout }: { layout: FormLayout }) {
  const bar = 'bg-zinc-300';
  if (layout === 'single')
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden p-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1 bg-snow p-1 ring-1 ring-zinc-200">
            <div className={cx(bar, 'h-1 w-2/3')} />
            <div className="h-1.5 bg-zinc-100" />
          </div>
        ))}
      </div>
    );
  if (layout === 'steps')
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cx('h-1 flex-1', i === 0 ? 'bg-accent-500' : 'bg-zinc-300')} />
          ))}
        </div>
        <div className="flex-1 space-y-1.5 bg-snow p-2 ring-1 ring-zinc-200">
          <div className={cx(bar, 'h-1.5 w-1/2 bg-zinc-400')} />
          <div className="h-1.5 bg-zinc-100" />
          <div className="h-1.5 bg-zinc-100" />
        </div>
        <div className="ms-auto h-2.5 w-8 bg-accent-500" />
      </div>
    );
  return (
    <div className="flex h-full flex-col p-3">
      <div className="h-1 bg-zinc-200">
        <div className="h-1 w-2/5 bg-accent-500" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 px-2">
        <div className={cx(bar, 'h-2 w-4/5 bg-zinc-400')} />
        <div className="h-3 bg-snow ring-1 ring-zinc-200" />
      </div>
    </div>
  );
}

/** The picture behind the form's heading: chosen here, kept with the form's other pictures. */
function HeaderImageField({
  formKey,
  value,
  onChange,
}: {
  formKey: string;
  value: string | null;
  onChange(v: string | null): void;
}) {
  const { tenantId, project } = useProject();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('Use a PNG, JPEG or WebP picture');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(
        (await api.uploadAttachment(tenantId, project.key, formKey, await shrink(file), file.name))
          .id,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The picture could not be sent');
    } finally {
      setBusy(false);
    }
  };
  // Dropping a file anywhere on the field sets (or replaces) the picture.
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      void take(e.dataTransfer.files[0]);
    },
  };
  return (
    <div>
      <div className="mb-1 text-[13px] font-medium text-zinc-700">Header picture</div>
      <p className="mb-1.5 text-xs text-zinc-500">Behind the heading. A wide picture works best</p>
      {value ? (
        <div
          {...drop}
          className={cx(
            'relative h-32 overflow-hidden border bg-zinc-100',
            over ? 'border-accent-600 ring-2 ring-accent-600/30' : 'border-zinc-300',
          )}
        >
          <AttachmentImage
            tenantId={tenantId}
            project={project.key}
            id={value}
            className="size-full"
          />
          {over && (
            <div className="absolute inset-0 flex items-center justify-center bg-accent-600/70 text-sm font-medium text-white">
              Drop to replace
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-2">
            <Button
              size="sm"
              variant="secondary"
              icon={ImagePlus}
              loading={busy}
              onClick={() => input.current?.click()}
            >
              Replace
            </Button>
            <Button size="sm" variant="secondary" icon={Trash2} onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          {...drop}
          className={cx(
            'flex h-32 flex-col items-center justify-center gap-1.5 border border-dashed px-4 text-center transition-colors',
            over ? 'border-accent-600 bg-accent-50' : 'border-zinc-300 bg-zinc-50',
          )}
        >
          <ImagePlus
            className={cx('size-5', over ? 'text-accent-700' : 'text-zinc-400')}
            aria-hidden
          />
          <p className="text-[13px] text-zinc-600">
            {over ? 'Drop the picture' : 'Drop a wide picture here, or'}
          </p>
          {!over && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => input.current?.click()}
            >
              Choose a picture
            </Button>
          )}
          <p className="text-[11px] text-zinc-500">PNG, JPEG or WebP. Sits behind the heading</p>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ''))}
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

const ACCENTS = ['#0f62fe', '#6929c4', '#007d79', '#c2561f', '#a2191f', '#161616'];

export function DesignPanel({
  draft,
  set,
  formKey,
}: {
  draft: Draft;
  set(p: Partial<Draft>): void;
  formKey: string;
}) {
  const { tenantId, project } = useProject();
  const groups = useQuery({
    queryKey: ['form-groups', tenantId, project.key],
    queryFn: () => api.projectFormGroups(tenantId, project.key),
  });
  const def = draft.def;
  const setDef = (patch: Partial<FormDefinition>) => set({ def: { ...def, ...patch } });
  const look = def.look ?? {
    accent: null,
    density: 'roomy' as const,
    corners: 'square' as const,
    headerImage: null,
  };
  const flow = def.flow ?? { progress: true, back: true, review: false };
  const tree = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const g of (groups.data ?? []).filter((x) => x.parentId === parent)) {
        out.push({ id: g.id, name: g.name, depth });
        walk(g.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [groups.data]);
  const accent = look.accent ?? project.color;
  const paged = def.layout !== 'single';
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card
          title="Layout"
          description="How people move through the form. Sections become pages in steps."
          icon={ClipboardList}
        >
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Layout">
            {FORM_LAYOUTS.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={def.layout === l}
                onClick={() => setDef({ layout: l })}
                className={cx(
                  'flex flex-col overflow-hidden border text-start transition',
                  def.layout === l
                    ? 'border-accent-600 shadow-[inset_0_-2px_0_var(--brand-600)]'
                    : 'border-zinc-300 hover:border-zinc-500',
                )}
              >
                <div
                  className={cx(
                    'h-24 shrink-0 overflow-hidden',
                    def.layout === l ? 'bg-accent-50' : 'bg-zinc-100',
                  )}
                >
                  <LayoutArt layout={l} />
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {def.layout === l && <CheckCircle2 className="size-4 text-accent-600" />}
                    {FORM_LAYOUT_INFO[l].label}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{FORM_LAYOUT_INFO[l].description}</p>
                </div>
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
              Navigation
            </div>
            <div className="divide-y divide-zinc-100">
              <ToggleLine
                label="Show progress"
                description={paged ? 'A bar or steps along the top' : 'For steps and one-at-a-time'}
                checked={flow.progress}
                disabled={!paged}
                onChange={(progress) => setDef({ flow: { ...flow, progress } })}
              />
              <ToggleLine
                label="Allow going back"
                description={paged ? 'A Back button on every page' : 'For steps and one-at-a-time'}
                checked={flow.back}
                disabled={!paged}
                onChange={(back) => setDef({ flow: { ...flow, back } })}
              />
              <ToggleLine
                label="Review before sending"
                description="A final page listing every answer"
                checked={flow.review}
                onChange={(review) => setDef({ flow: { ...flow, review } })}
              />
            </div>
          </div>
        </Card>
        <Card
          title="Words"
          description="What people read before, around and after the questions."
          icon={Type}
        >
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            <Field label="Name" intro="Shown in menus and lists">
              <Input
                icon={Tag}
                placeholder="e.g. Weekly facility report"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="Heading" intro="Shown at the top of the form">
              <Input
                icon={Type}
                placeholder="e.g. Weekly report"
                value={def.title}
                onChange={(e) => setDef({ title: e.target.value })}
              />
            </Field>
            <Field
              label="Summary"
              intro="Shown on the form’s card in the Forms menu"
              className="md:col-span-2"
            >
              <Textarea
                placeholder="e.g. Cases, stock and staffing for the week"
                value={draft.description}
                maxLength={500}
                onChange={(e) => set({ description: e.target.value })}
                className="min-h-16"
              />
            </Field>
            <Field
              label="Introduction"
              intro="Who it is for and what to have ready"
              className="md:col-span-2"
            >
              <Textarea
                placeholder="e.g. Fill this in every Monday for the week before."
                value={def.description}
                onChange={(e) => setDef({ description: e.target.value })}
                className="min-h-20"
              />
            </Field>
            <Field label="Thank-you message" intro="Shown after sending" className="md:col-span-2">
              <Textarea
                value={def.thankYou}
                onChange={(e) => setDef({ thankYou: e.target.value })}
                className="min-h-20"
                placeholder="Thanks. Your report has been recorded."
              />
            </Field>
          </div>
        </Card>
        <Card title="Look" description="Starts with the project’s colour." icon={Palette}>
          <HeaderImageField
            formKey={formKey}
            value={look.headerImage ?? null}
            onChange={(headerImage) => setDef({ look: { ...look, headerImage } })}
          />
          <div>
            <div className="mb-1 text-[13px] font-medium text-zinc-700">Accent</div>
            <p className="mb-2 text-xs text-zinc-500">
              The heading band, buttons and progress.{' '}
              {!look.accent && 'Using the project’s colour.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Project colour"
                title="Project colour"
                aria-pressed={!look.accent}
                onClick={() => setDef({ look: { ...look, accent: null } })}
                className={cx(
                  'flex size-8 items-center justify-center border-2 border-snow',
                  !look.accent ? 'ring-2 ring-ink' : 'ring-1 ring-zinc-300',
                )}
                style={{ background: project.color }}
              >
                {!look.accent && <Check className="size-4 text-white" />}
              </button>
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  title={c}
                  aria-pressed={look.accent === c}
                  onClick={() => setDef({ look: { ...look, accent: c } })}
                  className={cx(
                    'flex size-8 items-center justify-center border-2 border-snow',
                    look.accent === c ? 'ring-2 ring-ink' : 'ring-1 ring-zinc-300',
                  )}
                  style={{ background: c }}
                >
                  {look.accent === c && <Check className="size-4 text-white" />}
                </button>
              ))}
              <label
                className="relative flex size-8 cursor-pointer items-center justify-center border border-dashed border-zinc-400 text-xs text-zinc-500"
                title="Any colour"
              >
                +
                <input
                  type="color"
                  aria-label="Pick a colour"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={accent}
                  onChange={(e) => setDef({ look: { ...look, accent: e.target.value } })}
                />
              </label>
            </div>
          </div>
          <ChoiceCards
            label="Density"
            intro="How much space there is between questions"
            value={look.density}
            onChange={(density) => setDef({ look: { ...look, density } })}
            options={{
              compact: {
                label: 'Compact',
                text: 'Tighter spacing. Fits more on screen, good for long forms and quick entry.',
                icon: Rows4,
              },
              roomy: {
                label: 'Roomy',
                text: 'More breathing space. Easier to read and to tap on a phone.',
                icon: Rows2,
              },
            }}
          />
          <ChoiceCards
            label="Corners"
            intro="How rounded the boxes, fields and buttons are"
            value={look.corners}
            onChange={(corners) => setDef({ look: { ...look, corners } })}
            options={{
              square: {
                label: 'Square',
                text: 'Sharp edges, matching the rest of Grids.',
                icon: Square,
              },
              soft: {
                label: 'Soft',
                text: 'Slightly rounded: friendly but still crisp.',
                icon: SquareRoundCorner,
              },
              round: {
                label: 'Round',
                text: 'Generous curves for a relaxed, app-like feel.',
                icon: Circle,
              },
            }}
          />
        </Card>
        <Card
          title="Menu and data"
          description="Where people find the form, and how its answers are recorded."
          icon={FolderOpen}
        >
          <div className="divide-y divide-zinc-100">
            <div className="grid items-start gap-x-8 gap-y-2 pb-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <div className="text-[13px] font-medium text-zinc-700">Icon in the menus</div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Shown beside the form in the sidebar and on its card. Appears once published
                </p>
              </div>
              <IconPicker
                hideLabel
                label="Icon in the menus"
                value={def.icon}
                emptyLabel="Default (clipboard)"
                onChange={(icon) => setDef({ icon })}
                onClear={() => setDef({ icon: undefined })}
              />
            </div>
            <div className="grid items-start gap-x-8 gap-y-2 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <div className="text-[13px] font-medium text-zinc-700">Group in the Forms menu</div>
                <p className="mt-0.5 text-xs text-zinc-500">The folder it sits in on the sidebar</p>
              </div>
              <div>
                <Listbox
                  label="Group in the Forms menu"
                  searchable={tree.length > 8}
                  value={draft.groupId ?? '__none'}
                  options={[
                    { value: '__none', label: 'Not in a group' },
                    ...tree.map((g) => ({
                      value: g.id,
                      label: `${'— '.repeat(g.depth)}${g.name}`,
                      icon: FolderOpen,
                    })),
                  ]}
                  onChange={(v) => set({ groupId: v === '__none' ? null : v })}
                />
              </div>
            </div>
            <div className="grid items-start gap-x-8 gap-y-2 pt-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <div className="text-[13px] font-medium text-zinc-700">Reporting period</div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Answers are dated to the start of this period
                </p>
              </div>
              <Listbox
                label="Reporting period"
                value={def.period}
                options={[
                  { value: 'none', label: 'Exact collection time' },
                  { value: 'day', label: 'Day' },
                  { value: 'week', label: 'Week (Monday)' },
                  { value: 'week_sun', label: 'Week (Sunday)' },
                  { value: 'month', label: 'Month' },
                  { value: 'year', label: 'Year' },
                ]}
                onChange={(period) => setDef({ period })}
              />
            </div>
          </div>
        </Card>
      </div>
      <aside className="space-y-5 xl:sticky xl:top-0">
        <Card
          title="Preview"
          description="A sketch that follows your settings."
          icon={Eye}
          action={
            <span className="bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-emerald-900">
              LIVE
            </span>
          }
        >
          <MiniPreview def={def} accent={accent} flow={flow} look={look} />
          <p className="text-xs text-zinc-500">
            Use Preview at the top to try the real form on a phone or tablet.
          </p>
        </Card>
        <Card title="Layout summary" description="The choices made on this page." icon={ListChecks}>
          <dl className="-my-2 divide-y divide-zinc-100 text-[13px]">
            {(
              [
                ['Layout', FORM_LAYOUT_INFO[def.layout].label],
                ['Progress', !paged ? 'Not used' : flow.progress ? 'Shown' : 'Hidden'],
                ['Going back', !paged ? 'Not used' : flow.back ? 'Allowed' : 'Not allowed'],
                ['Review page', flow.review ? 'On' : 'Off'],
                ['Density', look.density === 'compact' ? 'Compact' : 'Roomy'],
                ['Corners', { square: 'Square', soft: 'Soft', round: 'Round' }[look.corners]],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-2.5">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </aside>
    </div>
  );
}

/** A setting with its switch at the end of the row. */
function ToggleLine({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className={cx('flex items-center justify-between gap-4 py-3', disabled && 'opacity-60')}>
      <div className="min-w-0 text-sm leading-tight">
        <div className="font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{description}</div>
      </div>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const RADIUS = { square: '0', soft: '4px', round: '12px' } as const;

/** A small version of the form that follows the settings: layout, heading, picture, density and corners. */
function MiniPreview({
  def,
  accent,
  flow,
  look,
}: {
  def: FormDefinition;
  accent: string;
  flow: { progress: boolean; back: boolean; review: boolean };
  look: {
    density: 'compact' | 'roomy';
    corners: 'square' | 'soft' | 'round';
    headerImage: string | null;
  };
}) {
  const { tenantId, project } = useProject();
  const r = RADIUS[look.corners];
  const compact = look.density === 'compact';
  const questions = def.sections
    .flatMap((s) => s.questions)
    .filter((q) => q.type !== 'note' && q.type !== 'calculate');
  const label = (i: number) => questions[i]?.label || `Question ${i + 1}`;
  const pages = Math.max(1, def.sections.length);
  const focus = def.layout === 'focus';
  const paged = def.layout !== 'single';
  const lastLabel = flow.review ? 'Review' : 'Send';
  const field = (i: number, big?: boolean) => (
    <div key={i} className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className={cx('truncate font-medium text-zinc-700', big ? 'text-sm' : 'text-[11px]')}>
        {label(i)}
      </div>
      <div
        className={cx('border border-zinc-300 bg-snow', big ? 'h-9' : compact ? 'h-5' : 'h-7')}
        style={{ borderRadius: r }}
      />
    </div>
  );
  const button = (text: string, filled: boolean) => (
    <div
      className={cx(
        'px-3.5 text-center text-[11px]',
        compact ? 'h-6 leading-6' : 'h-7 leading-7',
        filled ? 'text-white' : 'border border-zinc-300 bg-snow',
      )}
      style={{ borderRadius: r, ...(filled ? { background: accent } : {}) }}
    >
      {text}
    </div>
  );
  return (
    <div className="overflow-hidden border border-zinc-200 bg-canvas" style={{ borderRadius: r }}>
      <div
        className="relative overflow-hidden px-4 text-white"
        style={{ background: accent, paddingBlock: compact ? '0.75rem' : '1.25rem' }}
      >
        {look.headerImage && (
          <HeaderImage tenantId={tenantId} project={project.key} id={look.headerImage} />
        )}
        <div className="relative">
          <div className="text-[9px] font-medium tracking-[0.1em] uppercase opacity-80">
            {project.name}
          </div>
          <div className="truncate text-sm font-semibold">{def.title || 'Untitled form'}</div>
        </div>
      </div>
      <div className={compact ? 'space-y-2 p-3' : 'space-y-3.5 p-4'}>
        {paged && flow.progress && (
          <div>
            <div className="flex gap-1">
              {focus ? (
                <div className="h-1 flex-1 bg-zinc-300">
                  <div className="h-1 w-1/3" style={{ background: accent }} />
                </div>
              ) : (
                Array.from({ length: Math.min(pages, 6) }, (_, i) => (
                  <div
                    key={i}
                    className="h-1 flex-1"
                    style={{ background: i === 0 ? accent : 'var(--color-zinc-300)' }}
                  />
                ))
              )}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              {focus ? `Question 1 of ${Math.max(1, questions.length)}` : `Step 1 of ${pages}`}
            </div>
          </div>
        )}
        {def.layout === 'single' && (
          <>
            {def.sections[0]?.title && (
              <div className="text-xs font-semibold">{def.sections[0].title}</div>
            )}
            {[0, 1, 2].map((i) => field(i))}
          </>
        )}
        {def.layout === 'steps' && (
          <>
            <div className="border-b border-zinc-200 pb-1.5 text-xs font-semibold">
              {def.sections[0]?.title || 'Step 1'}
            </div>
            {[0, 1].map((i) => field(i))}
          </>
        )}
        {focus && (
          <div className={cx('flex flex-col justify-center', compact ? 'min-h-24' : 'min-h-32')}>
            {field(0, true)}
          </div>
        )}
        <div className="flex items-center justify-between pt-0.5">
          {paged && flow.back ? button('Back', false) : <span />}
          {button(
            paged ? (flow.review && pages === 1 ? 'Review' : focus ? 'OK' : 'Next') : lastLabel,
            true,
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- preview

type Device = 'phone' | 'tablet' | 'desktop';

/** Which device the preview shows: the kind, the model of each kind, and its orientation. */
function useDevicePreview() {
  const [device, setDevice] = useState<Device>('phone');
  const [models, setModels] = useState<{ phone: string; tablet: string }>({ ...DEFAULT_MODELS });
  const [landscape, setLandscape] = useState(false);
  return {
    device,
    setDevice,
    landscape,
    model: device === 'desktop' ? null : modelById(models[device]),
    setModel: (id: string) => device !== 'desktop' && setModels((m) => ({ ...m, [device]: id })),
    rotate: () => setLandscape((l) => !l),
  };
}
type DevicePreview = ReturnType<typeof useDevicePreview>;

function DeviceControls({ p, compact }: { p: DevicePreview; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DeviceSwitch value={p.device} onChange={p.setDevice} compact={compact} />
      {p.model && (
        <>
          <Listbox
            compact
            label="Model"
            className={compact ? 'w-44' : 'w-56'}
            value={p.model.id}
            onChange={p.setModel}
            options={DEVICE_MODELS.filter((m) => m.kind === p.model!.kind).map((m) => ({
              value: m.id,
              label: m.name,
              icon: m.kind === 'phone' ? Smartphone : Tablet,
              description: `${m.w} × ${m.h}`,
            }))}
          />
          <button
            type="button"
            aria-label="Rotate"
            title="Rotate"
            aria-pressed={p.landscape}
            onClick={p.rotate}
            className={cx(
              'flex items-center justify-center border border-zinc-300 bg-snow text-zinc-600 hover:bg-zinc-50',
              compact ? 'size-7' : 'size-8',
              p.landscape && 'bg-accent-50 text-accent-800',
            )}
          >
            <RotateCw className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

function DeviceSwitch({
  value,
  onChange,
  compact,
}: {
  value: Device;
  onChange(d: Device): void;
  compact?: boolean;
}) {
  const items: [Device, LucideIcon, string][] = [
    ['phone', Smartphone, 'Phone'],
    ['tablet', Tablet, 'Tablet'],
    ['desktop', Monitor, 'Desktop'],
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Device"
      className="inline-flex border border-zinc-300 bg-snow"
    >
      {items.map(([d, I, label]) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          aria-label={label}
          title={label}
          onClick={() => onChange(d)}
          className={cx(
            'flex items-center gap-1.5 px-3',
            compact ? 'h-7 text-xs' : 'h-8 text-[13px]',
            value === d
              ? 'bg-accent-50 font-semibold text-accent-800 shadow-[inset_0_-2px_0_var(--brand-600)]'
              : 'text-zinc-600 hover:bg-zinc-50',
          )}
        >
          <I className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

/** What the form looks like on a device, working for real: nothing is saved. */
function PreviewFrame({
  def,
  preview,
  maxHeight,
  dir,
  answers: typed,
  setAnswers,
}: {
  def: FormDefinition;
  preview: DevicePreview;
  maxHeight: number;
  /** Reading direction of the form's language. */
  dir?: 'ltr' | 'rtl';
  answers: Answers;
  setAnswers(a: Answers): void;
}) {
  // The preview opens with the questions' default values, as the real form does.
  const answers = useMemo(() => ({ ...defaultAnswers(def), ...typed }), [def, typed]);
  const toast = useToast();
  const { tenantId, project } = useProject();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const accent = def.look?.accent ?? project.color;
  // Like the real page: on a tablet or desktop the form sits in a centred column (wider when questions go side by side).
  const phone = preview.model?.kind === 'phone';
  const sideBySide = def.sections.some(
    (sec) => (sec.columns ?? 1) > 1 || sec.questions.some((q) => q.width && q.width !== 'full'),
  );
  const column = phone ? '' : cx('mx-auto w-full', sideBySide ? 'max-w-4xl' : 'max-w-2xl');
  const gutter = phone ? 'px-4' : 'px-6';
  const body = (
    <div className="space-y-4">
      <div
        className={cx('relative overflow-hidden text-white', gutter, phone ? 'py-3.5' : 'py-5')}
        style={{ background: accent, minHeight: def.look?.headerImage ? '7rem' : undefined }}
      >
        {def.look?.headerImage && (
          <HeaderImage tenantId={tenantId} project={project.key} id={def.look.headerImage} />
        )}
        <div className={cx('relative', column)}>
          <div className="text-[10px] font-medium tracking-[0.1em] uppercase opacity-80">
            {project.name}
          </div>
          <h2 className="text-lg font-semibold tracking-tight">{def.title}</h2>
          {def.description && <p className="mt-0.5 text-sm opacity-90">{def.description}</p>}
        </div>
      </div>
      <div className={cx('pb-6', gutter)}>
        <div className={column}>
          <FormEnv.Provider
            value={{
              tenantId,
              project: project.key,
              formKey: 'preview',
              subjectId: null,
              answers: {},
              preview: true,
            }}
          >
            <FormRunner
              definition={def}
              answers={answers}
              onChange={setAnswers}
              errors={errors}
              onErrors={setErrors}
              onSubmit={() => {
                const r = validate(def, answers);
                setErrors(r.errors);
                toast(
                  r.ok
                    ? 'Preview: every answer is valid. Nothing was saved.'
                    : 'Preview: some answers need attention',
                );
              }}
              secondary={
                <Button variant="ghost" size="sm" onClick={() => (setAnswers({}), setErrors({}))}>
                  Reset
                </Button>
              }
            />
          </FormEnv.Provider>
        </div>
      </div>
    </div>
  );
  if (!preview.model)
    return (
      <div dir={dir} className="max-h-[68vh] overflow-y-auto border border-zinc-300 bg-canvas">
        {body}
      </div>
    );
  return (
    <DeviceFrame
      model={preview.model}
      landscape={preview.landscape}
      accent={accent}
      maxHeight={maxHeight}
      dir={dir}
    >
      {body}
    </DeviceFrame>
  );
}

const SAMPLE = (q: Question): unknown => {
  switch (q.type) {
    case 'text':
      return 'Sample answer';
    case 'textarea':
      return 'A few words of sample text.';
    case 'integer':
      return Math.round(
        q.min !== undefined && q.max !== undefined ? (q.min + q.max) / 2 : (q.min ?? 12),
      );
    case 'decimal':
      return q.min !== undefined && q.max !== undefined ? (q.min + q.max) / 2 : (q.min ?? 12.5);
    case 'select':
      return q.options?.[0]?.value;
    case 'multiselect':
      return q.options?.[0] ? [q.options[0].value] : [];
    case 'boolean':
      return true;
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'datetime':
      return new Date().toISOString().slice(0, 16);
    case 'time':
      return '09:30';
    case 'phone':
      return '+685 123 4567';
    case 'email':
      return 'name@example.org';
    case 'url':
      return 'https://example.org';
    case 'rating':
      return Math.min(4, q.max ?? 5);
    case 'geopoint':
      return { lat: 15.3, lon: -61.39 };
    default:
      return undefined;
  }
};

export function PreviewDialog({
  def,
  lang: initialLang,
  onClose,
}: {
  def: FormDefinition;
  lang?: string;
  onClose(): void;
}) {
  const ws = useWorkspace();
  const preview = useDevicePreview();
  const languages = LOCALES.filter(
    (l) => ws.localization.languages.includes(l.code) || l.code in def.translations,
  );
  const [lang, setLang] = useState(initialLang ?? ws.localization.defaultLanguage);
  const shown = useMemo(() => localizeForm(def, lang), [def, lang]);
  const [answers, setAnswers] = useState<Answers>({});
  const state = useMemo(() => formState(def, answers), [def, answers]);
  const questions = def.sections.flatMap((s) => s.questions);
  const rules = questions.filter((q) => q.relevant || q.constraint);
  const result = useMemo(() => validate(def, answers), [def, answers]);
  const fill = () =>
    setAnswers(
      Object.fromEntries(
        questions
          .filter((q) => q.type !== 'note' && q.type !== 'calculate')
          .map((q) => [q.key, SAMPLE(q)])
          .filter(([, v]) => v !== undefined),
      ),
    );
  const total = formTexts(def).length;
  return (
    <Dialog
      open
      wide="full"
      onClose={onClose}
      title="Preview"
      description="How people will see it. Nothing is saved."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DeviceControls p={preview} />
        {languages.length > 1 && (
          <Listbox
            compact
            label="Language"
            className="w-52"
            value={lang}
            onChange={setLang}
            options={languages.map((l) => ({
              value: l.code as string,
              label: l.nativeName,
              icon: Languages,
              description:
                l.code === ws.localization.defaultLanguage
                  ? 'Original'
                  : `${formTexts(def).filter(([k]) => def.translations[l.code]?.[k]?.trim()).length} of ${total} translated`,
            }))}
          />
        )}
        <span className="flex-1" />
        <Button variant="secondary" size="sm" icon={Zap} onClick={fill}>
          Fill with sample data
        </Button>
        <Button variant="secondary" size="sm" icon={X} onClick={() => setAnswers({})}>
          Reset
        </Button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="bg-zinc-100 p-4 sm:p-6">
          <PreviewFrame
            key={lang}
            def={shown}
            preview={preview}
            maxHeight={Math.max(420, window.innerHeight - 260)}
            dir={LOCALES.find((l) => l.code === lang)?.dir ?? 'ltr'}
            answers={answers}
            setAnswers={setAnswers}
          />
        </div>
        <aside className="space-y-4 text-sm">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
              Rules at work
            </div>
            {rules.length ? (
              <ul className="divide-y divide-zinc-100 border border-zinc-200">
                {rules.map((q) => {
                  const shownNow = state.relevant.has(q.key);
                  const err = result.errors[q.key];
                  return (
                    <li key={q.key} className="flex gap-2.5 px-3 py-2.5">
                      {q.relevant ? (
                        shownNow ? (
                          <Eye className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                        ) : (
                          <EyeOff className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                        )
                      ) : err ? (
                        <CircleX className="mt-0.5 size-4 shrink-0 text-red-700" />
                      ) : (
                        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                      )}
                      <div className="min-w-0">
                        <div>
                          <b className="font-medium">{q.label || q.key}</b>
                          {q.relevant && (
                            <span className="text-zinc-600">
                              {' '}
                              is {shownNow ? 'shown' : 'hidden'}
                            </span>
                          )}
                        </div>
                        {q.relevant && (
                          <div
                            className="truncate font-mono text-xs text-zinc-500"
                            title={q.relevant}
                          >
                            when {q.relevant}
                          </div>
                        )}
                        {q.constraint && err && <div className="text-xs text-red-700">{err}</div>}
                        {q.constraint && !err && (
                          <div
                            className="truncate font-mono text-xs text-zinc-500"
                            title={q.constraint}
                          >
                            accepts {q.constraint}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="border border-dashed border-zinc-300 px-3 py-3 text-zinc-500">
                This form has no show or accept rules yet.
              </p>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
              Answers so far
            </div>
            <pre
              className="max-h-56 overflow-auto bg-ink p-3 font-mono text-xs leading-relaxed text-zinc-200"
              dir="ltr"
            >
              {JSON.stringify(
                Object.fromEntries(
                  Object.entries(state.values).filter(
                    ([k, v]) => v !== undefined && v !== null && v !== '' && state.relevant.has(k),
                  ),
                ),
                null,
                1,
              )}
            </pre>
          </div>
          <p className="text-xs text-zinc-500">
            Sending in the preview checks every answer and shows the result, without saving.
          </p>
        </aside>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- access & workflow

/** Permission and every permission above it. */
const lineage = (id: string | null, groups: { id: string; parent: string | null }[]) => {
  const out = new Set<string>();
  for (
    let g = id ? groups.find((x) => x.id === id) : undefined;
    g && !out.has(g.id);
    g = g.parent ? groups.find((x) => x.id === g!.parent) : undefined
  )
    out.add(g.id);
  return out;
};

export function AccessPanel({
  draft,
  set,
  onTab,
  formKey,
  subjectType,
}: {
  draft: Draft;
  set(p: Partial<Draft>): void;
  onTab?(tab: 'workflow'): void;
  formKey: string;
  subjectType: { key: string; name: string } | null;
}) {
  const { tenantId, project } = useProject();
  const s = draft.settings;
  const groups = usePermissionGroups();
  const members = useQuery({
    queryKey: ['members', tenantId, project.key],
    queryFn: () => api.projectMembers(tenantId, project.key),
  });
  // The merchants this form can be set to pay (the organisation's, with GridPay).
  const merchants = useQuery({ queryKey: ['merchant-choices', tenantId], queryFn: () => api.merchantChoices(tenantId), retry: false });
  const setSettings = (patch: Partial<typeof s>) => set({ settings: { ...s, ...patch } });
  // Access for people outside the project belongs to the Public permission. Under any other, it is switched off, so a link
  // never keeps working out of sight.
  const publicPicked = groups.data?.find((g) => g.id === s.fillGroup)?.kind === 'public';
  useEffect(() => {
    if (groups.data && !publicPicked && (s.publicAccess.enabled || s.publicAccess.inviteOnly))
      set({
        settings: { ...s, publicAccess: { ...s.publicAccess, enabled: false, inviteOnly: false } },
      });
  }, [groups.data, publicPicked, s, set]);
  const stages = approvalsOf(s);
  const allowed = lineage(s.fillGroup, groups.data ?? []);
  const canFill = (m: { role: ProjectRole; permissionGroups: string[] }) =>
    m.role === 'manager' || !s.fillGroup || m.permissionGroups.some((g) => allowed.has(g));
  const roleName = (r: ApproverRule['role']) =>
    r === 'manager' ? 'Project managers' : r === 'viewer' ? 'Any project member' : null;
  // The same test the server makes: named people, or a role and/or a permission group (the group, or one above it).
  const approves = (m: { userId: string; role: ProjectRole; permissionGroups: string[] }) =>
    stages
      .filter((n) => {
        const r = n.approvers;
        if (m.role === 'manager' || r.users.includes(m.userId)) return true;
        if (!r.role && !r.group) return false;
        const inGroup =
          !r.group || m.permissionGroups.some((g) => lineage(r.group, groups.data ?? []).has(g));
        return (!r.role || roleAtLeast(m.role, r.role)) && inGroup;
      })
      .map((n) => n.name || 'Approval');
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name ?? '—';
  const a = s.availability;
  const l = s.limits;
  const setAvail = (patch: Partial<typeof a>) => {
    const next = { ...patch };
    // The first date picked brings the time zone of whoever is editing.
    if (
      (patch.opensAt || patch.closesAt) &&
      !a.opensAt &&
      !a.closesAt &&
      a.timezone === 'UTC' &&
      !patch.timezone
    )
      next.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setSettings({ availability: { ...a, ...next } });
  };
  const setLimits = (patch: Partial<typeof l>) => setSettings({ limits: { ...l, ...patch } });
  const zones = useMemo(() => {
    let all: string[] = [];
    try {
      all = Intl.supportedValuesOf('timeZone');
    } catch {
      /* older browsers: the zone in use is added below */
    }
    return [...new Set(['UTC', ...all, a.timezone])];
  }, [a.timezone]);
  const timing = availabilityProblems(s);
  const formsList = useQuery({
    queryKey: ['forms', tenantId, project.key],
    queryFn: () => api.forms(tenantId, project.key),
  });
  const thisForm = formsList.data?.find((f) => f.key === formKey);
  const total = thisForm?.submissionCount ?? 0;
  const now = fillState(s, new Date(), { total, mine: 0 });
  const when = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: a.timezone,
        }).format(d)
      : '';
  const count = (v: string) => (v === '' ? null : Math.max(1, Math.floor(Number(v)) || 1));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <Card
          title="Who can fill it in"
          description="Members with this permission, or one above it. Others won’t see the form in their menu."
          icon={Users}
        >
          <SettingRow label="Permission" intro="Takes effect as soon as you save">
            <Listbox
              label="Permission"
              searchable={(groups.data?.length ?? 0) > 8}
              value={s.fillGroup ?? '__any'}
              options={[
                { value: '__any', label: 'Any project member', icon: Users },
                ...(groups.data ?? []).map((g) => ({
                  value: g.id,
                  label: `${'— '.repeat(g.depth)}${g.name} and above`,
                  icon: Lock,
                })),
              ]}
              onChange={(v) => setSettings({ fillGroup: v === '__any' ? null : v })}
            />
          </SettingRow>
        </Card>
        {publicPicked && (
          <>
            <Card
              title="Publicly available"
              description="People outside the project fill this form in through a link, without an account"
              icon={Globe}
              action={
                <Switch
                  label="Publicly available"
                  checked={s.publicAccess.enabled}
                  onChange={(enabled) =>
                    setSettings({ publicAccess: { ...s.publicAccess, enabled } })
                  }
                />
              }
            >
              {s.publicAccess.enabled && (
                <PublicAccessFields
                  part="settings"
                  draft={draft}
                  setSettings={setSettings}
                  formKey={formKey}
                  subjectType={subjectType}
                />
              )}
            </Card>
            <Card
              title="By invitation only"
              description="Each person gets a link of their own, which works once. There is no open link"
              icon={Mail}
              action={
                <Switch
                  label="By invitation only"
                  checked={s.publicAccess.inviteOnly}
                  onChange={(inviteOnly) =>
                    setSettings({ publicAccess: { ...s.publicAccess, inviteOnly } })
                  }
                />
              }
            >
              {s.publicAccess.inviteOnly && (
                <PublicAccessFields
                  part="invites"
                  draft={draft}
                  setSettings={setSettings}
                  formKey={formKey}
                  subjectType={subjectType}
                />
              )}
            </Card>
          </>
        )}
        <Card
          title="Who can see the answers"
          description="Approvers and project managers always can."
          icon={Eye}
        >
          <ChoiceCards
            label="Who can see the answers"
            hideLabel
            value={s.seeAnswers}
            onChange={(seeAnswers) => setSettings({ seeAnswers })}
            options={{
              own: {
                label: 'Only their own',
                text: 'People read what they sent themselves.',
                icon: User,
              },
              scope: {
                label: 'Their part of the project',
                text: 'Everything for the places they work in.',
                icon: MapPinned,
              },
            }}
          />
        </Card>
        <WorkFromSubmissions draft={draft} setSettings={setSettings} />
        <Card
          title="Availability"
          description="When the form can be filled in. Leave a date empty for no limit."
          icon={CalendarClock}
        >
          <SettingRow label="Opens" intro="From this date and time">
            <DateTimePicker
              accent={project.color}
              id="avail-opensat"
              value={a.opensAt}
              onChange={(v) => setAvail({ opensAt: v || null })}
            />
          </SettingRow>
          <SettingRow label="Closes" intro="Until this date and time">
            <DateTimePicker
              accent={project.color}
              id="avail-closesat"
              value={a.closesAt}
              onChange={(v) => setAvail({ closesAt: v || null })}
            />
          </SettingRow>
          <SettingRow label="Time zone" intro="The zone these times are in">
            <Listbox
              label="Time zone"
              searchable
              value={a.timezone}
              options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' '), icon: Globe }))}
              onChange={(timezone) => setAvail({ timezone })}
            />
          </SettingRow>
          {timing.length > 0 && <p className="text-xs text-red-700">{timing.join('. ')}.</p>}
          <SettingRow label="Before it opens" intro="What people read if they arrive too early">
            <Textarea
              aria-label="Message before it opens"
              placeholder="e.g. This form opens on 1 March. Please come back then."
              value={a.beforeMessage}
              maxLength={500}
              onChange={(e) => setAvail({ beforeMessage: e.target.value })}
              className="min-h-16"
            />
          </SettingRow>
          <SettingRow label="After it closes" intro="What people read once the deadline has passed">
            <Textarea
              aria-label="Message after it closes"
              placeholder="e.g. Thank you. This form is now closed."
              value={a.afterMessage}
              maxLength={500}
              onChange={(e) => setAvail({ afterMessage: e.target.value })}
              className="min-h-16"
            />
          </SettingRow>
          <p className="text-xs text-zinc-500">
            Left blank, people see a standard sentence with the date and zone.
          </p>
        </Card>
        <Card
          title="Payment"
          description="A fee the person pays before the form is sent, through the payment provider your organisation has connected."
          icon={Banknote}
        >
          <SettingRow label="Ask for a payment" intro="Only people who have paid can send the form">
            <Switch
              label="Ask for a payment"
              checked={s.payment.enabled}
              onChange={(enabled) => setSettings({ payment: { ...s.payment, enabled } })}
            />
          </SettingRow>
          {s.payment.enabled && (
            <>
              <SettingRow label="Amount" intro="What each person pays">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="Amount"
                  value={s.payment.amount ? String(s.payment.amount / 100) : ''}
                  onChange={(e) =>
                    setSettings({ payment: { ...s.payment, amount: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) } })
                  }
                />
              </SettingRow>
              <SettingRow label="Currency" intro="Paid in this currency">
                <Listbox
                  label="Currency"
                  searchable
                  value={s.payment.currency}
                  options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  onChange={(currency) => setSettings({ payment: { ...s.payment, currency: currency as typeof s.payment.currency } })}
                />
              </SettingRow>
              <SettingRow label="Pay to" intro="The merchant that receives the money">
                <Listbox
                  label="Pay to"
                  value={s.payment.merchantId ?? ''}
                  options={[
                    { value: '', label: 'The first merchant that is on' },
                    ...(merchants.data ?? []).filter((m) => m.enabled).map((m) => ({ value: m.id, label: m.name })),
                  ]}
                  onChange={(merchantId) => setSettings({ payment: { ...s.payment, merchantId: merchantId || null } })}
                />
              </SettingRow>
              <SettingRow label="What it is for" intro="Shown to the person and on their receipt">
                <Input
                  aria-label="What the payment is for"
                  maxLength={200}
                  placeholder="e.g. Business licence application fee"
                  value={s.payment.description}
                  onChange={(e) => setSettings({ payment: { ...s.payment, description: e.target.value } })}
                />
              </SettingRow>
              <p className="text-xs text-zinc-500">
                Takes effect once the organisation has added a merchant (Settings › Payments); until then the form is sent without a fee. How people can pay (card, wallet and so on) is set on the merchant.
              </p>
            </>
          )}
        </Card>
        <Card
          title="Limits"
          description="How much can be sent. Leave empty for no limit."
          icon={Gauge}
        >
          <SettingRow
            label="Total submissions"
            intro="Everyone together. The form closes when it is reached"
          >
            <Input
              type="number"
              min={1}
              aria-label="Total submissions"
              placeholder="No limit"
              value={l.maxSubmissions ?? ''}
              onChange={(e) => setLimits({ maxSubmissions: count(e.target.value) })}
            />
          </SettingRow>
          <SettingRow label="Per person" intro="How many times one person can send it">
            <Input
              type="number"
              min={1}
              aria-label="Submissions per person"
              placeholder="No limit"
              value={l.perPerson ?? ''}
              onChange={(e) => setLimits({ perPerson: count(e.target.value) })}
            />
          </SettingRow>
          {(l.maxSubmissions !== null || l.perPerson !== null) && (
            <SettingRow
              label="When a limit is reached"
              intro="What people read instead of the form"
            >
              <Textarea
                aria-label="Message when a limit is reached"
                placeholder="e.g. We have all the answers we need. Thank you."
                value={l.fullMessage}
                maxLength={500}
                onChange={(e) => setLimits({ fullMessage: e.target.value })}
                className="min-h-16"
              />
            </SettingRow>
          )}
        </Card>
        <Card
          title="Who approves"
          description="By role or by name. Set up on the Workflow tab."
          icon={GitBranch}
          action={
            onTab && (
              <Button variant="secondary" size="sm" onClick={() => onTab('workflow')}>
                Open workflow
              </Button>
            )
          }
        >
          {s.workflow.enabled && stages.length ? (
            <ol className="space-y-4">
              {stages.map((n, i) => (
                <li key={n.id} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center bg-accent-600 text-xs font-semibold text-on-accent">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{n.name || 'Approval'}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      {roleName(n.approvers.role) && (
                        <span className="bg-zinc-100 px-2 py-1 font-medium text-zinc-700">
                          {roleName(n.approvers.role)}
                        </span>
                      )}
                      {n.approvers.users.map((u) => (
                        <span key={u} className="bg-zinc-100 px-2 py-1 font-medium text-zinc-700">
                          {members.data?.find((m) => m.userId === u)?.name ??
                            members.data?.find((m) => m.userId === u)?.email ??
                            'Someone'}
                        </span>
                      ))}
                      {n.allowReturn && <span className="text-zinc-500">can send back</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">
              {s.workflow.enabled
                ? 'The workflow has no approval step yet.'
                : 'No approval: answers are accepted as soon as they are sent.'}
            </p>
          )}
          <p className="text-xs text-zinc-500">
            Project managers can always review. Authors never approve their own submissions.
          </p>
        </Card>
      </div>
      <aside className="space-y-5 xl:sticky xl:top-0">
        <Card
          title="Right now"
          description="Whether people can fill it in at this moment."
          icon={Clock}
        >
          <div className="flex items-start gap-3">
            <span
              className={cx(
                'mt-1.5 size-2.5 shrink-0 rounded-full',
                now.state === 'open'
                  ? 'bg-emerald-500'
                  : now.state === 'not_yet'
                    ? 'bg-zinc-400'
                    : 'bg-red-500',
              )}
            />
            <div className="text-sm">
              <div className="font-semibold">
                {now.state === 'open'
                  ? 'Open'
                  : now.state === 'not_yet'
                    ? 'Not open yet'
                    : 'Closed'}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {now.state === 'not_yet'
                  ? `Opens ${when(now.opensAt)}.`
                  : now.state === 'closed'
                    ? `Closed ${when(now.closesAt)}.`
                    : now.closesAt
                      ? `Open until ${when(now.closesAt)}.`
                      : now.opensAt
                        ? `Open since ${when(now.opensAt)}.`
                        : 'Open all the time.'}
              </p>
            </div>
          </div>
          <dl className="-mx-5 -mb-5 divide-y divide-zinc-100 border-t border-zinc-100 text-[13px]">
            {(
              [
                ['Opens', a.opensAt ? when(now.opensAt) : 'Already open'],
                ['Closes', a.closesAt ? when(now.closesAt) : 'Never'],
                ['Time zone', a.timezone],
                [
                  'Sent so far',
                  l.maxSubmissions !== null
                    ? `${total.toLocaleString()} of ${l.maxSubmissions.toLocaleString()} (${Math.max(0, l.maxSubmissions - total).toLocaleString()} left)`
                    : total.toLocaleString(),
                ],
                ['Per person', l.perPerson !== null ? `${l.perPerson} at most` : 'No limit'],
                [
                  'Last sent',
                  thisForm?.lastSubmissionAt ? relTime(thisForm.lastSubmissionAt) : 'Nothing yet',
                ],
                [
                  'Who can fill it in',
                  s.fillGroup ? `${groupName(s.fillGroup)} and above` : 'Any project member',
                ],
                [
                  'Link for people without an account',
                  s.publicAccess.inviteOnly
                    ? 'By invitation only'
                    : s.publicAccess.enabled
                      ? 'On'
                      : 'Off',
                ],
                [
                  'Approval',
                  stages.length
                    ? `${stages.length} ${stages.length === 1 ? 'stage' : 'stages'}: ${stages.map((n) => n.name || 'Approval').join(', ')}`
                    : 'None',
                ],
                [
                  'Published',
                  thisForm?.currentVersion ? `Version ${thisForm.currentVersion}` : 'Not yet',
                ],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-5 py-2"
              >
                <dt className="text-zinc-500">{k}</dt>
                <dd className="min-w-0 break-words font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card
          title="What each person can do"
          description="Check the result of the rules."
          icon={ShieldCheck}
        >
          {members.data?.length ? (
            <div className="-mx-5 -mb-5 divide-y divide-zinc-100 border-t border-zinc-100">
              <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_2.5rem_minmax(0,1fr)] gap-3 bg-zinc-50 px-5 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <span>Person</span>
                <span>Permission</span>
                <span>Fill</span>
                <span>Approve</span>
              </div>
              {members.data.map((m) => {
                const ap = approves(m);
                return (
                  <div
                    key={m.userId}
                    className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-3 px-5 py-2.5 text-[13px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name ?? m.email}</div>
                      <div className="truncate text-xs text-zinc-500">
                        {m.role === 'manager' ? 'Project manager' : m.email}
                      </div>
                    </div>
                    <div className="min-w-0 break-words text-zinc-600">
                      {m.role === 'manager'
                        ? 'Admin'
                        : m.permissionGroups.map(groupName).join(', ') || 'None'}
                    </div>
                    <span>
                      {canFill(m) ? (
                        <Check className="size-4 text-emerald-700" aria-label="Can fill" />
                      ) : (
                        <span className="text-zinc-300" aria-label="Cannot fill">
                          —
                        </span>
                      )}
                    </span>
                    <span
                      className="min-w-0 break-words text-xs text-accent-800"
                      title={ap.join(', ')}
                    >
                      {ap.length ? (
                        m.role === 'manager' ? (
                          'Always'
                        ) : (
                          ap.join(', ')
                        )
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No members yet.</p>
          )}
        </Card>
      </aside>
    </div>
  );
}

/** A setting: its name and a line about it on the left, the control on the right. */
function SettingRow({
  label,
  intro,
  children,
}: {
  label: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-x-8 gap-y-2 border-t border-zinc-100 pt-5 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div>
        <div className="text-[13px] font-medium text-zinc-700">{label}</div>
        <p className="mt-0.5 text-xs text-zinc-500">{intro}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Picks who may approve: a role, or named people. Project managers can always act. */
export function ApproverFields({
  value: a,
  onChange,
}: {
  value: ApproverRule;
  onChange(v: ApproverRule): void;
}) {
  const { tenantId, project } = useProject();
  const members = useQuery({
    queryKey: ['members', tenantId, project.key],
    queryFn: () => api.projectMembers(tenantId, project.key),
  });
  const setA = (patch: Partial<ApproverRule>) => onChange({ ...a, ...patch });
  const nobody = !a.role && !a.users.length;
  const name = (id: string) =>
    members.data?.find((m) => m.userId === id)?.name ??
    members.data?.find((m) => m.userId === id)?.email ??
    'Unknown';
  return (
    <div className="space-y-4">
      <Field label="Role" intro="Everyone with this role in the project can approve">
        <Listbox
          label="Role"
          value={a.role ?? '__none'}
          options={[
            { value: 'manager', label: 'Project managers', icon: ShieldCheck },
            { value: 'viewer', label: 'Any project member', icon: Users },
            { value: '__none', label: 'Only the people named below', icon: Lock },
          ]}
          onChange={(v) => setA({ role: v === '__none' ? null : (v as ProjectRole), group: null })}
        />
      </Field>
      <Field label="…or these people" intro="Named people can approve whatever their role">
        <div className="space-y-2">
          {a.users.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {a.users.map((u) => (
                <span
                  key={u}
                  className="inline-flex items-center gap-1 bg-accent-50 py-0.5 ps-2.5 pe-1 text-xs text-accent-800 ring-1 ring-accent-100"
                >
                  {name(u)}
                  <button
                    type="button"
                    aria-label={`Remove ${name(u)}`}
                    onClick={() => setA({ users: a.users.filter((x) => x !== u) })}
                    className="p-0.5 hover:bg-accent-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Listbox
            label="Add a person"
            value={null}
            placeholder="Add a person…"
            searchable
            onChange={(id) => setA({ users: [...a.users, id] })}
            options={(members.data ?? [])
              .filter((m) => !a.users.includes(m.userId))
              .map((m) => ({
                value: m.userId,
                label: m.name ?? m.email ?? 'Unnamed',
                description: m.email ?? undefined,
                text: `${m.name ?? ''} ${m.email ?? ''}`,
              }))}
          />
        </div>
      </Field>
      {nobody && <p className="text-xs text-red-700">Choose a role or name at least one person.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- translations

/** Rows of a CSV file, handling quoted fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((cell += '"'), i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((x) => x.trim()));
}
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Translations of the form's texts into the organisation's other languages. People
 * fill the form in their own language; anything not translated shows the original.
 */
export function TranslationsPanel({ draft, set }: { draft: Draft; set(p: Partial<Draft>): void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const def = draft.def;
  // The organisation's languages, plus any this form has added for itself.
  const others = LOCALES.filter(
    (l) =>
      l.code !== ws.localization.defaultLanguage &&
      (ws.localization.languages.includes(l.code) || l.code in def.translations),
  );
  const [picked, setLang] = useState<string>(others[0]?.code ?? '');
  const lang = others.some((l) => l.code === picked) ? picked : (others[0]?.code ?? '');
  const addable = LOCALES.filter(
    (l) => l.code !== ws.localization.defaultLanguage && !others.some((o) => o.code === l.code),
  );
  const addLanguage = (code: string) => {
    set({
      def: { ...def, translations: { ...def.translations, [code]: def.translations[code] ?? {} } },
    });
    setLang(code);
  };
  const removeLanguage = async (code: string, name: string) => {
    const n = texts.filter(([k]) => def.translations[code]?.[k]?.trim()).length;
    if (
      n &&
      !(await confirmDialog(
        `Remove ${name} from this form? Its ${n} translated texts will be deleted.`,
      ))
    )
      return;
    const next = { ...def.translations };
    delete next[code];
    set({ def: { ...def, translations: next } });
  };
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('todo');
  const [q, setQ] = useState('');
  // Texts being typed stay in the To do list until saved, so they do not vanish after one letter.
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => setPinned(new Set()), [lang]);
  const [preview, setPreview] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const texts = formTexts(def);
  const tr = def.translations[lang] ?? {};
  const source =
    LOCALES.find((l) => l.code === ws.localization.defaultLanguage)?.nativeName ?? 'Original';
  const target = LOCALES.find((l) => l.code === lang)?.nativeName ?? lang;
  const targetDir = LOCALES.find((l) => l.code === lang)?.dir ?? 'ltr';
  const doneIn = (code: string) =>
    texts.filter(([k]) => def.translations[code]?.[k]?.trim()).length;
  const done = doneIn(lang);
  const setText = (key: string, value: string) => {
    const next = { ...tr, [key]: value };
    if (!value) delete next[key];
    if (!pinned.has(key) && !tr[key]?.trim()) setPinned(new Set(pinned).add(key));
    set({ def: { ...def, translations: { ...def.translations, [lang]: next } } });
  };
  // Which section each text belongs to, for grouping.
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of def.sections) {
      m.set(`section.${s.key}`, s.title || s.key);
      for (const qn of s.questions)
        for (const [k] of texts) if (k.startsWith(`${qn.key}.`)) m.set(k, s.title || s.key);
    }
    return m;
  }, [def, texts]);
  const rows = texts.filter(([k, text]) => {
    const has = !!tr[k]?.trim();
    if (filter === 'todo' && has && !pinned.has(k)) return false;
    if (filter === 'done' && !has) return false;
    const needle = q.trim().toLowerCase();
    return !needle || `${text} ${tr[k] ?? ''} ${k}`.toLowerCase().includes(needle);
  });
  const exportCsv = () => {
    const lines = [
      ['key', 'source', lang].map(csvCell).join(','),
      ...texts.map(([k, text]) => [k, text, tr[k] ?? ''].map(csvCell).join(',')),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }),
    );
    a.download = `${draft.name || 'form'}-${lang}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importCsv = async (f: File) => {
    const rows = parseCsv((await f.text()).replace(/^﻿/, ''));
    const head = rows[0]?.map((x) => x.trim().toLowerCase()) ?? [];
    const col = head.indexOf(lang) >= 0 ? head.indexOf(lang) : 2;
    const known = new Set(texts.map(([k]) => k));
    const next = { ...tr };
    let n = 0;
    for (const r of rows.slice(1)) {
      const key = r[0]?.trim();
      const value = r[col]?.trim();
      if (key && known.has(key) && value) ((next[key] = value), n++);
    }
    set({ def: { ...def, translations: { ...def.translations, [lang]: next } } });
    toast(n ? `${n} translated texts imported` : 'No translations found in that file');
  };
  let lastGroup = '';
  return (
    <div className="grid h-full min-h-[28rem] gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className="min-h-0 space-y-2 overflow-y-auto">
        <div className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
          Languages
        </div>
        <div className="border border-zinc-200 bg-zinc-50 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <b className="font-semibold">{source}</b>
            <span className="text-xs text-zinc-500">original</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">{texts.length} texts to translate</div>
        </div>
        {others.map((l) => {
          const n = doneIn(l.code);
          const pct = texts.length ? Math.round((n / texts.length) * 100) : 0;
          const on = l.code === lang;
          const own = !ws.localization.languages.includes(l.code);
          return (
            <div key={l.code} className="relative">
              <button
                type="button"
                onClick={() => setLang(l.code)}
                aria-pressed={on}
                className={cx(
                  'block w-full border px-3.5 py-3 text-start',
                  on
                    ? 'border-accent-600 bg-accent-50/50 shadow-[inset_3px_0_0_var(--brand-600)]'
                    : 'border-zinc-200 bg-snow hover:border-zinc-400',
                )}
              >
                <div className="flex items-center gap-2">
                  <b className="font-semibold">{l.nativeName}</b>
                  <span className="text-xs text-zinc-500">{l.name}</span>
                  <b className="ms-auto text-sm font-medium">{pct}%</b>
                </div>
                <div className="mt-2 h-1.5 bg-zinc-200">
                  <div
                    className={cx('h-full', pct === 100 ? 'bg-emerald-600' : 'bg-accent-600')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                  {texts.length - n ? `${texts.length - n} missing` : 'Complete'}
                  {own && (
                    <span className="bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
                      This form only
                    </span>
                  )}
                </div>
              </button>
              {own && (
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  title={`Remove ${l.name} from this form`}
                  onClick={() => void removeLanguage(l.code, l.name)}
                  className="absolute end-2 bottom-2 p-1 text-zinc-400 hover:text-red-700"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {addable.length > 0 && (
          <Listbox
            label="Add a language"
            value={null}
            align="start"
            searchable
            trigger={{
              className:
                'flex w-full items-center justify-center gap-2 border border-dashed border-zinc-400 bg-snow px-3.5 py-3 text-sm font-medium text-zinc-700 hover:border-zinc-600 hover:bg-zinc-50',
              children: (
                <>
                  <Plus className="size-4" /> Add a language
                </>
              ),
            }}
            options={addable.map((l) => ({
              value: l.code,
              label: l.nativeName,
              description: l.name,
              icon: Languages,
            }))}
            onChange={addLanguage}
          />
        )}
      </div>
      {!lang ? (
        <div className="flex min-h-0 flex-col items-center justify-center gap-2 border border-dashed border-zinc-300 bg-snow p-10 text-center">
          <Languages className="size-8 text-zinc-400" aria-hidden />
          <p className="text-sm font-medium">No language to translate into yet</p>
          <p className="max-w-sm text-xs text-zinc-500">
            Add a language to translate this form. It works even if your organisation has not
            switched that language on.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-col border border-zinc-200 bg-snow">
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-3.5">
            <div className="w-64">
              <Input
                icon={Search}
                aria-label="Search texts"
                placeholder="Search texts"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div
              role="radiogroup"
              aria-label="Show"
              className="inline-flex border border-zinc-300 text-[13px]"
            >
              {(
                [
                  ['all', `All ${texts.length}`],
                  ['todo', `To do ${texts.length - done}`],
                  ['done', `Done ${done}`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={filter === id}
                  onClick={() => setFilter(id)}
                  className={cx(
                    'px-3 py-1.5',
                    filter === id
                      ? 'bg-accent-50 font-semibold text-accent-800 shadow-[inset_0_-2px_0_var(--brand-600)]'
                      : 'text-zinc-600 hover:bg-zinc-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={Download}
                title="Export every text to a CSV file to send to a translator"
                onClick={exportCsv}
              >
                Export
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={Upload}
                title="Import a translated CSV file"
                onClick={() => file.current?.click()}
              >
                Import
              </Button>
              <input
                ref={file}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => (
                  e.target.files?.[0] && void importCsv(e.target.files[0]),
                  (e.target.value = '')
                )}
              />
              <Button variant="secondary" size="sm" icon={Eye} onClick={() => setPreview(true)}>
                Preview in {target}
              </Button>
            </div>
          </div>
          {preview && <PreviewDialog def={def} lang={lang} onClose={() => setPreview(false)} />}
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5rem] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
            <span>{source}</span>
            <span>{target}</span>
            <span className="text-center">Status</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!rows.length && (
              <p className="px-4 py-10 text-center text-sm text-zinc-500">
                {filter === 'todo' ? 'Everything is translated.' : 'Nothing matches.'}
              </p>
            )}
            {rows.map(([key, text]) => {
              const g =
                key === 'title' || key === 'description' || key === 'thankYou'
                  ? 'Form texts'
                  : (groupOf.get(key) ?? '');
              const head = g !== lastGroup ? g : '';
              lastGroup = g;
              const has = !!tr[key]?.trim();
              return (
                <div key={key}>
                  {head && (
                    <div className="border-b border-zinc-200 bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-600">
                      {head}
                    </div>
                  )}
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5rem] items-start gap-4 border-b border-zinc-100 px-4 py-3">
                    <div className="text-[13px] text-zinc-700">
                      {text}
                      <div className="mt-0.5 font-mono text-[11px] text-zinc-400" dir="ltr">
                        {key}
                      </div>
                    </div>
                    {text.length > 70 ? (
                      <Textarea
                        aria-label={`${key} in ${target}`}
                        lang={lang}
                        dir={targetDir}
                        value={tr[key] ?? ''}
                        placeholder={text}
                        onChange={(e) => setText(key, e.target.value)}
                        className="min-h-16"
                      />
                    ) : (
                      <Input
                        aria-label={`${key} in ${target}`}
                        lang={lang}
                        dir={targetDir}
                        value={tr[key] ?? ''}
                        placeholder={text}
                        onChange={(e) => setText(key, e.target.value)}
                      />
                    )}
                    {pinned.has(key) && has ? (
                      <Button
                        size="sm"
                        icon={Check}
                        onClick={() => {
                          const next = new Set(pinned);
                          next.delete(key);
                          setPinned(next);
                        }}
                      >
                        Save
                      </Button>
                    ) : (
                      <span
                        className={cx(
                          'mt-1.5 inline-flex h-[22px] items-center justify-self-center px-2 text-xs font-medium',
                          has ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-800',
                        )}
                      >
                        {has ? 'Done' : 'Missing'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
