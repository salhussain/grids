import { forStage, validate } from '@grids/forms';
import type { FormDefinition, SubmissionDto } from '@grids/schema';
import { ApiError } from '@grids/ui';
import { ClipboardPen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormEnv } from '../projects/FormInputs';
import { FormRenderer, type Answers } from '../projects/FormRenderer';

/**
 * The part of a form an approval step's approvers fill in while they decide (sections with `fillAt`):
 * its answers go with the Approve button, and are checked there like any form's.
 */
export function useStagePart(s: SubmissionDto | undefined, published: FormDefinition | null | undefined) {
  const part = s?.canReview && s.nodeId && published ? forStage(published, s.nodeId) : null;
  const def = part && part.sections.length ? part : null;
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seed = `${s?.id}:${s?.nodeId}:${s?.reviews.length}`;
  useEffect(() => {
    setAnswers(s?.answers ?? {});
    setErrors({});
    // Started again for each submission and step, not on every refresh of its answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  return {
    def,
    answers,
    setAnswers,
    errors,
    /** Checks the answers here first; false when some need attention. */
    check(): boolean {
      if (!def) return true;
      const r = validate(def, answers);
      setErrors(r.errors);
      return r.ok;
    },
    /** What the server said was wrong with them. */
    fail(e: unknown) {
      if (e instanceof ApiError && e.problem.errors) setErrors(Object.fromEntries(e.problem.errors.map((x) => [x.path, x.message])));
    },
  };
}

export function StagePartCard({ part, s, tenantId, project }: { part: ReturnType<typeof useStagePart>; s: SubmissionDto; tenantId: string; project: string }) {
  if (!part.def) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center bg-accent-600 text-on-accent">
          <ClipboardPen className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Your part</h3>
          <p className="text-xs text-zinc-500">{`Fill this in to approve. It is kept with the application${s.stageName ? `, from ${s.stageName}` : ''}.`}</p>
        </div>
      </div>
      <FormEnv.Provider value={{ tenantId, project, formKey: s.formKey, subjectId: s.entity?.id ?? null, answers: {} }}>
        <FormRenderer definition={part.def} answers={part.answers} onChange={part.setAnswers} errors={part.errors} />
      </FormEnv.Provider>
    </section>
  );
}

/** The form without this step's own sections, which the card above shows for filling in. */
export const withoutStagePart = (def: FormDefinition | null, nodeId: string | null | undefined, editing: boolean): FormDefinition | null =>
  def && editing && nodeId ? { ...def, sections: def.sections.filter((x) => x.fillAt !== nodeId) } : def;
