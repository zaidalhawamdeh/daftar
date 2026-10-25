// Regressions for the adversarial review of M7, UAE VAT (25 Oct 2026). Each failed before its fix.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, findAccount, type Company } from '../company.ts';
import { checkIntegrity } from '../integrity.ts';
import { vatReturn } from '../vat.ts';
import { fromText, toText } from '../../store/serialize.ts';
import { oasis } from './golden/oasis.ts';

type R = { ok: boolean; value?: any; error?: { code: string; message: string } };
const code = (r: unknown) => ((r as R).ok ? 'ok' : (r as R).error!.code);
const reopens = (c: Company) => fromText(toText(c)).ok;
const id = (c: Company, n: string) => findAccount(c, n)!.id;
const party = (c: Company, name: string) => [...c.parties.values()].find((p) => p.name === name)!.id;

function registered(from = '2026-07-01'): Company {
  const made = createCompany({ name: 'R', currency: 'AED' });
  assert.ok(made.ok);
  const c = made.value;
  assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Dubai', from })), 'ok');
  execute(c, 'customer.create', { name: 'C' });
  execute(c, 'vendor.create', { name: 'V' });
  return c;
}

test('#1 money never goes into or out of a VAT account', () => {
  const c = registered();
  const input = id(c, '1410');
  assert.equal(code(execute(c, 'salesReceipt.create', { date: '2026-08-01', depositToId: input, lines: [{ accountId: id(c, '4000'), rate: 1000, taxCode: 'SR' }] })), 'doc.money_account_type');
  assert.equal(code(execute(c, 'payment.receive', { customerId: party(c, 'C'), date: '2026-08-01', amount: 100, depositToId: input })), 'doc.money_account_type');
  assert.equal(code(execute(c, 'transfer.create', { date: '2026-08-01', fromId: id(c, '1010'), toId: input, amount: 100 })), 'doc.money_account_type');
  assert.equal(code(execute(c, 'transfer.create', { date: '2026-08-01', fromId: input, toId: id(c, '1010'), amount: 100 })), 'doc.money_account_type');
  assert.ok(reopens(c));
});

test('#2 VAT accounts stay top-level and have no sub-accounts', () => {
  const c = registered();
  assert.equal(code(execute(c, 'account.update', { id: id(c, '2210'), parentId: id(c, '2200') })), 'account.system');
  assert.equal(code(execute(c, 'account.update', { id: id(c, '1410'), parentId: id(c, '1350') })), 'account.system');
  assert.equal(code(execute(c, 'account.create', { name: 'Sub VAT', type: 'other_current_liability', parentId: id(c, '2210') })), 'account.parent_vat');
  assert.equal(code(execute(c, 'account.update', { id: id(c, '2210'), name: 'Output VAT' })), 'ok'); // renaming is fine
  assert.ok(reopens(c));
  // A file with a VAT account under a parent, or a child under a VAT account, is refused.
  const file = JSON.parse(toText(c));
  file.company.accounts.find((a: any) => a.role === 'vat_output').parentId = id(c, '2200');
  assert.equal(fromText(JSON.stringify(file)).ok, false);
});

test('#4 a credit is checked against the document it names', () => {
  const { c, doc } = oasis();
  const noor = party(c, 'Al Noor Trading');
  const line = (rate: number, taxCode?: string) => ({ accountId: id(c, '4100'), rate, ...(taxCode ? { taxCode } : {}) });
  // Void, later, or more than is left.
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-20', refId: doc.INV4!.id, memo: 'x', lines: [line(100, 'SR')] })), 'doc.ref_void');
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-08-02', refId: doc.INV3!.id, memo: 'x', lines: [line(100, 'SR')] })), 'ok'); // same day as INV3 is fine
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-07-10', refId: doc.INV3!.id, memo: 'x', lines: [line(100, 'SR')] })), 'doc.ref_later');
  // INV1 had 3,750.00 standard-rated; CM1 already took 1,250.00.
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-20', refId: doc.INV1!.id, memo: 'x', lines: [line(250001, 'SR')] })), 'doc.credit_over_ref');
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-20', refId: doc.INV1!.id, memo: 'x', lines: [line(250000, 'SR')] })), 'ok');
  // INV3's exempt line cannot be credited as standard-rated.
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-20', refId: doc.INV3!.id, memo: 'x', lines: [{ accountId: id(c, '7000'), rate: 50000, taxCode: 'SR' }] })), 'doc.credit_over_ref');
  // A tax credit note names its invoice and gives a reason.
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-20', lines: [line(100, 'SR')] })), 'doc.credit_note_ref');
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-20', refId: doc.INV3!.id, lines: [line(100, 'SR')] })), 'doc.credit_note_reason');
  assert.ok(reopens(c));
});

