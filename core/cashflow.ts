// Statement of cash flows, indirect method: start from net income and adjust by how much each
// balance-sheet account (other than cash) moved during the period. Cash is every bank account.
//
// Because every entry balances, net income + the adjustments equals the change in cash exactly;
// the report refuses to return if it ever does not.

import { ACCOUNT_TYPES, classOf, type AccountType } from './accounts.ts';
import type { Company } from './company.ts';
import { dayBefore, isIsoDate } from './dates.ts';
import { sum, type Minor } from './money.ts';
import { balancesBetween } from './reports.ts';
import { err, ok, type Result } from './result.ts';

type Activity = 'operating' | 'investing' | 'financing';

// Where each kind of account belongs, as small-business accounting software classifies them.
const ACTIVITY: Partial<Record<AccountType, Activity>> = {
  accounts_receivable: 'operating',
  other_current_asset: 'operating',
  accounts_payable: 'operating',
  credit_card: 'operating',
  other_current_liability: 'operating',
  fixed_asset: 'investing',
  other_asset: 'investing',
  long_term_liability: 'financing',
  equity: 'financing',
};

export interface CashFlowRow {
  accountId: string;
  number: string;
  name: string;
  amount: Minor; // cash it brought in (+) or used (−)
}

export interface CashFlowSection {
  rows: CashFlowRow[];
  total: Minor;
}

export interface CashFlow {
  from: string;
  to: string;
  netIncome: Minor;
  operating: CashFlowSection; // adjustments to net income
  netOperating: Minor;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: Minor;
  cashAtBeginning: Minor;
  cashAtEnd: Minor;
}

export function cashFlow(c: Company, from: unknown, to: unknown): Result<CashFlow> {
  if (!isIsoDate(from) || !isIsoDate(to)) return err('date.invalid', 'Report dates must be real dates (YYYY-MM-DD).');
  if (from > to) return err('date.range', 'The start date is after the end date.');
  const before = balancesBetween(c, null, dayBefore(from));
  const after = balancesBetween(c, null, to);
  if (!before.ok) return before;
  if (!after.ok) return after;
  const change = (id: string) => (after.value.get(id) ?? 0) - (before.value.get(id) ?? 0);

  const sections: Record<Activity, CashFlowRow[]> = { operating: [], investing: [], financing: [] };
  const pl: Minor[] = [];
  const cashBefore: Minor[] = [];
  const cashAfter: Minor[] = [];
  const accounts = [...c.accounts.values()].sort((a, b) => ACCOUNT_TYPES[a.type].order - ACCOUNT_TYPES[b.type].order || a.number.localeCompare(b.number, 'en', { numeric: true }));
  for (const a of accounts) {
    const d = change(a.id);
    if (!Number.isSafeInteger(d)) return err('amount.too_large', 'A change is too large to report.');
    const k = classOf(a.type);
    if (k === 'income' || k === 'expense') {
      pl.push(-d);
      continue;
    }
    if (a.type === 'bank') {
      cashBefore.push(before.value.get(a.id) ?? 0);
      cashAfter.push(after.value.get(a.id) ?? 0);
      continue;
    }
    const activity = ACTIVITY[a.type];
    if (activity && d !== 0) sections[activity].push({ accountId: a.id, number: a.number, name: a.name, amount: -d });
  }
  const total = (rows: CashFlowRow[]) => sum(rows.map((r) => r.amount));
  const netIncome = sum(pl);
  const op = total(sections.operating);
  const inv = total(sections.investing);
  const fin = total(sections.financing);
  const begin = sum(cashBefore);
  const end = sum(cashAfter);
  for (const r of [netIncome, op, inv, fin, begin, end]) if (!r.ok) return r;
  const v = (r: Result<Minor>) => (r.ok ? r.value : 0);
  const netOperating = v(netIncome) + v(op);
  const netChange = netOperating + v(inv) + v(fin);
  if (!Number.isSafeInteger(netChange)) return err('amount.too_large', 'Totals are too large to report.');
  if (v(begin) + netChange !== v(end)) {
    return err('cashflow.unbalanced', 'Cash flow does not reconcile to the change in cash; please report this.', { netChange, begin: v(begin), end: v(end) });
  }
  return ok({
    from,
    to,
    netIncome: v(netIncome),
    operating: { rows: sections.operating, total: v(op) },
    netOperating,
    investing: { rows: sections.investing, total: v(inv) },
    financing: { rows: sections.financing, total: v(fin) },
    netChange,
    cashAtBeginning: v(begin),
    cashAtEnd: v(end),
  });
}
