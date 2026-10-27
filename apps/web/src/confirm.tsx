import { Button, Dialog } from '@grids/ui';
import { useCallback, useRef, useState, type ReactNode } from 'react';

interface Ask {
  title: string;
  message: ReactNode;
  /** The label of the button that goes ahead. */
  confirm?: string;
  /** Red: the action takes something away. */
  danger?: boolean;
}

/**
 * A confirmation in the app's own window, instead of the browser's. `ask()` answers true when the person goes ahead;
 * render `dialog` once in the page.
 */
export function useConfirm() {
  const [open, setOpen] = useState<Ask | null>(null);
  const done = useRef<((yes: boolean) => void) | null>(null);
  const ask = useCallback(
    (a: Ask) =>
      new Promise<boolean>((resolve) => {
        done.current = resolve;
        setOpen(a);
      }),
    [],
  );
  const close = (yes: boolean) => {
    done.current?.(yes);
    done.current = null;
    setOpen(null);
  };
  const dialog = open && (
    <Dialog
      open
      tone={open.danger ? 'danger' : undefined}
      onClose={() => close(false)}
      title={open.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={open.danger ? 'danger' : undefined} onClick={() => close(true)}>
            {open.confirm ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-700">{open.message}</p>
    </Dialog>
  );
  return { ask, dialog };
}
