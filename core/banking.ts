// Bank and credit card reconciliation. The person ticks the lines that appear on the statement; the
// reconciliation is saved only when the ticked lines bring the last reconciled balance exactly to the
// statement's ending balance. Ticked lines stay cleared; the latest reconciliation can be undone.
//
// At any statement date: register balance = statement ending balance + the lines not yet cleared.

import type { AccountType } from './accounts.ts';
import { isIsoDate } from './dates.ts';
import { formatAmount, isMinor, sum, type Minor } from './money.ts';
import { isObject, type Company } from './company.ts';
import { err, ok, type Result } from './result.ts';

export interface Reconciliation {
  id: number;
  accountId: string;
  statementDate: string;
  beginningBalance: Minor;
  endingBalance: Minor;
  lineKeys: string[]; // "entryId:lineIndex"
  undone: boolean;
}

export interface ClearableLine {
  key: string;
  entryId: number;
  date: string;
  memo: string;
  kind: string;
  number: string;
  amount: Minor; // bank: money in is positive; credit card: charges are positive
}

const RECONCILABLE: AccountType[] = ['bank', 'credit_card'];

function reconcilable(c: Company, accountId: unknown): Result<string> {
  const a = typeof accountId === 'string' ? c.accounts.get(accountId) : undefined;
  if (!a) return err('reconcile.account_missing', 'Choose a bank or credit card account.');
  if (!RECONCILABLE.includes(a.type)) return err('reconcile.account_type', `"${a.name}" is not a bank or credit card account.`);
  return ok(a.id);
}

function last(c: Company, accountId: string): Reconciliation | undefined {
  return c.reconciliations.filter((r) => r.accountId === accountId && !r.undone).at(-1);
}

// Lines on the account, in date order, with their natural-sign amount.
function linesOf(c: Company, accountId: string, through: string): ClearableLine[] {
  const sign = c.accounts.get(accountId)!.type === 'credit_card' ? -1 : 1;
  const out: ClearableLine[] = [];
  for (const e of c.entries) {
    if (e.date > through) continue;
    const doc = e.source ? c.documents.get(e.source.id) : undefined;
    e.lines.forEach((l, i) => {
      if (l.accountId !== accountId) return;
      const raw = l.debit - l.credit;
      out.push({
        key: `${e.id}:${i}`,
        entryId: e.id,
        date: e.date,
        memo: l.memo || e.memo,
        kind: e.reverses !== null ? 'void' : (doc?.kind ?? 'journal'),
        number: doc?.number ?? '',
        amount: raw === 0 ? 0 : sign * raw,
      });
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId - b.entryId));
}

export function reconcileCandidates(c: Company, accountId: unknown, statementDate: unknown): Result<{ beginningBalance: Minor; lines: ClearableLine[] }> {
  const acct = reconcilable(c, accountId);
  if (!acct.ok) return acct;
  if (!isIsoDate(statementDate)) return err('date.invalid', 'Statement date must be a real date (YYYY-MM-DD).');
  return ok({ beginningBalance: last(c, acct.value)?.endingBalance ?? 0, lines: linesOf(c, acct.value, statementDate).filter((l) => !c.cleared.has(l.key)) });
}

export function reconcile(c: Company, input: unknown): Result<Reconciliation> {
  if (!isObject(input)) return err('reconcile.invalid', 'Reconciliation details are missing.');
  const acct = reconcilable(c, input.accountId);
  if (!acct.ok) return acct;
  if (!isIsoDate(input.statementDate)) return err('date.invalid', 'Statement date must be a real date (YYYY-MM-DD).');
  const statementDate = input.statementDate;
  const prev = last(c, acct.value);
  if (prev && statementDate <= prev.statementDate) return err('reconcile.date_order', `The last statement reconciled ended ${prev.statementDate}.`);
  if (!isMinor(input.endingBalance)) return err('reconcile.ending_invalid', 'Ending balance must be a whole number of minor units.');
  if (!Array.isArray(input.lineKeys)) return err('reconcile.lines_invalid', 'Lines must be a list.');
  const available = new Map(linesOf(c, acct.value, statementDate).map((l) => [l.key, l]));
  const keys: string[] = [];
  for (const k of input.lineKeys) {
    if (typeof k !== 'string') return err('reconcile.line_invalid', 'Line keys are text.');
    if (keys.includes(k)) return err('reconcile.line_duplicate', `Line ${k} appears twice.`);
    if (c.cleared.has(k)) return err('reconcile.line_cleared', `Line ${k} is already reconciled.`);
    if (!available.has(k)) return err('reconcile.line_missing', `Line ${k} is not on this account by ${statementDate}.`);
    keys.push(k);
  }
  const cleared = sum(keys.map((k) => available.get(k)!.amount));
  if (!cleared.ok) return cleared;
  const beginningBalance = prev?.endingBalance ?? 0;
  const difference = input.endingBalance - beginningBalance - cleared.value;
  if (!Number.isSafeInteger(difference)) return err('amount.too_large', 'Amounts are too large.');
  if (difference !== 0) {
    return err('reconcile.difference', `Off by ${formatAmount(difference, c.currency)}: the ticked lines do not reach the statement balance.`, { difference });
  }
  const r: Reconciliation = { id: c.nextReconciliationId++, accountId: acct.value, statementDate, beginningBalance, endingBalance: input.endingBalance, lineKeys: keys, undone: false };
  c.reconciliations.push(r);
  for (const k of keys) c.cleared.set(k, r.id);
  return ok(r);
}

export function undoReconciliation(c: Company, input: unknown): Result<Reconciliation> {
  if (!isObject(input)) return err('reconcile.invalid', 'Details are missing.');
  const acct = reconcilable(c, input.accountId);
  if (!acct.ok) return acct;
  const r = last(c, acct.value);
  if (!r) return err('reconcile.none', 'Nothing has been reconciled on this account.');
  r.undone = true;
  for (const k of r.lineKeys) c.cleared.delete(k);
  return ok(r);
}

export interface ReconciliationReport {
  reconciliation: Reconciliation;
  clearedIn: Minor;
  clearedOut: Minor;
  uncleared: ClearableLine[]; // dated on or before the statement and not cleared by then
  registerBalance: Minor; // the account's own balance on the statement date
}

export function reconciliationReport(c: Company, id: unknown): Result<ReconciliationReport> {
  const r = c.reconciliations.find((x) => x.id === id);
  if (!r) return err('reconcile.missing', 'That reconciliation does not exist.');
  const all = linesOf(c, r.accountId, r.statementDate);
  const mine = new Set(r.lineKeys);
  const amounts = all.filter((l) => mine.has(l.key)).map((l) => l.amount);
  const clearedIn = sum(amounts.filter((a) => a > 0));
  const clearedOut = sum(amounts.filter((a) => a < 0).map((a) => -a));
  const register = sum(all.map((l) => l.amount));
  if (!clearedIn.ok) return clearedIn;
  if (!clearedOut.ok) return clearedOut;
  if (!register.ok) return register;
  const uncleared = all.filter((l) => {
    const by = c.cleared.get(l.key);
    return by === undefined || by > r.id;
  });
  return ok({ reconciliation: r, clearedIn: clearedIn.value, clearedOut: clearedOut.value, uncleared, registerBalance: register.value });
}
