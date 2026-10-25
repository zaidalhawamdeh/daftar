// Business documents. Each posting document writes exactly one journal entry when it is created and
// one reversing entry if it is voided; the entry is the truth, the document is how people see it.
//
// Payments and credits settle invoices and bills through applications. An invoice's open balance is
// never stored: it is the total minus the applications made to it.

import type { AccountType } from './accounts.ts';
import { isObject, type Company } from './company.ts';
import { addDays, isIsoDate } from './dates.ts';
import { postEntry, reverseEntry, validateEntry } from './journal.ts';
import { formatAmount, isMinor, type Minor } from './money.ts';
import type { Party, PartyKind } from './parties.ts';
import { formatQuantity, lineAmount, ONE, parseQuantity, type Milli } from './quantity.ts';
import { err, ok, type Result } from './result.ts';
import { isTaxCode, isVatRole, lineNet, lineTax, vatAccounts, type TaxCode } from './vat.ts';

export type SalesKind = 'estimate' | 'invoice' | 'sales_receipt' | 'credit_memo';
export type PurchaseKind = 'purchase_order' | 'bill' | 'vendor_credit' | 'expense';
export type SettlementKind = 'payment' | 'bill_payment';
export type DocKind = SalesKind | PurchaseKind | SettlementKind | 'transfer';

export interface DocLine {
  itemId: string | null;
  accountId: string;
  description: string;
  quantity: Milli;
  rate: Minor;
  amount: Minor; // quantity × rate, as entered (VAT included when the document's prices include it)
  taxCode: TaxCode | null; // null: the company is not registered for VAT, or the line came in without it
  tax: Minor; // VAT on the line, rounded to the minor unit
}

export interface Doc {
  id: number;
  kind: DocKind;
  number: string;
  date: string;
  dueDate: string | null;
  partyId: string | null;
  memo: string;
  lines: DocLine[];
  total: Minor; // what the customer or vendor owes or paid: values plus the VAT the document charges
  taxInclusive: boolean; // line prices include VAT
  refId: number | null; // a credit memo's invoice, or a vendor credit's bill, when it names one
  accountId: string | null; // receivable or payable account the document posts to
  bankAccountId: string | null; // where money came in or went out
  toAccountId: string | null; // transfers only
  status: 'open' | 'closed' | null; // estimates and purchase orders
  linkedId: number | null; // estimate ↔ invoice, purchase order ↔ bill
  entryId: number | null;
  voided: boolean;
}

export interface Application {
  id: number;
  date: string;
  sourceId: number; // payment, credit memo, bill payment or vendor credit
  targetId: number; // invoice or bill
  amount: Minor;
  voided: boolean;
}

const PARTY_KIND: Record<DocKind, PartyKind | null> = {
  estimate: 'customer',
  invoice: 'customer',
  sales_receipt: 'customer',
  credit_memo: 'customer',
  payment: 'customer',
  purchase_order: 'vendor',
  bill: 'vendor',
  vendor_credit: 'vendor',
  bill_payment: 'vendor',
  expense: 'vendor',
  transfer: null,
};

// Kinds that number themselves 1, 2, 3…; for the others the number is the other side's reference.
const SELF_NUMBERED = new Set<DocKind>(['estimate', 'invoice', 'sales_receipt', 'credit_memo', 'purchase_order']);
const RECEIVE_INTO: AccountType[] = ['bank', 'other_current_asset'];
const PAY_FROM: AccountType[] = ['bank', 'credit_card'];
const TRANSFER: AccountType[] = ['bank', 'credit_card', 'other_current_asset'];
const NOT_ON_LINES = new Set<AccountType>(['accounts_receivable', 'accounts_payable']);
export const MAX_DOC_LINES = 500;

// ---------------------------------------------------------------- shared checks

function partyOf(c: Company, v: unknown, kind: PartyKind, required: boolean): Result<Party | null> {
  if (v === undefined || v === null || v === '') return required ? err('doc.party_required', `Choose a ${kind}.`) : ok(null);
  const p = typeof v === 'string' ? c.parties.get(v) : undefined;
  if (!p || p.kind !== kind) return err('doc.party_missing', `That ${kind} does not exist.`);
  if (!p.active) return err('doc.party_inactive', `"${p.name}" is inactive.`);
  return ok(p);
}

function controlAccount(c: Company, type: 'accounts_receivable' | 'accounts_payable', v: unknown): Result<string> {
  const label = type === 'accounts_receivable' ? 'Accounts Receivable' : 'Accounts Payable';
  if (v !== undefined && v !== null && v !== '') {
    const a = typeof v === 'string' ? c.accounts.get(v) : undefined;
    if (!a || a.type !== type) return err('doc.control_invalid', `Choose an ${label} account.`);
    if (!a.active) return err('doc.control_inactive', `"${a.name}" is inactive.`);
    return ok(a.id);
  }
  const candidates = [...c.accounts.values()].filter((a) => a.type === type && a.active).sort((x, y) => x.number.localeCompare(y.number, 'en', { numeric: true }));
  if (!candidates[0]) return err('doc.control_missing', `Add an ${label} account first.`);
  return ok(candidates[0].id);
}

