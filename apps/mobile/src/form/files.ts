import { uuidv7 } from '@grids/schema';
import { Directory, File, Paths } from 'expo-file-system';

/** A picture or file kept on the device until its submission has been sent. */
export interface BlobMeta {
  id: string;
  name: string;
  contentType: string;
  uri: string;
  size: number;
}

const dir = () => {
  const d = new Directory(Paths.document, 'attachments');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};

const extOf = (name: string) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? `.${m[1]!.toLowerCase()}` : '';
};

/** Copies a file the picker or camera made (which the system may delete) into the app's own storage. */
export function keepFile(sourceUri: string, name: string, contentType: string): BlobMeta {
  const id = uuidv7();
  const target = new File(dir(), `${id}${extOf(name)}`);
  new File(sourceUri).copy(target);
  return { id, name, contentType, uri: target.uri, size: target.size ?? 0 };
}

/** Writes bytes (a drawn signature) into the app's storage. */
export function keepBytes(bytes: Uint8Array, name: string, contentType: string): BlobMeta {
  const id = uuidv7();
  const target = new File(dir(), `${id}${extOf(name)}`);
  target.create();
  target.write(bytes);
  return { id, name, contentType, uri: target.uri, size: bytes.byteLength };
}

export function dropFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export const fromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
