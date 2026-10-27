import { useQuery } from '@tanstack/react-query';
import type { EntityQuery, Question } from '@grids/schema';
import { Button, Dialog, Input, Listbox, cx } from '@grids/ui';
import { Camera, Download, ImagePlus, Loader2, MapPin, Paperclip, QrCode, ScanLine, Trash2, Upload, X } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { iconOf } from './context';

/** Where a form is being filled in: what the questions that reach out to the project need to know. */
export interface FormEnvValue {
  tenantId: string;
  project: string;
  formKey: string;
  /** The entity the whole form is about, when it has been chosen. */
  subjectId: string | null;
  /** Every answer so far, calculations included. */
  answers: Record<string, unknown>;
  /** Nothing is stored: pictures stay on this device. */
  preview?: boolean;
  /** Someone without an account filling in through a link: files and places come through the link's own endpoints. */
  publicPath?: string;
}

/** Stores a file for the form being filled in: through the link when there is one, else as the signed-in person. */
const uploadFor = (env: FormEnvValue, blob: Blob, name: string) =>
  env.publicPath ? api.publicUploadAttachment(env.publicPath, blob, name) : api.uploadAttachment(env.tenantId, env.project, env.formKey, blob, name);
export const FormEnv = createContext<FormEnvValue | null>(null);
export const useFormEnv = () => useContext(FormEnv);

// ------------------------------------------------------------------ pictures

/** Pictures chosen in a preview, by the made-up id the answer holds. */
const previewPictures = new Map<string, string>();

/** A stored picture. The API needs the sign-in token, so it is fetched and shown from memory. */
export function AttachmentImage({ tenantId, project, id, className, alt = '', style }: { tenantId: string; project: string; id: string; className?: string; alt?: string; style?: React.CSSProperties }) {
  const local = previewPictures.get(id);
  const publicPath = useFormEnv()?.publicPath;
  const pic = useQuery({
    queryKey: ['attachment', publicPath ?? `${tenantId}/${project}`, id],
    queryFn: async () => URL.createObjectURL(publicPath ? await api.publicAttachment(publicPath, id) : await api.attachment(tenantId, project, id)),
    enabled: !local,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
  const src = local ?? pic.data;
  if (!src) return <div className={cx('flex items-center justify-center bg-zinc-100 text-zinc-400', className)}>{pic.isError ? <X className="size-5" /> : <Loader2 className="size-5 animate-spin" />}</div>;
  return <img src={src} alt={alt} className={cx('object-cover', className)} style={style} />;
}

/** A picture across the top of a block, dimmed so the words on it can be read. */
export function HeaderImage({ tenantId, project, id }: { tenantId: string; project: string; id: string }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <AttachmentImage tenantId={tenantId} project={project} id={id} className="size-full" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
    </div>
  );
}

/** Shrinks a camera picture before it is sent: 1600 px on the long side is plenty for a record. */
export async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))) ?? file;
}

