// Regressions for the adversarial review of M5 (21 Oct 2026). Each failed before its fix.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createAccount, createCompany, findAccount, type Company } from '../company.ts';
import { exportIif, importIif, termsDays } from '../import/iif.ts';
import { checkIntegrity } from '../integrity.ts';
import { trialBalance } from '../reports.ts';
import { openInvoices, partyBalances } from '../subledger.ts';

type R = { ok: boolean; value?: any; error?: { code: string; message: string } };
const code = (r: R) => (r.ok ? 'ok' : r.error!.code);
const T = (...a: string[]) => a.join('\t');
const HEAD = [T('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'DUEDATE'), T('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO'), '!ENDTRNS'];
const fresh = (template: 'basic' | 'none' = 'basic'): Company => {
  const r = createCompany({ name: 'M5', currency: 'USD', template });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const tbOf = (c: Company, d: string) => {
  const tb = trialBalance(c, d);
  assert.ok(tb.ok);
  return Object.fromEntries(tb.value.rows.map((r) => [r.number || r.name, r.debit - r.credit]));
};

test('#1 opening balances with two receivable accounts post to each, or ask for an Account column', () => {
  const c = fresh();
  createAccount(c, { name: 'AR 2', number: '1210', type: 'accounts_receivable' });
  const tb = 'Account,Debit,Credit\n1200,60.00,\n1210,40.00,\n3000,,100.00';
  assert.equal(code(execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: tb, openInvoices: 'Customer,Amount\nA,60.00\nB,40.00' }) as R), 'opening.doc_account');
  const r = execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: tb, openInvoices: 'Customer,Amount,Account\nA,60.00,1200\nB,40.00,1210' }) as R;
  assert.equal(code(r), 'ok', r.error?.message);
  const t = tbOf(c, '2025-12-31');
  assert.deepEqual([t['1200'], t['1210']], [6000, 4000]);
  assert.deepEqual(checkIntegrity(c), { ok: true, value: true });
});