function moneyAccount(c: Company, v: unknown, allowed: AccountType[], what: string): Result<string> {
  const a = typeof v === 'string' ? c.accounts.get(v) : undefined;
  if (!a) return err('doc.money_account_missing', `Choose the account for ${what}.`);
  if (!a.active) return err('doc.money_account_inactive', `"${a.name}" is inactive.`);
  if (!allowed.includes(a.type) || isVatRole(a.role)) return err('doc.money_account_type', `"${a.name}" cannot be used for ${what}.`);
  return ok(a.id);
}

function memoOf(v: unknown): Result<string> {
  if (v === undefined || v === null) return ok('');
  if (typeof v !== 'string' || v.length > 1000) return err('memo.invalid', 'Memo is text up to 1000 characters.');
  return ok(v.trim());
}

function checkDate(c: Company, v: unknown): Result<string> {
  if (!isIsoDate(v)) return err('date.invalid', 'Date must be a real date (YYYY-MM-DD).', { date: v });
  if (c.closingDate && v <= c.closingDate) return err('date.closed', `The books are closed through ${c.closingDate}.`);
  return ok(v);
}

function dueDateOf(date: string, party: Party | null, input: Record<string, unknown>): Result<string> {
  if (input.dueDate !== undefined && input.dueDate !== null) {
    if (!isIsoDate(input.dueDate)) return err('date.invalid', 'Due date must be a real date (YYYY-MM-DD).');
    if (input.dueDate < date) return err('doc.due_before_date', 'The due date is before the document date.');
    return ok(input.dueDate);
  }
  const days = input.termsDays ?? party?.termsDays ?? 0;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 3650) return err('terms.invalid', 'Terms are whole days from 0 to 3650.');
  const due = addDays(date, days);
  if (!isIsoDate(due)) return err('date.invalid', 'The due date falls outside the calendar.');
  return ok(due);
}

function numberOf(c: Company, kind: DocKind, v: unknown, partyId: string | null): Result<string> {
  const same = [...c.documents.values()].filter((d) => d.kind === kind);
  if (v === undefined || v === null || v === '') {
    if (!SELF_NUMBERED.has(kind)) return ok('');
    let next = same.reduce((m, d) => (/^\d{1,15}$/.test(d.number) ? Math.max(m, Number(d.number)) : m), 0) + 1;
    while (same.some((d) => d.number === String(next))) next++;
    return ok(String(next));
  }
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 30) return err('doc.number_invalid', 'Number is text up to 30 characters.');
  const n = v.trim();
  const clash = SELF_NUMBERED.has(kind)
    ? same.find((d) => d.number === n)
    : kind === 'bill' || kind === 'vendor_credit'
      ? same.find((d) => d.number === n && d.partyId === partyId)
      : undefined;
  if (clash) return err('doc.number_taken', `${kind.replace('_', ' ')} ${n} already exists.`);
  return ok(n);
}

interface RawLine {
  itemId?: unknown;
  accountId?: unknown;
  description?: unknown;
  quantity?: unknown;
  rate?: unknown;
  amount?: unknown;
  taxCode?: unknown;
}

interface Body {
  lines: DocLine[];
  total: Minor;
  vat: Minor; // VAT charged on standard-rated lines
  reverseCharge: Minor; // VAT the business accounts for itself on reverse-charge lines
}

// VAT applies to documents dated on or after the registration's effective date.
const vatActive = (c: Company, date: string): boolean => c.vat !== null && vatAccounts(c) !== null && date >= c.vat.from;

