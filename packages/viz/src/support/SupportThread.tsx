import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportAttachmentDto, SupportMessageDto } from '@grids/schema';
import { cx, ErrorNotice, Spinner } from '@grids/ui';
import { Clock3, Download, FileText, LifeBuoy, Loader2, Paperclip, Send, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupportClient } from './client';
import { RichBody, RichFilesProvider, type RichFiles } from './markdown';

const SOUND_KEY = 'grids-help-sound';
const soundOn = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
};
let audio: AudioContext | null = null;
/** A soft two-note "ting" (made in the browser, so there is no file to load). */
export function ting() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    [880, 1318.5].forEach((hz, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.5);
      osc.connect(gain).connect(audio!.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.55);
    });
  } catch {
    // No audio in this browser: the message is still there.
  }
}
/** The conversation as a plain text file. */
function transcript(t: { ref: string; subject: string; orgName: string; messages: SupportMessageDto[] }) {
  const lines = [`${t.subject} (${t.ref}) · ${t.orgName}`, ''];
  for (const m of t.messages) lines.push(`[${new Date(m.createdAt).toLocaleString()}] ${m.from === 'system' ? '—' : m.from === 'requester' ? 'You' : m.name}: ${m.body}${m.attachments.length ? ` (files: ${m.attachments.map((f) => f.name).join(', ')})` : ''}`, '');
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t.ref.replace('#', 'request-')}-transcript.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The files chosen for a message: uploaded as soon as they are picked, shown as chips that can be taken off again. */
export function useAttachments(client: SupportClient, thread: string | null) {
  const [files, setFiles] = useState<SupportAttachmentDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of [...list].slice(0, 5 - files.length)) {
        const up = await client.upload(f, thread);
        setFiles((cur) => [...cur, up]);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { files, busy, error, add, remove: (id: string) => setFiles((cur) => cur.filter((x) => x.id !== id)), clear: () => setFiles([]) };
}