test('#2 account paths match exactly; a bogus parent or a partial name does not', () => {
  const c = fresh();
  const office = (parent: string) => createAccount(c, { name: 'Office', type: 'expense', parentId: findAccount(c, parent)!.id });
  office('6000');
  office('6200');
  const r = execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\nUtilities:Office,100.00\n3000,-100.00' }) as R;
  assert.equal(code(r), 'ok', r.error?.message);
  const utilOffice = [...c.accounts.values()].find((a) => a.name === 'Office' && c.accounts.get(a.parentId!)!.number === '6200')!;
  assert.equal(tbOf(c, '2025-12-31')[utilOffice.number || utilOffice.name], 10000);
  const c2 = fresh();
  createAccount(c2, { name: 'Office', type: 'expense', parentId: findAccount(c2, '6000')!.id });
  assert.equal(code(execute(c2, 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\nRent:Utilities,1\nSales-2025,1\n3000,-2' }) as R), 'opening.accounts_missing');
});

test('#3 open invoices dated after the opening date are refused', () => {
  const c = fresh();
  const r = execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\n1200,100\n3000,-100', openInvoices: 'Customer,Date,Amount\nA,01/15/2026,100' }) as R;
  assert.equal(code(r), 'opening.doc_after_date');
});

test('#4 a blank or id-like account cell in an IIF file is refused, never guessed', () => {
  for (const acct of ['', ' ', 'acc-1', '1010']) {
    const c = fresh();
    const file = [...HEAD, T('TRNS', '', 'GENERAL JOURNAL', '01/05/2026', 'Checking Account', '', '100.00'), T('SPL', '', 'GENERAL JOURNAL', '01/05/2026', acct, '', '-100.00'), 'ENDTRNS'].join('\n');
    const r = importIif(c, file);
    assert.equal(r.ok, false, JSON.stringify(acct));
  }
});

test('#5 stray rows and one-sided transactions are refused, not dropped', () => {
  const c = fresh();
  const stray = [...HEAD, T('SPL', '', 'GENERAL JOURNAL', '01/05/2026', 'Checking Account', '', '500.00')].join('\n');
  assert.equal(code(importIif(c, stray) as R), 'iif.orphan_line');
  const oneSided = [...HEAD, T('TRNS', '', 'GENERAL JOURNAL', '01/05/2026', 'Checking Account', '', '100.00'), T('SPL', '', 'GENERAL JOURNAL', '01/05/2026', "Owner's Capital", '', '0.00'), 'ENDTRNS'].join('\n');
  assert.equal(code(importIif(c, oneSided) as R), 'iif.unbalanced');
});

test('#6 importing leaves documents already in the books alone', () => {
  const c = fresh();
  const cust = (execute(c, 'customer.create', { name: 'Old Customer' }) as R).value.id;
  execute(c, 'invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ accountId: findAccount(c, '4000')!.id, amount: 1000 }] });
  execute(c, 'payment.receive', { customerId: cust, date: '2026-01-06', amount: 1000, depositToId: findAccount(c, '1010')!.id });
  const r = importIif(c, [T('!ACCNT', 'NAME', 'ACCNTTYPE'), T('ACCNT', 'Petty Cash', 'BANK')].join('\n'));
  assert.ok(r.ok);
  assert.equal(r.value.applied, 0);
  const open = openInvoices(c, '2026-12-31');
  assert.ok(open.ok && open.value.total === 1000, 'the old invoice is still open, as the person left it');
});

test('#7 thousands of payments apply quickly', () => {
  const c = fresh();
  const rows = [T('!CUST', 'NAME'), T('CUST', 'Big Customer'), ...HEAD];
  for (let i = 0; i < 2000; i++) {
    const d = `${String((i % 12) + 1).padStart(2, '0')}/${String((i % 28) + 1).padStart(2, '0')}/2026`;
    rows.push(T('TRNS', '', 'INVOICE', d, 'Accounts Receivable', 'Big Customer', '10.00', `I${i}`), T('SPL', '', 'INVOICE', d, 'Sales', '', '-10.00'), 'ENDTRNS');
    rows.push(T('TRNS', '', 'PAYMENT', d, 'Checking Account', 'Big Customer', '10.00'), T('SPL', '', 'PAYMENT', d, 'Accounts Receivable', 'Big Customer', '-10.00'), 'ENDTRNS');
  }
  const t0 = performance.now();
  const r = importIif(c, rows.join('\n'));
  const ms = performance.now() - t0;
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  assert.ok(ms < 8000, `took ${Math.round(ms)} ms`);
  const open = openInvoices(c, '2026-12-31');
  assert.ok(open.ok && open.value.total === 0);
  assert.deepEqual(checkIntegrity(c), { ok: true, value: true });
});

test('#8 names with quotes survive export and import; account names cannot hold a colon', () => {
  const c = fresh();
  for (const name of ['O"Brien', "O'Brien"]) {
    const id = (execute(c, 'customer.create', { name }) as R).value.id;
    execute(c, 'invoice.create', { customerId: id, date: '2026-01-05', lines: [{ accountId: findAccount(c, '4000')!.id, amount: name.includes('"') ? 100 : 200 }] });
  }
  const copy = fresh();
  const r = importIif(copy, exportIif(c));
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  const p = partyBalances(copy, 'customer', '2026-12-31');
  assert.ok(p.ok);
  assert.deepEqual(p.value.rows.map((x) => [x.name, x.balance]), [["O'Brien", 200], ['O"Brien', 100]]);
  assert.equal(code(createAccount(c, { name: 'Rent: Office', type: 'expense' }) as R), 'account.name_colon');
});

test('#9 list import: unsupported item types refused, inventory parts noted, plural account types read', () => {
  const c = fresh();
  assert.equal(code(execute(c, 'import.list', { kind: 'item', text: 'Item,Type\nGift Box,Group\n' }) as R), 'list.item_type');
  const inv = execute(c, 'import.list', { kind: 'item', text: 'Item,Type,Price,Income Account\nCable,Inventory Part,2.50,4000\n' }) as R;
  assert.equal(code(inv), 'ok', inv.error?.message);
  assert.ok(inv.value.skipped[0].includes('non-inventory'));
  const accts = execute(c, 'import.list', { kind: 'account', text: 'Account,Type\nVan,Fixed Assets\nTips,Other Current Liabilities\nAds,Expenses\nCustomer Deposits,Accounts receivable (A/R)\n' }) as R;
  assert.equal(code(accts), 'ok', accts.error?.message);
  assert.deepEqual(['Van', 'Tips', 'Ads', 'Customer Deposits'].map((n) => findAccount(c, n)?.type), ['fixed_asset', 'other_current_liability', 'expense', 'accounts_receivable']);
});

test('#10 terms read the net days', () => {
  assert.deepEqual(['2% 10 Net 30', 'Net 15', '45 days', '30', 'Due on receipt', ''].map(termsDays), [30, 15, 45, 30, 0, 0]);
});

test('#11 opening amounts are read strictly; CR means credit; a real account named Total counts', () => {
  const c = fresh();
  assert.equal(code(execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\n1010,1O0.00\n3000,-100' }) as R), 'opening.amount');
  createAccount(c, { name: 'Total Care Fund', type: 'other_current_liability' });
  const r = execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\n1010,$1500.00\nTotal Care Fund,500.00 CR\n3000,1000.00 CR\nTotal,0' }) as R;
  assert.equal(code(r), 'ok', r.error?.message);
  assert.equal(r.value.difference, 0);
  assert.equal(code(execute(fresh(), 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\n,100\n3000,-100' }) as R), 'opening.accounts_missing');
  assert.equal(code(execute(fresh(), 'import.openingBalances', { date: '2025-12-31', trialBalance: 'Account,Amount\n' }) as R), 'opening.tb_empty');
});

test('#12 the same file cannot be imported twice; an account cannot change kind on import', () => {
  const c = fresh();
  const file = [T('!CUST', 'NAME'), T('CUST', 'Acme'), ...HEAD, T('TRNS', '', 'INVOICE', '01/10/2026', 'Accounts Receivable', 'Acme', '50.00', '101'), T('SPL', '', 'INVOICE', '01/10/2026', 'Sales', '', '-50.00', '101'), 'ENDTRNS'].join('\n');
  assert.ok(importIif(c, file).ok);
  assert.equal(code(execute(c, 'import.iif', { text: file }) as R), 'iif.already_imported');
  assert.equal(code(execute(c, 'import.openingBalances', { date: '2026-12-31', trialBalance: 'Account,Amount\n1010,1\n3000,-1' }) as R), 'opening.not_first');
  assert.equal(code(importIif(fresh(), [T('!ACCNT', 'NAME', 'ACCNTTYPE'), T('ACCNT', 'Rent', 'INC')].join('\n')) as R), 'iif.account_type_conflict');
});

test('#13 a payment covering several invoices stays a payment; due dates are read', () => {
  const c = fresh();
  const file = [
    T('!CUST', 'NAME'), T('CUST', 'Acme'), ...HEAD,
    T('TRNS', '', 'INVOICE', '01/10/2026', 'Accounts Receivable', 'Acme', '50.00', '101', '', '02/20/2026'), T('SPL', '', 'INVOICE', '01/10/2026', 'Sales', '', '-50.00'), 'ENDTRNS',
    T('TRNS', '', 'INVOICE', '01/11/2026', 'Accounts Receivable', 'Acme', '30.00', '102'), T('SPL', '', 'INVOICE', '01/11/2026', 'Sales', '', '-30.00'), 'ENDTRNS',
    T('TRNS', '', 'PAYMENT', '01/20/2026', 'Checking Account', 'Acme', '80.00'), T('SPL', '', 'PAYMENT', '01/20/2026', 'Accounts Receivable', 'Acme', '-50.00'), T('SPL', '', 'PAYMENT', '01/20/2026', 'Accounts Receivable', 'Acme', '-30.00'), 'ENDTRNS',
  ].join('\r');
  const r = importIif(c, file);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  assert.deepEqual(r.value.documents, { invoice: 2, payment: 1 }, 'CR-only line endings read too');
  assert.equal(r.value.throughClearing, 0);
  assert.equal([...c.documents.values()].find((d) => d.number === '101')!.dueDate, '2026-02-20');
});
