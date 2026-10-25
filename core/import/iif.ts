// QuickBooks IIF files: Intuit's published tab-separated interchange format. Header rows ("!ACCNT",
// "!TRNS", …) name the columns of the rows that follow; a transaction is a TRNS row, its SPL rows and
// an ENDTRNS row, with debits positive and credits negative.
//
// Import keeps every amount exact. Transactions that match a document (invoice, bill, payment…)
// become that document; anything else still comes in, through an "Import clearing" account that nets
// to zero inside each transaction, so receivables and payables keep moving only through documents.

import { classOf, type Account, type AccountType } from '../accounts.ts';
import { createAccount, findAccount, retainedEarnings, type Company } from '../company.ts';
import { VAT_ACCOUNT, isVatRole } from '../vat.ts';
import { applyCredit, createPurchaseDoc, createSalesDoc, createSettlement, createTransfer, openBalance, unapplied, type Doc } from '../documents.ts';
import { createItem } from '../items.ts';
import { postEntry } from '../journal.ts';
import { formatAmount, parseAmount, type Minor } from '../money.ts';
import { createParty, type Party, type PartyKind } from '../parties.ts';
import { err, ok, type Result } from '../result.ts';

// ---------------------------------------------------------------- reading

export interface IifRow {
  kind: string; // ACCNT, CUST, TRNS, SPL, …
  line: number;
  f: Record<string, string>;
}

function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
}

