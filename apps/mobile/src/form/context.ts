import { createContext, useContext } from 'react';
import type { BlobMeta } from './files';

/** Where a form is being filled in: what questions that reach out (places, pictures) need to know. */
export interface FillContext {
  /** Places downloaded for the project; null for forms opened from a link. */
  scope: string | null;
  /** Forms opened from a link: its places come from what was saved with the link. */
  linkPath: string | null;
  /** The place the whole form is about, once chosen. */
  subjectId: string | null;
  /** Every answer so far, calculations included. */
  answers: Record<string, unknown>;
  blobs: Record<string, BlobMeta>;
  addBlob(b: BlobMeta): void;
}

export const FillCtx = createContext<FillContext | null>(null);
export const useFill = () => {
  const c = useContext(FillCtx);
  if (!c) throw new Error('Not inside a form');
  return c;
};
