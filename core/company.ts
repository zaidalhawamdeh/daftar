// A company: its chart of accounts and its posted journal. Every mutation here validates first and
// changes state only once nothing can fail.

import { ACCOUNT_TYPES, MAX_DEPTH, classOf, isAccountType, type Account, type AccountType } from './accounts.ts';
import { isIsoDate } from './dates.ts';
import { currency, type Currency, type Minor } from './money.ts';
import { err, ok, type Result } from './result.ts';
import { BASIC_CHART } from './templates.ts';
import type { Reconciliation } from './banking.ts';
import type { Application, Doc } from './documents.ts';
import type { Memorized } from './memorized.ts';
import type { Item } from './items.ts';
import type { Party } from './parties.ts';

export interface Line {
  accountId: string;
  debit: Minor;
  credit: Minor;
  memo: string;
  partyId: string | null; // required on receivable and payable lines
}

// The document an entry was posted for, if any.
export interface EntrySource {
  kind: string;
  id: number;
}

export interface Entry {
  id: number;
  date: string;
  memo: string;
  lines: readonly Line[];
  reverses: number | null;
  source: EntrySource | null;
}

export type Language = 'en' | 'ar';

export interface Company {
  name: string;
  currency: Currency;
  language: Language;
  fiscalYearStartMonth: number;
  closingDate: string | null;
  closingDateLog: { from: string | null; to: string | null }[];
  accounts: Map<string, Account>;
  entries: Entry[];
  parties: Map<string, Party>;
  items: Map<string, Item>;
  documents: Map<number, Doc>;
  applications: Application[];
  reconciliations: Reconciliation[];
  cleared: Map<string, number>; // "entryId:lineIndex" → reconciliation id
  memorized: Map<string, Memorized>;
  nextAccountId: number;
  nextEntryId: number;
  nextPartyId: number;
  nextItemId: number;
  nextDocId: number;
  nextApplicationId: number;
  nextReconciliationId: number;
  nextMemorizedId: number;
}

export interface CreateCompanyInput {
  name: unknown;
  currency: unknown;
  language?: unknown;
  fiscalYearStartMonth?: unknown;
  template?: unknown;
}

const RETAINED_EARNINGS = { en: 'Retained Earnings', ar: 'الأرباح المحتجزة' };

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function cleanName(v: unknown, max: number, what: string): Result<string> {
  if (typeof v !== 'string') return err(`${what}.invalid`, `${what} must be text.`);
  // Invisible characters would let "Rent" and "Rent\u200b" sit side by side.
  const s = v.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim().replace(/\s+/g, ' ');
  if (!s) return err(`${what}.empty`, `${what} is required.`);
  if (s.length > max) return err(`${what}.too_long`, `${what} is longer than ${max} characters.`);
  return ok(s);
}

export function createCompany(input: CreateCompanyInput): Result<Company> {
  if (!isObject(input)) return err('company.invalid', 'Company details are missing.');
  const name = cleanName(input.name, 120, 'company name');
  if (!name.ok) return name;
  const cur = currency(input.currency);
  if (!cur.ok) return cur;
  const language = input.language ?? 'en';
  if (language !== 'en' && language !== 'ar') return err('language.invalid', 'Language must be "en" or "ar".');
  const fy = input.fiscalYearStartMonth ?? 1;
  if (typeof fy !== 'number' || !Number.isInteger(fy) || fy < 1 || fy > 12) {
    return err('fiscal_year.invalid', 'Fiscal year must start in month 1 to 12.');
  }
  const template = input.template ?? 'basic';
  if (template !== 'basic' && template !== 'none') return err('template.invalid', 'Template must be "basic" or "none".');

  const company: Company = {
    name: name.value,
    currency: cur.value,
    language,
    fiscalYearStartMonth: fy,
    closingDate: null,
    closingDateLog: [],
    accounts: new Map(),
    entries: [],
    parties: new Map(),
    items: new Map(),
    documents: new Map(),
    applications: [],
    reconciliations: [],
    cleared: new Map(),
    memorized: new Map(),
    nextAccountId: 1,
    nextEntryId: 1,
    nextPartyId: 1,
    nextItemId: 1,
    nextDocId: 1,
    nextApplicationId: 1,
    nextReconciliationId: 1,
    nextMemorizedId: 1,
  };
  const re = insertAccount(company, { number: '3900', name: RETAINED_EARNINGS[language], type: 'equity', parentId: null });
  re.role = 'retained_earnings';
  if (template === 'basic') {
    const byNumber = new Map<string, string>();
    for (const t of BASIC_CHART) {
      const parentId = t.parent ? (byNumber.get(t.parent) ?? null) : null;
      const a = insertAccount(company, { number: t.number, name: t.name[language], type: t.type, parentId });
      byNumber.set(t.number, a.id);
    }
  }
  return ok(company);
}