function linesOf(c: Company, side: 'sales' | 'purchase', raw: unknown, inclusive: boolean, date: string, ref: Doc | null): Result<Body> {
  if (!Array.isArray(raw) || raw.length === 0) return err('doc.lines_missing', 'Add at least one line.');
  if (raw.length > MAX_DOC_LINES) return err('doc.too_many_lines', `A document has at most ${MAX_DOC_LINES} lines.`);
  const lines: DocLine[] = [];
  let total = 0;
  let vat = 0;
  let reverseCharge = 0;
  const vatOn = vatActive(c, date);
  // A credit names the document it corrects: its lines take that document's tax code when it has one.
  const refCodes = ref ? [...new Set(ref.lines.map((l) => l.taxCode))] : [];
  for (const [i, r] of raw.entries()) {
    const where = { line: i + 1 };
    if (!isObject(r)) return err('line.invalid', `Line ${i + 1} is not a line.`, where);
    const l = r as RawLine;
    let itemId: string | null = null;
    let accountId: string;
    let defaultRate: Minor | undefined;
    let defaultDescription = '';
    let defaultCode: TaxCode | null = null;
    if (l.itemId !== undefined && l.itemId !== null) {
      const item = typeof l.itemId === 'string' ? c.items.get(l.itemId) : undefined;
      if (!item) return err('line.item_missing', `Line ${i + 1}: item does not exist.`, where);
      if (!item.active) return err('line.item_inactive', `Line ${i + 1}: "${item.name}" is inactive.`, where);
      const acct = side === 'sales' ? item.salesAccountId : item.purchaseAccountId;
      if (!acct) return err('line.item_side', `Line ${i + 1}: "${item.name}" is not set up for ${side === 'sales' ? 'sales' : 'purchases'}.`, where);
      itemId = item.id;
      accountId = acct;
      defaultRate = side === 'sales' ? item.price : item.cost;
      defaultDescription = item.description;
      if (side === 'sales') defaultCode = item.taxCode; // an item's code is its sales code; purchases default to standard
    } else {
      if (typeof l.accountId !== 'string') return err('line.account_missing', `Line ${i + 1}: choose an item or an account.`, where);
      accountId = l.accountId;
    }
    const account = c.accounts.get(accountId);
    if (!account) return err('line.account_missing', `Line ${i + 1}: account does not exist.`, where);
    if (!account.active) return err('line.account_inactive', `Line ${i + 1}: "${account.name}" is inactive.`, where);
    if (NOT_ON_LINES.has(account.type)) return err('line.account_type', `Line ${i + 1}: "${account.name}" cannot be used on a line.`, where);
    if (account.role === 'vat_output' || account.role === 'vat_input') return err('line.account_vat', `Line ${i + 1}: VAT is worked out from the tax code; "${account.name}" cannot be used on a line.`, where);

    let quantity: Milli = ONE;
    if (l.quantity !== undefined && l.quantity !== null) {
      const q = parseQuantity(l.quantity);
      if (!q.ok) return err(q.error.code, `Line ${i + 1}: ${q.error.message}`, where);
      quantity = q.value;
    }
    let rate: Minor;
    if (l.rate !== undefined && l.rate !== null) {
      if (!isMinor(l.rate) || l.rate < 0) return err('line.rate_invalid', `Line ${i + 1}: rate must be a whole, non-negative number of minor units.`, where);
      rate = l.rate;
    } else if (l.amount !== undefined && l.amount !== null && (l.quantity === undefined || l.quantity === null)) {
      if (!isMinor(l.amount) || l.amount < 0) return err('line.amount_invalid', `Line ${i + 1}: amount must be a whole, non-negative number of minor units.`, where);
      rate = l.amount;
    } else if (defaultRate !== undefined) {
      rate = defaultRate;
    } else {
      return err('line.rate_missing', `Line ${i + 1}: enter an amount.`, where);
    }
    const amount = lineAmount(quantity, rate);
    if (!amount.ok) return amount;
    if (l.amount !== undefined && l.amount !== null && l.amount !== amount.value) {
      return err('line.amount_mismatch', `Line ${i + 1}: quantity × rate is ${amount.value}, not ${String(l.amount)}.`, where);
    }
    let description = defaultDescription;
    if (l.description !== undefined && l.description !== null) {
      if (typeof l.description !== 'string' || l.description.length > 1000) return err('line.description_invalid', `Line ${i + 1}: description is text up to 1000 characters.`, where);
      description = l.description.trim();
    }
    let taxCode: TaxCode | null = null;
    if (l.taxCode !== undefined && l.taxCode !== null && l.taxCode !== '') {
      if (!c.vat) return err('line.vat_off', `Line ${i + 1}: the company is not registered for VAT.`, where);
      if (!vatOn) return err('line.before_registration', `Line ${i + 1}: the document is dated before the VAT registration (${c.vat.from}).`, where);
      if (!isTaxCode(l.taxCode)) return err('line.tax_code_invalid', `Line ${i + 1}: tax code is SR, ZR, EX, OS or RC.`, where);
      taxCode = l.taxCode;
    } else if (vatOn) taxCode = refCodes.length === 1 ? refCodes[0]! : (defaultCode ?? 'SR');
    if (taxCode === 'RC' && side === 'sales') return err('line.reverse_charge_sales', `Line ${i + 1}: reverse charge applies to purchases only.`, where);
    const t = lineTax(amount.value, taxCode, inclusive);
    total += t.payable;
    if (taxCode === 'SR') vat += t.tax;
    if (taxCode === 'RC') reverseCharge += t.tax;
    if (!Number.isSafeInteger(total)) return err('amount.too_large', 'Document total is too large.');
    lines.push({ itemId, accountId, description, quantity, rate, amount: amount.value, taxCode, tax: t.tax });
  }
  if (total <= 0) return err('doc.zero_total', 'The document total must be more than zero.');
  return ok({ lines, total, vat, reverseCharge });
}

// The value of a line excluding VAT: what posts to its income or expense account.
const netOf = (l: DocLine, inclusive: boolean): Minor => (l.taxCode === 'SR' && inclusive ? l.amount - l.tax : l.amount);

function inclusiveOf(c: Company, date: string, v: unknown): Result<boolean> {
  if (v === undefined || v === null) return ok(false);
  if (typeof v !== 'boolean') return err('doc.tax_inclusive_invalid', 'Say whether prices include VAT with true or false.');
  if (v && !vatActive(c, date)) return err('doc.tax_inclusive_vat_off', 'Prices include VAT only on documents under a VAT registration.');
  return ok(v);
}

