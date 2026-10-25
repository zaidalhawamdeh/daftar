// UAE VAT: the golden quarter, the rounding rules, the return, and the guards around them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, findAccount, type Company } from '../company.ts';
import { exportIif, importIif } from '../import/iif.ts';
import { checkIntegrity } from '../integrity.ts';
import { trialBalance } from '../reports.ts';
import { creditRoom } from '../documents.ts';
import { lineTax, vatReturn, type VatReturn } from '../vat.ts';
import { fromText, toText } from '../../store/serialize.ts';
import { oasis } from './golden/oasis.ts';

type R = { ok: boolean; value?: any; error?: { code: string; message: string } };
const code = (r: R) => (r.ok ? 'ok' : r.error!.code);
const tb = (c: Company, asOf: string) => {
  const t = trialBalance(c, asOf);
  assert.ok(t.ok);
  return Object.fromEntries(t.value.rows.filter((r) => r.debit || r.credit).map((r) => [r.number || r.name, r.debit - r.credit]));
};
const quarter = (c: Company, from: string, to: string): VatReturn => {
  const r = vatReturn(c, { from, to });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.value;
};

test('golden: Oasis Trading documents carry the VAT computed by hand', () => {
  const { c, doc } = oasis();
  assert.deepEqual(checkIntegrity(c), { ok: true, value: true });
  // 3 × 1,250.00 = 3,750.00, VAT 187.50
  assert.equal(doc.INV1!.total, 393750);
  assert.equal(doc.INV1!.lines[0]!.tax, 18750);
  assert.equal(doc.INV2!.total, 200000);
  // 7 × 33.33 = 233.31, VAT 11.6655 → 11.67; plus 500.00 exempt
  assert.deepEqual(doc.INV3!.lines.map((l) => [l.amount, l.tax]), [[23331, 1167], [50000, 0]]);
  assert.equal(doc.INV3!.total, 74498);
  // prices include VAT: 105.00 holds 5.00; 99.99 holds 4.7614 → 4.76
  assert.deepEqual(doc.SR1!.lines.map((l) => l.tax), [500, 476]);
  assert.equal(doc.SR1!.total, 20499);
  assert.equal(doc.CM1!.total, 131250);
  assert.equal(doc.CM1!.refId, doc.INV1!.id);
  assert.equal(doc.BILL1!.total, 630000);
  // reverse charge: 367.25 × 5% = 18.3625 → 18.36, not added to what is owed to the vendor
  assert.equal(doc.BILL2!.lines[0]!.tax, 1836);
  assert.equal(doc.BILL2!.total, 36725);
  // 47.62 × 5% = 2.381 → 2.38
  assert.equal(doc.EXP1!.total, 5000);
  assert.equal(doc.VC1!.total, 21000);
  assert.equal(doc.EXP2!.total, 180000);
  assert.equal(doc.INV4!.voided, true);
});

test('golden: Oasis Trading trial balance on 30 September 2026', () => {
  const { c } = oasis();
  assert.deepEqual(tb(c, '2026-09-30'), {
    '1010': 835499,
    '1200': 536998,
    '1410': 31074,
    '2000': -645725,
    '2210': -16479,
    '3000': -1000000,
    '4000': -42854,
    '4100': -450000,
    '6000': 580000,
    '6300': 36725,
    '6600': 184762,
    '7000': -50000,
  });
});

test('golden: the VAT 201 return for July to September 2026', () => {
  const { c, doc } = oasis();
  const r = quarter(c, '2026-07-01', '2026-09-30');
  assert.equal(r.emirate, 'DU');
  assert.deepEqual(r.box1.DU, { amount: 292854, vat: 14643 });
  for (const e of ['AZ', 'SH', 'AJ', 'UQ', 'RK', 'FU'] as const) assert.deepEqual(r.box1[e], { amount: 0, vat: 0 });
  assert.deepEqual(r.box3, { amount: 36725, vat: 1836 });
  assert.equal(r.box4, 200000);
  assert.equal(r.box5, 50000);
  assert.deepEqual(r.box8, { amount: 579579, vat: 16479 });
  assert.deepEqual(r.box9, { amount: 584762, vat: 29238 });
  assert.deepEqual(r.box10, { amount: 36725, vat: 1836 });
  assert.deepEqual(r.box11, { amount: 621487, vat: 31074 });
  assert.equal(r.box12, 16479);
  assert.equal(r.box13, 31074);
  assert.equal(r.box14, -14595);
  // The return agrees with the ledger: Box 12 is the output account, Box 13 the input account.
  const t = tb(c, '2026-09-30');
  assert.equal(r.box12, -t['2210']!);
  assert.equal(r.box13, t['1410']!);
  // The void invoice and the October bill are not in it; the zero-rated flight is not reported.
  assert.ok(!r.documents.includes(doc.INV4!.id));
  assert.ok(!r.documents.includes(doc.BILL3!.id));
  assert.ok(!r.documents.includes(doc.EXP2!.id));
});

