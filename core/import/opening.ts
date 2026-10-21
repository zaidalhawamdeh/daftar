// Moving in with opening balances, from reports any accounting program can export as CSV: a trial
// balance on the start date, plus the open invoices and unpaid bills behind the receivables and
// payables. Receivables and payables come in as real invoices and bills (against Opening Balance
// Equity), so they can be paid and aged from the first day.

import { ACCOUNT_TYPES, isAccountType, type AccountType } from '../accounts.ts';
import { createAccount, findAccount, type Company } from '../company.ts';
import { createPurchaseDoc, createSalesDoc } from '../documents.ts';
import { createItem, type ItemType } from '../items.ts';
import { postEntry } from '../journal.ts';
import { formatAmount, parseAmount, type Minor } from '../money.ts';
import { createParty, findParty, type PartyKind } from '../parties.ts';
import { err, ok, type Result } from '../result.ts';
import { column, parseCsv, type Table } from './csv.ts';
import { iifDate } from './iif.ts';

const ACCOUNT = ['account', 'name', 'account name', 'الحساب', 'اسم الحساب'];
const DEBIT = ['debit', 'مدين'];
const CREDIT = ['credit', 'دائن'];
const AMOUNT = ['amount', 'balance', 'open balance', 'المبلغ', 'الرصيد', 'الرصيد المفتوح'];
const NUMBER = ['num', 'number', 'no', 'doc num', 'invoice', 'bill', 'ref no', 'الرقم'];
const DATE = ['date', 'التاريخ'];
const DUE = ['due date', 'due', 'تاريخ الاستحقاق', 'الاستحقاق'];

function money(c: Company, s: string | undefined): Result<Minor> {
  if (!s || !s.trim()) return ok(0);
  return parseAmount(s.replace(/[^\d.,()\-−٠-٩٫٬]/g, ''), c.currency);
}

function date(s: string | undefined): string | null {
  return s ? iifDate(s.trim()) : null;
}

function accountByKey(c: Company, key: string) {
  const k = key.trim();
  const numbered = /^(\S+)\s*[·\-–]\s*(.+)$/.exec(k);
  return findAccount(c, k) ?? (numbered ? findAccount(c, numbered[1]!) ?? findAccount(c, numbered[2]!) : undefined) ?? findAccount(c, k.split(':').at(-1) ?? k);
}

export interface OpeningSummary {
  lines: number;
  invoices: number;
  bills: number;
  newCustomers: number;
  newVendors: number;
  difference: Minor; // what the trial balance was out by; booked to Opening Balance Equity
  warnings: string[];
}

