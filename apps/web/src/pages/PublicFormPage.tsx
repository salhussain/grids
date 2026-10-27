import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultAnswers, validate } from '@grids/forms';
import { LOCALES } from '@grids/i18n';
import { localizeForm, uuidv7, type CaptchaChallenge } from '@grids/schema';
import { ApiError, Button, ErrorNotice, Field, Input, LanguageMenu, Loading } from '@grids/ui';
import { CheckCircle2, Clock, CreditCard, Download, Lock } from 'lucide-react';
import { api } from '../api';
import { I18nProvider } from '../i18n';
import { publicFormRoute } from '../router';
import { FormRunner, type Answers } from './projects/FormRenderer';
import { FormEnv } from './projects/FormInputs';

/** Finds the number the puzzle hides (the browser does the work, in small steps so the page stays alive). */
async function solve(c: CaptchaChallenge): Promise<number> {
  const enc = new TextEncoder();
  const want = c.challenge;
  const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  for (let n = 0; n <= c.maxNumber; n++) {
    if (hex(await crypto.subtle.digest('SHA-256', enc.encode(`${c.salt}${n}`))) === want) return n;
    if (n % 500 === 0) await new Promise((r) => setTimeout(r));
  }
  throw new Error('The check could not be completed. Reload the page and try again.');
}

const shell = (body: React.ReactNode) => (
  <div className="min-h-full bg-canvas px-4 py-8">
    <div className="mx-auto max-w-2xl space-y-6">{body}</div>
    <p className="mt-10 text-center font-mono text-[11px] tracking-[0.18em] text-zinc-400">GRIDS</p>
  </div>
);

