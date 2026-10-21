import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findAccount } from '../company.ts';
import { formatAmount } from '../money.ts';
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from '../reports.ts';
import { bakery, EXPECTED } from './golden/bakery.ts';

const c = bakery();
const f = (m: number) => formatAmount(m, c.currency);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

test('golden bakery: trial balance on 31 Jan 2026 matches the hand computation', () => {
  const tb = must(trialBalance(c, '2026-01-31'));
  const got = tb.rows.map((r) => [r.number, r.name, r.debit ? f(r.debit) : '', r.credit ? f(r.credit) : '']);
  assert.deepEqual(got, EXPECTED.trialBalance_2026_01_31.rows);
  assert.equal(f(tb.totalDebit), EXPECTED.trialBalance_2026_01_31.total);
  assert.equal(f(tb.totalCredit), EXPECTED.trialBalance_2026_01_31.total);
});

test('golden bakery: profit and loss, January 2026', () => {
  const pl = must(profitAndLoss(c, '2026-01-01', '2026-01-31'));
  const e = EXPECTED.profitAndLoss_2026_01;
  assert.deepEqual(
    {
      income: f(pl.income.total),
      costOfGoodsSold: f(pl.costOfGoodsSold.total),
      grossProfit: f(pl.grossProfit),
      expenses: f(pl.expenses.total),
      netOperatingIncome: f(pl.netOperatingIncome),
      otherIncome: f(pl.otherIncome.total),
      otherExpenses: f(pl.otherExpenses.total),
      netOtherIncome: f(pl.netOtherIncome),
      netIncome: f(pl.netIncome),
    },
    e,
  );
  assert.ok(!pl.expenses.rows.some((r) => r.name === 'Rent'), 'rent nets to zero after the reversal and is hidden');
});

test('golden bakery: profit and loss, December 2025', () => {
  const pl = must(profitAndLoss(c, '2025-12-01', '2025-12-31'));
  assert.deepEqual(
    { income: f(pl.income.total), costOfGoodsSold: f(pl.costOfGoodsSold.total), grossProfit: f(pl.grossProfit), expenses: f(pl.expenses.total), netIncome: f(pl.netIncome) },
    EXPECTED.profitAndLoss_2025_12,
  );
});

test('golden bakery: balance sheet on 31 Jan 2026 balances and matches', () => {
  const bs = must(balanceSheet(c, '2026-01-31'));
  const g = (side: { groups: { type: string; total: number }[] }, t: string) => f(side.groups.find((x) => x.type === t)?.total ?? 0);
  const e = EXPECTED.balanceSheet_2026_01_31;
  assert.equal(g(bs.assets, 'bank'), e.bank);
  assert.equal(g(bs.assets, 'accounts_receivable'), e.receivable);
  assert.equal(g(bs.assets, 'fixed_asset'), e.fixed);
  assert.equal(f(bs.assets.total), e.assets);
  assert.equal(g(bs.liabilities, 'accounts_payable'), e.payable);
  assert.equal(g(bs.liabilities, 'long_term_liability'), e.longTerm);
  assert.equal(f(bs.liabilities.total), e.liabilities);
  assert.equal(g(bs.equity, 'equity'), e.capital);
  assert.equal(f(bs.equity.extra.retainedEarnings), e.retainedEarnings);
  assert.equal(f(bs.equity.extra.netIncome), e.netIncome);
  assert.equal(f(bs.equity.total), e.equity);
  assert.equal(f(bs.totalLiabilitiesAndEquity), e.liabilitiesAndEquity);
  assert.equal(bs.assets.total, bs.totalLiabilitiesAndEquity);
});

test('golden bakery: balance sheet at the 2025 year end', () => {
  const bs = must(balanceSheet(c, '2025-12-31'));
  const e = EXPECTED.balanceSheet_2025_12_31;
  assert.equal(f(bs.assets.total), e.assets);
  assert.equal(f(bs.liabilities.total), e.liabilities);
  assert.equal(f(bs.equity.extra.retainedEarnings), e.retainedEarnings);
  assert.equal(f(bs.equity.extra.netIncome), e.netIncome);
  assert.equal(f(bs.equity.total), e.equity);
  assert.equal(bs.assets.total, bs.totalLiabilitiesAndEquity);
});

test('golden bakery: general ledger for Cash in January runs line by line', () => {
  const cash = findAccount(c, '1000');
  assert.ok(cash);
  const [gl] = must(generalLedger(c, '2026-01-01', '2026-01-31', cash.id));
  assert.ok(gl);
  const e = EXPECTED.ledger_cash_2026_01;
  assert.equal(f(gl.opening), e.opening);
  assert.deepEqual(gl.lines.map((l) => f(l.balance)), e.balances);
  assert.equal(f(gl.closing), e.closing);
});