export function importOpeningBalances(c: Company, input: { date: unknown; trialBalance: unknown; openInvoices?: unknown; unpaidBills?: unknown }): Result<OpeningSummary> {
  if (typeof input.date !== 'string' || !date(input.date)) return err('date.invalid', 'Choose the date the opening balances are on.');
  const on = date(input.date)!;
  if (typeof input.trialBalance !== 'string' || !input.trialBalance.trim()) return err('opening.tb_missing', 'Add the trial balance (CSV).');
  const s: OpeningSummary = { lines: 0, invoices: 0, bills: 0, newCustomers: 0, newVendors: 0, difference: 0, warnings: [] };
  const tb = parseCsv(input.trialBalance);
  const ca = column(tb, ACCOUNT);
  const cd = column(tb, DEBIT);
  const cc = column(tb, CREDIT);
  const cm = column(tb, AMOUNT);
  if (ca < 0 || (cd < 0 && cm < 0)) return err('opening.tb_columns', 'The trial balance needs an Account column and Debit/Credit (or Amount) columns.');

  const missing: string[] = [];
  const lines: { accountId: string; type: AccountType; amount: Minor }[] = [];
  for (const [i, r] of tb.rows.entries()) {
    const key = r[ca] ?? '';
    if (!key || /^total/i.test(key) || key === 'المجموع') continue;
    const a = accountByKey(c, key);
    if (!a) {
      missing.push(key);
      continue;
    }
    let amount: Minor;
    if (cd >= 0) {
      const d = money(c, r[cd]);
      const cr = cc >= 0 ? money(c, r[cc]) : ok(0);
      if (!d.ok || !cr.ok) return err('opening.amount', `Row ${i + 2}: "${r[cd]} / ${r[cc] ?? ''}" is not an amount.`);
      amount = d.value - cr.value;
    } else {
      const m = money(c, r[cm]);
      if (!m.ok) return err('opening.amount', `Row ${i + 2}: "${r[cm]}" is not an amount.`);
      amount = m.value;
    }
    if (amount !== 0) lines.push({ accountId: a.id, type: a.type, amount });
  }
  if (missing.length) return err('opening.accounts_missing', `These accounts are not in the chart of accounts yet: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}.`, { missing });

  const obe = findAccount(c, 'Opening Balance Equity') ?? findAccount(c, 'حقوق ملكية الأرصدة الافتتاحية');
  let obeId = obe?.id;
  if (!obeId) {
    const made = createAccount(c, { name: 'Opening Balance Equity', type: 'equity' });
    if (!made.ok) return made;
    obeId = made.value.id;
  }

  // Receivables and payables: the documents behind them must add up to the trial balance.
  for (const [side, text] of [['customer', input.openInvoices], ['vendor', input.unpaidBills]] as const) {
    const control: AccountType = side === 'customer' ? 'accounts_receivable' : 'accounts_payable';
    const expected = lines.filter((l) => l.type === control).reduce((t, l) => t + (side === 'customer' ? l.amount : -l.amount), 0);
    if (typeof text !== 'string' || !text.trim()) {
      if (expected !== 0) return err('opening.docs_missing', `The trial balance shows ${side === 'customer' ? 'receivables' : 'payables'} of ${formatAmount(expected, c.currency)}; add the ${side === 'customer' ? 'open invoices' : 'unpaid bills'} behind them.`);
      continue;
    }
    const t = parseCsv(text);
    const docs = readDocs(c, t, side);
    if (!docs.ok) return docs;
    const total = docs.value.reduce((x, d) => x + d.amount, 0);
    if (total !== expected) {
      return err('opening.docs_mismatch', `The ${side === 'customer' ? 'open invoices' : 'unpaid bills'} add up to ${formatAmount(total, c.currency)} but the trial balance shows ${formatAmount(expected, c.currency)}.`);
    }
    for (const d of docs.value) {
      let party = findParty(c, side, d.name);
      if (!party) {
        const made = createParty(c, side, { name: d.name });
        if (!made.ok) return made;
        party = made.value;
        if (side === 'customer') s.newCustomers++;
        else s.newVendors++;
      }
      const body = { date: d.date ?? on, dueDate: d.due ?? undefined, number: d.number || undefined, memo: 'Opening balance', lines: [{ accountId: obeId, amount: d.amount, description: 'Opening balance' }] };
      const made = side === 'customer' ? createSalesDoc(c, 'invoice', { ...body, customerId: party.id }) : createPurchaseDoc(c, 'bill', { ...body, vendorId: party.id });
      if (!made.ok) return err(made.error.code, `${d.name} ${d.number}: ${made.error.message}`);
      if (side === 'customer') s.invoices++;
      else s.bills++;
    }
  }

  // Everything else in one journal entry; whatever the trial balance was out by goes to Opening
  // Balance Equity and is reported.
  const rest = lines.filter((l) => l.type !== 'accounts_receivable' && l.type !== 'accounts_payable');
  const control = lines.filter((l) => l.type === 'accounts_receivable' || l.type === 'accounts_payable').reduce((t, l) => t + l.amount, 0);
  const restSum = rest.reduce((t, l) => t + l.amount, 0);
  s.difference = restSum + control;
  if (s.difference !== 0) s.warnings.push(`The trial balance was out by ${formatAmount(s.difference, c.currency)}; the difference is in Opening Balance Equity.`);
  if (rest.length) {
    const jl = rest.map((l) => ({ accountId: l.accountId, debit: l.amount > 0 ? l.amount : 0, credit: l.amount < 0 ? -l.amount : 0 }));
    const offset = -restSum;
    if (offset !== 0) jl.push({ accountId: obeId, debit: offset > 0 ? offset : 0, credit: offset < 0 ? -offset : 0 });
    const e = postEntry(c, { date: on, memo: 'Opening balances', lines: jl });
    if (!e.ok) return e;
  }
  s.lines = lines.length;
  return ok(s);
}

