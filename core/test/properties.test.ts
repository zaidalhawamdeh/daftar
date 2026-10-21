// Thousands of random books. Whatever the entries, the accounting identities must hold.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalSide } from '../accounts.ts';
import { execute } from '../commands.ts';
import { createCompany, type Company } from '../company.ts';
import { fiscalYearStart } from '../dates.ts';
import { postEntry, reverseEntry } from '../journal.ts';
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from '../reports.ts';

// Small seeded generator so a failure can be replayed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function randomBooks(seed: number): { c: Company; rand: () => number; dates: string[] } {
  const rand = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const made = createCompany({ name: `Random ${seed}`, currency: rand() < 0.5 ? 'JOD' : 'USD', fiscalYearStartMonth: int(1, 12) });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const ids = [...c.accounts.keys()];
  const dates: string[] = [];
  const n = int(20, 120);
  for (let i = 0; i < n; i++) {
    const date = `${int(2024, 2026)}-${pad(int(1, 12))}-${pad(int(1, 28))}`;
    dates.push(date);
    const k = int(2, 6);
    const amounts = Array.from({ length: k - 1 }, () => int(1, 5_000_000));
    const total = amounts.reduce((a, b) => a + b, 0);
    // k-1 lines on one side, one balancing line on the other; sides shuffled.
    const debitSide = rand() < 0.5;
    const lines = amounts.map((m) => ({ accountId: ids[int(0, ids.length - 1)]!, debit: debitSide ? m : 0, credit: debitSide ? 0 : m }));
    lines.push({ accountId: ids[int(0, ids.length - 1)]!, debit: debitSide ? 0 : total, credit: debitSide ? total : 0 });
    const r = postEntry(c, { date, memo: `random ${i}`, lines });
    if (!r.ok) throw new Error(r.error.message);
    if (rand() < 0.1) {
      const rev = reverseEntry(c, { entryId: r.value.id, date });
      if (!rev.ok) throw new Error(rev.error.message);
    }
  }
  return { c, rand, dates };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test('trial balance always balances', () => {
  for (const seed of SEEDS) {
    const { c, dates } = randomBooks(seed);
    for (const d of [...dates.slice(0, 5), '2023-01-01', '2026-12-31']) {
      const tb = trialBalance(c, d);
      assert.ok(tb.ok);
      assert.equal(tb.value.totalDebit, tb.value.totalCredit, `seed ${seed}, ${d}`);
    }
  }
});

test('balance sheet: assets always equal liabilities plus equity', () => {
  for (const seed of SEEDS) {
    const { c, dates } = randomBooks(seed);
    for (const d of dates.slice(0, 5)) {
      const bs = balanceSheet(c, d);
      assert.ok(bs.ok);
      assert.equal(bs.value.assets.total, bs.value.totalLiabilitiesAndEquity, `seed ${seed}, ${d}`);
    }
  }
});

test('year-to-date P&L net income equals the net income on the balance sheet', () => {
  for (const seed of SEEDS) {
    const { c, dates } = randomBooks(seed);
    for (const d of dates.slice(0, 5)) {
      const pl = profitAndLoss(c, fiscalYearStart(d, c.fiscalYearStartMonth), d);
      const bs = balanceSheet(c, d);
      assert.ok(pl.ok && bs.ok);
      assert.equal(pl.value.netIncome, bs.value.equity.extra.netIncome, `seed ${seed}, ${d}`);
    }
  }
});

test('retained earnings grow by exactly each closed year’s net income', () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const { c } = randomBooks(seed);
    const m = pad(c.fiscalYearStartMonth);
    for (const y of [2025, 2026]) {
      const start = `${y}-${m}-01`;
      const prevStart = `${y - 1}-${m}-01`;
      const pl = profitAndLoss(c, prevStart, new Date(Date.UTC(y, c.fiscalYearStartMonth - 1, 0)).toISOString().slice(0, 10));
      const before = balanceSheet(c, prevStart);
      const after = balanceSheet(c, start);
      assert.ok(pl.ok && before.ok && after.ok);
      assert.equal(after.value.equity.extra.retainedEarnings - before.value.equity.extra.retainedEarnings, pl.value.netIncome, `seed ${seed}, ${y}`);
    }
  }
});