// A credit memo may name the invoice it corrects, and a vendor credit the bill (a tax credit note must
// identify the supply it relates to).
function refOf(c: Company, kind: DocKind, partyId: string | null, date: string, v: unknown): Result<Doc | null> {
  if (v === undefined || v === null) return ok(null);
  const target = kind === 'credit_memo' ? 'invoice' : kind === 'vendor_credit' ? 'bill' : null;
  const d = typeof v === 'number' ? c.documents.get(v) : undefined;
  if (!target || !d || d.kind !== target || d.partyId !== partyId) return err('doc.ref_invalid', target ? `Choose one of this ${PARTY_KIND[kind]}'s ${target}s.` : 'Only credit memos and vendor credits refer to another document.');
  if (d.voided) return err('doc.ref_void', `${target} ${d.number} is void.`);
  if (d.date > date) return err('doc.ref_later', `${target} ${d.number} is dated after this credit.`);
  return ok(d);
}

// What a credit may still take back from the document it names, per tax code: the document's value
// less the credits already made against it. Keeps credits from reclaiming VAT that was never charged.
export function creditRoom(c: Company, ref: Doc, exceptId?: number): Map<TaxCode | null, Minor> {
  const room = new Map<TaxCode | null, Minor>();
  for (const l of ref.lines) room.set(l.taxCode, (room.get(l.taxCode) ?? 0) + lineNet(ref, l));
  for (const d of c.documents.values()) {
    if (d.refId !== ref.id || d.voided || d.id === exceptId) continue;
    for (const l of d.lines) room.set(l.taxCode, (room.get(l.taxCode) ?? 0) - lineNet(d, l));
  }
  return room;
}

function checkCredit(c: Company, kind: DocKind, ref: Doc | null, lines: DocLine[], inclusive: boolean, memo: string): Result<true> {
  const taxable = lines.some((l) => l.taxCode === 'SR' || l.taxCode === 'ZR' || l.taxCode === 'EX');
  // A tax credit note identifies the supply it corrects and says why (Executive Regulation Art. 60).
  if (kind === 'credit_memo' && taxable && !ref) return err('doc.credit_note_ref', 'Choose the invoice this credit corrects; a tax credit note must name it.');
  if (kind === 'credit_memo' && taxable && !memo) return err('doc.credit_note_reason', 'Write the reason for the credit in the memo; a tax credit note must give it.');
  if (!ref) return ok(true);
  const room = creditRoom(c, ref);
  const want = new Map<TaxCode | null, Minor>();
  for (const l of lines) want.set(l.taxCode, (want.get(l.taxCode) ?? 0) + lineNet({ taxInclusive: inclusive }, l));
  for (const [code, amount] of want) {
    const left = room.get(code) ?? 0;
    if (amount > left) {
      return err('doc.credit_over_ref', `${ref.kind === 'invoice' ? 'Invoice' : 'Bill'} ${ref.number} has ${formatAmount(Math.max(left, 0), c.currency)} left to credit${code ? ` at tax code ${code}` : ' without VAT'}.`);
    }
  }
  return ok(true);
}

// The entry a document posts, rebuilt from the document alone. Creating a document posts exactly
// this, and the integrity check compares every document's entry with it line by line.
export function postingFor(c: Company, d: Omit<Doc, 'id' | 'entryId' | 'voided'>): EntryLine[] {
  const p = d.partyId;
  const body: Body = { lines: d.lines, total: d.total, vat: 0, reverseCharge: 0 };
  for (const l of d.lines) {
    if (l.taxCode === 'SR') body.vat += l.tax;
    if (l.taxCode === 'RC') body.reverseCharge += l.tax;
  }
  const net = (l: DocLine) => netOf(l, d.taxInclusive);
  const credit = () => d.lines.map((l) => cr(l.accountId, net(l), p, l.description));
  const debit = () => d.lines.map((l) => dr(l.accountId, net(l), p, l.description));
  switch (d.kind) {
    case 'estimate':
    case 'purchase_order':
      return [];
    case 'sales_receipt':
      return [dr(d.bankAccountId!, d.total, p), ...credit(), ...vatLines(c, 'sales', body, 1, p)];
    case 'invoice':
      return [dr(d.accountId!, d.total, p), ...credit(), ...vatLines(c, 'sales', body, 1, p)];
    case 'credit_memo': // income goes back down, the customer owes less
      return [...debit(), ...vatLines(c, 'sales', body, -1, p), cr(d.accountId!, d.total, p)];
    case 'expense':
      return [...debit(), ...vatLines(c, 'purchase', body, 1, p), cr(d.bankAccountId!, d.total, p)];
    case 'bill':
      return [...debit(), ...vatLines(c, 'purchase', body, 1, p), cr(d.accountId!, d.total, p)];
    case 'vendor_credit': // we owe less, the cost goes back down
      return [dr(d.accountId!, d.total, p), ...vatLines(c, 'purchase', body, -1, p), ...credit()];
    case 'payment':
      return [dr(d.bankAccountId!, d.total, p), cr(d.accountId!, d.total, p)];
    case 'bill_payment':
      return [dr(d.accountId!, d.total, p), cr(d.bankAccountId!, d.total, p)];
    case 'transfer':
      return [dr(d.toAccountId!, d.total, null), cr(d.bankAccountId!, d.total, null)];
  }
}

