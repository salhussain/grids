import { Button, cx, useToast } from '@grids/ui';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { AttachmentImage } from './FormInputs';
import { useProject } from './context';

const MAX_BYTES = 8 * 1024 * 1024;

/** A picture for a document (a logo, a watermark, a page behind it): drop a file here or choose one. PNG or JPEG, kept as it is. */
export function PictureDrop({ label, intro, value, onChange, formKey, tall }: { label: string; intro?: string; value: string | null; onChange(id: string | null): void; formKey: string; tall?: boolean }) {
  const { tenantId, project } = useProject();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('Use a PNG or JPEG picture');
    if (file.size > MAX_BYTES) return toast('The picture is over 8 MB');
    setBusy(true);
    try {
      onChange((await api.uploadAttachment(tenantId, project.key, formKey, file, file.name)).id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The picture could not be sent');
    } finally {
      setBusy(false);
    }
  };
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      void take(e.dataTransfer.files[0]);
    },
  };
  const h = tall ? 'h-40' : 'h-28';
  return (
    <div>
      <div className="mb-1 text-[13px] font-medium text-zinc-700">{label}</div>
      {intro && <p className="mb-1.5 text-xs text-zinc-500">{intro}</p>}
      {value ? (
        <div {...drop} className={cx('relative overflow-hidden border bg-zinc-100', h, over ? 'border-accent-600 ring-2 ring-accent-600/30' : 'border-zinc-300')}>
          <AttachmentImage tenantId={tenantId} project={project.key} id={value} className="size-full object-contain" />
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-2">
            <Button size="sm" variant="secondary" icon={ImagePlus} loading={busy} onClick={() => input.current?.click()}>
              Replace
            </Button>
            <Button size="sm" variant="secondary" icon={Trash2} onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div {...drop} className={cx('flex min-h-40 flex-col items-center justify-center gap-1.5 border border-dashed px-4 py-4 text-center', over ? 'border-accent-600 bg-accent-50' : 'border-zinc-300 bg-zinc-50')}>
          <ImagePlus className="size-5 text-zinc-400" aria-hidden />
          <p className="text-[13px] text-zinc-600">{over ? 'Drop the picture' : 'Drop a picture here, or'}</p>
          {!over && (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              Choose a picture
            </Button>
          )}
          <p className="text-[11px] text-zinc-500">PNG or JPEG, up to 8 MB</p>
        </div>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}
