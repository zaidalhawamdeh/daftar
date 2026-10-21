import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createAccount, createCompany, findAccount, setAccountActive, setClosingDate, updateAccount, type Company } from '../company.ts';
import { postEntry, reverseEntry } from '../journal.ts';
import { balanceSheet, profitAndLoss, trialBalance } from '../reports.ts';

function fresh(opts: Partial<Parameters<typeof createCompany>[0]> = {}): Company {
  const r = createCompany({ name: 'Test Co', currency: 'USD', ...opts });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const id = (c: Company, k: string) => {
  const a = findAccount(c, k);
  if (!a) throw new Error(`no account ${k}`);
  return a.id;
};
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);
const snapshot = (c: Company) => structuredClone(c);

test('a new company has a retained earnings account and the basic chart', () => {
  const c = fresh();
  assert.ok(findAccount(c, 'Retained Earnings')?.role === 'retained_earnings');
  assert.ok(findAccount(c, '1010'));
  assert.equal(fresh({ template: 'none' }).accounts.size, 1);
  const ar = fresh({ language: 'ar' });
  assert.ok(findAccount(ar, 'الأرباح المحتجزة'));
  assert.ok(findAccount(ar, 'الصندوق'));
});

test('company creation refuses bad input', () => {
  assert.equal(code(createCompany({ name: '', currency: 'USD' })), 'company name.empty');
  assert.equal(code(createCompany({ name: 'X', currency: 'ZZZ' })), 'currency.unknown');
  assert.equal(code(createCompany({ name: 'X', currency: 'USD', fiscalYearStartMonth: 13 })), 'fiscal_year.invalid');
  assert.equal(code(createCompany({ name: 'X', currency: 'USD', language: 'fr' })), 'language.invalid');
});

test('an unbalanced entry is refused and nothing changes', () => {
  const c = fresh();
  const before = snapshot(c);
  const r = postEntry(c, { date: '2026-01-05', lines: [{ accountId: id(c, '1000'), debit: 100 }, { accountId: id(c, '4000'), credit: 99 }] });
  assert.equal(code(r), 'entry.unbalanced');
  assert.deepEqual(c, before);
});

test('each line has exactly one positive side, in whole minor units', () => {
  const c = fresh();
  const cash = id(c, '1000');
  const sales = id(c, '4000');
  const cases: [unknown[], string][] = [
    [[{ accountId: cash, debit: 100, credit: 100 }, { accountId: sales, credit: 0 }], 'line.one_side'],
    [[{ accountId: cash }, { accountId: sales, credit: 1 }], 'line.one_side'],
    [[{ accountId: cash, debit: 1.5 }, { accountId: sales, credit: 1.5 }], 'line.amount_invalid'],
    [[{ accountId: cash, debit: -5 }, { accountId: sales, credit: -5 }], 'line.amount_invalid'],
    [[{ accountId: cash, debit: '100' }, { accountId: sales, credit: '100' }], 'line.amount_invalid'],
    [[{ accountId: 'nope', debit: 1 }, { accountId: sales, credit: 1 }], 'line.account_missing'],
    [[{ accountId: cash, debit: 1 }], 'entry.too_few_lines'],
    [[null, { accountId: sales, credit: 1 }], 'line.invalid'],
  ];
  for (const [lines, expected] of cases) {
    const before = snapshot(c);
    assert.equal(code(postEntry(c, { date: '2026-01-05', lines })), expected, JSON.stringify(lines));
    assert.deepEqual(c, before);
  }
  assert.equal(code(postEntry(c, { date: '2026-02-30', lines: [] })), 'date.invalid');
  assert.equal(code(postEntry(c, { date: '05/01/2026', lines: [] })), 'date.invalid');
  assert.equal(code(postEntry(c, { date: '2026-01-05', lines: 'x' })), 'entry.lines_invalid');
});

