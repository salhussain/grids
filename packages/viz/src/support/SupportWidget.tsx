import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, cx, ErrorNotice, Field, Input, Listbox, Textarea } from '@grids/ui';
import { ArrowRight, Check, ChevronLeft, LifeBuoy, Mail, MailCheck, MessageCircle, Phone, Plus, Send, Tag, User, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { topicIcon } from './topicIcons';
import { remember, remembered, solvePuzzle, type SupportClient } from './client';
import { AttachmentChips, AttachmentPicker, SupportThread, useAttachments } from './SupportThread';

type View = { name: 'home' } | { name: 'new' } | { name: 'thread'; key: string };
const STAGE_DOT = { open: 'bg-zinc-400', active: 'bg-sky-500', done: 'bg-emerald-500' } as const;

type Info = { categories: string[]; categoryIcons?: Record<string, string>; captcha: boolean; chat: boolean; phone: 'off' | 'optional' | 'required'; verifyEmail: boolean };
const field = '';
/** The theme's corners are square; inside the help window controls are rounded (round ones, like the topic pills, stay). */
const WINDOW_CSS = `.help-window :is(input,textarea,select,button):not([class*='rounded-full']){border-radius:12px}`;
const mailOk = (e: string) => /.+@.+\..+/.test(e.trim());
const phoneOk = (p: string) => /^[+0-9 ()-]{6,25}$/.test(p.trim());

/** Which step of two a visitor is on. */
function Steps({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500" aria-label={`Step ${step} of 2`}>
      {[1, 2].map((n) => (
        <span key={n} className={cx('h-1.5 flex-1 rounded-full', n <= step ? 'bg-accent-600' : 'bg-zinc-200')} />
      ))}
      <span className="num shrink-0">Step {step} of 2</span>
    </div>
  );
}

/**
 * The form for a new request. A signed-in person only writes about the problem. A visitor first says who they are
 * (name, email, perhaps a phone number, and a code sent to the email when the organisation asks for that), then
 * writes about the problem.
 */
function NewRequest({ client, info, project, page, onSent }: { client: SupportClient; info: Info; project?: string; page?: string; onSent(key: string): void }) {
  const known = client.identity?.email ? client.identity : null;
  const [step, setStep] = useState<'who' | 'code' | 'about'>(client.signedIn || known ? 'about' : 'who');
  const [f, setF] = useState({ name: known?.name ?? '', email: known?.email ?? '', phone: '', code: '', proof: '', subject: '', body: '', category: info.categories[0] ?? '' });
  const attach = useAttachments(client, null);
  const set = (p: Partial<typeof f>) => setF((cur) => ({ ...cur, ...p }));
  const sendCode = useMutation({ mutationFn: () => client.sendEmailCode!(f.email.trim()), onSuccess: () => setStep('code') });
  const verify = useMutation({
    mutationFn: () => client.verifyEmail!(f.email.trim(), f.code.trim()),
    onSuccess: (r) => (set({ proof: r.proof }), setStep('about')),
  });
  const send = useMutation({
    mutationFn: async () => {
      let captcha = null;
      if (!client.signedIn && info.captcha && client.captcha) {
        const c = await client.captcha();
        captcha = { salt: c.salt, challenge: c.challenge, signature: c.signature, number: await solvePuzzle(c) };
      }
      return client.create({
        ...(client.signedIn ? {} : { name: f.name.trim(), email: f.email.trim(), ...(info.phone !== 'off' && f.phone.trim() && { phone: f.phone.trim() }), ...(f.proof && { emailProof: f.proof }) }),
        subject: f.subject,
        body: f.body,
        category: f.category || undefined,
        attachments: attach.files.map((x) => x.id),
        project,
        page: page ?? window.location.pathname,
        captcha,
      });
    },
    onSuccess: (sent) => {
      // A visitor opens it again with the secret link; a signed-in person by its id.
      const key = sent.token ?? sent.thread.id;
      if (sent.token) remember(client.storageKey, { key: sent.token, ref: sent.thread.ref, subject: sent.thread.subject, at: new Date().toISOString() });
      onSent(key);
    },
  });
  const whoOk = f.name.trim() && mailOk(f.email) && (info.phone === 'off' || (info.phone === 'optional' && !f.phone.trim()) || phoneOk(f.phone));
  const aboutOk = f.subject.trim().length >= 4 && f.body.trim() && !attach.busy;

  if (step === 'who')
    return (
      <form
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!whoOk) return;
          if (info.verifyEmail && client.sendEmailCode) sendCode.mutate();
          else setStep('about');
        }}
      >
        <Steps step={1} />
        <div>
          <h3 className="text-base font-semibold">Who are we talking to?</h3>
          <p className="mt-0.5 text-sm text-zinc-500">So we know who you are and can reply, even if you close this window.</p>
        </div>
        <ErrorNotice error={sendCode.error} />
        <Field label="Your name" hint="What should we call you?">
          <Input icon={User} className={field} value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} required autoComplete="name" autoFocus />
        </Field>
        <Field label="Your email" hint="We reply here, and by email if you close this window">
          <Input icon={Mail} className={field} type="email" value={f.email} maxLength={200} onChange={(e) => set({ email: e.target.value, proof: '' })} required autoComplete="email" />
        </Field>
        {info.phone !== 'off' && (
          <Field label={info.phone === 'optional' ? 'Mobile number (optional)' : 'Mobile number'} error={f.phone.trim() && !phoneOk(f.phone) ? 'That number does not look right' : undefined} hint="Only used if the team needs to call you">
            <Input icon={Phone} className={field} type="tel" value={f.phone} maxLength={25} onChange={(e) => set({ phone: e.target.value })} required={info.phone === 'required'} autoComplete="tel" placeholder="+1 555 010 2030" />
          </Field>
        )}
        <Button type="submit" className="w-full" icon={info.verifyEmail ? Mail : ArrowRight} loading={sendCode.isPending} disabled={!whoOk}>
          {info.verifyEmail ? 'Send me a code' : 'Continue'}
        </Button>
        {info.verifyEmail && <p className="text-center text-xs text-zinc-500">We will email you a 6-digit code to check this address.</p>}
      </form>
    );

  if (step === 'code')
    return (
      <form
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{6}$/.test(f.code.trim())) verify.mutate();
        }}
      >
        <Steps step={1} />
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <MailCheck className="size-5 text-accent-600" /> Check your email
          </h3>
          <p className="mt-0.5 text-sm text-zinc-500">
            We sent a 6-digit code to <b className="text-ink">{f.email.trim()}</b>.
          </p>
        </div>
        <ErrorNotice error={verify.error ?? sendCode.error} />
        <Field label="Code" hint="It works once and runs out after 10 minutes">
          <Input className={cx(field, 'num text-center text-lg tracking-[0.5em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={f.code} onChange={(e) => set({ code: e.target.value.replace(/\D/g, '') })} autoFocus placeholder="······" />
        </Field>
        <Button type="submit" className="w-full" icon={Check} loading={verify.isPending} disabled={!/^\d{6}$/.test(f.code.trim())}>
          Confirm
        </Button>
        <div className="flex items-center justify-between text-xs">
          <button type="button" className="text-zinc-500 hover:text-ink hover:underline" onClick={() => (set({ code: '' }), setStep('who'))}>
            Use another email
          </button>
          <button type="button" className="text-accent-700 hover:underline disabled:opacity-50" disabled={sendCode.isPending} onClick={() => sendCode.mutate()}>
            Send a new code
          </button>
        </div>
      </form>
    );

  return (
    <form
      className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (aboutOk) send.mutate();
      }}
    >
      {!client.signedIn && !known && <Steps step={2} />}
      {!client.signedIn && (
        <div className="flex items-center gap-2 rounded-[12px] bg-zinc-100 px-3 py-2 text-sm">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-on-accent">{f.name.trim().slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate">
            {f.name.trim()} <span className="text-zinc-500">· {f.email.trim()}</span>
          </span>
          {!known && (
            <button type="button" className="shrink-0 text-xs text-accent-700 hover:underline" onClick={() => setStep('who')}>
              Change
            </button>
          )}
        </div>
      )}
      <ErrorNotice error={send.error} />
      {info.categories.length > 0 && (
        <Field label="What is it about?" hint="Pick the closest match">
          <Listbox label="What is it about?" value={f.category} onChange={(category) => set({ category })} options={info.categories.map((c) => ({ value: c, label: c, icon: topicIcon(info.categoryIcons, c) }))} />
        </Field>
      )}
      <Field label="Subject" hint="A few words that sum it up">
        <Input icon={Tag} className={field} value={f.subject} maxLength={200} onChange={(e) => set({ subject: e.target.value })} required minLength={4} placeholder="e.g. The map shows no data" autoFocus />
      </Field>
      <Field label="Message" hint="Include what you were doing, and what you expected to happen">
        <Textarea className={field} rows={4} value={f.body} maxLength={8000} onChange={(e) => set({ body: e.target.value })} required placeholder="What happened, and what did you expect?" />
      </Field>
      <AttachmentChips a={attach} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <AttachmentPicker a={attach} /> Attach a picture or file
        </div>
        <Button type="submit" icon={info.chat ? MessageCircle : Send} loading={send.isPending} disabled={!aboutOk}>
          {info.chat ? 'Start chat' : 'Send'}
        </Button>
      </div>
      {!client.signedIn && info.captcha && <p className="text-[11px] text-zinc-500">A quick automatic check runs when you send, to keep spam out.</p>}
    </form>
  );
}

