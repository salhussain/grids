import { ApiError } from '@grids/ui';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface Pending {
  tenantId: string;
  project: string;
  form: string;
  formName: string;
  input: Parameters<typeof api.submit>[3];
}
const OUTBOX = 'grids.outbox';
const readOutbox = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Pending[];
  } catch {
    return [];
  }
};
const writeOutbox = (items: Pending[]) => {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(items));
  } catch {
    /* storage full or unavailable */
  }
};

/**
 * Submissions that couldn't reach the server (offline) wait here and are sent when
 * the connection returns. Ids are client-generated, so a retry never duplicates.
 */
export function useOutbox() {
  const [items, setItems] = useState<Pending[]>(readOutbox);
  const flush = useCallback(async () => {
    const remaining: Pending[] = [];
    for (const p of readOutbox()) {
      try {
        await api.submit(p.tenantId, p.project, p.form, p.input);
      } catch (e) {
        // Keep it only if it is still a connectivity problem; server rejections are dropped.
        if (!(e instanceof ApiError)) remaining.push(p);
      }
    }
    writeOutbox(remaining);
    setItems(remaining);
  }, []);
  useEffect(() => {
    if (navigator.onLine) void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);
  const add = (p: Pending) => {
    const next = [...readOutbox(), p];
    writeOutbox(next);
    setItems(next);
  };
  return { items, add, flush };
}