test('golden: the next quarter holds only the October bill', () => {
  const { c, doc } = oasis();
  const r = quarter(c, '2026-10-01', '2026-12-31');
  assert.deepEqual(r.box9, { amount: 100000, vat: 5000 });
  assert.equal(r.box12, 0);
  assert.equal(r.box14, -5000);
  assert.deepEqual(r.documents, [doc.BILL3!.id]);
});

test('line VAT rounds to the nearest fils, half away from zero', () => {
  assert.deepEqual(lineTax(10, 'SR', false), { net: 10, tax: 1, payable: 11 }); // 0.5 fils → 1
  assert.deepEqual(lineTax(9, 'SR', false), { net: 9, tax: 0, payable: 9 }); // 0.45 → 0
  assert.deepEqual(lineTax(21, 'SR', true), { net: 20, tax: 1, payable: 21 }); // 21 × 5/105 = 1
  assert.deepEqual(lineTax(10, 'SR', true), { net: 10, tax: 0, payable: 10 }); // 0.476 → 0
  assert.deepEqual(lineTax(11, 'SR', true), { net: 10, tax: 1, payable: 11 }); // 0.5238 → 1
  assert.deepEqual(lineTax(1000, 'RC', true), { net: 1000, tax: 50, payable: 1000 }); // never on the supplier's invoice
  for (const code of ['ZR', 'EX', 'OS', null] as const) assert.deepEqual(lineTax(12345, code, false), { net: 12345, tax: 0, payable: 12345 });
  assert.deepEqual(lineTax(2357, 'SR', false).tax, 118); // 117.85 → 118
});

test('VAT needs dirhams, a 15-digit TRN, an emirate and an address', () => {
  const usd = createCompany({ name: 'US Co', currency: 'USD' });
  assert.ok(usd.ok);
  assert.equal(code(execute(usd.value, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Dubai', from: '2026-01-01' })), 'vat.currency');
  const aed = createCompany({ name: 'AE Co', currency: 'AED' });
  assert.ok(aed.ok);
  const c = aed.value;
  assert.equal(code(execute(c, 'vat.setup', { trn: '12345', emirate: 'DU', address: 'Dubai', from: '2026-01-01' })), 'vat.trn_invalid');
  assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: 'XX', address: 'Dubai', from: '2026-01-01' })), 'vat.emirate_invalid');
  assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: '  ', from: '2026-01-01' })), 'vat.address_missing');
  assert.equal(c.vat, null);
  assert.equal(code(execute(c, 'vat.setup', { trn: '100-1234-5670-0003', emirate: 'AZ', address: 'Abu Dhabi', from: '2026-01-01' })), 'ok');
  assert.equal(c.vat!.trn, '100123456700003');
  const vatAccounts = [...c.accounts.values()].filter((a) => a.role === 'vat_output' || a.role === 'vat_input');
  assert.equal(vatAccounts.length, 2);
  // Changing the details keeps the same two accounts.
  assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: 'SH', address: 'Sharjah', from: '2026-01-01' })), 'ok');
  assert.equal([...c.accounts.values()].filter((a) => a.role === 'vat_output' || a.role === 'vat_input').length, 2);
  assert.equal(code(execute(c, 'account.setActive', { id: vatAccounts[0]!.id, active: false })), 'account.system');
  assert.equal(checkIntegrity(c).ok, true);
});