/**
 * Help from the organisation's pages. People ask the organisation (the project they are on is only where it came from), and carry on the conversation in the
 * same window; the organisation is the one that can pass a request on to the Grids team.
 */
export function SupportWidget({ client, project, page, onOpenChange, side = 'start', className }: { client: SupportClient; /** The address of the page it sits on, when that is not this window's (an embedded window). */ page?: string; /** Told when the window opens or closes (an embedding page makes room for it). */ onOpenChange?: (open: boolean) => void; /** The project whose page this is: told to the team as where the request came from. */ project?: string; side?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ name: 'home' });
  const info = useQuery({ queryKey: ['support-info', client.storageKey], queryFn: () => client.info(), staleTime: 60_000, retry: false });
  const mine = useQuery({ queryKey: ['support-mine', client.storageKey], queryFn: () => client.mine!(), enabled: open && client.signedIn && !!client.mine, refetchInterval: open ? 15_000 : false });
  const list = useMemo(() => {
    if (client.signedIn) return (mine.data ?? []).map((m) => ({ key: m.id, ref: m.ref, subject: m.subject, stage: m.stage }));
    return remembered(client.storageKey).map((r) => ({ key: r.key, ref: r.ref, subject: r.subject, stage: null }));
    // The list is read again whenever the window is opened or a conversation is added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.signedIn, client.storageKey, mine.data, open, view.name]);
  if (!info.data?.enabled) return null;
  const toggle = () => {
    setOpen(!open);
    onOpenChange?.(!open);
    if (!open) setView(list.length ? { name: 'home' } : { name: 'new' });
  };
  const title = view.name === 'thread' ? 'Chat' : view.name === 'new' ? 'New request' : 'Help';
  return (
    <div className={cx('fixed bottom-5 z-40 print:hidden', side === 'start' ? 'start-5' : 'end-5', className)}>
      {open && (
        <>
        <style>{WINDOW_CSS}</style>
        <div role="dialog" aria-label="Get help" className={cx('absolute bottom-14 flex h-[min(78vh,560px)] w-[min(94vw,380px)] flex-col help-window overflow-hidden rounded-[18px] bg-snow shadow-2xl', side === 'start' ? 'start-0' : 'end-0')}>
          <header className="flex items-center gap-2 bg-accent-600 px-4 py-3.5 text-on-accent">
            {view.name !== 'home' && list.length > 0 && (
              <button type="button" aria-label="Back" onClick={() => setView({ name: 'home' })} className="opacity-70 hover:opacity-100">
                <ChevronLeft className="size-4" />
              </button>
            )}
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
              <LifeBuoy className="size-4 shrink-0" /> <span className="truncate">{title} · {info.data.orgName}</span>
            </span>
            <button type="button" aria-label="Close" onClick={() => (setOpen(false), onOpenChange?.(false))} className="opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </header>
          {view.name === 'new' && <NewRequest client={client} info={info.data} project={project} page={page} onSent={(key) => setView({ name: 'thread', key })} />}
          {view.name === 'thread' && <SupportThread client={client} threadKey={view.key} compact />}
          {view.name === 'home' && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-sm text-zinc-600">{info.data.greeting}</p>
              <Button className="w-full" icon={Plus} onClick={() => setView({ name: 'new' })}>
                {info.data.chat ? 'Start a chat' : 'Ask for help'}
              </Button>
              {list.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">Your conversations</div>
                  <ul className="divide-y divide-zinc-100 overflow-hidden rounded-[12px] border border-zinc-200">
                    {list.map((c) => (
                      <li key={c.key}>
                        <button type="button" onClick={() => setView({ name: 'thread', key: c.key })} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start hover:bg-zinc-50">
                          <MessageCircle className="size-4 shrink-0 text-zinc-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{c.subject}</span>
                            <span className="block text-xs text-zinc-500">{c.ref}</span>
                          </span>
                          {c.stage && (
                            <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-600">
                              <span className={cx('size-2 rounded-full', STAGE_DOT[c.stage.kind])} /> {c.stage.label}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        </>
      )}
      <button
        type="button"
        aria-label={open ? 'Close help' : 'Get help'}
        aria-expanded={open}
        onClick={toggle}
        className="flex size-12 items-center justify-center rounded-full bg-accent-600 text-on-accent shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      >
        {open ? <X className="size-5" /> : <LifeBuoy className="size-5" />}
      </button>
    </div>
  );
}