function insertAccount(c: Company, a: { number: string; name: string; type: AccountType; parentId: string | null }): Account {
  const account: Account = { id: `acc-${c.nextAccountId++}`, active: true, role: null, ...a };
  c.accounts.set(account.id, account);
  return account;
}

export function retainedEarnings(c: Company): Account {
  for (const a of c.accounts.values()) if (a.role === 'retained_earnings') return a;
  throw new Error('company has no retained earnings account');
}

export function findAccount(c: Company, key: unknown): Account | undefined {
  if (typeof key !== 'string') return undefined;
  const byId = c.accounts.get(key);
  if (byId) return byId;
  const k = key.trim().toLowerCase();
  for (const a of c.accounts.values()) if (a.number === key.trim() || a.name.toLowerCase() === k) return a;
  return undefined;
}

export function depth(c: Company, a: Account): number {
  let d = 1;
  let p = a.parentId ? c.accounts.get(a.parentId) : undefined;
  while (p) {
    d++;
    p = p.parentId ? c.accounts.get(p.parentId) : undefined;
  }
  return d;
}

function subtreeHeight(c: Company, id: string): number {
  let h = 1;
  for (const a of c.accounts.values()) if (a.parentId === id) h = Math.max(h, 1 + subtreeHeight(c, a.id));
  return h;
}

export function hasPostings(c: Company, accountId: string): boolean {
  return c.entries.some((e) => e.lines.some((l) => l.accountId === accountId));
}

export interface AccountInput {
  name?: unknown;
  number?: unknown;
  type?: unknown;
  parentId?: unknown;
}

function checkNumber(c: Company, v: unknown, selfId: string | null): Result<string> {
  if (v === undefined || v === null || v === '') return ok('');
  if (typeof v !== 'string' || !/^[0-9A-Za-z.\-]{1,20}$/.test(v.trim())) {
    return err('account.number_invalid', 'Account number is up to 20 letters, digits, dots or dashes.');
  }
  const n = v.trim();
  for (const a of c.accounts.values()) {
    if (a.id !== selfId && a.number === n) return err('account.number_taken', `Account number ${n} is already used by "${a.name}".`);
  }
  return ok(n);
}

function checkParent(c: Company, v: unknown, type: AccountType, selfId: string | null): Result<string | null> {
  if (v === undefined || v === null || v === '') return ok(null);
  if (typeof v !== 'string') return err('account.parent_invalid', 'Parent must be an account id.');
  const parent = c.accounts.get(v);
  if (!parent) return err('account.parent_missing', 'Parent account does not exist.');
  if (!parent.active) return err('account.parent_inactive', `Parent "${parent.name}" is inactive.`);
  if (classOf(parent.type) !== classOf(type)) {
    return err('account.parent_class', `A ${ACCOUNT_TYPES[type].label.en} account cannot sit under "${parent.name}".`);
  }
  for (let p: Account | undefined = parent; p; p = p.parentId ? c.accounts.get(p.parentId) : undefined) {
    if (p.id === selfId) return err('account.parent_cycle', 'An account cannot sit under itself.');
  }
  const height = selfId ? subtreeHeight(c, selfId) : 1;
  if (depth(c, parent) + height > MAX_DEPTH) return err('account.too_deep', `Accounts nest at most ${MAX_DEPTH} levels.`);
  return ok(parent.id);
}

function checkSiblingName(c: Company, name: string, parentId: string | null, selfId: string | null): Result<string> {
  const k = name.toLowerCase();
  for (const a of c.accounts.values()) {
    if (a.id !== selfId && a.parentId === parentId && a.name.toLowerCase() === k) {
      return err('account.name_taken', `An account named "${a.name}" already exists here.`);
    }
  }
  return ok(name);
}

export function createAccount(c: Company, input: AccountInput): Result<Account> {
  if (!isObject(input)) return err('account.invalid', 'Account details are missing.');
  const name = cleanName(input.name, 100, 'account name');
  if (!name.ok) return name;
  if (!isAccountType(input.type)) return err('account.type_invalid', 'Unknown account type.', { type: input.type });
  const type = input.type;
  const number = checkNumber(c, input.number, null);
  if (!number.ok) return number;
  const parentId = checkParent(c, input.parentId, type, null);
  if (!parentId.ok) return parentId;
  const unique = checkSiblingName(c, name.value, parentId.value, null);
  if (!unique.ok) return unique;
  return ok(insertAccount(c, { number: number.value, name: name.value, type, parentId: parentId.value }));
}