// Entry lines for the VAT of a document: output tax on sales and on reverse charge, input tax on
// purchases and on reverse charge. `sign` is 1 for invoices, receipts, bills and expenses, -1 for
// credit memos and vendor credits.
function vatLines(c: Company, side: 'sales' | 'purchase', body: Body, sign: 1 | -1, partyId: string | null): EntryLine[] {
  const accts = vatAccounts(c);
  if (!accts || (body.vat === 0 && body.reverseCharge === 0)) return [];
  const out: EntryLine[] = [];
  const put = (accountId: string, amount: Minor, debitSide: boolean, memo: string) => {
    if (amount > 0) out.push(debitSide === (sign === 1) ? dr(accountId, amount, partyId, memo) : cr(accountId, amount, partyId, memo));
  };
  if (side === 'sales') put(accts.output, body.vat, false, 'VAT');
  else {
    put(accts.input, body.vat + body.reverseCharge, true, 'VAT');
    put(accts.output, body.reverseCharge, false, 'VAT, reverse charge');
  }
  return out;
}

type EntryLine = { accountId: string; debit: Minor; credit: Minor; memo?: string; partyId: string | null };

const dr = (accountId: string, amount: Minor, partyId: string | null, memo = ''): EntryLine => ({ accountId, debit: amount, credit: 0, partyId, memo });
const cr = (accountId: string, amount: Minor, partyId: string | null, memo = ''): EntryLine => ({ accountId, debit: 0, credit: amount, partyId, memo });

interface PendingApplication {
  targetId: number;
  amount: Minor;
}

// Validate everything, then change state. Nothing after the first mutation can fail.
function commit(c: Company, draft: Omit<Doc, 'id' | 'entryId' | 'voided'>, entry: EntryLine[] | null, apps: PendingApplication[] = []): Result<Doc> {
  const id = c.nextDocId;
  const entryLines = entry?.filter((l) => l.debit > 0 || l.credit > 0) ?? null;
  const entryInput = entryLines ? { date: draft.date, memo: draft.memo || `${draft.kind.replace('_', ' ')} ${draft.number}`.trim(), lines: entryLines, source: { kind: draft.kind, id } } : null;
  if (entryInput) {
    const v = validateEntry(c, entryInput);
    if (!v.ok) return v;
  }
  c.nextDocId++;
  let entryId: number | null = null;
  if (entryInput) {
    const posted = postEntry(c, entryInput);
    if (!posted.ok) throw new Error(`validated entry refused: ${posted.error.message}`);
    entryId = posted.value.id;
  }
  const doc: Doc = { ...draft, id, entryId, voided: false };
  c.documents.set(id, doc);
  for (const a of apps) c.applications.push({ id: c.nextApplicationId++, date: draft.date, sourceId: id, targetId: a.targetId, amount: a.amount, voided: false });
  return ok(doc);
}

// ---------------------------------------------------------------- balances

const live = (c: Company, asOf?: string) => c.applications.filter((a) => !a.voided && (asOf === undefined || a.date <= asOf));

// What is still owed on an invoice or bill.
export function openBalance(c: Company, doc: Doc, asOf?: string): Minor {
  if (doc.voided || (asOf !== undefined && doc.date > asOf)) return 0;
  return live(c, asOf).reduce((open, a) => (a.targetId === doc.id ? open - a.amount : open), doc.total);
}

// What is left of a payment or credit to apply.
export function unapplied(c: Company, doc: Doc, asOf?: string): Minor {
  if (doc.voided || (asOf !== undefined && doc.date > asOf)) return 0;
  return live(c, asOf).reduce((left, a) => (a.sourceId === doc.id ? left - a.amount : left), doc.total);
}

const TARGET_OF: Partial<Record<DocKind, DocKind>> = { payment: 'invoice', credit_memo: 'invoice', bill_payment: 'bill', vendor_credit: 'bill' };

