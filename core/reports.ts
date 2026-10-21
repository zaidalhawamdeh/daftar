// Reports are computed from posted entries every time. Nothing here is stored, so nothing can drift.
//
// Conventions, as small-business accounting software presents them:
// - Income and expense accounts show the fiscal year to date; earlier years' profit appears on the
//   balance sheet as Retained Earnings, and the current year's as Net Income.
// - Amounts in report rows carry their natural sign: a normal balance is positive.

import { ACCOUNT_TYPES, classOf, normalSide, type Account, type AccountClass, type AccountType } from './accounts.ts';
import { retainedEarnings, type Company } from './company.ts';
import { dayBefore, fiscalYearStart, isIsoDate } from './dates.ts';
import type { Minor } from './money.ts';
import { err, ok, type Result } from './result.ts';

type Balances = Map<string, Minor>; // debit-positive

function accumulate(c: Company, from: string | null, to: string): Result<Balances> {
  const m: Balances = new Map();
  for (const e of c.entries) {
    if (e.date > to || (from !== null && e.date < from)) continue;
    for (const l of e.lines) {
      const v = (m.get(l.accountId) ?? 0) + l.debit - l.credit;
      if (!Number.isSafeInteger(v)) return err('amount.too_large', 'A balance is too large to report.');
      m.set(l.accountId, v);
    }
  }
  return ok(m);
}

const sign = (t: AccountType): 1 | -1 => (normalSide(t) === 'debit' ? 1 : -1);
const isPL = (t: AccountType) => {
  const k = classOf(t);
  return k === 'income' || k === 'expense';
};

function compareAccounts(a: Account, b: Account): number {
  const t = ACCOUNT_TYPES[a.type].order - ACCOUNT_TYPES[b.type].order;
  if (t) return t;
  if (a.number !== b.number) {
    if (!a.number) return 1;
    if (!b.number) return -1;
    return a.number.localeCompare(b.number, 'en', { numeric: true });
  }
  return a.name.localeCompare(b.name);
}

export interface ReportRow {
  accountId: string;
  number: string;
  name: string;
  type: AccountType;
  depth: number;
  amount: Minor; // this account alone
  total: Minor; // this account and its sub-accounts
}

// Rows in tree order for the given accounts. A row is kept if it or a sub-account has an amount.
function buildRows(accounts: Account[], own: (a: Account) => Minor): { rows: ReportRow[]; total: Minor } {
  const ids = new Set(accounts.map((a) => a.id));
  const kids = new Map<string | null, Account[]>();
  for (const a of accounts) {
    const key = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    const list = kids.get(key) ?? [];
    list.push(a);
    kids.set(key, list);
  }
  for (const list of kids.values()) list.sort(compareAccounts);

  const walk = (a: Account, depth: number): { rows: ReportRow[]; total: Minor } => {
    const amount = own(a);
    let total = amount;
    const below: ReportRow[] = [];
    for (const k of kids.get(a.id) ?? []) {
      const r = walk(k, depth + 1);
      total += r.total;
      below.push(...r.rows);
    }
    if (amount === 0 && below.length === 0) return { rows: [], total: 0 };
    const row: ReportRow = { accountId: a.id, number: a.number, name: a.name, type: a.type, depth, amount, total };
    return { rows: [row, ...below], total };
  };

  const rows: ReportRow[] = [];
  let total = 0;
  for (const top of kids.get(null) ?? []) {
    const r = walk(top, 0);
    rows.push(...r.rows);
    total += r.total;
  }
  return { rows, total };
}

function checkDates(...dates: unknown[]): Result<true> {
  for (const d of dates) if (!isIsoDate(d)) return err('date.invalid', 'Report dates must be real dates (YYYY-MM-DD).', { date: d });
  return ok(true);
}

// Net income of all entries in [from, to]: income minus expenses, positive for a profit.
function netIncome(c: Company, b: Balances): Minor {
  let n = 0;
  for (const [id, v] of b) {
    const a = c.accounts.get(id);
    if (a && isPL(a.type)) n -= v;
  }
  return n;
}

