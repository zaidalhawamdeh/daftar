// Posting. An entry is accepted only if it balances; once posted it is never edited or deleted.
// A mistake is undone with a reversing entry, as a bookkeeper would.

import type { AccountType } from './accounts.ts';
import type { Company, Entry, EntrySource, Line } from './company.ts';
import type { PartyKind } from './parties.ts';
import { isIsoDate } from './dates.ts';
import { formatAmount, isMinor } from './money.ts';
import { err, ok, type Result } from './result.ts';

export const MAX_LINES = 1000; // a 500-line document plus its control line fits
const MAX_MEMO = 1000;

export interface EntryInput {
  date: unknown;
  memo?: unknown;
  lines: unknown;
  source?: EntrySource | null;
}

// Receivable lines must name a customer and payable lines a vendor, so every balance can be traced
// to someone and customer balances always add up to the receivables account. They are written only by
// documents (invoices, bills, payments, credits), so every amount owed is also an open document.
// Opening balances are entered as invoices and bills, as QuickBooks does.
const PARTY_FOR: Partial<Record<AccountType, PartyKind>> = { accounts_receivable: 'customer', accounts_payable: 'vendor' };

function memoOf(v: unknown): Result<string> {
  if (v === undefined || v === null) return ok('');
  if (typeof v !== 'string') return err('memo.invalid', 'Memo must be text.');
  if (v.length > MAX_MEMO) return err('memo.too_long', `Memo is longer than ${MAX_MEMO} characters.`);
  return ok(v.trim());
}

function checkDate(c: Company, date: unknown): Result<string> {
  if (!isIsoDate(date)) return err('date.invalid', 'Date must be a real date (YYYY-MM-DD).', { date });
  if (c.closingDate && date <= c.closingDate) {
    return err('date.closed', `The books are closed through ${c.closingDate}.`, { date, closingDate: c.closingDate });
  }
  return ok(date);
}

export function validateEntry(c: Company, input: EntryInput): Result<Omit<Entry, 'id'>> {
  if (typeof input !== 'object' || input === null) return err('entry.invalid', 'Entry is missing.');
  const date = checkDate(c, input.date);
  if (!date.ok) return date;
  const memo = memoOf(input.memo);
  if (!memo.ok) return memo;
  if (!Array.isArray(input.lines)) return err('entry.lines_invalid', 'Entry lines are missing.');
  if (input.lines.length < 2) return err('entry.too_few_lines', 'An entry needs at least two lines.');
  if (input.lines.length > MAX_LINES) return err('entry.too_many_lines', `An entry has at most ${MAX_LINES} lines.`);

  const lines: Line[] = [];
  let debits = 0;
  let credits = 0;
  for (const [i, raw] of input.lines.entries()) {
    const where = { line: i + 1 };
    if (typeof raw !== 'object' || raw === null) return err('line.invalid', `Line ${i + 1} is not a line.`, where);
    const l = raw as Record<string, unknown>;
    const account = typeof l.accountId === 'string' ? c.accounts.get(l.accountId) : undefined;
    if (!account) return err('line.account_missing', `Line ${i + 1}: account does not exist.`, where);
    if (!account.active) return err('line.account_inactive', `Line ${i + 1}: "${account.name}" is inactive.`, where);
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    if (!isMinor(debit) || !isMinor(credit) || debit < 0 || credit < 0) {
      return err('line.amount_invalid', `Line ${i + 1}: amounts must be whole, non-negative minor units.`, where);
    }
    if ((debit > 0) === (credit > 0)) {
      return err('line.one_side', `Line ${i + 1}: put the amount in either debit or credit.`, where);
    }
    const memo = memoOf(l.memo);
    if (!memo.ok) return memo;
    let partyId: string | null = null;
    if (l.partyId !== undefined && l.partyId !== null) {
      const party = typeof l.partyId === 'string' ? c.parties.get(l.partyId) : undefined;
      if (!party) return err('line.party_missing', `Line ${i + 1}: name does not exist.`, where);
      partyId = party.id;
    }
    const needs = PARTY_FOR[account.type];
    if (needs && !input.source) {
      return err('line.control_needs_document', `Line ${i + 1}: "${account.name}" changes through invoices, bills, payments and credits, not journal entries.`, where);
    }
    if (needs) {
      const party = partyId ? c.parties.get(partyId) : undefined;
      if (!party) return err('line.party_required', `Line ${i + 1}: "${account.name}" needs a ${needs}.`, where);
      if (party.kind !== needs) return err('line.party_kind', `Line ${i + 1}: "${account.name}" needs a ${needs}, not a ${party.kind}.`, where);
    }
    debits += debit;
    credits += credit;
    if (!Number.isSafeInteger(debits) || !Number.isSafeInteger(credits)) return err('amount.too_large', 'Entry total is too large.');
    lines.push({ accountId: account.id, debit, credit, memo: memo.value, partyId });
  }
  if (debits !== credits) {
    return err('entry.unbalanced', `Debits ${formatAmount(debits, c.currency)} do not equal credits ${formatAmount(credits, c.currency)}.`, {
      debits,
      credits,
    });
  }
  const source = input.source ?? null;
  return ok({ date: date.value, memo: memo.value, lines, reverses: null, source: source ? { kind: source.kind, id: source.id } : null });
}

