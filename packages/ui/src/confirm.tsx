import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Ban, Check, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react';
import { Button, Dialog } from './components';

/** The icon for the action's button, by what the question starts with. */
const iconFor = (message: string): LucideIcon => {
  if (/^(delete|remove)/i.test(message)) return Trash2;
  if (/^(suspend|revoke|void|cancel)/i.test(message)) return Ban;
  if (/^(replace|reset)/i.test(message)) return RotateCcw;
  if (/^(discard|close without)/i.test(message)) return X;
  return Check;
};
const DANGER = /^(delete|remove|cancel|void|suspend|revoke|replace|archive|discard|close without)/i;

function Ask({ message, confirmLabel, danger, onDone }: { message: string; confirmLabel: string; danger: boolean; onDone(ok: boolean): void }) {
  const settled = useRef(false);
  const [open, setOpen] = useState(true);
  const finish = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setOpen(false);
    onDone(ok);
  };
  return (
    <Dialog
      open={open}
      onClose={() => finish(false)}
      title="Are you sure?"
      tone={danger ? 'danger' : undefined}
      footer={
        <>
          <Button variant="secondary" icon={X} onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} icon={iconFor(message)} onClick={() => finish(true)} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed whitespace-pre-line text-zinc-700">{message}</p>
    </Dialog>
  );
}

/**
 * Asks the person to confirm in the app's own window instead of the browser's alert.
 * Resolves true when they confirm, false when they cancel or dismiss it. The button is
 * named after the action ("Delete…" → "Delete") and is red for destructive ones.
 */
export function confirmDialog(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'contents';
    // The question belongs to wherever it was asked from: inside a project it wears the project's colour.
    const scope = (document.activeElement as HTMLElement | null)?.closest?.('.brand-scope') ?? [...document.querySelectorAll('.brand-scope')].pop();
    if (scope) {
      const look = getComputedStyle(scope);
      for (const k of ['--brand-600', '--brand-contrast']) {
        const v = look.getPropertyValue(k).trim();
        if (v) host.style.setProperty(k, v);
      }
    }
    document.body.appendChild(host);
    const root = createRoot(host);
    const danger = opts.danger ?? DANGER.test(message);
    const verb = /^(\w+)/.exec(message)?.[1] ?? 'Confirm';
    const confirmLabel = opts.confirmLabel ?? (danger ? verb[0]!.toUpperCase() + verb.slice(1).toLowerCase() : 'Confirm');
    root.render(
      <Ask
        message={message}
        confirmLabel={confirmLabel}
        danger={danger}
        onDone={(ok) => {
          resolve(ok);
          setTimeout(() => {
            root.unmount();
            host.remove();
          }, 250);
        }}
      />,
    );
  });
}