// ---------------------------------------------------------------- trial balance

export interface TrialBalanceRow {
  accountId: string;
  number: string;
  name: string;
  type: AccountType;
  debit: Minor;
  credit: Minor;
}

export interface TrialBalance {
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: Minor;
  totalCredit: Minor;
}

export function trialBalance(c: Company, asOf: unknown): Result<TrialBalance> {
  const d = checkDates(asOf);
  if (!d.ok) return d;
  const date = asOf as string;
  const fyStart = fiscalYearStart(date, c.fiscalYearStartMonth);
  const all = accumulate(c, null, date);
  if (!all.ok) return all;
  const prior = accumulate(c, null, dayBefore(fyStart));
  if (!prior.ok) return prior;

  const re = retainedEarnings(c);
  const net = new Map<string, Minor>();
  for (const [id, v] of all.value) {
    const a = c.accounts.get(id);
    if (!a) continue;
    net.set(id, isPL(a.type) ? v - (prior.value.get(id) ?? 0) : v);
  }
  // Earlier years' profit is a credit to retained earnings.
  net.set(re.id, (net.get(re.id) ?? 0) - netIncome(c, prior.value));

  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const a of [...c.accounts.values()].sort(compareAccounts)) {
    const v = net.get(a.id) ?? 0;
    if (v === 0) continue;
    const row = { accountId: a.id, number: a.number, name: a.name, type: a.type, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 };
    totalDebit += row.debit;
    totalCredit += row.credit;
    rows.push(row);
  }
  if (!Number.isSafeInteger(totalDebit) || !Number.isSafeInteger(totalCredit)) return err('amount.too_large', 'Totals are too large to report.');
  return ok({ asOf: date, rows, totalDebit, totalCredit });
}

// ---------------------------------------------------------------- profit and loss

export interface Section {
  rows: ReportRow[];
  total: Minor;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  income: Section;
  costOfGoodsSold: Section;
  grossProfit: Minor;
  expenses: Section;
  netOperatingIncome: Minor;
  otherIncome: Section;
  otherExpenses: Section;
  netOtherIncome: Minor;
  netIncome: Minor;
}

export function profitAndLoss(c: Company, from: unknown, to: unknown): Result<ProfitAndLoss> {
  const d = checkDates(from, to);
  if (!d.ok) return d;
  if ((from as string) > (to as string)) return err('date.range', 'The start date is after the end date.');
  const b = accumulate(c, from as string, to as string);
  if (!b.ok) return b;
  const section = (types: AccountType[]): Section =>
    buildRows(
      [...c.accounts.values()].filter((a) => types.includes(a.type)),
      (a) => sign(a.type) * (b.value.get(a.id) ?? 0),
    );
  const income = section(['income']);
  const costOfGoodsSold = section(['cost_of_goods_sold']);
  const expenses = section(['expense']);
  const otherIncome = section(['other_income']);
  const otherExpenses = section(['other_expense']);
  const grossProfit = income.total - costOfGoodsSold.total;
  const netOperatingIncome = grossProfit - expenses.total;
  const netOtherIncome = otherIncome.total - otherExpenses.total;
  return ok({
    from: from as string,
    to: to as string,
    income,
    costOfGoodsSold,
    grossProfit,
    expenses,
    netOperatingIncome,
    otherIncome,
    otherExpenses,
    netOtherIncome,
    netIncome: netOperatingIncome + netOtherIncome,
  });
}

// ---------------------------------------------------------------- balance sheet

export interface Group {
  type: AccountType;
  rows: ReportRow[];
  total: Minor;
}

export interface EquityExtra {
  retainedEarnings: Minor; // added to the retained earnings account: profit of earlier fiscal years
  netIncome: Minor; // this fiscal year to date
}

export interface BalanceSheet {
  asOf: string;
  assets: { groups: Group[]; total: Minor };
  liabilities: { groups: Group[]; total: Minor };
  equity: { groups: Group[]; extra: EquityExtra; total: Minor };
  totalLiabilitiesAndEquity: Minor;
}