// Checks applications from `source` (which may not exist yet) to its targets.
function checkApplications(c: Company, source: { kind: DocKind; partyId: string | null; accountId: string | null; date: string; available: Minor }, raw: unknown): Result<PendingApplication[]> {
  if (raw === undefined || raw === null) return ok([]);
  if (!Array.isArray(raw)) return err('apply.invalid', 'Applications must be a list.');
  const targetKind = TARGET_OF[source.kind];
  const out: PendingApplication[] = [];
  let used = 0;
  for (const [i, r] of raw.entries()) {
    if (!isObject(r)) return err('apply.invalid', `Application ${i + 1} is not valid.`);
    const target = typeof r.docId === 'number' ? c.documents.get(r.docId) : undefined;
    if (!target || target.kind !== targetKind) return err('apply.target_missing', `Application ${i + 1}: that ${targetKind} does not exist.`);
    if (target.voided) return err('apply.target_void', `${targetKind} ${target.number} is void.`);
    if (target.partyId !== source.partyId) return err('apply.target_party', `${targetKind} ${target.number} belongs to someone else.`);
    if (target.accountId !== source.accountId) return err('apply.target_account', `${targetKind} ${target.number} posts to a different account.`);
    if (target.date > source.date) return err('apply.target_later', `${targetKind} ${target.number} is dated after this ${source.kind.replace('_', ' ')}.`);
    if (out.some((o) => o.targetId === target.id)) return err('apply.duplicate', `${targetKind} ${target.number} appears twice.`);
    const amount = r.amount;
    if (!isMinor(amount) || amount <= 0) return err('apply.amount_invalid', `Application ${i + 1}: amount must be more than zero.`);
    const open = openBalance(c, target);
    if (amount > open) return err('apply.over_target', `Only ${formatAmount(open, c.currency)} is open on ${targetKind} ${target.number}.`);
    used += amount;
    if (used > source.available) return err('apply.over_source', `Applications add up to more than ${formatAmount(source.available, c.currency)}.`);
    out.push({ targetId: target.id, amount });
  }
  return ok(out);
}

// ---------------------------------------------------------------- sales: estimate, invoice, sales receipt, credit memo

export function createSalesDoc(c: Company, kind: SalesKind, input: unknown): Result<Doc> {
  if (!isObject(input)) return err('doc.invalid', 'Document details are missing.');
  const date = kind === 'estimate' ? (isIsoDate(input.date) ? ok(input.date) : err<string>('date.invalid', 'Date must be a real date (YYYY-MM-DD).')) : checkDate(c, input.date);
  if (!date.ok) return date;
  const party = partyOf(c, input.customerId, 'customer', kind !== 'sales_receipt');
  if (!party.ok) return party;
  const partyId = party.value?.id ?? null;
  const memo = memoOf(input.memo);
  if (!memo.ok) return memo;
  const inclusive = inclusiveOf(c, date.value, input.taxInclusive);
  if (!inclusive.ok) return inclusive;
  const ref = refOf(c, kind, partyId, date.value, input.refId);
  if (!ref.ok) return ref;
  const body = linesOf(c, 'sales', input.lines, inclusive.value, date.value, ref.value);
  if (!body.ok) return body;
  const number = numberOf(c, kind, input.number, partyId);
  if (!number.ok) return number;
  const { lines, total } = body.value;
  const credit = checkCredit(c, kind, ref.value, lines, inclusive.value, memo.value);
  if (!credit.ok) return credit;
  const base = { kind, number: number.value, date: date.value, partyId, memo: memo.value, lines, total, taxInclusive: inclusive.value, refId: ref.value?.id ?? null, toAccountId: null, linkedId: null };
  const post = (draft: Omit<Doc, 'id' | 'entryId' | 'voided'>) => commit(c, draft, postingFor(c, draft));

  if (kind === 'estimate') {
    const expires = input.expiresOn === undefined || input.expiresOn === null ? ok(null) : isIsoDate(input.expiresOn) ? ok(input.expiresOn) : err<null>('date.invalid', 'Expiry must be a real date.');
    if (!expires.ok) return expires;
    return commit(c, { ...base, dueDate: expires.value, accountId: null, bankAccountId: null, status: 'open' }, null);
  }
  if (kind === 'sales_receipt') {
    const into = moneyAccount(c, input.depositToId, RECEIVE_INTO, 'the money received');
    if (!into.ok) return into;
    return post({ ...base, dueDate: null, accountId: null, bankAccountId: into.value, status: null });
  }
  const ar = controlAccount(c, 'accounts_receivable', input.accountId);
  if (!ar.ok) return ar;
  if (kind === 'invoice') {
    const due = dueDateOf(date.value, party.value, input);
    if (!due.ok) return due;
    return post({ ...base, dueDate: due.value, accountId: ar.value, bankAccountId: null, status: null });
  }
  return post({ ...base, dueDate: null, accountId: ar.value, bankAccountId: null, status: null });
}

// ---------------------------------------------------------------- purchases: purchase order, bill, vendor credit, expense