test('#4 a credit against an invoice from before registration reclaims no VAT', () => {
  const c = registered('2026-07-01');
  const cust = party(c, 'C');
  const pre = execute(c, 'invoice.create', { customerId: cust, date: '2026-06-15', lines: [{ accountId: id(c, '4000'), rate: 100000 }] }) as R;
  assert.equal(pre.value.lines[0].taxCode, null);
  assert.equal(pre.value.total, 100000);
  // The credit takes the invoice's (absent) code: no VAT, nothing in Box 1.
  const cm = execute(c, 'creditMemo.create', { customerId: cust, date: '2026-07-15', refId: pre.value.id, memo: 'Returned', lines: [{ accountId: id(c, '4000'), rate: 100000 }] }) as R;
  assert.equal(cm.ok, true, cm.ok ? '' : cm.error!.message);
  assert.equal(cm.value.lines[0].taxCode, null);
  assert.equal(cm.value.total, 100000);
  const r = vatReturn(c, { from: '2026-07-01', to: '2026-09-30' });
  assert.ok(r.ok);
  assert.deepEqual(r.value.box1.DU, { amount: 0, vat: 0 });
  // Claiming it was standard-rated is refused.
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: cust, date: '2026-07-15', refId: pre.value.id, memo: 'x', lines: [{ accountId: id(c, '4000'), rate: 100, taxCode: 'SR' }] })), 'doc.credit_over_ref');
});

test('#6 VAT starts on the registration date', () => {
  const c = registered('2026-07-01');
  const cust = party(c, 'C');
  assert.equal(code(execute(c, 'invoice.create', { customerId: cust, date: '2026-06-30', lines: [{ accountId: id(c, '4000'), rate: 100, taxCode: 'SR' }] })), 'line.before_registration');
  assert.equal(code(execute(c, 'invoice.create', { customerId: cust, date: '2026-06-30', taxInclusive: true, lines: [{ accountId: id(c, '4000'), rate: 100 }] })), 'doc.tax_inclusive_vat_off');
  const ok = execute(c, 'invoice.create', { customerId: cust, date: '2026-07-01', lines: [{ accountId: id(c, '4000'), rate: 1000 }] }) as R;
  assert.equal(ok.value.total, 1050);
  // The date cannot move after documents that already carry VAT.
  assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Dubai', from: '2026-07-02' })), 'vat.from_after_documents');
  assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Dubai', from: '2026-06-01' })), 'ok');
  // A file with VAT on a document before the registration is refused.
  const file = JSON.parse(toText(c));
  file.company.vat.from = '2026-08-01';
  assert.equal(fromText(JSON.stringify(file)).ok, false);
});