export function ImageInput({ q, value, onChange, invalid }: { q: Question; value: unknown; onChange(v: unknown): void; invalid?: boolean }) {
  const env = useFormEnv();
  const camera = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const many = !!q.multiple;
  const max = q.maxItems ?? 10;
  const ids = Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : [];
  const set = (next: string[]) => onChange(many ? (next.length ? next : null) : (next[0] ?? null));
  const take = async (files: FileList | File[] | undefined) => {
    const list = [...(files ?? [])].slice(0, many ? Math.max(0, max - ids.length) : 1);
    if (!list.length || !env) return;
    setBusy(true);
    setError(null);
    try {
      const added: string[] = [];
      for (const file of list) {
        const blob = await shrink(file);
        if (env.preview) {
          const fake = crypto.randomUUID();
          previewPictures.set(fake, URL.createObjectURL(blob));
          added.push(fake);
        } else added.push((await uploadFor(env, blob, file.name)).id);
      }
      set(many ? [...ids, ...added] : added);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The picture could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const full = many && ids.length >= max;
  return (
    <div className="space-y-2" aria-invalid={invalid}>
      {ids.length > 0 && env && (
        <div className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <div key={id} className="relative">
              <AttachmentImage tenantId={env.tenantId} project={env.project} id={id} alt={q.label} className={many ? 'size-24 border border-zinc-200' : 'h-44 w-full max-w-xs border border-zinc-200'} />
              {many && (
                <button type="button" aria-label="Remove this picture" onClick={() => set(ids.filter((x) => x !== id))} className="absolute end-1 top-1 flex size-6 items-center justify-center bg-black/60 text-white hover:bg-black/80">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant={ids.length ? 'secondary' : 'primary'} size="sm" icon={Camera} loading={busy} disabled={full} onClick={() => camera.current?.click()}>
          {ids.length ? (many ? 'Take another' : 'Take another') : 'Take a photo'}
        </Button>
        <Button variant="secondary" size="sm" icon={ImagePlus} disabled={busy || full} onClick={() => pick.current?.click()}>
          {many ? 'Choose pictures' : 'Choose a picture'}
        </Button>
        {!many && ids.length > 0 && (
          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => set([])}>
            Remove
          </Button>
        )}
        {many && <span className="self-center text-xs text-zinc-500">{`${ids.length} of ${max}`}</span>}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void take(e.target.files ?? undefined), (e.target.value = ''))} />
      <input ref={pick} type="file" accept="image/*" multiple={many} hidden onChange={(e) => (void take(e.target.files ?? undefined), (e.target.value = ''))} />
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A stored document, fetched with the sign-in token and handed to the browser to save or open. */
export function AttachmentLink({ tenantId, project, id, label = 'Download the file' }: { tenantId: string; project: string; id: string; label?: string }) {
  const publicPath = useFormEnv()?.publicPath;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const url = URL.createObjectURL(publicPath ? await api.publicAttachment(publicPath, id) : await api.attachment(tenantId, project, id));
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={() => void open()} disabled={busy} className="inline-flex items-center gap-1.5 text-accent-700 hover:underline disabled:opacity-60">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} {failed ? 'Could not load: try again' : label}
    </button>
  );
}

const FILE_TYPES: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain' };

/** Documents chosen from the device and stored with the submission (one, or several when the question allows). */
export function FileInput({ q, value, onChange, invalid }: { q: Question; value: unknown; onChange(v: unknown): void; invalid?: boolean }) {
  const env = useFormEnv();
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const many = !!q.multiple;
  const max = q.maxItems ?? 10;
  const ids = Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : [];
  const set = (next: string[]) => onChange(many ? (next.length ? next : null) : (next[0] ?? null));
  const take = async (files: FileList | undefined) => {
    const list = [...(files ?? [])].slice(0, many ? Math.max(0, max - ids.length) : 1);
    if (!list.length || !env) return;
    if (list.some((f) => f.size > 10 * 1024 * 1024)) return setError('A file is larger than 10 MB');
    setBusy(true);
    setError(null);
    try {
      const added: string[] = [];
      const label: Record<string, string> = {};
      for (const file of list) {
        const type = file.type || FILE_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
        const id = env.preview ? crypto.randomUUID() : (await uploadFor(env, new Blob([file], { type }), file.name)).id;
        added.push(id);
        label[id] = file.name;
      }
      setNames((n) => ({ ...n, ...label }));
      set(many ? [...ids, ...added] : added);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const full = many && ids.length >= max;
  return (
    <div className="space-y-2" aria-invalid={invalid}>
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-2 border border-zinc-200 px-3 py-2 text-sm">
          <Paperclip className="size-4 shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate">{names[id] ?? 'File attached'}</span>
          {env && !env.preview && !names[id] && <AttachmentLink tenantId={env.tenantId} project={env.project} id={id} label="Open" />}
          <button type="button" aria-label="Remove this file" onClick={() => set(ids.filter((x) => x !== id))} className="p-1 text-zinc-500 hover:text-red-700">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={ids.length ? 'secondary' : 'primary'} size="sm" icon={Upload} loading={busy} disabled={full} onClick={() => pick.current?.click()}>
          {ids.length ? (many ? 'Add more files' : 'Choose another file') : many ? 'Choose files' : 'Choose a file'}
        </Button>
        {many && <span className="text-xs text-zinc-500">{`${ids.length} of ${max}`}</span>}
      </div>
      <input ref={pick} type="file" multiple={many} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt" hidden onChange={(e) => (void take(e.target.files ?? undefined), (e.target.value = ''))} />
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A signature drawn with a finger, stylus or mouse, stored as a picture. */
export function SignatureInput({ q, value, onChange, invalid }: { q: Question; value: unknown; onChange(v: unknown): void; invalid?: boolean }) {
  const env = useFormEnv();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = typeof value === 'string' ? value : null;
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d')!;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = at(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    setInked(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const { x, y } = at(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setInked(false);
  };
  const save = async () => {
    const c = canvas.current;
    if (!c || !env) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('The signature could not be saved');
      if (env.preview) {
        const fake = crypto.randomUUID();
        previewPictures.set(fake, URL.createObjectURL(blob));
        onChange(fake);
      } else onChange((await uploadFor(env, blob, 'signature.png')).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The signature could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  if (id && env)
    return (
      <div className="space-y-2" aria-invalid={invalid}>
        <AttachmentImage tenantId={env.tenantId} project={env.project} id={id} alt={q.label} className="h-32 w-full max-w-sm border border-zinc-200 bg-white !object-contain" />
        <Button variant="secondary" size="sm" onClick={() => (onChange(null), setInked(false))}>
          Sign again
        </Button>
      </div>
    );
  return (
    <div className="space-y-2" aria-invalid={invalid}>
      <canvas
        ref={canvas}
        width={800}
        height={260}
        aria-label={`Signature: ${q.label}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
        className="h-32 w-full max-w-sm touch-none cursor-crosshair border border-zinc-300 bg-white"
      />
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={!inked} onClick={() => void save()}>
          Use this signature
        </Button>
        <Button variant="ghost" size="sm" disabled={!inked} onClick={clear}>
          Clear
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ codes

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
const detectorClass = () => (globalThis as unknown as { BarcodeDetector?: new (o?: { formats?: string[] }) => Detector }).BarcodeDetector;

/** The camera, looking for a QR code or barcode. */
function ScanDialog({ onCode, onClose }: { onCode(code: string): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const Detector = detectorClass();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setProblem('Scanning is not available in this browser. Type the code instead.');
      return;
    }
    let stream: MediaStream | undefined;
    let stop = false;
    const detector = new Detector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'data_matrix'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const look = async () => {
          if (stop || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) {
            onCode(found[0].rawValue);
            return;
          }
          setTimeout(look, 250);
        };
        void look();
      } catch {
        setProblem('The camera could not be opened. Allow camera access, or type the code instead.');
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <Dialog open onClose={onClose} title="Scan a code" description="Hold the code in front of the camera.">
      {problem ? (
        <p className="py-6 text-center text-sm text-zinc-600">{problem}</p>
      ) : (
        <div className="relative overflow-hidden bg-black">
          <video ref={video} muted playsInline className="aspect-square w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 border-2 border-white/80" />
        </div>
      )}
    </Dialog>
  );
}

export function QrInput({ id, value, onChange, invalid, described, placeholder }: { id: string; value: unknown; onChange(v: unknown): void; invalid?: boolean; described?: string; placeholder?: string }) {
  const [scanning, setScanning] = useState(false);
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <Input id={id} icon={QrCode} aria-invalid={invalid} aria-describedby={described} placeholder={placeholder || 'Scan or type the code'} className="font-mono" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />
      </div>
      <Button variant="secondary" icon={ScanLine} onClick={() => setScanning(true)}>
        Scan
      </Button>
      {scanning && (
        <ScanDialog
          onClose={() => setScanning(false)}
          onCode={(code) => {
            onChange(code);
            setScanning(false);
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ places

/** What the question limits its places to, as the entities query understands it. */
export function relationQuery(q: Question, env: FormEnvValue | null): { query: Partial<EntityQuery> | null; waitingFor: string | null } {
  if (!q.filter) return { query: {}, waitingFor: null };
  const base = q.filter.of === '$subject' ? env?.subjectId : (env?.answers[q.filter.of] as string | undefined);
  if (!base) return { query: null, waitingFor: q.filter.of === '$subject' ? 'the entity this form is about' : q.filter.of };
  const key = { children: 'parentId', descendants: 'ancestorId', parent: 'parentOfId', ancestors: 'aboveId' }[q.filter.relation] as 'parentId';
  return { query: { [key]: base }, waitingFor: null };
}

export function EntityInput({ q, value, onChange, invalid, id }: { q: Question; value: unknown; onChange(v: unknown): void; invalid?: boolean; id: string }) {
  const env = useFormEnv();
  const viaLink = env?.publicPath;
  const { query, waitingFor: waitingInside } = relationQuery(q, env);
  // Through a link the server knows which place the link is for; only another answer can be waited for.
  const dependsOn = q.filter && q.filter.of !== '$subject' ? q.filter.of : null;
  const waitingFor = viaLink ? (dependsOn && !env?.answers[dependsOn] ? dependsOn : null) : waitingInside;
  const relationKey = JSON.stringify(viaLink ? (dependsOn ? env?.answers[dependsOn] : null) : query);
  const places = useQuery({
    queryKey: ['form-places', viaLink ?? env?.tenantId, env?.project, q.key, q.entityType, relationKey],
    queryFn: async (): Promise<{ items: { id: string; code: string; name: string; parent?: { name: string } | null; type: { icon: string } }[] }> => {
      if (viaLink) {
        const of = dependsOn ? (env!.answers[dependsOn] as string | undefined) : undefined;
        return { items: (await api.publicFormPlaces(viaLink, q.key, of)).map((e) => ({ ...e, parent: e.parent ? { name: e.parent } : null, type: { icon: 'map-pin' } })) };
      }
      return api.entities(env!.tenantId, env!.project, { type: q.entityType, pageSize: 200, ...query });
    },
    enabled: !!env && !!q.entityType && (viaLink ? !waitingFor : !!query),
  });
  const items = useMemo(() => places.data?.items ?? [], [places.data]);
  const current = typeof value === 'string' ? value : null;
  // A choice that no longer fits (the place it depended on changed) is dropped.
  useEffect(() => {
    if (current && places.data && !items.some((e) => e.id === current)) onChange(null);
  }, [items, places.data, current]);
  const Icon = MapPin;
  if (!q.entityType) return <p className="text-sm text-red-700">This question has no entity type yet.</p>;
  return (
    <div className="space-y-1">
      <Listbox
        id={id}
        searchable
        invalid={invalid}
        label={q.label}
        placeholder={waitingFor ? `Choose ${waitingFor} first` : places.isPending ? 'Loading…' : items.length ? q.placeholder || 'Choose…' : 'Nothing to choose from'}
        disabled={!!waitingFor || (!items.length && !current)}
        value={current}
        options={items.map((e) => ({ value: e.id, label: e.name, description: [e.code, e.parent?.name].filter(Boolean).join(' · '), icon: iconOf(e.type.icon) ?? Icon, text: `${e.name} ${e.code}` }))}
        onChange={(v) => onChange(v)}
      />
      {current && (
        <button type="button" className="text-xs text-zinc-500 hover:text-ink" onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </div>
  );
}

/** An entity's name from its id, for reading answers back. */
export function EntityName({ tenantId, project, id }: { tenantId: string; project: string; id: string }) {
  const e = useQuery({ queryKey: ['entity-name', tenantId, project, id], queryFn: () => api.entity(tenantId, project, id), staleTime: 5 * 60_000 });
  return <>{e.data ? e.data.name : e.isError ? 'An entity you cannot see' : '…'}</>;
}