export function createPurchaseDoc(c: Company, kind: PurchaseKind, input: unknown): Result<Doc> {
  if (!isObject(input)) return err('doc.invalid', 'Document details are missing.');
  const date = kind === 'purchase_order' ? (isIsoDate(input.date) ? ok(input.date) : err<string>('date.invalid', 'Date must be a real date (YYYY-MM-DD).')) : checkDate(c, input.date);
  if (!date.ok) return date;
  const party = partyOf(c, input.vendorId, 'vendor', kind !== 'expense');
  if (!party.ok) return party;
  const partyId = party.value?.id ?? null;
  const memo = memoOf(input.memo);
  if (!memo.ok) return memo;
  const inclusive = inclusiveOf(c, date.value, input.taxInclusive);
  if (!inclusive.ok) return inclusive;
  const ref = refOf(c, kind, partyId, date.value, input.refId);
  if (!ref.ok) return ref;
  const body = linesOf(c, 'purchase', input.lines, inclusive.value, date.value, ref.value);
  if (!body.ok) return body;
  const number = numberOf(c, kind, input.number, partyId);
  if (!number.ok) return number;
  const { lines, total } = body.value;
  const credit = checkCredit(c, kind, ref.value, lines, inclusive.value, memo.value);
  if (!credit.ok) return credit;
  const base = { kind, number: number.value, date: date.value, partyId, memo: memo.value, lines, total, taxInclusive: inclusive.value, refId: ref.value?.id ?? null, toAccountId: null, linkedId: null };
  const post = (draft: Omit<Doc, 'id' | 'entryId' | 'voided'>) => commit(c, draft, postingFor(c, draft));

  if (kind === 'purchase_order') return commit(c, { ...base, dueDate: null, accountId: null, bankAccountId: null, status: 'open' }, null);
  if (kind === 'expense') {
    const from = moneyAccount(c, input.payFromId, PAY_FROM, 'paying');
    if (!from.ok) return from;
    return post({ ...base, dueDate: null, accountId: null, bankAccountId: from.value, status: null });
  }
  const ap = controlAccount(c, 'accounts_payable', input.accountId);
  if (!ap.ok) return ap;
  if (kind === 'bill') {
    const due = dueDateOf(date.value, party.value, input);
    if (!due.ok) return due;
    return post({ ...base, dueDate: due.value, accountId: ap.value, bankAccountId: null, status: null });
  }
  return post({ ...base, dueDate: null, accountId: ap.value, bankAccountId: null, status: null });
}

// ---------------------------------------------------------------- payments received and bills paid

export function createSettlement(c: Company, kind: SettlementKind, input: unknown): Result<Doc> {
  if (!isObject(input)) return err('doc.invalid', 'Payment details are missing.');
  const date = checkDate(c, input.date);
  if (!date.ok) return date;
  const partyKind = kind === 'payment' ? 'customer' : 'vendor';
  const party = partyOf(c, kind === 'payment' ? input.customerId : input.vendorId, partyKind, true);
  if (!party.ok) return party;
  const partyId = party.value!.id;
  if (!isMinor(input.amount) || input.amount <= 0) return err('doc.amount_invalid', 'Amount must be more than zero, in whole minor units.');
  const amount = input.amount;
  const control = controlAccount(c, kind === 'payment' ? 'accounts_receivable' : 'accounts_payable', input.accountId);
  if (!control.ok) return control;
  const money = kind === 'payment' ? moneyAccount(c, input.depositToId, RECEIVE_INTO, 'the money received') : moneyAccount(c, input.payFromId, PAY_FROM, 'paying');
  if (!money.ok) return money;
  const memo = memoOf(input.memo);
  if (!memo.ok) return memo;
  const number = numberOf(c, kind, input.number, partyId);
  if (!number.ok) return number;
  const apps = checkApplications(c, { kind, partyId, accountId: control.value, date: date.value, available: amount }, input.applications);
  if (!apps.ok) return apps;
  const draft: Omit<Doc, 'id' | 'entryId' | 'voided'> = { kind, number: number.value, date: date.value, dueDate: null, partyId, memo: memo.value, lines: [], total: amount, taxInclusive: false, refId: null, accountId: control.value, bankAccountId: money.value, toAccountId: null, status: null, linkedId: null };
  return commit(c, draft, postingFor(c, draft), apps.value);
}

// Apply what is left of a payment or credit to more invoices or bills.
export function applyCredit(c: Company, input: unknown): Result<Application[]> {
  if (!isObject(input)) return err('apply.invalid', 'Application details are missing.');
  const source = typeof input.sourceId === 'number' ? c.documents.get(input.sourceId) : undefined;
  if (!source || !TARGET_OF[source.kind]) return err('apply.source_missing', 'Choose a payment or credit to apply.');
  if (source.voided) return err('apply.source_void', 'That payment or credit is void.');
  const date = input.date === undefined ? ok(source.date) : isIsoDate(input.date) ? ok(input.date) : err<string>('date.invalid', 'Date must be a real date (YYYY-MM-DD).');
  if (!date.ok) return date;
  if (date.value < source.date) return err('apply.before_source', 'An application cannot be dated before the payment or credit.');
  if (c.closingDate && date.value <= c.closingDate) return err('date.closed', `The books are closed through ${c.closingDate}.`);
  const apps = checkApplications(c, { kind: source.kind, partyId: source.partyId, accountId: source.accountId, date: date.value, available: unapplied(c, source) }, input.applications);
  if (!apps.ok) return apps;
  if (!apps.value.length) return err('apply.empty', 'Nothing to apply.');
  const made = apps.value.map((a) => ({ id: c.nextApplicationId++, date: date.value, sourceId: source.id, targetId: a.targetId, amount: a.amount, voided: false }));
  c.applications.push(...made);
  return ok(made);
}

// ---------------------------------------------------------------- transfers

