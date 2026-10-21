// Memorized transactions: a saved invoice, bill, expense, sales receipt, transfer or journal entry
// that can be entered again with one command, or on a schedule (rent every month, a retainer every
// quarter). Running the schedule enters every occurrence that is due, each on its own date.

import { isObject, type Company } from './company.ts';
import { addDays, addMonths, isIsoDate } from './dates.ts';
import { err, ok, type Result } from './result.ts';

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export const MEMORIZABLE: ReadonlySet<string> = new Set(['invoice.create', 'bill.create', 'expense.create', 'salesReceipt.create', 'transfer.create', 'journal.post']);

export interface Memorized {
  id: string;
  name: string;
  command: string;
  params: Record<string, unknown>; // everything but the date
  frequency: Frequency | null; // null: saved, entered by hand
  nextDate: string | null;
  endDate: string | null;
  anchorDay: number | null; // the day of month a monthly schedule keeps to
  active: boolean;
}

// Runs a command on the company (`run`) or on a throwaway copy to check it (`dryRun`).
export interface Runner {
  run(id: string, params: Record<string, unknown>): Result<unknown>;
  dryRun(id: string, params: Record<string, unknown>): Result<unknown>;
}

const MAX_RUNS = 1000;

function next(date: string, f: Frequency, anchorDay: number | null): string {
  switch (f) {
    case 'weekly':
      return addDays(date, 7);
    case 'monthly':
      return addMonths(date, 1, anchorDay ?? undefined);
    case 'quarterly':
      return addMonths(date, 3, anchorDay ?? undefined);
    case 'yearly':
      return addMonths(date, 12, anchorDay ?? undefined);
  }
}

export function createMemorized(c: Company, runner: Runner, input: unknown): Result<Memorized> {
  if (!isObject(input)) return err('memorized.invalid', 'Details are missing.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) return err('memorized.name_invalid', 'Name is text up to 100 characters.');
  for (const m of c.memorized.values()) if (m.name.toLowerCase() === name.toLowerCase()) return err('memorized.name_taken', `"${m.name}" already exists.`);
  if (typeof input.command !== 'string' || !MEMORIZABLE.has(input.command)) return err('memorized.command', 'That kind of transaction cannot be memorized.');
  if (!isObject(input.params)) return err('memorized.params', 'The transaction details are missing.');
  let params: Record<string, unknown>;
  try {
    // A number that JSON cannot hold (NaN, Infinity) would come back as null; refuse it instead.
    const text = JSON.stringify(input.params, (_k, v: unknown) => {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('not a finite number');
      return v;
    });
    params = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return err('memorized.params', 'The transaction details cannot be saved.');
  }
  delete params.date;
  // A fixed number or due date would be right once and wrong every time after.
  if (params.number !== undefined) return err('memorized.fixed_number', 'Leave the number out; each entry gets its own.');
  if (params.dueDate !== undefined) return err('memorized.fixed_due_date', 'Use terms (termsDays) instead of a fixed due date.');
  const frequency = input.frequency ?? null;
  if (frequency !== null && !FREQUENCIES.includes(frequency as Frequency)) return err('memorized.frequency', 'Frequency is weekly, monthly, quarterly or yearly.');
  let nextDate: string | null = null;
  let endDate: string | null = null;
  if (frequency !== null) {
    if (!isIsoDate(input.nextDate)) return err('date.invalid', 'Choose the date of the next occurrence.');
    nextDate = input.nextDate;
    if (c.closingDate && nextDate <= c.closingDate) return err('date.closed', `The books are closed through ${c.closingDate}; start the schedule after that.`);
    if (input.endDate !== undefined && input.endDate !== null) {
      if (!isIsoDate(input.endDate) || input.endDate < nextDate) return err('memorized.end_invalid', 'The end date must be a real date on or after the next occurrence.');
      endDate = input.endDate;
    }
  }
  // Check the transaction itself, on a copy, so a broken template is refused now rather than later.
  const trial = runner.dryRun(input.command, { ...params, date: nextDate ?? input.trialDate ?? '2000-01-01' });
  if (!trial.ok) return err('memorized.template', `The saved transaction is not valid: ${trial.error.message}`, { cause: trial.error.code });
  const m: Memorized = {
    id: `m-${c.nextMemorizedId++}`,
    name,
    command: input.command,
    params,
    frequency: frequency as Frequency | null,
    nextDate,
    endDate,
    anchorDay: nextDate && frequency !== 'weekly' ? Number(nextDate.slice(8)) : null,
    active: true,
  };
  c.memorized.set(m.id, m);
  return ok(m);
}

// Enter a memorized transaction once, on the given date. This does not move its schedule.
export function runMemorized(c: Company, runner: Runner, input: unknown): Result<unknown> {
  if (!isObject(input)) return err('memorized.invalid', 'Details are missing.');
  const m = typeof input.id === 'string' ? c.memorized.get(input.id) : undefined;
  if (!m) return err('memorized.missing', 'That memorized transaction does not exist.');
  if (!isIsoDate(input.date)) return err('date.invalid', 'Choose the date to enter it on.');
  return runner.run(m.command, { ...structuredClone(m.params), date: input.date });
}

// Enter every scheduled occurrence due on or before `asOf`. All or nothing: if one fails, the
// command fails and the caller's snapshot puts everything back.
export function runDue(c: Company, runner: Runner, input: unknown): Result<{ memorizedId: string; date: string; result: unknown }[]> {
  if (!isObject(input) || !isIsoDate(input.asOf)) return err('date.invalid', 'Choose the date to run the schedule through.');
  const asOf = input.asOf;
  const made: { memorizedId: string; date: string; result: unknown }[] = [];
  const due = [...c.memorized.values()].filter((m) => m.active && m.frequency && m.nextDate).sort((a, b) => a.name.localeCompare(b.name));
  for (const m of due) {
    while (m.nextDate && m.nextDate <= asOf && (m.endDate === null || m.nextDate <= m.endDate)) {
      if (made.length >= MAX_RUNS) return err('memorized.too_many', `More than ${MAX_RUNS} occurrences are due; run the schedule in smaller steps.`);
      const r = runner.run(m.command, { ...structuredClone(m.params), date: m.nextDate });
      if (!r.ok) return err('memorized.run_failed', `"${m.name}" on ${m.nextDate}: ${r.error.message}`, { memorizedId: m.id, date: m.nextDate, cause: r.error.code });
      made.push({ memorizedId: m.id, date: m.nextDate, result: r.value });
      const n = next(m.nextDate, m.frequency!, m.anchorDay);
      m.nextDate = !isIsoDate(n) || (m.endDate !== null && n > m.endDate) ? null : n;
    }
  }
  return ok(made);
}

export function setMemorizedActive(c: Company, input: unknown): Result<Memorized> {
  if (!isObject(input)) return err('memorized.invalid', 'Details are missing.');
  const m = typeof input.id === 'string' ? c.memorized.get(input.id) : undefined;
  if (!m) return err('memorized.missing', 'That memorized transaction does not exist.');
  if (typeof input.active !== 'boolean') return err('memorized.active_invalid', 'Active must be true or false.');
  m.active = input.active;
  return ok(m);
}

export function deleteMemorized(c: Company, input: unknown): Result<Memorized> {
  if (!isObject(input)) return err('memorized.invalid', 'Details are missing.');
  const m = typeof input.id === 'string' ? c.memorized.get(input.id) : undefined;
  if (!m) return err('memorized.missing', 'That memorized transaction does not exist.');
  c.memorized.delete(m.id);
  return ok(m);
}
