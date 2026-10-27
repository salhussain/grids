import { blobIdOf, isLocalRef } from '@grids/offline';
import type { FormDefinition, Question } from '@grids/schema';
import { defaultRow, formState, mdToText, validate, type Answers, type Scope } from '@grids/forms';
import type { ComponentType } from 'react';
import { View } from 'react-native';
import { Button, Card, Txt, useTheme } from '../ui';
import { BooleanField, DateField, FileField, GeoField, ImageField, MultiSelectField, NumberField, PlaceField, RatingField, ScanField, SelectField, SignatureField, TextInputField, type InputProps } from './inputs';

/** Pictures are `local:<id>` until they are uploaded; the rules want the id alone. */
const unlocal = (v: unknown): unknown =>
  isLocalRef(v) ? blobIdOf(v) : Array.isArray(v) ? v.map(unlocal) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unlocal(x)])) : v;

/** The same checks as the server, on what the person has answered so far. */
export function checkAnswers(def: FormDefinition, answers: Answers) {
  return validate(def, unlocal(answers) as Answers);
}

const INPUTS: Partial<Record<Question['type'], ComponentType<InputProps<never>>>> = {
  text: TextInputField as never,
  textarea: TextInputField as never,
  phone: TextInputField as never,
  email: TextInputField as never,
  url: TextInputField as never,
  integer: NumberField as never,
  decimal: NumberField as never,
  select: SelectField as never,
  multiselect: MultiSelectField as never,
  boolean: BooleanField as never,
  date: DateField as never,
  datetime: DateField as never,
  time: DateField as never,
  rating: RatingField as never,
  geopoint: GeoField as never,
  qr: ScanField as never,
  image: ImageField as never,
  file: FileField as never,
  signature: SignatureField as never,
  entity: PlaceField as never,
};

function QuestionView({ q, scope, value, onChange, error }: { q: Question; scope: Scope; value: unknown; onChange(v: unknown): void; error?: string | undefined }) {
  const c = useTheme();
  if (q.type === 'note') return <Txt muted>{mdToText(q.label)}</Txt>;
  const Input = INPUTS[q.type];
  return (
    <View style={{ gap: 6 }}>
      <Txt strong>
        {q.label}
        {q.required ? <Txt color={c.danger}> *</Txt> : null}
      </Txt>
      {q.hint ? <Txt muted small>{mdToText(q.hint)}</Txt> : null}
      {q.type === 'calculate' ? (
        <Txt>{scope.values[q.key] === undefined || scope.values[q.key] === null ? '—' : String(scope.values[q.key])}</Txt>
      ) : Input ? (
        <Input q={q} value={value as never} onChange={onChange as never} invalid={!!error} />
      ) : (
        <Txt muted small>This kind of question is not supported in the app yet.</Txt>
      )}
      {error ? <Txt small color={c.danger}>{error}</Txt> : null}
    </View>
  );
}

const without = (a: Answers, key: string): Answers => {
  const { [key]: _gone, ...rest } = a;
  return rest;
};

interface Props {
  def: FormDefinition;
  answers: Answers;
  onChange(next: Answers): void;
  errors: Record<string, string>;
}

/** Every section and question of a form, as the person sees them now: what is relevant, what repeats. */
export function FormFiller({ def, answers, onChange, errors }: Props) {
  const state = formState(def, answers);
  const set = (key: string, v: unknown) => onChange(v === undefined ? without(answers, key) : { ...answers, [key]: v });

  return (
    <View style={{ gap: 18 }}>
      {def.sections
        .filter((s) => state.shown.has(s.key))
        .map((s) => {
          if (!s.repeat) {
            return (
              <Card key={s.key} style={{ gap: 14 }}>
                {s.title ? <Txt strong style={{ fontSize: 18 }}>{s.title}</Txt> : null}
                {s.questions
                  .filter((q) => state.shown.has(q.key))
                  .map((q) => (
                    <QuestionView key={q.key} q={q} scope={state} value={answers[q.key]} onChange={(v) => set(q.key, v)} error={errors[q.key]} />
                  ))}
              </Card>
            );
          }
          const rows = Array.isArray(answers[s.key]) ? (answers[s.key] as Answers[]) : [];
          const states = state.rows[s.key] ?? [];
          const max = s.repeat.max ?? 100;
          return (
            <View key={s.key} style={{ gap: 10 }}>
              {s.title ? <Txt strong style={{ fontSize: 18 }}>{s.title}</Txt> : null}
              {errors[s.key] ? <Txt small color="#c62828">{errors[s.key]}</Txt> : null}
              {rows.map((row, i) => (
                <Card key={i} style={{ gap: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Txt muted>{`#${i + 1}`}</Txt>
                    <Button small kind="danger" title="Remove" onPress={() => set(s.key, rows.filter((_, j) => j !== i))} />
                  </View>
                  {s.questions
                    .filter((q) => states[i]?.shown.has(q.key))
                    .map((q) => (
                      <QuestionView
                        key={q.key}
                        q={q}
                        scope={states[i]!}
                        value={row[q.key]}
                        onChange={(v) => set(s.key, rows.map((r, j) => (j === i ? (v === undefined ? without(r, q.key) : { ...r, [q.key]: v }) : r)))}
                        error={errors[`${s.key}.${i}.${q.key}`]}
                      />
                    ))}
                </Card>
              ))}
              {rows.length < max ? <Button kind="secondary" title={`Add${s.title ? ` ${s.title.toLowerCase()}` : ''}`} onPress={() => set(s.key, [...rows, defaultRow(s)])} /> : null}
            </View>
          );
        })}
    </View>
  );
}
