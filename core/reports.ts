// Reports are computed from posted entries every time. Nothing here is stored, so nothing can drift.
//
// Conventions, as small-business accounting software presents them:
// - Income and expense accounts show the fiscal year to date; earlier years' profit appears on the
//   balance sheet as Retained Earnings, and the current year's as Net Income.
// - Amounts in report rows carry their natural sign: a normal balance is positive.
// - Every sum is checked: a total beyond exact integer range is refused, never rounded.

import { ACCOUNT_TYPES, classOf, normalSide, type Account, type AccountClass, type AccountType } from './accounts.ts';
import { retainedEarnings, type Company } from './company.ts';
import { dayBefore, fiscalYearStart, isIsoDate } from './dates.ts';
import type { Minor } from './money.ts';
import { err, ok, type Result } from './result.ts';

type Balances = Map<string, Minor>; // debit-positive

class Overflow extends Error {}

function plus(a: Minor, b: Minor): Minor {
  const s = a + b;
  if (!Number.isSafeInteger(s)) throw new Overflow();
  return s;
}

const minus = (a: Minor, b: Minor): Minor => plus(a, -b);

function guard<T>(run: () => Result<T>): Result<T> {
  try {
    return run();
  } catch (e) {
    if (e instanceof Overflow) return err('amount.too_large', 'A total is too large to report exactly.');
    throw e;
  }
}

function accumulate(c: Company, from: string | null, to: string): Balances {
  const m: Balances = new Map();
  for (const e of c.entries) {
    if (e.date > to || (from !== null && e.date < from)) continue;
    for (const l of e.lines) m.set(l.accountId, minus(plus(m.get(l.accountId) ?? 0, l.debit), l.credit));
  }
  return m;
}

// Debit-positive balance of every account from `from` (or the beginning) through `to`.
export function balancesBetween(c: Company, from: string | null, to: string): Result<Balances> {
  return guard(() => ok(accumulate(c, from, to)));
}

const sign = (t: AccountType): 1 | -1 => (normalSide(t) === 'debit' ? 1 : -1);
// Natural-sign amount; never returns -0.
const natural = (t: AccountType, debitPositive: Minor): Minor => (sign(t) === 1 || debitPositive === 0 ? debitPositive : -debitPositive);
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
      total = plus(total, r.total);
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
    total = plus(total, r.total);
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
    if (a && isPL(a.type)) n = minus(n, v);
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
  return guard(() => {
    const date = asOf as string;
    const fyStart = fiscalYearStart(date, c.fiscalYearStartMonth);
    const all = accumulate(c, null, date);
    const prior = accumulate(c, null, dayBefore(fyStart));

    const re = retainedEarnings(c);
    const net = new Map<string, Minor>();
    for (const [id, v] of all) {
      const a = c.accounts.get(id);
      if (!a) continue;
      net.set(id, isPL(a.type) ? minus(v, prior.get(id) ?? 0) : v);
    }
    // Earlier years' profit is a credit to retained earnings.
    net.set(re.id, minus(net.get(re.id) ?? 0, netIncome(c, prior)));

    const rows: TrialBalanceRow[] = [];
    let totalDebit = 0;
    let totalCredit = 0;
    for (const a of [...c.accounts.values()].sort(compareAccounts)) {
      const v = net.get(a.id) ?? 0;
      if (v === 0) continue;
      const row = { accountId: a.id, number: a.number, name: a.name, type: a.type, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 };
      totalDebit = plus(totalDebit, row.debit);
      totalCredit = plus(totalCredit, row.credit);
      rows.push(row);
    }
    return ok({ asOf: date, rows, totalDebit, totalCredit });
  });
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
  return guard(() => {
    const b = accumulate(c, from as string, to as string);
    const section = (types: AccountType[]): Section =>
      buildRows(
        [...c.accounts.values()].filter((a) => types.includes(a.type)),
        (a) => natural(a.type, b.get(a.id) ?? 0),
      );
    const income = section(['income']);
    const costOfGoodsSold = section(['cost_of_goods_sold']);
    const expenses = section(['expense']);
    const otherIncome = section(['other_income']);
    const otherExpenses = section(['other_expense']);
    const grossProfit = minus(income.total, costOfGoodsSold.total);
    const netOperatingIncome = minus(grossProfit, expenses.total);
    const netOtherIncome = minus(otherIncome.total, otherExpenses.total);
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
      netIncome: plus(netOperatingIncome, netOtherIncome),
    });
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
  return guard(() => {
    const date = asOf as string;
    const fyStart = fiscalYearStart(date, c.fiscalYearStartMonth);
    const all = accumulate(c, null, date);
    const prior = accumulate(c, null, dayBefore(fyStart));
    const current = accumulate(c, fyStart, date);

    const groupsOf = (k: AccountClass): { groups: Group[]; total: Minor } => {
      const groups: Group[] = [];
      let total = 0;
      const types = (Object.keys(ACCOUNT_TYPES) as AccountType[])
        .filter((t) => ACCOUNT_TYPES[t].class === k)
        .sort((x, y) => ACCOUNT_TYPES[x].order - ACCOUNT_TYPES[y].order);
      for (const t of types) {
        const s = buildRows(
          [...c.accounts.values()].filter((a) => a.type === t),
          (a) => natural(a.type, all.get(a.id) ?? 0),
        );
        if (s.rows.length) {
          groups.push({ type: t, ...s });
          total = plus(total, s.total);
        }
      }
      return { groups, total };
    };

    const assets = groupsOf('asset');
    const liabilities = groupsOf('liability');
    const eq = groupsOf('equity');
    const extra: EquityExtra = { retainedEarnings: netIncome(c, prior), netIncome: netIncome(c, current) };
    const equityTotal = plus(plus(eq.total, extra.retainedEarnings), extra.netIncome);
    return ok({
      asOf: date,
      assets,
      liabilities,
      equity: { groups: eq.groups, extra, total: equityTotal },
      totalLiabilitiesAndEquity: plus(liabilities.total, equityTotal),
    });
  });
}