// Posted entries are frozen: nothing, inside or outside the core, can edit one after the fact.
function freeze(e: Entry): Entry {
  for (const l of e.lines) Object.freeze(l);
  Object.freeze(e.lines);
  return Object.freeze(e);
}

export function postEntry(c: Company, input: EntryInput): Result<Entry> {
  const v = validateEntry(c, input);
  if (!v.ok) return v;
  const entry = freeze({ id: c.nextEntryId++, ...v.value });
  c.entries.push(entry);
  return ok(entry);
}

export function reversalOf(c: Company, entryId: number): Entry | undefined {
  return c.entries.find((e) => e.reverses === entryId);
}

export interface ReverseInput {
  entryId: unknown;
  date: unknown;
  memo?: unknown;
}

// An entry that belongs to a document is undone by voiding the document, which keeps the document
// and its entry in step; only `voidDoc` passes `forDocument`.
export function reverseEntry(c: Company, input: ReverseInput, opts: { forDocument?: boolean } = {}): Result<Entry> {
  if (typeof input !== 'object' || input === null) return err('entry.invalid', 'Reversal details are missing.');
  const original = c.entries.find((e) => e.id === input.entryId);
  if (!original) return err('entry.missing', 'Entry does not exist.');
  if (original.source && !opts.forDocument) {
    return err('entry.has_document', `Entry ${original.id} belongs to a ${original.source.kind.replace('_', ' ')}; void the document instead.`);
  }
  const existing = reversalOf(c, original.id);
  if (existing) return err('entry.already_reversed', `Entry ${original.id} is already reversed by entry ${existing.id}.`);
  if (original.reverses !== null) return err('entry.is_reversal', `Entry ${original.id} is itself a reversal; post a new entry instead.`);
  const date = checkDate(c, input.date);
  if (!date.ok) return date;
  if (date.value < original.date) return err('date.before_original', 'A reversal cannot be dated before the entry it reverses.');
  for (const l of original.lines) {
    const a = c.accounts.get(l.accountId);
    if (!a?.active) return err('line.account_inactive', `"${a?.name ?? l.accountId}" is inactive; reactivate it to reverse.`);
  }
  const memo = memoOf(input.memo ?? `Reversal of entry ${original.id}`);
  if (!memo.ok) return memo;
  const entry = freeze({
    id: c.nextEntryId++,
    date: date.value,
    memo: memo.value,
    lines: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo, partyId: l.partyId })),
    reverses: original.id,
    source: original.source,
  });
  c.entries.push(entry);
  return ok(entry);
}