function readDocs(c: Company, t: Table, side: PartyKind): Result<{ name: string; number: string; date: string | null; due: string | null; amount: Minor }[]> {
  const cn = column(t, side === 'customer' ? ['customer', 'name', 'customer name', 'الزبون', 'اسم الزبون'] : ['vendor', 'supplier', 'name', 'vendor name', 'المورد', 'المورّد']);
  const cnum = column(t, NUMBER);
  const cdate = column(t, DATE);
  const cdue = column(t, DUE);
  const camt = column(t, AMOUNT);
  if (cn < 0 || camt < 0) return err('opening.doc_columns', `The ${side === 'customer' ? 'open invoices' : 'unpaid bills'} need a ${side} name column and an amount column.`);
  const out: { name: string; number: string; date: string | null; due: string | null; amount: Minor }[] = [];
  for (const [i, r] of t.rows.entries()) {
    const name = (r[cn] ?? '').trim();
    if (!name || /^total/i.test(name) || name === 'المجموع') continue;
    const m = money(c, r[camt]);
    if (!m.ok || m.value <= 0) return err('opening.amount', `Row ${i + 2}: "${r[camt]}" is not an amount owed.`);
    const d = cdate >= 0 && r[cdate] ? date(r[cdate]) : null;
    const due = cdue >= 0 && r[cdue] ? date(r[cdue]) : null;
    if ((cdate >= 0 && r[cdate] && !d) || (cdue >= 0 && r[cdue] && !due)) return err('opening.date', `Row ${i + 2}: a date is not readable.`);
    out.push({ name, number: cnum >= 0 ? (r[cnum] ?? '').slice(0, 30) : '', date: d, due, amount: m.value });
  }
  return ok(out);
}

// ---------------------------------------------------------------- lists

const QB_TYPES: Record<string, AccountType> = {
  bank: 'bank',
  'accounts receivable': 'accounts_receivable',
  'other current asset': 'other_current_asset',
  'fixed asset': 'fixed_asset',
  'other asset': 'other_asset',
  'accounts payable': 'accounts_payable',
  'credit card': 'credit_card',
  'other current liability': 'other_current_liability',
  'long term liability': 'long_term_liability',
  equity: 'equity',
  income: 'income',
  'cost of goods sold': 'cost_of_goods_sold',
  expense: 'expense',
  'other income': 'other_income',
  'other expense': 'other_expense',
};

function accountType(s: string): AccountType | null {
  const k = s.trim().toLowerCase();
  if (isAccountType(k)) return k;
  if (QB_TYPES[k]) return QB_TYPES[k]!;
  for (const [t, info] of Object.entries(ACCOUNT_TYPES)) if (info.label.ar === s.trim() || info.label.en.toLowerCase() === k) return t as AccountType;
  return null;
}

export interface ListSummary {
  added: number;
  skipped: string[];
}