// ---------------------------------------------------------------- general ledger
//
// Agrees with the trial balance at every date: income and expense accounts start again at zero on
// each fiscal-year start, and Retained Earnings shows each closed year's net income as its own line.

export interface LedgerLine {
  entryId: number | null; // null for the year-end net income line on Retained Earnings
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

// Fiscal-year start dates in (start, end].
function yearStartsWithin(start: string, end: string, month: number): string[] {
  const out: string[] = [];
  const mm = String(month).padStart(2, '0');
  for (let y = Number(fiscalYearStart(start, month).slice(0, 4)) + 1; `${y}-${mm}-01` <= end; y++) out.push(`${y}-${mm}-01`);
  return out;
}

export function generalLedger(c: Company, from: unknown, to: unknown, accountId?: unknown): Result<LedgerAccount[]> {
  const d = checkDates(from, to);
  if (!d.ok) return d;
  if ((from as string) > (to as string)) return err('date.range', 'The start date is after the end date.');
  if (accountId !== undefined && (typeof accountId !== 'string' || !c.accounts.has(accountId))) {
    return err('account.missing', 'Account does not exist.');
  }
  return guard(() => {
    const start = from as string;
    const end = to as string;
    const m = c.fiscalYearStartMonth;
    const fyStart = fiscalYearStart(start, m);
    const before = accumulate(c, null, dayBefore(start));
    const fyBefore = accumulate(c, fyStart, dayBefore(start));
    const boundaries = yearStartsWithin(start, end, m);
    const re = retainedEarnings(c);

    const out: LedgerAccount[] = [];
    const accounts = [...c.accounts.values()].filter((a) => accountId === undefined || a.id === accountId).sort(compareAccounts);
    const entries = c.entries
      .filter((e) => e.date >= start && e.date <= end)
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));
    for (const a of accounts) {
      const pl = isPL(a.type);
      const isRE = a.id === re.id;
      let opening = natural(a.type, (pl ? fyBefore : before).get(a.id) ?? 0);
      if (isRE) opening = plus(opening, netIncome(c, accumulate(c, null, dayBefore(fyStart))));
      let balance = opening;
      const lines: LedgerLine[] = [];
      let next = 0; // index into boundaries
      const crossTo = (date: string) => {
        while (next < boundaries.length && boundaries[next]! <= date) {
          const f = boundaries[next++]!;
          if (pl) balance = 0;
          if (isRE) {
            const closedYear = dayBefore(f);
            const ni = netIncome(c, accumulate(c, fiscalYearStart(closedYear, m), closedYear));
            if (ni !== 0) {
              balance = plus(balance, ni);
              lines.push({
                entryId: null,
                date: f,
                memo: `Net income for the year ended ${closedYear}`,
                debit: ni < 0 ? -ni : 0,
                credit: ni > 0 ? ni : 0,
                balance,
              });
            }
          }
        }
      };
      for (const e of entries) {
        crossTo(e.date);
        for (const l of e.lines) {
          if (l.accountId !== a.id) continue;
          balance = plus(balance, natural(a.type, minus(l.debit, l.credit)));
          lines.push({ entryId: e.id, date: e.date, memo: l.memo || e.memo, debit: l.debit, credit: l.credit, balance });
        }
      }
      crossTo(end);
      if (lines.length || opening !== 0 || balance !== 0) {
        out.push({ accountId: a.id, number: a.number, name: a.name, type: a.type, opening, lines, closing: balance });
      }
    }
    return ok(out);
  });
}
