// node scripts/demo.ts   prints the golden bakery's reports, straight from the core.

import { formatAmount } from '../core/money.ts';
import { balanceSheet, profitAndLoss, trialBalance, type Section } from '../core/reports.ts';
import { bakery } from '../core/test/golden/bakery.ts';

const c = bakery();
const f = (m: number) => formatAmount(m, c.currency).padStart(12);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const line = (label: string, amount: number, indent = 0) => console.log(`${'  '.repeat(indent)}${label}`.padEnd(40) + f(amount));
const section = (title: string, s: Section) => {
  if (!s.rows.length) return;
  console.log(title);
  for (const r of s.rows) line(r.name, r.total, r.depth + 1);
  line(`Total ${title}`, s.total);
};

console.log(`\n${c.name} — Profit & Loss, January 2026 (${c.currency.code})\n`);
const pl = must(profitAndLoss(c, '2026-01-01', '2026-01-31'));
section('Income', pl.income);
section('Cost of Goods Sold', pl.costOfGoodsSold);
line('Gross Profit', pl.grossProfit);
section('Expenses', pl.expenses);
line('Net Operating Income', pl.netOperatingIncome);
section('Other Income', pl.otherIncome);
section('Other Expenses', pl.otherExpenses);
line('Net Income', pl.netIncome);

console.log(`\n${c.name} — Balance Sheet, 31 January 2026\n`);
const bs = must(balanceSheet(c, '2026-01-31'));
for (const [title, side] of [['Assets', bs.assets], ['Liabilities', bs.liabilities], ['Equity', bs.equity]] as const) {
  console.log(title);
  for (const g of side.groups) for (const r of g.rows) line(r.name, r.total, r.depth + 1);
  if (title === 'Equity') {
    line('Retained Earnings', bs.equity.extra.retainedEarnings, 1);
    line('Net Income', bs.equity.extra.netIncome, 1);
  }
  line(`Total ${title}`, side.total);
}
line('Total Liabilities & Equity', bs.totalLiabilitiesAndEquity);

const tb = must(trialBalance(c, '2026-01-31'));
console.log(`\nTrial Balance, 31 January 2026: debits ${f(tb.totalDebit).trim()} = credits ${f(tb.totalCredit).trim()}\n`);