export function createTransfer(c: Company, input: unknown): Result<Doc> {
  if (!isObject(input)) return err('doc.invalid', 'Transfer details are missing.');
  const date = checkDate(c, input.date);
  if (!date.ok) return date;
  const from = moneyAccount(c, input.fromId, TRANSFER, 'transferring from');
  if (!from.ok) return from;
  const to = moneyAccount(c, input.toId, TRANSFER, 'transferring to');
  if (!to.ok) return to;
  if (from.value === to.value) return err('transfer.same_account', 'Choose two different accounts.');
  if (!isMinor(input.amount) || input.amount <= 0) return err('doc.amount_invalid', 'Amount must be more than zero, in whole minor units.');
  const memo = memoOf(input.memo);
  if (!memo.ok) return memo;
  const draft: Omit<Doc, 'id' | 'entryId' | 'voided'> = { kind: 'transfer', number: '', date: date.value, dueDate: null, partyId: null, memo: memo.value, lines: [], total: input.amount, taxInclusive: false, refId: null, accountId: null, bankAccountId: from.value, toAccountId: to.value, status: null, linkedId: null };
  return commit(c, draft, postingFor(c, draft));
}

// ---------------------------------------------------------------- converting estimates and purchase orders

export function convertDoc(c: Company, from: 'estimate' | 'purchase_order', input: unknown): Result<Doc> {
  if (!isObject(input)) return err('doc.invalid', 'Details are missing.');
  const src = typeof input.docId === 'number' ? c.documents.get(input.docId) : undefined;
  if (!src || src.kind !== from) return err('doc.missing', `That ${from.replace('_', ' ')} does not exist.`);
  if (src.voided) return err('doc.void', `${from.replace('_', ' ')} ${src.number} is void.`);
  if (src.status !== 'open') return err('doc.closed', `${from.replace('_', ' ')} ${src.number} is already closed.`);
  // Item lines post to the item's account as it is set up today, as they would on a new invoice.
  const newDate = typeof input.date === 'string' ? input.date : src.date;
  if (vatActive(c, newDate) && src.lines.some((l) => l.taxCode === null)) {
    return err('doc.convert_no_tax_code', `${from.replace('_', ' ')} ${src.number} was made without tax codes (before VAT registration); enter the ${from === 'estimate' ? 'invoice' : 'bill'} with its tax codes instead.`);
  }
  const lines = src.lines.map((l) => ({ itemId: l.itemId, accountId: l.itemId ? undefined : l.accountId, description: l.description, quantity: formatQuantity(l.quantity), rate: l.rate, taxCode: l.taxCode }));
  const common = { date: input.date ?? src.date, number: input.number, dueDate: input.dueDate, memo: input.memo ?? src.memo, taxInclusive: src.taxInclusive, lines };
  const made =
    from === 'estimate' ? createSalesDoc(c, 'invoice', { ...common, customerId: src.partyId }) : createPurchaseDoc(c, 'bill', { ...common, vendorId: src.partyId });
  if (!made.ok) return made;
  src.status = 'closed';
  src.linkedId = made.value.id;
  made.value.linkedId = src.id;
  return made;
}

// ---------------------------------------------------------------- void

export function voidDoc(c: Company, input: unknown): Result<Doc> {
  if (!isObject(input)) return err('doc.invalid', 'Details are missing.');
  const doc = typeof input.docId === 'number' ? c.documents.get(input.docId) : undefined;
  if (!doc) return err('doc.missing', 'That document does not exist.');
  if (doc.voided) return err('doc.void', 'It is already void.');
  const applied = live(c).filter((a) => a.targetId === doc.id || (a.sourceId === doc.id && (doc.kind === 'credit_memo' || doc.kind === 'vendor_credit')));
  if (applied.length) return err('doc.applied', 'Payments or credits are applied to it; void those first.');
  if (doc.entryId !== null) {
    const entry = c.entries.find((e) => e.id === doc.entryId);
    if (entry?.lines.some((_, i) => c.cleared.has(`${entry.id}:${i}`))) {
      return err('doc.reconciled', 'It is part of a bank reconciliation; undo the reconciliation first.');
    }
  }
  if ((doc.kind === 'estimate' || doc.kind === 'purchase_order') && doc.status === 'closed' && doc.linkedId !== null) {
    return err('doc.converted', 'It has been converted; void the document it became first.');
  }
  if (doc.entryId !== null) {
    const r = reverseEntry(c, { entryId: doc.entryId, date: doc.date, memo: `Void ${doc.kind.replace('_', ' ')} ${doc.number}`.trim() }, { forDocument: true });
    if (!r.ok) return r;
  }
  doc.voided = true;
  for (const a of c.applications) if (a.sourceId === doc.id) a.voided = true;
  if (doc.linkedId !== null) {
    const origin = c.documents.get(doc.linkedId);
    if (origin && (origin.kind === 'estimate' || origin.kind === 'purchase_order')) {
      origin.status = 'open';
      origin.linkedId = null;
    }
  }
  return ok(doc);
}
