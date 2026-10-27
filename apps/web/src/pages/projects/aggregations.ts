import { ArrowDownToLine, ArrowUpToLine, Clock, Hash, ListChecks, Sigma, Waves, type LucideIcon } from 'lucide-react';

/** Each way of combining readings by its proper name, with what it does. `yesNo` is how it reads for yes/no readings. */
export const AGGREGATION_INFO: Record<string, { label: string; text: string; icon: LucideIcon; yesNo?: string }> = {
  sum: { label: 'Sum', text: 'Total of all readings', icon: Sigma, yesNo: 'Number of yes answers' },
  avg: { label: 'Average', text: 'Mean of the readings', icon: Waves, yesNo: 'Share of answers that are yes' },
  min: { label: 'Minimum', text: 'Lowest reading', icon: ArrowDownToLine },
  max: { label: 'Maximum', text: 'Highest reading', icon: ArrowUpToLine },
  last: { label: 'Latest', text: 'Most recent reading', icon: Clock, yesNo: 'Most recent answer' },
  count: { label: 'Count', text: 'Number of readings', icon: Hash },
  distinct: { label: 'Distinct count', text: 'How many different places or values', icon: ListChecks },
};

/** Listbox options for the given aggregations, in the order given. */
export const aggregationOptions = <T extends string>(keys: readonly T[], yesNo = false) =>
  keys.flatMap((a) => {
    const i = AGGREGATION_INFO[a];
    return i ? [{ value: a, label: i.label, description: (yesNo && i.yesNo) || i.text, icon: i.icon }] : [];
  });
