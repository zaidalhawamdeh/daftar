import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, findAccount, type Company } from '../company.ts';
import { postEntry } from '../journal.ts';
import { lineAmount, parseQuantity } from '../quantity.ts';
import { aging, openInvoices, partyBalances, unappliedCredits, unpaidBills } from '../subledger.ts';
import { cashFlow } from '../cashflow.ts';
import { trialBalance } from '../reports.ts';

type R = { ok: boolean; value?: unknown; error?: { code: string } };
const code = (r: R) => (r.ok ? 'ok' : r.error?.code);

function setup() {
  const made = createCompany({ name: 'Docs Co', currency: 'USD' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const run = (id: string, p: Record<string, unknown>) => {
    const r = execute(c, id, p);
    if (!r.ok) throw new Error(`${id}: ${r.error.code} ${r.error.message}`);
    return r.value as { id: number | string; total: number };
  };
  const acct = (n: string) => findAccount(c, n)!.id;
  const cust = run('customer.create', { name: 'Huda', termsDays: 10 }).id as string;
  const cust2 = run('customer.create', { name: 'Karim' }).id as string;
  const vend = run('vendor.create', { name: 'Supplier One' }).id as string;
  const vend2 = run('vendor.create', { name: 'Supplier Two' }).id as string;
  const svc = run('item.create', { name: 'Consulting', price: 10000, salesAccountId: acct('4100') }).id as string;
  const buyOnly = run('item.create', { name: 'Toner', cost: 3000, purchaseAccountId: acct('6400') }).id as string;
  return { c, run, acct, cust, cust2, vend, vend2, svc, buyOnly };
}

const exec = (c: Company, id: string, p: unknown) => execute(c, id, p) as R;

test('quantities: up to three decimals, positive; amounts round half away from zero', () => {
  assert.deepEqual(parseQuantity('1.5'), { ok: true, value: 1500 });
  assert.deepEqual(parseQuantity(2), { ok: true, value: 2000 });
  for (const bad of ['0', '1.2345', '-1', 'abc', '', 1e30, NaN, '1e3']) assert.equal(parseQuantity(bad).ok, false, String(bad));
  assert.deepEqual(lineAmount(2333, 8500), { ok: true, value: 19831 });
  assert.deepEqual(lineAmount(1001, 5), { ok: true, value: 5 }, '1.001 × 0.05 = 0.05005 → 0.05');
  assert.deepEqual(lineAmount(1500, 3), { ok: true, value: 5 }, '1.5 × 0.03 = 0.045 → 0.05');
  assert.equal(lineAmount(1_000_000_000_000, Number.MAX_SAFE_INTEGER).ok, false);
});

test('names are unique across customers and vendors; items need the right kind of account', () => {
  const { c, acct } = setup();
  assert.equal(code(exec(c, 'vendor.create', { name: 'huda' })), 'party.name_taken');
  assert.equal(code(exec(c, 'item.create', { name: 'Bad', salesAccountId: acct('6000') })), 'item.account_class');
  assert.equal(code(exec(c, 'item.create', { name: 'Bad', salesAccountId: acct('1200') })), 'item.account_type');
  assert.equal(code(exec(c, 'item.create', { name: 'Nothing' })), 'item.no_account');
  assert.equal(code(exec(c, 'item.create', { name: 'consulting', salesAccountId: acct('4000') })), 'item.name_taken');
});

test('receivables and payables move only through documents, each line naming the right kind of party', () => {
  const { c, acct, cust, vend } = setup();
  const lines = (partyId: string | undefined) => [{ accountId: acct('1200'), debit: 100, partyId }, { accountId: acct('4000'), credit: 100 }];
  assert.equal(code(postEntry(c, { date: '2026-01-05', lines: lines(cust) })), 'line.control_needs_document', 'no plain journal entry to A/R');
  const source = { kind: 'invoice', id: 999 };
  assert.equal(code(postEntry(c, { date: '2026-01-05', lines: lines(undefined), source })), 'line.party_required');
  assert.equal(code(postEntry(c, { date: '2026-01-05', lines: lines(vend), source })), 'line.party_kind');
  assert.equal(code(postEntry(c, { date: '2026-01-05', lines: lines('nobody'), source })), 'line.party_missing');
});

test('documents refuse bad parties, lines and totals, and change nothing when they do', () => {
  const { c, acct, cust, vend, svc, buyOnly } = setup();
  const before = structuredClone(c);
  const inv = (p: Record<string, unknown>) => exec(c, 'invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ itemId: svc }], ...p });
  assert.equal(code(inv({ customerId: undefined })), 'doc.party_required');
  assert.equal(code(inv({ customerId: vend })), 'doc.party_missing');
  assert.equal(code(inv({ lines: [] })), 'doc.lines_missing');
  assert.equal(code(inv({ lines: [{ itemId: buyOnly }] })), 'line.item_side');
  assert.equal(code(inv({ lines: [{ accountId: acct('1200'), amount: 5 }] })), 'line.account_type');
  assert.equal(code(inv({ lines: [{ itemId: svc, quantity: 2, amount: 100 }] })), 'line.amount_mismatch');
  assert.equal(code(inv({ lines: [{ itemId: svc, rate: 0 }] })), 'doc.zero_total');
  assert.equal(code(inv({ lines: [{ accountId: acct('4000') }] })), 'line.rate_missing');
  assert.equal(code(inv({ dueDate: '2026-01-01' })), 'doc.due_before_date');
  assert.equal(code(inv({ date: '2026-02-30' })), 'date.invalid');
  assert.equal(code(exec(c, 'transfer.create', { date: '2026-01-05', fromId: acct('1010'), toId: acct('1010'), amount: 5 })), 'transfer.same_account');
  assert.equal(code(exec(c, 'expense.create', { date: '2026-01-05', payFromId: acct('6000'), lines: [{ accountId: acct('6400'), amount: 5 }] })), 'doc.money_account_type');
  assert.deepEqual(c, before);
});

test('numbering: invoices count up, duplicates are refused; bill numbers are unique per vendor', () => {
  const { c, run, cust, vend, vend2, buyOnly, svc } = setup();
  const inv = (number?: string) => exec(c, 'invoice.create', { customerId: cust, date: '2026-01-05', number, lines: [{ itemId: svc }] }) as R & { value: { number: string } };
  assert.equal(inv().value.number, '1');
  assert.equal(inv('100').value.number, '100');
  assert.equal(inv().value.number, '101');
  assert.equal(code(inv('100')), 'doc.number_taken');
  const bill = (vendorId: string) => exec(c, 'bill.create', { vendorId, date: '2026-01-05', number: 'A-1', lines: [{ itemId: buyOnly }] });
  assert.equal(code(bill(vend)), 'ok');
  assert.equal(code(bill(vend)), 'doc.number_taken');
  assert.equal(code(bill(vend2)), 'ok');
  void run;
});

test('applications: never more than is open or available, never someone else’s invoice', () => {
  const { c, run, acct, cust, cust2, svc } = setup();
  const i1 = run('invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ itemId: svc }] });
  const i2 = run('invoice.create', { customerId: cust2, date: '2026-01-05', lines: [{ itemId: svc }] });
  const late = run('invoice.create', { customerId: cust, date: '2026-02-01', lines: [{ itemId: svc }] });
  const pay = (applications: unknown[], amount = 15000) => exec(c, 'payment.receive', { customerId: cust, date: '2026-01-10', amount, depositToId: acct('1010'), applications });
  assert.equal(code(pay([{ docId: i1.id, amount: 10001 }])), 'apply.over_target');
  assert.equal(code(pay([{ docId: i2.id, amount: 100 }])), 'apply.target_party');
  assert.equal(code(pay([{ docId: late.id, amount: 100 }])), 'apply.target_later');
  assert.equal(code(pay([{ docId: i1.id, amount: 100 }, { docId: i1.id, amount: 100 }])), 'apply.duplicate');
  assert.equal(code(pay([{ docId: i1.id, amount: 10000 }], 5000)), 'apply.over_source');
  assert.equal(code(pay([{ docId: i1.id, amount: 0 }])), 'apply.amount_invalid');
  const p = run('payment.receive', { customerId: cust, date: '2026-01-10', amount: 15000, depositToId: acct('1010'), applications: [{ docId: i1.id, amount: 10000 }] });
  assert.equal(unappliedCredits(c, 'customer', '2026-12-31')[0]?.left, 5000);
  assert.equal(code(exec(c, 'ar.apply', { sourceId: p.id, date: '2026-01-05', applications: [{ docId: late.id, amount: 100 }] })), 'apply.before_source');
  assert.equal(code(exec(c, 'ar.apply', { sourceId: p.id, date: '2026-02-01', applications: [{ docId: late.id, amount: 5001 }] })), 'apply.over_source');
  assert.equal(code(exec(c, 'ap.apply', { sourceId: p.id, date: '2026-02-01', applications: [{ docId: late.id, amount: 100 }] })), 'apply.side');
  assert.equal(code(exec(c, 'ar.apply', { sourceId: p.id, date: '2026-02-01', applications: [{ docId: late.id, amount: 5000 }] })), 'ok');
  assert.deepEqual(unappliedCredits(c, 'customer', '2026-12-31'), []);
});

test('voids: refused while something is applied; voiding a payment reopens its invoices', () => {
  const { c, run, acct, cust, svc } = setup();
  const inv = run('invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ itemId: svc }] });
  const pay = run('payment.receive', { customerId: cust, date: '2026-01-10', amount: 10000, depositToId: acct('1010'), applications: [{ docId: inv.id, amount: 10000 }] });
  assert.equal(code(exec(c, 'document.void', { docId: inv.id })), 'doc.applied');
  assert.equal(openInvoices(c, '2026-12-31').ok && (openInvoices(c, '2026-12-31') as { value: { rows: unknown[] } }).value.rows.length, 0);
  assert.equal(code(exec(c, 'document.void', { docId: pay.id })), 'ok');
  const open = openInvoices(c, '2026-12-31');
  assert.ok(open.ok && open.value.total === 10000);
  assert.equal(code(exec(c, 'document.void', { docId: pay.id })), 'doc.void');
  assert.equal(code(exec(c, 'document.void', { docId: inv.id })), 'ok');
  const tb = trialBalance(c, '2026-12-31');
  assert.ok(tb.ok && tb.value.rows.length === 0, 'everything voided nets to nothing');
});

test('estimates: converting closes them; a converted estimate cannot be voided or converted again; voiding the invoice reopens it', () => {
  const { c, run, cust, svc } = setup();
  const est = run('estimate.create', { customerId: cust, date: '2026-01-02', lines: [{ itemId: svc, quantity: 3 }] });
  const inv = run('estimate.toInvoice', { docId: est.id, date: '2026-01-05' });
  assert.equal(inv.total, 30000);
  assert.equal(code(exec(c, 'estimate.toInvoice', { docId: est.id })), 'doc.closed');
  assert.equal(code(exec(c, 'document.void', { docId: est.id })), 'doc.converted');
  assert.equal(code(exec(c, 'document.void', { docId: inv.id })), 'ok');
  assert.equal(c.documents.get(est.id as number)!.status, 'open');
  assert.equal(code(exec(c, 'estimate.toInvoice', { docId: est.id, date: '2026-01-06' })), 'ok');
});

test('closed periods: no new documents and no voids inside them', () => {
  const { c, run, cust, svc } = setup();
  const inv = run('invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ itemId: svc }] });
  execute(c, 'company.setClosingDate', { date: '2026-01-31' });
  assert.equal(code(exec(c, 'invoice.create', { customerId: cust, date: '2026-01-20', lines: [{ itemId: svc }] })), 'date.closed');
  assert.equal(code(exec(c, 'document.void', { docId: inv.id })), 'date.closed');
  assert.equal(c.documents.get(inv.id as number)!.voided, false);
});

test('a crash inside a document command restores everything', () => {
  const { c, cust } = setup();
  const before = structuredClone(c);
  const evil = { customerId: cust, date: '2026-01-05', lines: [{ get itemId(): string { throw new Error('boom'); } }] };
  assert.equal(code(exec(c, 'invoice.create', evil)), 'internal');
  assert.deepEqual(c, before);
});

// Random document activity: the receivables and payables must always tie out three ways.
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

test('random documents: A/R and A/P tie to party balances and to open documents minus unapplied credits', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rand = rng(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const { c, acct, cust, cust2, vend, vend2, svc, buyOnly } = setup();
    const pick = <T>(xs: T[]) => xs[int(0, xs.length - 1)]!;
    const day = () => `2026-0${int(1, 6)}-${String(int(1, 28)).padStart(2, '0')}`;
    const docs = () => [...c.documents.values()];
    for (let i = 0; i < 60; i++) {
      const roll = rand();
      const qty = `${int(1, 20)}.${int(0, 999)}`;
      if (roll < 0.2) execute(c, 'invoice.create', { customerId: pick([cust, cust2]), date: day(), lines: [{ itemId: svc, quantity: qty }] });
      else if (roll < 0.35) execute(c, 'bill.create', { vendorId: pick([vend, vend2]), date: day(), lines: [{ itemId: buyOnly, quantity: qty }] });
      else if (roll < 0.5 || roll < 0.6) {
        const sales = roll < 0.5;
        const target = pick(docs().filter((d) => d.kind === (sales ? 'invoice' : 'bill') && !d.voided).concat([undefined as never]));
        if (!target) continue;
        const amount = int(1, target.total + 5000);
        const apps = rand() < 0.8 ? [{ docId: target.id, amount: Math.min(amount, int(1, target.total)) }] : [];
        if (sales) execute(c, 'payment.receive', { customerId: target.partyId, date: day(), amount, depositToId: acct('1010'), applications: apps });
        else execute(c, 'bill.pay', { vendorId: target.partyId, date: day(), amount, payFromId: acct('1010'), applications: apps });
      } else if (roll < 0.68) execute(c, 'creditMemo.create', { customerId: pick([cust, cust2]), date: day(), lines: [{ itemId: svc, quantity: '0.5' }] });
      else if (roll < 0.74) execute(c, 'vendorCredit.create', { vendorId: pick([vend, vend2]), date: day(), lines: [{ itemId: buyOnly }] });
      else if (roll < 0.86) {
        const src = pick(docs().filter((d) => ['payment', 'credit_memo', 'bill_payment', 'vendor_credit'].includes(d.kind)).concat([undefined as never]));
        const tgt = src && pick(docs().filter((d) => d.partyId === src.partyId && (d.kind === 'invoice' || d.kind === 'bill')).concat([undefined as never]));
        if (src && tgt) execute(c, src.kind === 'payment' || src.kind === 'credit_memo' ? 'ar.apply' : 'ap.apply', { sourceId: src.id, date: '2026-06-30', applications: [{ docId: tgt.id, amount: int(1, 30000) }] });
      } else {
        const d = pick(docs().concat([undefined as never]));
        if (d) execute(c, 'document.void', { docId: d.id });
      }
    }
    for (const asOf of ['2026-03-15', '2026-06-30']) {
      const tb = trialBalance(c, asOf);
      assert.ok(tb.ok && tb.value.totalDebit === tb.value.totalCredit, `seed ${seed}`);
      const ar = (tb.ok ? tb.value.rows.find((r) => r.number === '1200') : undefined) ?? { debit: 0, credit: 0 };
      const ap = (tb.ok ? tb.value.rows.find((r) => r.number === '2000') : undefined) ?? { debit: 0, credit: 0 };
      const arNet = ar.debit - ar.credit;
      const apNet = ap.credit - ap.debit;
      const cb = partyBalances(c, 'customer', asOf);
      const vb = partyBalances(c, 'vendor', asOf);
      const oi = openInvoices(c, asOf);
      const ub = unpaidBills(c, asOf);
      assert.ok(cb.ok && vb.ok && oi.ok && ub.ok);
      const credits = (side: 'customer' | 'vendor') => unappliedCredits(c, side, asOf).reduce((t, x) => t + x.left, 0);
      assert.equal(cb.value.total, arNet, `seed ${seed} ${asOf}: customer balances = A/R`);
      assert.equal(oi.value.total - credits('customer'), arNet, `seed ${seed} ${asOf}: open invoices − unapplied = A/R`);
      assert.equal(vb.value.total, apNet, `seed ${seed} ${asOf}: vendor balances = A/P`);
      assert.equal(ub.value.total - credits('vendor'), apNet, `seed ${seed} ${asOf}: unpaid bills − unapplied = A/P`);
      const ag = aging(c, 'customer', asOf, int(1, 60), int(1, 6));
      const apg = aging(c, 'vendor', asOf);
      assert.ok(ag.ok && apg.ok);
      assert.equal(ag.value.total, arNet, `seed ${seed} ${asOf}: A/R aging = A/R`);
      assert.equal(ag.value.totals.reduce((t, x) => t + x, 0), arNet, `seed ${seed} ${asOf}: aging columns add up`);
      assert.equal(apg.value.total, apNet, `seed ${seed} ${asOf}: A/P aging = A/P`);
      const cf = cashFlow(c, '2026-02-01', asOf);
      assert.ok(cf.ok, `seed ${seed}: cash flow reconciles`);
      for (const d of c.documents.values()) assert.ok(d.voided || (d.kind !== 'invoice' && d.kind !== 'bill') || (oi.value.rows.concat(ub.value.rows).find((r) => r.docId === d.id)?.open ?? 0) >= 0);
    }
  }
});
