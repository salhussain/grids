import { type PlacedField } from '@grids/schema';
import { Button, Dialog, Field, Listbox } from '@grids/ui';
import { AlignCenter, AlignLeft, AlignRight, Bold, Type } from 'lucide-react';
import { useState } from 'react';
import { ChoiceCards } from './fields';
import { Slider } from './Slider';

/** How an answer is printed: a picture (a photo, a signature) or text (everything else). */
export type AnswerKind = 'text' | 'picture';
export const kindOfAnswer = (type: string | undefined): AnswerKind => (type === 'image' || type === 'signature' ? 'picture' : 'text');

const MM = 2.8346;
/** A picture's tallest edge is `size × 3` points; shown to people in millimetres. */
const heightMm = (size: number) => Math.round((size * 3) / MM);
const sizeOfMm = (mm: number) => Math.max(6, Math.min(72, Math.round((mm * MM) / 3)));

const DEFAULTS: Record<AnswerKind, Pick<PlacedField, 'width' | 'size' | 'bold'>> = {
  text: { width: 40, size: 12, bold: false },
  picture: { width: 30, size: 24, bold: false },
};

/**
 * Adds an answer to the page, or changes one. What can be set depends on what the answer is: text has a weight and
 * a size; a picture has a height instead, and neither can be bold.
 */
export function PlacedAnswerDialog({
  value,
  isNew,
  pageCount,
  options,
  typeOf,
  onSave,
  onClose,
}: {
  value: PlacedField;
  isNew: boolean;
  pageCount: number;
  options: { value: string; label: string; description?: React.ReactNode; text?: string }[];
  typeOf(key: string): string | undefined;
  onSave(f: PlacedField): void;
  onClose(): void;
}) {
  const [f, setF] = useState(value);
  const kind = kindOfAnswer(typeOf(f.key));
  const patch = (p: Partial<PlacedField>) => setF({ ...f, ...p });
  const pick = (key: string) => {
    const next = kindOfAnswer(typeOf(key));
    // A different kind of answer starts with sizes that suit it.
    setF({ ...f, key, ...(next !== kind && DEFAULTS[next]) });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add an answer' : 'Edit answer'}
      description="Choose the answer, then how it is printed. Drag it on the page to place it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!f.key} onClick={() => onSave({ ...f, width: Math.min(f.width, 100 - Math.min(f.x, 95)) })}>
            {isNew ? 'Add to page' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Answer" intro={kind === 'picture' ? 'A picture: it is drawn, not described' : 'What is printed here'}>
          <Listbox searchable label="Answer" value={f.key || null} onChange={pick} options={options} placeholder="Choose an answer" />
        </Field>
        {pageCount > 1 && (
          <Field label="Page">
            <Listbox
              label="Page"
              value={String(f.page ?? 1)}
              onChange={(v) => patch({ page: Number(v) })}
              options={Array.from({ length: pageCount }, (_, i) => ({ value: String(i + 1), label: `Page ${i + 1}` }))}
            />
          </Field>
        )}
        {f.key && (
          <>
            <ChoiceCards
              label={kind === 'picture' ? 'Position' : 'Alignment'}
              intro={kind === 'picture' ? 'Where the picture sits in its box' : 'How the answer sits in its box'}
              value={f.align}
              onChange={(align) => patch({ align })}
              options={{
                left: { label: 'Left', text: kind === 'picture' ? 'At the left of its box.' : 'Starts at the left of its box.', icon: AlignLeft },
                center: { label: 'Centre', text: kind === 'picture' ? 'In the middle of its box.' : 'Centred in its box.', icon: AlignCenter },
                right: { label: 'Right', text: kind === 'picture' ? 'At the right of its box.' : 'Ends at the right of its box.', icon: AlignRight },
              }}
            />
            {kind === 'text' && (
              <>
                <ChoiceCards
                  label="Text"
                  intro="Weight of the printed answer"
                  value={f.bold ? 'bold' : 'normal'}
                  onChange={(w) => patch({ bold: w === 'bold' })}
                  options={{
                    normal: { label: 'Regular', text: 'Normal weight.', icon: Type },
                    bold: { label: 'Bold', text: 'Heavier, to stand out.', icon: Bold },
                  }}
                />
                <Slider label="Text size" intro="Size of the printed answer" value={f.size} min={6} max={48} unit=" pt" onChange={(size) => patch({ size })} />
              </>
            )}
            {kind === 'picture' && (
              <Slider label="Height" intro="The tallest a picture may be. Several pictures share the box side by side" value={heightMm(f.size)} min={5} max={76} unit=" mm" onChange={(mm) => patch({ size: sizeOfMm(mm) })} />
            )}
            <Slider
              label="Width"
              intro="How much of the page the answer may use"
              value={Math.round(f.width)}
              min={5}
              max={100}
              unit="%"
              onChange={(width) => patch({ width, x: Math.min(f.x, 100 - width) })}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
