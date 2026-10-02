import { CronExpressionParser } from 'cron-parser';

/** Next fire time strictly after `from` for a 5-field cron in a time zone. */
export function nextRun(cron: string, timezone = 'UTC', from = new Date()): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone }).next().toDate();
}

/** Validates a cron expression; returns an error message or null. */
export function cronProblem(cron: string, timezone = 'UTC'): string | null {
  try {
    nextRun(cron, timezone);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid schedule';
  }
}