export function balanceSheet(c: Company, asOf: unknown): Result<BalanceSheet> {
  const d = checkDates(asOf);
  if (!d.ok) return d;
  const date = asOf as string;
  const fyStart = fiscalYearStart(date, c.fiscalYearStartMonth);
  const all = accumulate(c, null, date);
  if (!all.ok) return all;
  const prior = accumulate(c, null, dayBefore(fyStart));
  if (!prior.ok) return prior;
  const current = accumulate(c, fyStart, date);
  if (!current.ok) return current;

  const groupsOf = (k: AccountClass): { groups: Group[]; total: Minor } => {
    const groups: Group[] = [];
    let total = 0;
    const types = (Object.keys(ACCOUNT_TYPES) as AccountType[])
      .filter((t) => ACCOUNT_TYPES[t].class === k)
      .sort((x, y) => ACCOUNT_TYPES[x].order - ACCOUNT_TYPES[y].order);
    for (const t of types) {
      const s = buildRows(
        [...c.accounts.values()].filter((a) => a.type === t),
        (a) => sign(a.type) * (all.value.get(a.id) ?? 0),
      );
      if (s.rows.length) {
        groups.push({ type: t, ...s });
        total += s.total;
      }
    }
    return { groups, total };
  };

  const assets = groupsOf('asset');
  const liabilities = groupsOf('liability');
  const eq = groupsOf('equity');
  const extra: EquityExtra = { retainedEarnings: netIncome(c, prior.value), netIncome: netIncome(c, current.value) };
  const equityTotal = eq.total + extra.retainedEarnings + extra.netIncome;
  return ok({
    asOf: date,
    assets,
    liabilities,
    equity: { groups: eq.groups, extra, total: equityTotal },
    totalLiabilitiesAndEquity: liabilities.total + equityTotal,
  });
}

// ---------------------------------------------------------------- general ledger

export interface LedgerLine {
  entryId: number;
  date: string;
  memo: string;
  debit: Minor;
  credit: Minor;
  balance: Minor; // running, natural sign
}

export interface LedgerAccount {
  accountId: string;
  number: string;
  name: string;
  type: AccountType;
  opening: Minor;
  lines: LedgerLine[];
  closing: Minor;
}

export function generalLedger(c: Company, from: unknown, to: unknown, accountId?: unknown): Result<LedgerAccount[]> {
  const d = checkDates(from, to);
  if (!d.ok) return d;
  if ((from as string) > (to as string)) return err('date.range', 'The start date is after the end date.');
  if (accountId !== undefined && (typeof accountId !== 'string' || !c.accounts.has(accountId))) {
    return err('account.missing', 'Account does not exist.');
  }
  const start = from as string;
  const end = to as string;
  const before = accumulate(c, null, dayBefore(start));
  if (!before.ok) return before;
  const fyBefore = accumulate(c, fiscalYearStart(start, c.fiscalYearStartMonth), dayBefore(start));
  if (!fyBefore.ok) return fyBefore;

  const out: LedgerAccount[] = [];
  const accounts = [...c.accounts.values()].filter((a) => accountId === undefined || a.id === accountId).sort(compareAccounts);
  const entries = c.entries.filter((e) => e.date >= start && e.date <= end).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));
  for (const a of accounts) {
    const s = sign(a.type);
    const opening = s * ((isPL(a.type) ? fyBefore.value : before.value).get(a.id) ?? 0);
    let balance = opening;
    const lines: LedgerLine[] = [];
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.accountId !== a.id) continue;
        balance += s * (l.debit - l.credit);
        lines.push({ entryId: e.id, date: e.date, memo: l.memo || e.memo, debit: l.debit, credit: l.credit, balance });
      }
    }
    if (!Number.isSafeInteger(balance)) return err('amount.too_large', 'A balance is too large to report.');
    if (lines.length || opening !== 0) out.push({ accountId: a.id, number: a.number, name: a.name, type: a.type, opening, lines, closing: balance });
  }
  return ok(out);
}