export function importList(c: Company, input: { kind: unknown; text: unknown }): Result<ListSummary> {
  if (typeof input.text !== 'string' || !input.text.trim()) return err('list.empty', 'The file is empty.');
  const t = parseCsv(input.text);
  const s: ListSummary = { added: 0, skipped: [] };
  const col = (names: string[]) => column(t, names);
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  if (input.kind === 'customer' || input.kind === 'vendor') {
    const kind = input.kind;
    const cn = col(kind === 'customer' ? ['customer', 'name', 'customer name', 'الزبون', 'الاسم'] : ['vendor', 'supplier', 'name', 'vendor name', 'المورد', 'الاسم']);
    if (cn < 0) return err('list.columns', 'Add a Name column.');
    const [cphone, cemail, caddr, cterms, ccomp] = [col(['phone', 'main phone', 'الهاتف']), col(['email', 'main email', 'البريد']), col(['address', 'bill to', 'billing address', 'العنوان']), col(['terms', 'مدة السداد']), col(['company', 'company name', 'الشركة'])];
    for (const r of t.rows) {
      const name = get(r, cn);
      if (!name) continue;
      if (findParty(c, 'customer', name) || findParty(c, 'vendor', name)) {
        s.skipped.push(name);
        continue;
      }
      const terms = /(\d{1,4})/.exec(get(r, cterms));
      const made = createParty(c, kind, { name, phone: get(r, cphone).slice(0, 50), email: get(r, cemail).slice(0, 200), address: get(r, caddr).slice(0, 500), companyName: get(r, ccomp).slice(0, 100), termsDays: terms ? Math.min(Number(terms[1]), 3650) : 0 });
      if (!made.ok) return err(made.error.code, `${name}: ${made.error.message}`);
      s.added++;
    }
    return ok(s);
  }
  if (input.kind === 'account') {
    const cn = col(ACCOUNT);
    const ct = col(['type', 'account type', 'النوع']);
    const cnum = col(['number', 'account number', 'no', 'الرقم']);
    if (cn < 0 || ct < 0) return err('list.columns', 'Add Account and Type columns.');
    for (const [i, r] of t.rows.entries()) {
      const path = get(r, cn);
      if (!path) continue;
      const type = accountType(get(r, ct));
      if (!type) return err('list.type', `Row ${i + 2}: "${get(r, ct)}" is not an account type.`);
      const parts = path.split(':').map((p) => p.trim()).filter(Boolean);
      let parentId: string | null = null;
      for (const [k, part] of parts.entries()) {
        const existing = [...c.accounts.values()].find((a) => a.parentId === parentId && a.name.toLowerCase() === part.toLowerCase());
        if (existing) {
          if (k === parts.length - 1) s.skipped.push(path);
          parentId = existing.id;
          continue;
        }
        const made = createAccount(c, { name: part, type, number: k === parts.length - 1 ? get(r, cnum) : '', parentId });
        if (!made.ok) return err(made.error.code, `Row ${i + 2}: ${made.error.message}`);
        parentId = made.value.id;
        s.added++;
      }
    }
    return ok(s);
  }
  if (input.kind === 'item') {
    const cn = col(['item', 'name', 'item name', 'الصنف', 'الاسم']);
    if (cn < 0) return err('list.columns', 'Add a Name column.');
    const [ct, cdesc, cprice, ccost, cinc, cexp] = [col(['type', 'النوع']), col(['description', 'sales description', 'الوصف']), col(['price', 'sales price', 'rate', 'سعر البيع']), col(['cost', 'purchase cost', 'التكلفة']), col(['income account', 'sales account', 'account', 'حساب المبيعات']), col(['expense account', 'purchase account', 'cogs account', 'حساب المشتريات'])];
    const TYPES: Record<string, ItemType> = { service: 'service', 'non-inventory part': 'non_inventory', 'non-inventory': 'non_inventory', non_inventory: 'non_inventory', 'other charge': 'other_charge', other_charge: 'other_charge', خدمة: 'service' };
    for (const [i, r] of t.rows.entries()) {
      const name = get(r, cn);
      if (!name) continue;
      if ([...c.items.values()].some((x) => x.name.toLowerCase() === name.toLowerCase())) {
        s.skipped.push(name);
        continue;
      }
      const type = TYPES[get(r, ct).toLowerCase()] ?? 'service';
      const price = money(c, get(r, cprice));
      const cost = money(c, get(r, ccost));
      if (!price.ok || !cost.ok) return err('list.amount', `Row ${i + 2}: a price or cost is not an amount.`);
      const inc = get(r, cinc) ? accountByKey(c, get(r, cinc)) : undefined;
      const exp = get(r, cexp) ? accountByKey(c, get(r, cexp)) : undefined;
      if ((get(r, cinc) && !inc) || (get(r, cexp) && !exp)) return err('list.account', `Row ${i + 2}: an account is not in the chart of accounts.`);
      const made = createItem(c, { type, name, description: get(r, cdesc).slice(0, 1000), price: price.value, cost: cost.value, salesAccountId: inc?.id ?? null, purchaseAccountId: exp?.id ?? null });
      if (!made.ok) return err(made.error.code, `Row ${i + 2}: ${made.error.message}`);
      s.added++;
    }
    return ok(s);
  }
  return err('list.kind', 'Choose customers, vendors, items or accounts.');
}