export function readIif(text: string): Result<IifRow[]> {
  const headers = new Map<string, string[]>();
  const rows: IifRow[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (const [i, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    const cells = raw.split('\t').map(unquote);
    const head = (cells[0] ?? '').toUpperCase();
    if (head.startsWith('!')) {
      headers.set(head.slice(1), cells.slice(1).map((c) => c.toUpperCase()));
      continue;
    }
    const cols = headers.get(head);
    if (!cols) {
      if (head === 'ENDTRNS') {
        rows.push({ kind: head, line: i + 1, f: {} });
        continue;
      }
      return err('iif.header_missing', `Line ${i + 1}: "${head}" rows come before their "!${head}" header.`, { line: i + 1 });
    }
    const f: Record<string, string> = {};
    cols.forEach((c, j) => (f[c] = cells[j + 1] ?? ''));
    rows.push({ kind: head, line: i + 1, f });
  }
  return ok(rows);
}

const ACCOUNT_TYPE: Record<string, AccountType> = {
  BANK: 'bank',
  AR: 'accounts_receivable',
  OCASSET: 'other_current_asset',
  FIXASSET: 'fixed_asset',
  OASSET: 'other_asset',
  AP: 'accounts_payable',
  CCARD: 'credit_card',
  OCLIAB: 'other_current_liability',
  LTLIAB: 'long_term_liability',
  EQUITY: 'equity',
  INC: 'income',
  COGS: 'cost_of_goods_sold',
  EXP: 'expense',
  EXINC: 'other_income',
  EXEXP: 'other_expense',
};
const IIF_TYPE = Object.fromEntries(Object.entries(ACCOUNT_TYPE).map(([k, v]) => [v, k])) as Record<AccountType, string>;

// IIF dates are month/day/year; two-digit years count from 1950.
export function iifDate(s: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3]!.length === 2) y += y < 50 ? 2000 : 1900;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- importing

export interface ImportSummary {
  accounts: number;
  customers: number;
  vendors: number;
  items: number;
  transactions: number;
  documents: Record<string, number>;
  journalEntries: number;
  throughClearing: number;
  applied: number;
  warnings: string[];
}

interface Line {
  accountId: string;
  type: AccountType;
  party: Party | null;
  amount: Minor; // debit positive
  memo: string;
}

const MONEY_IN: AccountType[] = ['bank', 'other_current_asset'];
const MONEY_OUT: AccountType[] = ['bank', 'credit_card'];
const isControl = (t: AccountType) => t === 'accounts_receivable' || t === 'accounts_payable';

// "Net 30", "2% 10 Net 30", "30 days", "30" -> days until due.
export function termsDays(s: string | undefined): number {
  const t = (s ?? '').trim();
  const m = /net\s*(\d{1,4})/i.exec(t) ?? /(\d{1,4})\s*days?/i.exec(t) ?? /^(\d{1,4})$/.exec(t);
  return m ? Math.min(Number(m[1]), 3650) : 0;
}

export function importIif(c: Company, text: unknown, opts: { autoApply?: boolean; allowDuplicates?: boolean } = {}): Result<ImportSummary> {
  if (typeof text !== 'string' || !text.trim()) return err('iif.empty', 'The file is empty.');
  const read = readIif(text);
  if (!read.ok) return read;
  const s: ImportSummary = { accounts: 0, customers: 0, vendors: 0, items: 0, transactions: 0, documents: {}, journalEntries: 0, throughClearing: 0, applied: 0, warnings: [] };
  const fail = (line: number, p: { message: string; code: string }) => err<ImportSummary>(p.code, `Line ${line}: ${p.message}`, { line });
  const firstNewDoc = c.nextDocId; // documents created by this import have ids from here on

  // ---- accounts, by their full "Parent:Child" path
  const byPath = new Map<string, string>();
  for (const a of c.accounts.values()) byPath.set(pathOf(c, a).toLowerCase(), a.id);
  const ensureAccount = (path: string, type: AccountType, number: string, line: number): Result<string> => {
    const known = byPath.get(path.toLowerCase());
    if (known) {
      const existing = c.accounts.get(known)!;
      if (classOf(existing.type) !== classOf(type)) {
        return err('iif.account_type_conflict', `Line ${line}: "${path}" already exists as a different kind of account.`);
      }
      return ok(known);
    }
    const parts = path.split(':').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return err('iif.account_name', `Line ${line}: an account has no name.`);
    if (parts.length === 1 && classOf(type) === 'equity' && parts[0]!.toLowerCase() === 'retained earnings') {
      const re = retainedEarnings(c);
      byPath.set(path.toLowerCase(), re.id);
      return ok(re.id);
    }
    // Another Daftar company's VAT accounts, in either language, are this company's own.
    if (parts.length === 1) {
      for (const role of ['vat_output', 'vat_input'] as const) {
        const own = [...c.accounts.values()].find((a) => a.role === role);
        const n = VAT_ACCOUNT[role].name;
        if (own && classOf(own.type) === classOf(type) && [n.en, n.ar].some((x) => x.toLowerCase() === parts[0]!.toLowerCase())) {
          byPath.set(path.toLowerCase(), own.id);
          return ok(own.id);
        }
      }
    }
    let parentId: string | null = null;
    if (parts.length > 1) {
      const parent = ensureAccount(parts.slice(0, -1).join(':'), type, '', line);
      if (!parent.ok) return parent;
      parentId = parent.value;
    }
    const taken = number && [...c.accounts.values()].some((a) => a.number === number);
    if (taken) s.warnings.push(`Line ${line}: account number ${number} is already used; "${path}" was added without it.`);
    const made = createAccount(c, { name: parts.at(-1), type, number: taken ? '' : number, parentId });
    if (!made.ok) return err(made.error.code, `Line ${line}: ${made.error.message}`);
    s.accounts++;
    byPath.set(path.toLowerCase(), made.value.id);
    return ok(made.value.id);
  };
  const accountOf = (path: string, line: number): Result<Account> => {
    // By full name only: never by a blank cell, a number, or an internal id.
    if (!path.trim()) return err('iif.account_blank', `Line ${line}: the account is blank.`);
    const id = byPath.get(path.trim().toLowerCase());
    const a = id ? c.accounts.get(id) : undefined;
    return a ? ok(a) : err('iif.account_unknown', `Line ${line}: account "${path}" is not in the file's account list.`);
  };

  for (const r of read.value.filter((x) => x.kind === 'ACCNT')) {
    const t = (r.f.ACCNTTYPE ?? '').toUpperCase();
    if (t === 'NONPOSTING') continue;
    const type = ACCOUNT_TYPE[t];
    if (!type) {
      s.warnings.push(`Line ${r.line}: account type "${t}" is not supported; "${r.f.NAME}" was skipped.`);
      continue;
    }
    const a = ensureAccount(r.f.NAME ?? '', type, (r.f.ACCNUM ?? '').trim(), r.line);
    if (!a.ok) return a as Result<never>;
  }

  // ---- names
  const parties = new Map<string, Party>();
  for (const p of c.parties.values()) parties.set(p.name.toLowerCase(), p);
  const addParty = (r: IifRow, kind: PartyKind, addrKeys: string[]): Result<null> => {
    const name = (r.f.NAME ?? '').trim();
    if (!name) return ok(null);
    const existing = parties.get(name.toLowerCase());
    if (existing) {
      if (existing.kind !== kind) s.warnings.push(`Line ${r.line}: "${name}" is already a ${existing.kind}; kept as ${existing.kind}.`);
      return ok(null);
    }
    const made = createParty(c, kind, {
      name,
      phone: (r.f.PHONE1 ?? '').slice(0, 50),
      email: (r.f.EMAIL ?? '').slice(0, 200),
      address: addrKeys.map((k) => r.f[k] ?? '').filter(Boolean).join(', ').slice(0, 500),
      termsDays: termsDays(r.f.TERMS),
      notes: (r.f.NOTE ?? '').slice(0, 2000),
    });
    if (!made.ok) return err(made.error.code, `Line ${r.line}: ${made.error.message}`);
    parties.set(name.toLowerCase(), made.value);
    if (kind === 'customer') s.customers++;
    else s.vendors++;
    return ok(null);
  };
  for (const r of read.value) {
    const res = r.kind === 'CUST' ? addParty(r, 'customer', ['BADDR1', 'BADDR2', 'BADDR3', 'BADDR4', 'BADDR5']) : r.kind === 'VEND' ? addParty(r, 'vendor', ['ADDR1', 'ADDR2', 'ADDR3', 'ADDR4', 'ADDR5']) : ok(null);
    if (!res.ok) return res as Result<never>;
  }

  // ---- items (services, non-inventory and other charges; others are reported and skipped)
  const ITEM_TYPE: Record<string, 'service' | 'non_inventory' | 'other_charge'> = { SERV: 'service', PART: 'non_inventory', NONINV: 'non_inventory', OTHC: 'other_charge' };
  for (const r of read.value.filter((x) => x.kind === 'INVITEM')) {
    const type = ITEM_TYPE[(r.f.INVITEMTYPE ?? '').toUpperCase()];
    const name = (r.f.NAME ?? '').trim();
    if (!type || !name) {
      if (name) s.warnings.push(`Line ${r.line}: item type "${r.f.INVITEMTYPE}" is not supported yet; "${name}" was skipped.`);
      continue;
    }
    if ([...c.items.values()].some((i) => i.name.toLowerCase() === name.toLowerCase())) continue;
    if ((r.f.INVITEMTYPE ?? '').toUpperCase() === 'PART') s.warnings.push(`Line ${r.line}: "${name}" is an inventory part; it was added without quantities (inventory comes later).`);
    const acct = (p: string | undefined) => (p ? accountOf(p, r.line) : null);
    const main = acct(r.f.ACCNT);
    const buy = acct(r.f.COGSACCNT || r.f.EXPACCNT);
    const sales = main?.ok && classOf(main.value.type) === 'income' ? main.value.id : null;
    const purchase = buy?.ok ? buy.value.id : main?.ok && classOf(main.value.type) !== 'income' && !isControl(main.value.type) ? main.value.id : null;
    const money = (v: string | undefined) => {
      const p = v ? parseAmount(v.replace(/%$/, ''), c.currency) : null;
      return p?.ok && p.value >= 0 && !v!.endsWith('%') ? p.value : 0;
    };
    const made = createItem(c, { type, name, description: (r.f.DESC ?? '').slice(0, 1000), price: money(r.f.PRICE), cost: money(r.f.COST), salesAccountId: sales, purchaseAccountId: purchase });
    if (!made.ok) s.warnings.push(`Line ${r.line}: item "${name}" was skipped (${made.error.message}).`);
    else s.items++;
  }

  // ---- transactions
  let clearing: string | null = null;
  const clearingAccount = (): Result<string> => {
    if (clearing) return ok(clearing);
    const existing = findAccount(c, 'Import clearing');
    if (existing) return ok((clearing = existing.id));
    const made = createAccount(c, { name: 'Import clearing', type: 'other_current_liability' });
    if (!made.ok) return made;
    return ok((clearing = made.value.id));
  };
  const count = (k: string) => (s.documents[k] = (s.documents[k] ?? 0) + 1);

  let i = 0;
  const rows = read.value;
  let renumbered = 0;
  while (i < rows.length) {
    const kind = rows[i]!.kind;
    if (kind === 'SPL' || kind === 'ENDTRNS') return err('iif.orphan_line', `Line ${rows[i]!.line}: a ${kind} row is not inside a transaction (its TRNS row is missing).`);
    if (kind !== 'TRNS') {
      i++;
      continue;
    }
    const head = rows[i]!;
    const group = [head];
    i++;
    while (i < rows.length && rows[i]!.kind === 'SPL') group.push(rows[i++]!);
    if (rows[i]?.kind === 'ENDTRNS') i++;
    else return err('iif.endtrns_missing', `Line ${head.line}: the transaction has no ENDTRNS row.`);

    const date = iifDate(head.f.DATE ?? '');
    if (!date) return err('iif.date', `Line ${head.line}: "${head.f.DATE}" is not a date.`);
    const lines: Line[] = [];
    let raw = 0;
    for (const r of group) {
      const a = accountOf(r.f.ACCNT ?? '', r.line);
      if (!a.ok) return a as Result<never>;
      const amt = parseAmount((r.f.AMOUNT ?? '').replace(/^\+/, ''), c.currency);
      if (!amt.ok) return fail(r.line, amt.error);
      raw += amt.value;
      if (amt.value === 0) continue;
      const nm = (r.f.NAME ?? '').trim();
      lines.push({ accountId: a.value.id, type: a.value.type, party: nm ? (parties.get(nm.toLowerCase()) ?? null) : null, amount: amt.value, memo: (r.f.MEMO ?? '').slice(0, 1000) });
    }
    if (raw !== 0) return err('iif.unbalanced', `Line ${head.line}: the transaction does not balance.`);
    if (lines.length === 0) {
      s.warnings.push(`Line ${head.line}: a transaction whose amounts are all zero was skipped.`);
      continue;
    }
    s.transactions++;
    const type = (head.f.TRNSTYPE ?? '').toUpperCase().trim();
    const number = (head.f.DOCNUM ?? '').trim().slice(0, 30);
    const memo = (head.f.MEMO ?? '').slice(0, 1000);
    const due = iifDate(head.f.DUEDATE ?? '');
    if (number && !opts.allowDuplicates) {
      const party = lines[0]!.party?.id ?? lines[1]?.party?.id ?? null;
      const twin = [...c.documents.values()].find((d) => d.id < firstNewDoc && d.number === number && d.date === date && d.partyId === party);
      if (twin) return err('iif.already_imported', `Line ${head.line}: ${type.toLowerCase()} ${number} of ${date} is already in the books; this file looks imported before.`);
    }
    const done = mapped(c, type, lines, { date, number, memo, due: due && due >= date ? due : null }, count, () => renumbered++);
    if (done.ok && done.value) continue;
    if (!done.ok) return fail(head.line, done.error);

    // Generic: receivable and payable lines become documents against the clearing account; the rest
    // is a journal entry that clears it again.
    const control = lines.filter((l) => isControl(l.type));
    const rest = lines.filter((l) => !isControl(l.type));
    let net = 0;
    if (control.length) {
      const cl = clearingAccount();
      if (!cl.ok) return cl as Result<never>;
      for (const l of control) {
        const ar = l.type === 'accounts_receivable';
        const kind = ar ? (l.amount > 0 ? 'invoice' : 'credit_memo') : l.amount < 0 ? 'bill' : 'vendor_credit';
        if (!l.party || l.party.kind !== (ar ? 'customer' : 'vendor')) {
          return err('iif.name_missing', `Line ${head.line}: a line on "${c.accounts.get(l.accountId)?.name}" needs a ${ar ? 'customer' : 'vendor'} name.`);
        }
        const body = { date, memo: memo || l.memo, accountId: l.accountId, lines: [{ accountId: cl.value, amount: Math.abs(l.amount), description: l.memo || memo, taxCode: c.vat ? 'OS' : undefined }] };
        const made = ar ? createSalesDoc(c, kind as 'invoice' | 'credit_memo', { ...body, customerId: l.party.id }) : createPurchaseDoc(c, kind as 'bill' | 'vendor_credit', { ...body, vendorId: l.party.id });
        if (!made.ok) return fail(head.line, made.error);
        count(kind);
        net += l.amount;
      }
      s.throughClearing++;
    }
    if (rest.length) {
      const jl = rest.map((l) => ({ accountId: l.accountId, debit: l.amount > 0 ? l.amount : 0, credit: l.amount < 0 ? -l.amount : 0, memo: l.memo, partyId: l.party?.id ?? null }));
      if (net !== 0) jl.push({ accountId: clearing!, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, memo: 'Import clearing', partyId: null });
      const e = postEntry(c, { date, memo: memo || type.toLowerCase(), lines: jl });
      if (!e.ok) return fail(head.line, e.error);
      s.journalEntries++;
    }
  }

  if (renumbered) s.warnings.push(`${renumbered} document number(s) were already in use and got new numbers.`);
  if (opts.autoApply !== false) s.applied = applyOldestFirst(c, firstNewDoc);
  return ok(s);
}

function pathOf(c: Company, a: Account): string {
  const parts = [a.name];
  for (let p = a.parentId ? c.accounts.get(a.parentId) : undefined; p; p = p.parentId ? c.accounts.get(p.parentId) : undefined) parts.unshift(p.name);
  return parts.join(':');
}

type Count = (kind: string) => void;

// The transaction kinds that map onto one document. Returns ok(false) when the shape does not fit,
// so the caller takes the generic route instead.
function mapped(c: Company, type: string, lines: Line[], h: { date: string; number: string; memo: string; due: string | null }, count: Count, renumbered: () => void): Result<boolean> {
  const [head, ...rest] = lines as [Line, ...Line[]];
  // A line on a VAT account cannot be a document line (VAT comes from tax codes): such a transaction
  // takes the generic route, where it becomes a journal entry on the VAT account.
  const plain = rest.every((l) => !isControl(l.type) && !isVatRole(c.accounts.get(l.accountId)?.role));
  const docLines = (sign: 1 | -1) => rest.map((l) => ({ accountId: l.accountId, amount: sign * l.amount, description: l.memo, taxCode: c.vat ? 'OS' : undefined }));
  const restSign = (sign: 1 | -1) => rest.every((l) => sign * l.amount > 0);
  // A number already in use (QuickBooks allows repeats) gets the next free one; the count is reported.
  const withNumber = <T>(make: (n: string | undefined) => Result<T>): Result<T> => {
    const r = make(h.number || undefined);
    if (r.ok || r.error.code !== 'doc.number_taken') return r;
    renumbered();
    return make(undefined);
  };
  const dueDate = h.due ? { dueDate: h.due } : {};
  const customer = head.party?.kind === 'customer' ? head.party.id : null;
  const vendor = head.party?.kind === 'vendor' ? head.party.id : null;
  const done = (r: Result<Doc>, kind: string): Result<boolean> => {
    if (!r.ok) return r;
    count(kind);
    return ok(true);
  };

  switch (type) {
    case 'INVOICE':
      if (head.type === 'accounts_receivable' && head.amount > 0 && customer && plain && restSign(-1))
        return done(withNumber((number) => createSalesDoc(c, 'invoice', { customerId: customer, date: h.date, number, memo: h.memo, accountId: head.accountId, ...dueDate, lines: docLines(-1) })), 'invoice');
      break;
    case 'CREDIT MEMO':
      if (head.type === 'accounts_receivable' && head.amount < 0 && customer && plain && restSign(1))
        return done(withNumber((number) => createSalesDoc(c, 'credit_memo', { customerId: customer, date: h.date, number, memo: h.memo, accountId: head.accountId, lines: docLines(1) })), 'credit_memo');
      break;
    case 'BILL':
      if (head.type === 'accounts_payable' && head.amount < 0 && vendor && plain && restSign(1))
        return done(withNumber((number) => createPurchaseDoc(c, 'bill', { vendorId: vendor, date: h.date, number, memo: h.memo, accountId: head.accountId, ...dueDate, lines: docLines(1) })), 'bill');
      break;
    case 'CASH SALE':
      if (MONEY_IN.includes(head.type) && head.amount > 0 && plain && restSign(-1))
        return done(withNumber((number) => createSalesDoc(c, 'sales_receipt', { customerId: customer, date: h.date, number, memo: h.memo, depositToId: head.accountId, lines: docLines(-1) })), 'sales_receipt');
      break;
    case 'CHECK':
    case 'CREDIT CARD':
      if (MONEY_OUT.includes(head.type) && head.amount < 0 && plain && restSign(1))
        return done(createPurchaseDoc(c, 'expense', { vendorId: vendor, date: h.date, number: h.number || undefined, memo: h.memo, payFromId: head.accountId, lines: docLines(1) }), 'expense');
      break;
    case 'PAYMENT': {
      // One payment may cover several invoices: several receivable lines, one customer, one account.
      const [ar] = rest;
      const oneCustomer = rest.every((l) => l.type === 'accounts_receivable' && l.amount < 0 && l.party?.id === ar?.party?.id && l.accountId === ar?.accountId);
      if (ar && oneCustomer && MONEY_IN.includes(head.type) && head.amount > 0 && ar.party?.kind === 'customer')
        return done(createSettlement(c, 'payment', { customerId: ar.party.id, date: h.date, amount: head.amount, depositToId: head.accountId, accountId: ar.accountId, number: h.number || undefined, memo: h.memo }), 'payment');
      break;
    }
    case 'BILL PMT -CHECK':
    case 'BILL PMT -CCARD':
    case 'BILLPMT': {
      const [ap] = rest;
      const oneVendor = rest.every((l) => l.type === 'accounts_payable' && l.amount > 0 && l.party?.id === ap?.party?.id && l.accountId === ap?.accountId);
      if (ap && oneVendor && MONEY_OUT.includes(head.type) && head.amount < 0 && ap.party?.kind === 'vendor')
        return done(createSettlement(c, 'bill_payment', { vendorId: ap.party.id, date: h.date, amount: -head.amount, payFromId: head.accountId, accountId: ap.accountId, number: h.number || undefined, memo: h.memo }), 'bill_payment');
      break;
    }
    case 'TRANSFER': {
      const [other] = rest;
      const money: AccountType[] = ['bank', 'credit_card', 'other_current_asset'];
      if (rest.length === 1 && other && money.includes(head.type) && money.includes(other.type) && head.accountId !== other.accountId) {
        const to = head.amount > 0 ? head : other;
        const from = head.amount > 0 ? other : head;
        return done(createTransfer(c, { date: h.date, fromId: from.accountId, toId: to.accountId, amount: Math.abs(head.amount), memo: h.memo }), 'transfer');
      }
      break;
    }
  }
  return ok(false);
}

// IIF payments carry no link to the invoices they paid; apply each to the oldest open documents.
// Only documents this import created take part: what was already in the books is left as it was.
// Open and unapplied amounts are tracked here, so a file with thousands of payments stays fast.
function applyOldestFirst(c: Company, firstNewDoc: number): number {
  let applied = 0;
  const fresh = [...c.documents.values()].filter((d) => d.id >= firstNewDoc && !d.voided);
  const byDate = (a: Doc, b: Doc) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);
  for (const [sources, target] of [[['payment', 'credit_memo'], 'invoice'], [['bill_payment', 'vendor_credit'], 'bill']] as const) {
    const open = new Map<number, Minor>();
    const queues = new Map<string, Doc[]>();
    for (const t of fresh.filter((d) => d.kind === target).sort(byDate)) {
      open.set(t.id, openBalance(c, t));
      const k = `${t.partyId}|${t.accountId}`;
      const q = queues.get(k) ?? [];
      q.push(t);
      queues.set(k, q);
    }
    for (const src of fresh.filter((d) => (sources as readonly string[]).includes(d.kind)).sort(byDate)) {
      let left = unapplied(c, src);
      const queue = queues.get(`${src.partyId}|${src.accountId}`) ?? [];
      const apps: { docId: number; amount: Minor }[] = [];
      let latest = src.date;
      let k = 0;
      while (left > 0 && k < queue.length) {
        const tgt = queue[k]!;
        const o = open.get(tgt.id)!;
        if (o === 0) {
          k++;
          continue;
        }
        const amount = Math.min(left, o);
        if (tgt.date > latest) latest = tgt.date;
        apps.push({ docId: tgt.id, amount });
        left -= amount;
        open.set(tgt.id, o - amount);
        if (o - amount === 0) k++;
      }
      if (!apps.length) continue;
      // Dated when both sides exist: the later of the payment and the last document it settles.
      const r = applyCredit(c, { sourceId: src.id, date: latest, applications: apps });
      if (r.ok) applied += apps.length;
      else for (const a of apps) open.set(a.docId, open.get(a.docId)! + a.amount);
    }
  }
  return applied;
}