test('guards: tax codes need registration, reverse charge is for purchases, VAT accounts stay off lines', () => {
  const plain = createCompany({ name: 'Plain', currency: 'AED' });
  assert.ok(plain.ok);
  const p = plain.value;
  const cust = (execute(p, 'customer.create', { name: 'A' }) as R).value.id;
  assert.equal(code(execute(p, 'invoice.create', { customerId: cust, date: '2026-07-01', lines: [{ accountId: findAccount(p, '4000')!.id, rate: 100, taxCode: 'SR' }] })), 'line.vat_off');
  // Without VAT, nothing changes: no tax code, no VAT.
  const inv = execute(p, 'invoice.create', { customerId: cust, date: '2026-07-01', lines: [{ accountId: findAccount(p, '4000')!.id, rate: 100 }] }) as R;
  assert.equal(inv.value.total, 100);
  assert.equal(inv.value.lines[0].taxCode, null);

  const { c } = oasis();
  const noor = [...c.parties.values()].find((x) => x.name === 'Al Noor Trading')!.id;
  const marina = [...c.parties.values()].find((x) => x.name === 'Marina Properties')!.id;
  assert.equal(code(execute(c, 'invoice.create', { customerId: noor, date: '2026-09-15', lines: [{ accountId: findAccount(c, '4000')!.id, rate: 100, taxCode: 'RC' }] })), 'line.reverse_charge_sales');
  assert.equal(code(execute(c, 'invoice.create', { customerId: noor, date: '2026-09-15', lines: [{ accountId: findAccount(c, '4000')!.id, rate: 100, taxCode: 'XX' }] })), 'line.tax_code_invalid');
  assert.equal(code(execute(c, 'bill.create', { vendorId: marina, date: '2026-09-15', lines: [{ accountId: findAccount(c, '2210')!.id, rate: 100 }] })), 'line.account_vat');
  // A line with no code on a VAT company is standard-rated.
  const d = execute(c, 'invoice.create', { customerId: noor, date: '2026-09-15', lines: [{ accountId: findAccount(c, '4000')!.id, rate: 1000 }] }) as R;
  assert.equal(d.value.lines[0].taxCode, 'SR');
  assert.equal(d.value.total, 1050);
  // A credit memo may only name an invoice of the same customer.
  const bill = [...c.documents.values()].find((x) => x.kind === 'bill')!;
  assert.equal(code(execute(c, 'creditMemo.create', { customerId: noor, date: '2026-09-15', refId: bill.id, lines: [{ accountId: findAccount(c, '4000')!.id, rate: 100 }] })), 'doc.ref_invalid');
  assert.equal(checkIntegrity(c).ok, true);
});

test('an item carries its default tax code to new lines', () => {
  const { c } = oasis();
  const noor = [...c.parties.values()].find((x) => x.name === 'Al Noor Trading')!.id;
  assert.equal(code(execute(c, 'item.create', { name: 'Bad', price: 100, salesAccountId: findAccount(c, '4000')!.id, taxCode: 'RC' })), 'item.tax_code_invalid');
  const item = (execute(c, 'item.create', { name: 'Export pack', price: 10000, salesAccountId: findAccount(c, '4000')!.id, taxCode: 'ZR' }) as R).value;
  const inv = execute(c, 'invoice.create', { customerId: noor, date: '2026-09-20', lines: [{ itemId: item.id }] }) as R;
  assert.equal(inv.value.lines[0].taxCode, 'ZR');
  assert.equal(inv.value.total, 10000);
});

test('estimates carry their tax codes into the invoice', () => {
  const { c } = oasis();
  const noor = [...c.parties.values()].find((x) => x.name === 'Al Noor Trading')!.id;
  const e = execute(c, 'estimate.create', { customerId: noor, date: '2026-09-01', taxInclusive: true, lines: [{ accountId: findAccount(c, '4000')!.id, rate: 2100, taxCode: 'SR' }, { accountId: findAccount(c, '4000')!.id, rate: 500, taxCode: 'ZR' }] }) as R;
  assert.equal(e.value.total, 2600);
  const inv = execute(c, 'estimate.toInvoice', { docId: e.value.id, date: '2026-09-02' }) as R;
  assert.equal(inv.ok, true);
  assert.equal(inv.value.taxInclusive, true);
  assert.deepEqual(inv.value.lines.map((l: any) => [l.taxCode, l.tax]), [['SR', 100], ['ZR', 0]]);
  assert.equal(inv.value.total, 2600);
});