export function updateAccount(c: Company, id: unknown, input: AccountInput): Result<Account> {
  const a = typeof id === 'string' ? c.accounts.get(id) : undefined;
  if (!a) return err('account.missing', 'Account does not exist.');
  if (!isObject(input)) return err('account.invalid', 'Account details are missing.');
  const name = input.name === undefined ? ok(a.name) : cleanName(input.name, 100, 'account name');
  if (!name.ok) return name;
  let type = a.type;
  if (input.type !== undefined && input.type !== a.type) {
    if (!isAccountType(input.type)) return err('account.type_invalid', 'Unknown account type.', { type: input.type });
    if (a.role) return err('account.system', `"${a.name}" is managed by the system; its type cannot change.`);
    if (hasPostings(c, a.id)) return err('account.type_locked', `"${a.name}" has postings; its type cannot change.`);
    if (c.reconciliations.some((r) => r.accountId === a.id && !r.undone)) return err('account.type_locked', `"${a.name}" has been reconciled; its type cannot change.`);
    for (const child of c.accounts.values()) {
      if (child.parentId === a.id && classOf(child.type) !== classOf(input.type)) {
        return err('account.type_children', `"${a.name}" has sub-accounts of another kind.`);
      }
    }
    type = input.type;
  }
  const number = input.number === undefined ? ok(a.number) : checkNumber(c, input.number, a.id);
  if (!number.ok) return number;
  const parentId = input.parentId === undefined ? ok(a.parentId) : checkParent(c, input.parentId, type, a.id);
  if (!parentId.ok) return parentId;
  if (input.parentId === undefined && input.type !== undefined && a.parentId) {
    const p = c.accounts.get(a.parentId);
    if (p && classOf(p.type) !== classOf(type)) return err('account.parent_class', 'Parent is a different kind of account.');
  }
  const unique = checkSiblingName(c, name.value, parentId.value, a.id);
  if (!unique.ok) return unique;
  a.name = name.value;
  a.type = type;
  a.number = number.value;
  a.parentId = parentId.value;
  return ok(a);
}

export function setAccountActive(c: Company, id: unknown, active: unknown): Result<Account> {
  const a = typeof id === 'string' ? c.accounts.get(id) : undefined;
  if (!a) return err('account.missing', 'Account does not exist.');
  if (typeof active !== 'boolean') return err('account.active_invalid', 'Active must be true or false.');
  if (!active && a.role) return err('account.system', `"${a.name}" is managed by the system and stays active.`);
  if (!active) {
    for (const child of c.accounts.values()) {
      if (child.parentId === a.id && child.active) return err('account.active_children', `"${a.name}" has active sub-accounts.`);
    }
  } else if (a.parentId) {
    const p = c.accounts.get(a.parentId);
    if (p && !p.active) return err('account.parent_inactive', `Parent "${p.name}" is inactive.`);
  }
  a.active = active;
  return ok(a);
}

// Moving the closing date later locks more of the past and needs no confirmation. Moving it earlier
// or removing it reopens closed periods, so it must be asked for explicitly, and every change is logged.
export function setClosingDate(c: Company, date: unknown, reopen: unknown = false): Result<string | null> {
  if (date !== null && !isIsoDate(date)) return err('date.invalid', 'Closing date must be a real date (YYYY-MM-DD).');
  const reopens = c.closingDate !== null && (date === null || date < c.closingDate);
  if (reopens && reopen !== true) {
    return err('closing.reopen', `This reopens periods closed through ${c.closingDate}; confirm to continue.`, { closingDate: c.closingDate });
  }
  if (date !== c.closingDate) c.closingDateLog.push({ from: c.closingDate, to: date });
  c.closingDate = date;
  return ok(date);
}

// Changing the fiscal year restates which profit is "retained" and which is "this year", so it is
// refused once closed periods hold entries.
export function setFiscalYearStart(c: Company, month: unknown): Result<number> {
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
    return err('fiscal_year.invalid', 'Fiscal year must start in month 1 to 12.');
  }
  const closed = c.closingDate;
  if (month !== c.fiscalYearStartMonth && closed !== null && c.entries.some((e) => e.date <= closed)) {
    return err('fiscal_year.closed', `Periods through ${closed} are closed; reopen them before changing the fiscal year.`);
  }
  c.fiscalYearStartMonth = month;
  return ok(month);
}