test('the closing date locks earlier periods', () => {
  const c = fresh();
  const lines = [{ accountId: id(c, '1000'), debit: 500 }, { accountId: id(c, '4000'), credit: 500 }];
  const first = postEntry(c, { date: '2025-12-10', lines });
  assert.ok(first.ok);
  assert.equal(code(setClosingDate(c, '2025-12-31')), 'ok');
  assert.equal(code(postEntry(c, { date: '2025-12-31', lines })), 'date.closed');
  assert.equal(code(postEntry(c, { date: '2026-01-01', lines })), 'ok');
  assert.equal(code(reverseEntry(c, { entryId: first.value.id, date: '2025-12-20' })), 'date.closed');
  assert.equal(code(reverseEntry(c, { entryId: first.value.id, date: '2026-01-02' })), 'ok');
});

test('reversal mirrors the entry and can happen only once', () => {
  const c = fresh();
  const e = postEntry(c, { date: '2026-03-01', lines: [{ accountId: id(c, '6000'), debit: 7000 }, { accountId: id(c, '1010'), credit: 7000 }] });
  assert.ok(e.ok);
  assert.equal(code(reverseEntry(c, { entryId: e.value.id, date: '2026-02-28' })), 'date.before_original');
  const r = reverseEntry(c, { entryId: e.value.id, date: '2026-03-02' });
  assert.ok(r.ok);
  assert.deepEqual(r.value.lines.map((l) => [l.debit, l.credit]), [[0, 7000], [7000, 0]]);
  assert.equal(r.value.reverses, e.value.id);
  assert.equal(code(reverseEntry(c, { entryId: e.value.id, date: '2026-03-03' })), 'entry.already_reversed');
  assert.equal(code(reverseEntry(c, { entryId: r.value.id, date: '2026-03-03' })), 'entry.is_reversal');
  const tb = trialBalance(c, '2026-12-31');
  assert.ok(tb.ok && tb.value.rows.length === 0, 'an entry and its reversal net to nothing');
});

test('inactive accounts take no postings', () => {
  const c = fresh();
  const ads = id(c, '6500');
  assert.equal(code(setAccountActive(c, ads, false)), 'ok');
  assert.equal(code(postEntry(c, { date: '2026-01-05', lines: [{ accountId: ads, debit: 1 }, { accountId: id(c, '1000'), credit: 1 }] })), 'line.account_inactive');
  assert.equal(code(setAccountActive(c, findAccount(c, '3900')!.id, false)), 'account.system');
});

test('chart of accounts rules: unique numbers and names, same-kind parents, no cycles, depth limit', () => {
  const c = fresh();
  assert.equal(code(createAccount(c, { name: 'Petty Cash', number: '1000', type: 'bank' })), 'account.number_taken');
  assert.equal(code(createAccount(c, { name: 'rent', type: 'expense' })), 'account.name_taken');
  assert.equal(code(createAccount(c, { name: 'X', type: 'spaceship' })), 'account.type_invalid');
  assert.equal(code(createAccount(c, { name: 'Sub', type: 'income', parentId: id(c, '6000') })), 'account.parent_class');
  const office = createAccount(c, { name: 'Office Rent', type: 'expense', parentId: id(c, '6000') });
  assert.ok(office.ok);
  assert.equal(code(updateAccount(c, id(c, '6000'), { parentId: office.value.id })), 'account.parent_cycle');
  let parent = office.value.id;
  for (let i = 0; i < 3; i++) {
    const r = createAccount(c, { name: `Level ${i + 3}`, type: 'expense', parentId: parent });
    assert.ok(r.ok, `level ${i + 3}`);
    parent = r.value.id;
  }
  assert.equal(code(createAccount(c, { name: 'Level 6', type: 'expense', parentId: parent })), 'account.too_deep');
  assert.equal(code(setAccountActive(c, id(c, '6000'), false)), 'account.active_children');
});