/** A form opened from a link, by someone without an account. */
export function PublicFormPage() {
  const { path } = publicFormRoute.useParams();
  const form = useQuery({ queryKey: ['public-form', path], queryFn: () => api.publicForm(path), retry: false, staleTime: Infinity });
  const submissionId = useRef(uuidv7());
  const seeded = useRef(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  // A form that checks addresses: the address, the code emailed to it, and where that stands.
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [codeAgainAt, setCodeAgainAt] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (codeAgainAt <= Date.now()) return;
    const t = setInterval(() => (tick((n) => n + 1), Date.now() >= codeAgainAt && clearInterval(t)), 1000);
    return () => clearInterval(t);
  }, [codeAgainAt]);
  const [lang, setLang] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // A form that asks for a fee: the person pays on the provider's page and comes back here with the payment's id.
  const returned = useMemo(() => new URLSearchParams(window.location.search).get('payment'), []);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const payKey = `grids.pay.${path}`;
  useEffect(() => {
    if (!returned) return;
    try {
      const saved = sessionStorage.getItem(payKey);
      if (saved) {
        const s = JSON.parse(saved) as { answers: Answers; name: string; email: string; code: string; codeSentTo: string | null };
        seeded.current = true;
        setAnswers(s.answers);
        setName(s.name);
        setEmail(s.email);
        setCode(s.code);
        setCodeSentTo(s.codeSentTo);
      }
    } catch {
      /* nothing saved: the form starts empty */
    }
    api
      .publicPaymentState(path, returned)
      .then((r) => (r.status === 'succeeded' ? setPaymentId(returned) : setProblem(r.status === 'cancelled' ? 'The payment was cancelled. Your answers are still here: send them again to pay.' : 'The payment did not go through. Try again.')))
      .catch(() => setProblem('We could not check the payment. Reload the page.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const def = form.data?.definition;
  // The languages on offer: those the form has some text for, and the app's finished ones (their buttons and messages are
  // translated even where the form's own words are not, and fall back to the original). It opens in the one the link names,
  // else the browser's, else the form's own.
  const offered = useMemo(
    () => LOCALES.filter((l) => l.status === 'stable' || (def && Object.values(def.translations[l.code] ?? {}).some((v) => v?.trim()))),
    [def],
  );
  const browser = navigator.languages.map((l) => l.slice(0, 2)).find((c) => offered.some((o) => o.code === c));
  const active = lang ?? form.data?.language ?? browser ?? '';
  const shown = useMemo(() => (def ? localizeForm(def, active || null) : null), [def, active]);
  useEffect(() => {
    if (def && !seeded.current) {
      seeded.current = true;
      setAnswers(defaultAnswers(def));
    }
  }, [def]);

  if (form.isPending) return shell(<Loading />);
  if (form.isError || !form.data || !shown)
    return shell(
      <div className="flex flex-col items-center gap-3 border border-zinc-200 bg-snow px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center bg-zinc-100 text-zinc-500">
          <Lock className="size-6" />
        </span>
        <h1 className="text-lg font-semibold">This link does not work</h1>
        <p className="max-w-md text-sm text-zinc-600">It may have been used already, switched off or replaced. Ask whoever sent it for a new one.</p>
      </div>,
    );
  const f = form.data;
  const locale = (LOCALES.find((l) => l.code === active)?.code ?? 'en') as 'en';

  if (done !== null)
    return shell(
      <I18nProvider locale={locale}>
        <div className="flex flex-col items-center gap-3 border border-zinc-200 bg-snow px-6 py-12 text-center" dir={LOCALES.find((l) => l.code === active)?.dir}>
          <CheckCircle2 className="size-10 text-emerald-600" />
          <h1 className="text-lg font-semibold">Thank you</h1>
          <p className="max-w-md text-sm text-zinc-600">{shown.thankYou || 'Your answers have been sent.'}</p>
          {paymentId && (
            <a href={api.publicReceiptUrl(path, paymentId)} className="inline-flex h-9 items-center gap-2 border border-zinc-300 px-3.5 text-sm hover:bg-zinc-50">
              <Download className="size-4" aria-hidden /> Download your receipt (PDF)
            </a>
          )}
        </div>
      </I18nProvider>,
    );

  if (f.availability.state !== 'open')
    return shell(
      <div className="flex flex-col items-center gap-3 border border-zinc-200 bg-snow px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center bg-zinc-100 text-zinc-500">{f.availability.state === 'not_yet' ? <Clock className="size-6" /> : <Lock className="size-6" />}</span>
        <h1 className="text-lg font-semibold">{f.availability.state === 'not_yet' ? 'Not open yet' : f.availability.state === 'limit' ? 'Already used' : 'Closed'}</h1>
        <p className="max-w-md text-sm text-zinc-600">{f.availability.message}</p>
      </div>,
    );

  const cleanEmail = email.trim().toLowerCase();
  const sendCode = async () => {
    setCodeBusy(true);
    setCodeProblem(null);
    try {
      await api.publicEmailCode(path, cleanEmail);
      setCodeSentTo(cleanEmail);
      setCode('');
      setCodeAgainAt(Date.now() + 30_000);
    } catch (e) {
      setCodeProblem(e instanceof Error ? e.message : 'The code could not be sent');
    } finally {
      setCodeBusy(false);
    }
  };
  const send = async () => {
    const local = validate(shown, answers);
    if (!local.ok) return setErrors(local.errors);
    if (f.verifyEmail && (codeSentTo !== cleanEmail || !/^\d{6}$/.test(code.trim()))) return setCodeProblem(codeSentTo === cleanEmail ? 'Enter the 6-digit code we emailed you' : 'Enter your email address, ask for a code, and enter it here');
    setBusy(true);
    setProblem(null);
    // The fee comes first: the person pays on the provider's page, then returns here to send.
    if (f.payment && !paymentId) {
      try {
        sessionStorage.setItem(payKey, JSON.stringify({ answers, name, email, code, codeSentTo }));
        const back = new URL(window.location.href);
        back.searchParams.delete('payment');
        const r = await api.publicStartPayment(path, { returnUrl: back.toString(), ...(cleanEmail ? { email: cleanEmail } : {}) });
        window.location.href = r.redirectUrl;
      } catch (e) {
        setProblem(e instanceof Error ? e.message : 'The payment could not be started');
        setBusy(false);
      }
      return;
    }
    try {
      const captcha = f.captcha ? await api.publicCaptcha() : null;
      const number = captcha ? await solve(captcha) : 0;
      const r = await api.publicSubmit(path, {
        id: submissionId.current,
        version: f.version,
        answers,
        collectedAt: new Date().toISOString(),
        submitter: f.askName && !f.verifyEmail && name.trim() ? name.trim() : null,
        emailCode: f.verifyEmail ? { email: cleanEmail, code: code.trim() } : null,
        captcha: captcha ? { salt: captcha.salt, challenge: captcha.challenge, signature: captcha.signature, number } : null,
        paymentId,
      });
      try {
        sessionStorage.removeItem(payKey);
      } catch {
        /* nothing to clear */
      }
      setDone(r.message);
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) setErrors(Object.fromEntries(e.problem.errors.map((x) => [x.path, x.message])));
      setProblem(e instanceof Error ? e.message : 'Your answers could not be sent');
    } finally {
      setBusy(false);
    }
  };

  const options = [{ code: '', label: 'Original', draft: false }, ...offered.map((l) => ({ code: l.code as string, label: l.nativeName, draft: l.status === 'draft' }))];
  return shell(
    <I18nProvider locale={locale}>
      <div dir={LOCALES.find((l) => l.code === active)?.dir} className="space-y-6">
        {offered.length > 0 && (
          <div className="flex justify-end">
            <LanguageMenu value={active} onChange={setLang} label="Language" options={options} />
          </div>
        )}
        <header className="relative overflow-hidden border border-zinc-200 bg-snow px-6 py-7 sm:px-8">
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">{f.projectName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{shown.title}</h1>
          {shown.description && <p className="mt-1.5 text-sm text-zinc-600">{shown.description}</p>}
        </header>
        {f.payment && (
          <div className="flex items-center gap-3 border border-zinc-200 bg-snow px-5 py-3 text-sm">
            <CreditCard className="size-5 shrink-0 text-accent-600" aria-hidden />
            <span className="min-w-0 flex-1">
              {paymentId ? 'Payment received. You can send the form now.' : `This form costs ${new Intl.NumberFormat(undefined, { style: 'currency', currency: f.payment.currency }).format(f.payment.amount / 100)}. You pay when you send it.`}
              {f.payment.description && !paymentId && <span className="block text-xs text-zinc-500">{f.payment.description}</span>}
            </span>
            {paymentId && (
              <a href={api.publicReceiptUrl(path, paymentId)} className="inline-flex items-center gap-1.5 text-xs text-accent-700 hover:underline">
                <Download className="size-4" aria-hidden /> Receipt
              </a>
            )}
            {paymentId && <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />}
          </div>
        )}
        {problem && <ErrorNotice error={new Error(problem)} />}
        <FormEnv.Provider value={{ tenantId: '', project: '', formKey: '', subjectId: null, answers: {}, publicPath: path }}>
        <FormRunner
          definition={shown}
          answers={answers}
          onChange={setAnswers}
          errors={errors}
          onErrors={setErrors}
          onSubmit={() => void send()}
          submitting={busy}
          header={
            f.verifyEmail ? (
              <div className="space-y-4 border border-zinc-200 bg-snow p-4">
                <Field label="Your email address" intro="We email you a code to confirm it">
                  <div className="flex gap-2">
                    <Input type="email" inputMode="email" autoComplete="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
                    <Button variant="secondary" loading={codeBusy} disabled={!/^\S+@\S+\.\S+$/.test(cleanEmail) || (codeSentTo === cleanEmail && codeAgainAt > Date.now())} onClick={() => void sendCode()} className="shrink-0">
                      {codeSentTo === cleanEmail ? (codeAgainAt > Date.now() ? `Send again in ${Math.ceil((codeAgainAt - Date.now()) / 1000)}s` : 'Send again') : 'Send code'}
                    </Button>
                  </div>
                </Field>
                {codeSentTo !== null && (
                  <Field label="The 6-digit code" intro={`Sent to ${codeSentTo}. It works once and expires in 10 minutes`}>
                    <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="tracking-[0.4em] tabular-nums sm:w-40" />
                  </Field>
                )}
                {codeProblem && (
                  <p className="text-xs text-red-700" role="alert">
                    {codeProblem}
                  </p>
                )}
              </div>
            ) : f.askName ? (
              <Field label="Your name or email" intro="So the people reading the answers know who sent them (optional)">
                <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </Field>
            ) : undefined
          }
        />
        </FormEnv.Provider>
      </div>
    </I18nProvider>,
  );
}