test('a VAT company saves and opens again unchanged; a version 1 file still opens', () => {
  const { c } = oasis();
  const back = fromText(toText(c));
  assert.ok(back.ok, back.ok ? '' : back.error.message);
  assert.deepEqual(back.value.vat, c.vat);
  assert.deepEqual(tb(back.value, '2026-12-31'), tb(c, '2026-12-31'));
  assert.deepEqual(quarter(back.value, '2026-07-01', '2026-09-30'), quarter(c, '2026-07-01', '2026-09-30'));

  // A file from before VAT: no vat, no trn, no tax fields.
  const old = createCompany({ name: 'Old', currency: 'JOD' });
  assert.ok(old.ok);
  const o = old.value;
  const cust = (execute(o, 'customer.create', { name: 'A' }) as R).value.id;
  execute(o, 'invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ accountId: findAccount(o, '4000')!.id, rate: 1500 }] });
  const file = JSON.parse(toText(o));
  file.version = 1;
  delete file.company.vat;
  for (const p of file.company.parties) delete p.trn;
  for (const d of file.company.documents) {
    delete d.taxInclusive;
    delete d.refId;
    for (const l of d.lines) {
      delete l.taxCode;
      delete l.tax;
    }
  }
  const opened = fromText(JSON.stringify(file));
  assert.ok(opened.ok, opened.ok ? '' : opened.error.message);
  assert.equal(opened.value.vat, null);
  assert.equal([...opened.value.documents.values()][0]!.lines[0]!.taxCode, null);
});

test('a file whose VAT was tampered with is refused', () => {
  const { c } = oasis();
  const tamper = (f: (file: any) => void) => {
    const file = JSON.parse(toText(c));
    f(file);
    return fromText(JSON.stringify(file));
  };
  const inv1 = (file: any) => file.company.documents.find((d: any) => d.kind === 'invoice' && d.number === '1');
  assert.equal(tamper((f) => (inv1(f).lines[0].tax = 18000)).ok, false); // VAT that does not match the rate
  assert.equal(tamper((f) => (inv1(f).lines[0].taxCode = 'ZR')).ok, false); // code changed after posting
  assert.equal(tamper((f) => (inv1(f).taxInclusive = true)).ok, false);
  assert.equal(tamper((f) => (f.company.vat.trn = '123')).ok, false);
  assert.equal(tamper((f) => (f.company.vat = null)).ok, false); // VAT accounts without registration
  assert.equal(tamper((f) => (f.company.parties[0].trn = 'abc')).ok, false);
});

test('IIF round trip of a VAT company keeps every balance', () => {
  const { c } = oasis();
  const text = exportIif(c);
  const fresh = createCompany({ name: 'Copy', currency: 'AED', template: 'none' });
  assert.ok(fresh.ok);
  const imported = importIif(fresh.value, text);
  assert.ok(imported.ok, imported.ok ? '' : imported.error.message);
  assert.equal(checkIntegrity(fresh.value).ok, true);
  const byName = (co: Company, asOf: string) => {
    const t = trialBalance(co, asOf);
    assert.ok(t.ok);
    return Object.fromEntries(t.value.rows.filter((r) => r.debit || r.credit).map((r) => [r.name, r.debit - r.credit]));
  };
  assert.deepEqual(byName(fresh.value, '2026-12-31'), byName(c, '2026-12-31'));
});

test('importing into a VAT company adds no VAT and keeps every balance, in either language', () => {
  const { c: source } = oasis();
  const text = exportIif(source);
  for (const language of ['en', 'ar'] as const) {
    const target = createCompany({ name: 'Target', currency: 'AED', template: 'none', language });
    assert.ok(target.ok);
    const t = target.value;
    // Register first, then import: documents come in as out of scope, and lines on the source's VAT
    // accounts land on this company's own VAT accounts through journal entries.
    assert.equal(code(execute(t, 'vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Dubai', from: '2026-01-01' })), 'ok');
    const imported = execute(t, 'import.iif', { text }) as R;
    assert.ok(imported.ok, imported.ok ? '' : imported.error!.message);
    assert.equal(checkIntegrity(t).ok, true);
    const vatAccts = [...t.accounts.values()].filter((a) => /VAT|ضريبة/.test(a.name));
    assert.equal(vatAccts.length, 2, `${language}: no duplicate VAT accounts`);
    for (const d of t.documents.values()) for (const l of d.lines) assert.ok(l.taxCode === 'OS' && l.tax === 0);
    const out = vatAccts.find((a) => a.role === 'vat_output')!;
    const inp = vatAccts.find((a) => a.role === 'vat_input')!;
    const bal = trialBalance(t, '2026-09-30');
    assert.ok(bal.ok);
    const row = (id: string) => bal.value.rows.find((r) => r.accountId === id)!;
    assert.equal(row(out.id).credit - row(out.id).debit, 16479);
    assert.equal(row(inp.id).debit - row(inp.id).credit, 31074);
    // History imported from another program is not part of this company's return; it shows as other entries.
    const r = quarter(t, '2026-07-01', '2026-09-30');
    assert.equal(r.box12, 0);
    assert.deepEqual(r.otherEntries, { output: 16479, input: 31074 });
  }
});