test('an account with postings keeps its type; the system account keeps its type', () => {
  const c = fresh();
  postEntry(c, { date: '2026-01-05', lines: [{ accountId: id(c, '6400'), debit: 10 }, { accountId: id(c, '1000'), credit: 10 }] });
  assert.equal(code(updateAccount(c, id(c, '6400'), { type: 'income' })), 'account.type_locked');
  assert.equal(code(updateAccount(c, id(c, '6400'), { name: 'Stationery' })), 'ok');
  assert.equal(code(updateAccount(c, id(c, '3900'), { type: 'income' })), 'account.system');
  assert.equal(code(updateAccount(c, id(c, '6500'), { type: 'cost_of_goods_sold' })), 'ok');
});

test('sub-accounts roll up into their parent in reports', () => {
  const c = fresh();
  const office = createAccount(c, { name: 'Office Rent', type: 'expense', parentId: id(c, '6000') });
  const store = createAccount(c, { name: 'Store Rent', type: 'expense', parentId: id(c, '6000') });
  assert.ok(office.ok && store.ok);
  postEntry(c, { date: '2026-01-05', lines: [{ accountId: office.value.id, debit: 300 }, { accountId: store.value.id, debit: 700 }, { accountId: id(c, '1010'), credit: 1000 }] });
  const pl = profitAndLoss(c, '2026-01-01', '2026-01-31');
  assert.ok(pl.ok);
  const rows = pl.value.expenses.rows.map((r) => [r.name, r.depth, r.amount, r.total]);
  assert.deepEqual(rows, [['Rent', 0, 0, 1000], ['Office Rent', 1, 300, 300], ['Store Rent', 1, 700, 700]]);
  assert.equal(pl.value.expenses.total, 1000);
});

test('a fiscal year starting in July moves profit into retained earnings on 1 July', () => {
  const c = fresh({ fiscalYearStartMonth: 7 });
  const sale = (date: string, amount: number) =>
    postEntry(c, { date, lines: [{ accountId: id(c, '1000'), debit: amount }, { accountId: id(c, '4000'), credit: amount }] });
  sale('2026-06-30', 1000);
  sale('2026-07-01', 250);
  const june = balanceSheet(c, '2026-06-30');
  const july = balanceSheet(c, '2026-07-01');
  assert.ok(june.ok && july.ok);
  assert.deepEqual(june.value.equity.extra, { retainedEarnings: 0, netIncome: 1000 });
  assert.deepEqual(july.value.equity.extra, { retainedEarnings: 1000, netIncome: 250 });
  const tb = trialBalance(c, '2026-07-01');
  assert.ok(tb.ok);
  assert.deepEqual(tb.value.rows.map((r) => [r.number, r.debit, r.credit]), [['1000', 1250, 0], ['3900', 0, 1000], ['4000', 0, 250]]);
});

test('reports refuse bad dates', () => {
  const c = fresh();
  assert.equal(code(trialBalance(c, 'yesterday')), 'date.invalid');
  assert.equal(code(profitAndLoss(c, '2026-02-01', '2026-01-01')), 'date.range');
});

test('commands: unknown ids and bad params are refused; a crash inside restores the company', () => {
  const c = fresh();
  assert.equal(code(execute(c, 'nope.nothing', {})), 'command.unknown');
  assert.equal(code(execute(c, 'journal.post', null)), 'command.params');
  assert.equal(code(execute(c, 'journal.post', [])), 'command.params');
  const before = snapshot(c);
  // A hostile object whose getter throws halfway through validation.
  const evil = { date: '2026-01-05', lines: [{ accountId: id(c, '1000'), debit: 5 }, { get accountId(): string { throw new Error('boom'); } }] };
  const r = execute(c, 'journal.post', evil);
  assert.equal(code(r), 'internal');
  assert.deepEqual(c, before);
  const ok = execute(c, 'journal.post', { date: '2026-01-05', lines: [{ accountId: id(c, '1000'), debit: 5 }, { accountId: id(c, '4000'), credit: 5 }] });
  assert.equal(code(ok), 'ok');
});