export function AttachmentPicker({ a, disabled }: { a: ReturnType<typeof useAttachments>; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt" onChange={(e) => { void a.add(e.target.files); e.target.value = ''; }} />
      <button type="button" aria-label="Attach a file" title="Attach a file" disabled={disabled || a.busy || a.files.length >= 5} onClick={() => input.current?.click()} className="flex size-9 shrink-0 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-ink disabled:opacity-40">
        {a.busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
      </button>
    </>
  );
}

export function AttachmentChips({ a }: { a: ReturnType<typeof useAttachments> }) {
  if (!a.files.length && !a.error) return null;
  return (
    <div className="space-y-1.5">
      <ErrorNotice error={a.error} />
      {a.files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {a.files.map((f) => (
            <li key={f.id} className="flex max-w-full items-center gap-1.5 bg-zinc-100 py-1 ps-2 pe-1 text-xs">
              <FileText className="size-3.5 shrink-0 text-zinc-500" />
              <span className="truncate">{f.name}</span>
              <span className="text-zinc-500">{size(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => a.remove(f.id)} className="p-0.5 text-zinc-500 hover:text-ink">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bubble({ m, threadKey, client }: { m: SupportMessageDto; threadKey: string; client: SupportClient }) {
  if (m.from === 'system')
    return (
      <li className="flex items-center justify-center gap-1.5 py-1 text-center text-[11px] text-zinc-500">
        <Clock3 className="size-3" /> {m.body} · {clock(m.createdAt)}
      </li>
    );
  const mine = m.from === 'requester';
  return (
    <li className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className="mb-0.5 text-[11px] text-zinc-500">
        {mine ? 'You' : m.name} · {clock(m.createdAt)}
      </div>
      <div className={cx('max-w-[88%] space-y-1.5 px-3 py-2 text-sm leading-snug break-words whitespace-pre-wrap', mine ? 'rounded-[18px] rounded-ee-[6px] bg-accent-600 text-on-accent' : 'rounded-[18px] rounded-es-[6px] border border-zinc-200 bg-snow')}>
        {m.body && (mine ? <div className="whitespace-pre-wrap">{m.body}</div> : <RichBody text={m.body} className="whitespace-normal" />)}
        {m.editedAt && <div className={cx('text-[10px]', mine ? 'text-white/70' : 'text-zinc-400')}>edited</div>}
        {m.attachments.filter((f) => !m.body.includes(`file:${f.id}`)).map((f) => (
          <button key={f.id} type="button" onClick={() => void client.openFile(threadKey, f)} className={cx('flex w-full items-center gap-1.5 rounded-[10px] px-2 py-1 text-start text-xs underline-offset-2 hover:underline', mine ? 'bg-white/15' : 'bg-zinc-100')}>
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate">{f.name}</span>
          </button>
        ))}
      </div>
    </li>
  );
}

/**
 * One conversation, as a chat: what each side wrote, with the stage it is at. It looks for new messages every few
 * seconds while open, so a reply from the team appears without reloading.
 */
export function SupportThread({ client, threadKey, compact }: { client: SupportClient; threadKey: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const attach = useAttachments(client, threadKey);
  const q = useQuery({
    queryKey: ['support-thread', client.storageKey, threadKey],
    queryFn: () => client.thread(threadKey),
    refetchInterval: (query) => (query.state.data?.chat === false ? 30_000 : 2_000),
    refetchIntervalInBackground: false,
  });
  const send = useMutation({
    mutationFn: () => client.reply(threadKey, { body: text.trim(), attachments: attach.files.map((f) => f.id) }),
    onSuccess: (t) => {
      qc.setQueryData(['support-thread', client.storageKey, threadKey], t);
      setText('');
      lastTyped.current = 0;
      if (client.typing) void client.typing(threadKey, '').catch(() => undefined);
      attach.clear();
    },
  });
  // The team sees the words as they are typed (at most every second and a half).
  const lastTyped = useRef(0);
  const say = (value: string) => {
    setText(value);
    if (!client.typing) return;
    const t = Date.now();
    if (!value.trim()) {
      lastTyped.current = 0;
      void client.typing(threadKey, '').catch(() => undefined);
    } else if (t - lastTyped.current > 1_500) {
      lastTyped.current = t;
      void client.typing(threadKey, value).catch(() => undefined);
    }
  };
  const [sound, setSound] = useState(soundOn);
  // A new message from the team makes a sound (not the first time the conversation loads).
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const msgs = q.data?.messages;
    if (!msgs) return;
    const staff = msgs.filter((m) => m.from === 'staff' || (m.from === 'system' && /joined the chat$/.test(m.body))).length;
    if (seen.current !== null && staff > seen.current && sound) ting();
    seen.current = staff;
  }, [q.data?.messages, sound]);
  const end = useRef<HTMLDivElement>(null);
  const count = (q.data?.messages.length ?? 0) + (q.data?.agentTyping ? 1 : 0);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  const files = useMemo<RichFiles>(
    () => ({
      url: (id) => (client.fileUrl ? client.fileUrl(threadKey, id) : Promise.reject(new Error('no pictures'))),
      open: (id, name) => client.openFile(threadKey, { id, name, contentType: '', size: 0 }),
    }),
    [client, threadKey],
  );
  if (q.isPending)
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  if (q.isError) return <div className="p-4"><ErrorNotice error={q.error} /></div>;
  const t = q.data;
  const ready = (text.trim() || attach.files.length) && !send.isPending && !attach.busy;
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', compact ? '' : 'h-full')}>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 text-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{t.subject}</div>
          <div className="text-xs text-zinc-500">{t.ref}</div>
        </div>
        <button
          type="button"
          aria-label={sound ? 'Turn the message sound off' : 'Turn the message sound on'}
          aria-pressed={sound}
          title={sound ? 'Sound on' : 'Sound off'}
          onClick={() => {
            const next = !sound;
            setSound(next);
            try {
              localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
            } catch {
              /* private window */
            }
            if (next) ting();
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-ink"
        >
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </button>
        <button type="button" aria-label="Download the conversation" title="Download the conversation" onClick={() => transcript(t)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-ink">
          <Download className="size-4" />
        </button>
      </div>
      <RichFilesProvider value={files}>
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50 px-4 py-3" aria-live="polite">
        {t.messages.map((m) => (
          <Bubble key={m.id} m={m} threadKey={threadKey} client={client} />
        ))}
        {!t.answered && t.stage.kind !== 'done' && (
          <li className="flex items-center justify-center gap-1.5 py-1 text-center text-xs text-zinc-500">
            <LifeBuoy className="size-3.5" /> A member of the team will reply here. Keep this open, or we will email you.
          </li>
        )}
        {t.agentTyping && (
          <li className="flex flex-col items-start" aria-live="polite">
            <div className="mb-0.5 text-[11px] text-zinc-500">{t.agentTyping} is typing…</div>
            <div className="flex items-center gap-1 rounded-[18px] rounded-es-[6px] border border-zinc-200 bg-snow px-3.5 py-3" aria-label={`${t.agentTyping} is typing`}>
              {[0, 150, 300].map((d) => (
                <i key={d} className="size-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </li>
        )}
        <div ref={end} />
      </ol>
      </RichFilesProvider>
      {t.canReply ? (
        <form
          className="space-y-2 border-t border-zinc-200 bg-snow p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send.mutate();
          }}
        >
          <ErrorNotice error={send.error} />
          <AttachmentChips a={attach} />
          {t.stage.kind === 'done' && <p className="text-xs text-zinc-500">This is marked {t.stage.label.toLowerCase()}. Writing back opens it again.</p>}
          <div className="flex items-end gap-1.5">
            <AttachmentPicker a={attach} />
            <textarea
              value={text}
              rows={1}
              onChange={(e) => say(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (ready) send.mutate();
                }
              }}
              placeholder="Write a message…"
              aria-label="Message"
              className="max-h-28 min-h-9 flex-1 resize-none rounded-[12px] border border-zinc-300 bg-snow px-3 py-2 text-sm outline-none focus:border-accent-600"
            />
            <button type="submit" aria-label="Send" disabled={!ready} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-600 text-on-accent disabled:opacity-40">
              {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </form>
      ) : (
        <p className="border-t border-zinc-200 bg-snow px-4 py-3 text-center text-xs text-zinc-500">This request was closed a while ago. Please start a new one.</p>
      )}
    </div>
  );
}