test('#9 nothing made before registration gains 5% afterwards', () => {
  const c = registered('2026-07-01');
  const cust = party(c, 'C');
  const vend = party(c, 'V');
  const est = execute(c, 'estimate.create', { customerId: cust, date: '2026-06-01', lines: [{ accountId: id(c, '4000'), rate: 100000 }] }) as R;
  assert.equal(code(execute(c, 'estimate.toInvoice', { docId: est.value.id, date: '2026-07-05' })), 'doc.convert_no_tax_code');
  assert.equal(code(execute(c, 'estimate.toInvoice', { docId: est.value.id, date: '2026-06-20' })), 'ok'); // still before registration
  const po = execute(c, 'purchaseOrder.create', { vendorId: vend, date: '2026-06-01', lines: [{ accountId: id(c, '6000'), rate: 500000 }] }) as R;
  assert.equal(code(execute(c, 'purchaseOrder.toBill', { docId: po.value.id, date: '2026-07-05' })), 'doc.convert_no_tax_code');
  // A memorized bill without tax codes does not run in a registered period.
  const plain = createCompany({ name: 'Later', currency: 'AED' });
  assert.ok(plain.ok);
  const p = plain.value;
  const v = (execute(p, 'vendor.create', { name: 'Landlord' }) as R).value.id;
  const m = execute(p, 'memorized.create', { name: 'Rent', command: 'bill.create', params: { vendorId: v, lines: [{ accountId: id(p, '6000'), rate: 500000 }] }, frequency: 'monthly', nextDate: '2026-08-01' }) as R;
  assert.equal(m.ok, true, m.ok ? '' : m.error!.message);
  assert.equal(code(execute(p, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Dubai', from: '2026-07-01' })), 'ok');
  assert.equal(code(execute(p, 'memorized.run', { id: m.value.id, date: '2026-08-01' })), 'memorized.no_tax_codes');
  assert.equal(code(execute(p, 'memorized.runDue', { asOf: '2026-08-31' })), 'memorized.run_failed');
  assert.equal(code(execute(p, 'memorized.run', { id: m.value.id, date: '2026-06-15' })), 'ok'); // before registration it is right as it is
});

test('#10 a document whose entry was moved to other accounts is refused', () => {
  const { c } = oasis();
  const file = JSON.parse(toText(c));
  const inv1 = file.company.documents.find((d: any) => d.kind === 'invoice' && d.number === '1');
  const entry = file.company.entries.find((e: any) => e.id === inv1.entryId);
  const income = entry.lines.find((l: any) => l.accountId === id(c, '4100'));
  income.credit = 100000;
  entry.lines.push({ accountId: id(c, '3000'), debit: 0, credit: 275000, memo: '', partyId: null });
  assert.equal(fromText(JSON.stringify(file)).ok, false);
  // Moving the whole credit to another income account is refused too.
  const file2 = JSON.parse(toText(c));
  const e2 = file2.company.entries.find((e: any) => e.id === file2.company.documents.find((d: any) => d.kind === 'invoice' && d.number === '1').entryId);
  e2.lines.find((l: any) => l.accountId === id(c, '4100')).accountId = id(c, '7000');
  assert.equal(fromText(JSON.stringify(file2)).ok, false);
});

test('#11 smaller guards: purchases default to standard, non-VAT companies refuse VAT-inclusive prices, other VAT entries are reported', () => {
  const { c } = oasis();
  const item = (execute(c, 'item.create', { name: 'Export pack', price: 10000, cost: 4000, salesAccountId: id(c, '4000'), purchaseAccountId: id(c, '5000'), taxCode: 'ZR' }) as R).value;
  const bill = execute(c, 'bill.create', { vendorId: party(c, 'Marina Properties'), date: '2026-09-20', lines: [{ itemId: item.id }] }) as R;
  assert.equal(bill.value.lines[0].taxCode, 'SR'); // the item's code is its sales code
  const inv = execute(c, 'invoice.create', { customerId: party(c, 'Northwind Ltd'), date: '2026-09-20', lines: [{ itemId: item.id }] }) as R;
  assert.equal(inv.value.lines[0].taxCode, 'ZR');

  const plain = createCompany({ name: 'P', currency: 'AED' });
  assert.ok(plain.ok);
  const cust = (execute(plain.value, 'customer.create', { name: 'A' }) as R).value.id;
  assert.equal(code(execute(plain.value, 'invoice.create', { customerId: cust, date: '2026-07-01', taxInclusive: true, lines: [{ accountId: id(plain.value, '4000'), rate: 100 }] })), 'doc.tax_inclusive_vat_off');

  // Paying the FTA by journal is fine, and shows on the return as another entry on the VAT accounts.
  assert.equal(code(execute(c, 'journal.post', { date: '2026-09-28', memo: 'VAT paid', lines: [{ accountId: id(c, '2210'), debit: 777 }, { accountId: id(c, '1010'), credit: 777 }] })), 'ok');
  const r = vatReturn(c, { from: '2026-07-01', to: '2026-09-30' });
  assert.ok(r.ok);
  assert.deepEqual(r.value.otherEntries, { output: -777, input: 0 });
  assert.equal(checkIntegrity(c).ok, true);
});

test('#8 once a period is filed and closed, voiding a document in it is refused', () => {
  const { c, doc } = oasis();
  assert.equal(code(execute(c, 'company.setClosingDate', { date: '2026-09-30' })), 'ok');
  assert.equal(code(execute(c, 'document.void', { docId: doc.INV3!.id })), 'date.closed');
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: party(c, 'Al Noor Trading'), date: '2026-09-15', refId: doc.INV3!.id, memo: 'x', lines: [{ accountId: id(c, '4000'), rate: 100, taxCode: 'SR' }] })), 'date.closed');
});