test('property: on random VAT companies the return equals the VAT accounts and integrity holds', () => {
  let seed = 20261025;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[rnd(xs.length)]!;
  for (let company = 0; company < 80; company++) {
    const made = createCompany({ name: `Random ${company}`, currency: 'AED' });
    assert.ok(made.ok);
    const c = made.value;
    assert.equal(code(execute(c, 'vat.setup', { trn: '100123456700003', emirate: pick(['AZ', 'DU', 'SH', 'AJ', 'UQ', 'RK', 'FU'] as const), address: 'UAE', from: '2026-01-01' })), 'ok');
    const cust = (execute(c, 'customer.create', { name: 'C' }) as R).value.id;
    const vend = (execute(c, 'vendor.create', { name: 'V' }) as R).value.id;
    const income = ['4000', '4100', '7000'].map((n) => findAccount(c, n)!.id);
    const costs = ['6000', '6300', '6600', '5000'].map((n) => findAccount(c, n)!.id);
    const bank = findAccount(c, '1010')!.id;
    const made_: number[] = [];
    for (let op = 0; op < 40; op++) {
      const date = `2026-0${1 + rnd(9)}-${String(1 + rnd(28)).padStart(2, '0')}`;
      const sales = rnd(2) === 0;
      const kind = sales ? pick(['invoice', 'salesReceipt', 'creditMemo'] as const) : pick(['bill', 'expense', 'vendorCredit'] as const);
      const codes = sales ? (['SR', 'ZR', 'EX', 'OS'] as const) : (['SR', 'ZR', 'EX', 'OS', 'RC'] as const);
      const lines = Array.from({ length: 1 + rnd(4) }, () => ({ accountId: pick(sales ? income : costs), quantity: String(1 + rnd(5)), rate: rnd(200000), taxCode: pick(codes) }));
      const p: Record<string, unknown> = { date, lines, taxInclusive: rnd(3) === 0 };
      if (kind === 'invoice' || kind === 'creditMemo') p.customerId = cust;
      if (kind === 'salesReceipt') p.depositToId = bank;
      if (kind === 'bill' || kind === 'vendorCredit') p.vendorId = vend;
      if (kind === 'expense') p.payFromId = bank;
      if (kind === 'creditMemo' || kind === 'vendorCredit') {
        // A credit names an earlier document of the same name and gives a reason.
        const targets = [...c.documents.values()].filter((d) => d.kind === (kind === 'creditMemo' ? 'invoice' : 'bill') && !d.voided && d.date <= date);
        if (!targets.length) continue;
        p.refId = pick(targets).id;
        p.memo = 'Correction';
        if (rnd(2) === 0) for (const l of lines) delete (l as Record<string, unknown>).taxCode; // take the codes from the document
      }
      const r = execute(c, `${kind}.create`, p) as R;
      if (r.ok) made_.push(r.value.id);
      else assert.ok(['doc.zero_total', 'doc.credit_over_ref'].includes(r.error!.code), r.error!.message);
      if (made_.length && rnd(10) === 0) execute(c, 'document.void', { docId: pick(made_) });
    }
    const sound = checkIntegrity(c);
    assert.ok(sound.ok, sound.ok ? '' : sound.error.message);
    const r = quarter(c, '2026-01-01', '2026-12-31');
    const t = tb(c, '2026-12-31');
    assert.equal(r.box12, -(t['2210'] ?? 0), `company ${company}: output`);
    assert.equal(r.box13, t['1410'] ?? 0, `company ${company}: input`);
    assert.equal(r.box14, r.box12 - r.box13);
    // Each line's VAT is a whole, non-negative number of fils, and no credit takes back more than
    // its document holds at any tax code.
    for (const d of c.documents.values()) {
      for (const l of d.lines) assert.ok(Number.isInteger(l.tax) && l.tax >= 0);
      if (d.refId !== null && !c.documents.get(d.refId)!.voided) for (const left of creditRoom(c, c.documents.get(d.refId)!).values()) assert.ok(left >= 0, `credits over document ${d.refId}`);
    }
  }
});