test('general ledger closing balances equal the trial balance on the end date, for any range', () => {
  for (const seed of SEEDS.slice(0, 150)) {
    const { c, dates } = randomBooks(seed);
    const sorted = [...dates].sort();
    for (let k = 0; k < 4; k++) {
      const from = sorted[(k * 7) % sorted.length]!;
      const to = sorted[Math.min(sorted.length - 1, (k * 7) % sorted.length + 1 + k * 11)]!;
      if (from > to) continue;
      const gl = generalLedger(c, from, to);
      const tb = trialBalance(c, to);
      assert.ok(gl.ok && tb.ok);
      const expected = new Map(tb.value.rows.map((r) => [r.accountId, r.debit - r.credit]));
      for (const a of gl.value) {
        const debitPositive = normalSide(a.type) === 'debit' ? a.closing : 0 - a.closing;
        assert.equal(debitPositive, expected.get(a.accountId) ?? 0, `seed ${seed}, ${a.number} ${from}..${to}`);
        expected.delete(a.accountId);
      }
      assert.deepEqual([...expected.values()].filter((v) => v !== 0), [], `seed ${seed}: accounts missing from the ledger`);
    }
  }
});

test('moving accounts under new parents and deactivating them never breaks roll-ups', () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const { c, rand } = randomBooks(seed);
    const all = () => [...c.accounts.values()];
    for (let i = 0; i < 40; i++) {
      const a = all()[Math.floor(rand() * c.accounts.size)]!;
      const p = all()[Math.floor(rand() * c.accounts.size)]!;
      if (rand() < 0.7) execute(c, 'account.update', { id: a.id, parentId: rand() < 0.2 ? null : p.id });
      else execute(c, 'account.setActive', { id: a.id, active: rand() < 0.5 });
    }
    const d = '2026-12-31';
    const pl = profitAndLoss(c, '2024-01-01', d);
    const bs = balanceSheet(c, d);
    assert.ok(pl.ok && bs.ok);
    for (const s of [pl.value.income, pl.value.costOfGoodsSold, pl.value.expenses, pl.value.otherIncome, pl.value.otherExpenses]) {
      assert.equal(s.rows.reduce((t, r) => t + r.amount, 0), s.total, `seed ${seed}: section total is the sum of its rows`);
      for (const r of s.rows) {
        const kids = s.rows.filter((k) => c.accounts.get(k.accountId)?.parentId === r.accountId);
        assert.equal(r.total, r.amount + kids.reduce((t, k) => t + k.total, 0), `seed ${seed}: ${r.name} rolls up its sub-accounts`);
      }
    }
    assert.equal(bs.value.assets.total, bs.value.totalLiabilitiesAndEquity, `seed ${seed}`);
  }
});

test('a refused entry never changes the books', () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const { c, rand } = randomBooks(seed);
    const ids = [...c.accounts.keys()];
    const before = structuredClone(c);
    const a = ids[Math.floor(rand() * ids.length)]!;
    const b = ids[Math.floor(rand() * ids.length)]!;
    const bad = [
      { date: '2026-01-01', lines: [{ accountId: a, debit: 100 }, { accountId: b, credit: 101 }] },
      { date: '2026-13-01', lines: [{ accountId: a, debit: 100 }, { accountId: b, credit: 100 }] },
      { date: '2026-01-01', lines: [{ accountId: a, debit: Number.MAX_SAFE_INTEGER }, { accountId: a, debit: 1 }, { accountId: b, credit: 1 }] },
      { date: '2026-01-01', lines: [{ accountId: a, debit: 100 }, { accountId: 'ghost', credit: 100 }] },
    ];
    for (const input of bad) assert.equal(postEntry(c, input).ok, false);
    assert.deepEqual(c, before, `seed ${seed}`);
  }
});