// ---------------------------------------------------------------- exporting

const TRNSTYPE: Record<string, string> = {
  invoice: 'INVOICE',
  credit_memo: 'CREDIT MEMO',
  bill: 'BILL',
  sales_receipt: 'CASH SALE',
  payment: 'PAYMENT',
  expense: 'CHECK',
  transfer: 'TRANSFER',
};

// Tabs and line breaks cannot live in a cell; quotes are kept by quoting the cell, as QuickBooks reads it.
const clean = (s: string) => {
  const one = s.replace(/[\t\r\n]+/g, ' ');
  return one.includes('"') ? `"${one.replace(/"/g, '""')}"` : one;
};
const mdy = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

export function exportIif(c: Company): string {
  const out: string[] = [];
  const row = (...cells: string[]) => out.push(cells.map(clean).join('\t'));
  const accounts = [...c.accounts.values()].sort((a, b) => pathOf(c, a).localeCompare(pathOf(c, b)));
  const path = (id: string) => pathOf(c, c.accounts.get(id)!);
  row('!ACCNT', 'NAME', 'ACCNTTYPE', 'ACCNUM');
  for (const a of accounts) row('ACCNT', pathOf(c, a), IIF_TYPE[a.type], a.number);
  row('!CUST', 'NAME', 'BADDR1', 'PHONE1', 'EMAIL', 'TERMS', 'NOTE');
  row('!VEND', 'NAME', 'ADDR1', 'PHONE1', 'EMAIL', 'TERMS', 'NOTE');
  for (const p of c.parties.values()) row(p.kind === 'customer' ? 'CUST' : 'VEND', p.name, p.address, p.phone, p.email, p.termsDays ? `Net ${p.termsDays}` : '', p.notes);
  row('!INVITEM', 'NAME', 'INVITEMTYPE', 'DESC', 'PRICE', 'COST', 'ACCNT', 'COGSACCNT');
  const itemType = { service: 'SERV', non_inventory: 'NONINV', other_charge: 'OTHC' } as const;
  for (const i of c.items.values()) {
    row('INVITEM', i.name, itemType[i.type], i.description, formatAmount(i.price, c.currency, { grouping: false }), formatAmount(i.cost, c.currency, { grouping: false }), i.salesAccountId ? path(i.salesAccountId) : '', i.purchaseAccountId ? path(i.purchaseAccountId) : '');
  }
  row('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO');
  row('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO');
  row('!ENDTRNS');
  const voidedEntries = new Set<number>();
  for (const d of c.documents.values()) if (d.voided && d.entryId !== null) voidedEntries.add(d.entryId);
  for (const e of c.entries) {
    if (voidedEntries.has(e.id) || (e.reverses !== null && voidedEntries.has(e.reverses))) continue; // a void and what it voided net to nothing
    const doc = e.source ? c.documents.get(e.source.id) : undefined;
    const money = doc?.bankAccountId;
    let type = doc ? (TRNSTYPE[doc.kind] ?? 'GENERAL JOURNAL') : 'GENERAL JOURNAL';
    if (doc?.kind === 'bill_payment') type = c.accounts.get(money!)?.type === 'credit_card' ? 'BILL PMT -CCARD' : 'BILL PMT -CHECK';
    // The line that carries the document (receivable, payable or money account) leads, as in QuickBooks.
    const leadId = doc ? (['payment', 'bill_payment', 'sales_receipt', 'expense'].includes(doc.kind) ? money : doc.accountId) : null;
    const lines = [...e.lines];
    const lead = leadId ? lines.findIndex((l) => l.accountId === leadId) : -1;
    if (lead > 0) lines.unshift(...lines.splice(lead, 1));
    lines.forEach((l, k) => {
      const party = l.partyId ? c.parties.get(l.partyId)!.name : '';
      row(k === 0 ? 'TRNS' : 'SPL', '', type, mdy(e.date), path(l.accountId), party, formatAmount(l.debit - l.credit, c.currency, { grouping: false }), doc?.number ?? '', l.memo || e.memo);
    });
    row('ENDTRNS');
  }
  return out.join('\r\n') + '\r\n';
}
