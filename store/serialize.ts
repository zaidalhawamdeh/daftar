// A company to and from plain JSON: the browser keeps it in IndexedDB, people keep it as a .daftar
// file. A file is hostile input: loading checks every entry balances and every reference resolves
// before handing the company to the core, and refreezes posted entries.

import { isAccountType, type Account } from '../core/accounts.ts';
import type { Reconciliation } from '../core/banking.ts';
import type { Company, Entry, Line } from '../core/company.ts';
import { isIsoDate } from '../core/dates.ts';
import type { Application, Doc } from '../core/documents.ts';
import type { Item } from '../core/items.ts';
import type { Memorized } from '../core/memorized.ts';
import { currency, isMinor } from '../core/money.ts';
import type { Party } from '../core/parties.ts';
import { err, ok, type Result } from '../core/result.ts';

export const FORMAT = 'daftar-company';
export const VERSION = 1;

export interface CompanyFile {
  format: typeof FORMAT;
  version: number;
  savedAt: string;
  company: {
    name: string;
    currency: string;
    language: 'en' | 'ar';
    fiscalYearStartMonth: number;
    closingDate: string | null;
    closingDateLog: { from: string | null; to: string | null }[];
    accounts: Account[];
    entries: Entry[];
    parties: Party[];
    items: Item[];
    documents: Doc[];
    applications: Application[];
    reconciliations: Reconciliation[];
    cleared: [string, number][];
    memorized: Memorized[];
    counters: Record<string, number>;
  };
}

const COUNTERS = ['nextAccountId', 'nextEntryId', 'nextPartyId', 'nextItemId', 'nextDocId', 'nextApplicationId', 'nextReconciliationId', 'nextMemorizedId'] as const;

export function toFile(c: Company, savedAt = new Date().toISOString()): CompanyFile {
  const copy = structuredClone(c);
  return {
    format: FORMAT,
    version: VERSION,
    savedAt,
    company: {
      name: copy.name,
      currency: copy.currency.code,
      language: copy.language,
      fiscalYearStartMonth: copy.fiscalYearStartMonth,
      closingDate: copy.closingDate,
      closingDateLog: copy.closingDateLog,
      accounts: [...copy.accounts.values()],
      entries: copy.entries,
      parties: [...copy.parties.values()],
      items: [...copy.items.values()],
      documents: [...copy.documents.values()],
      applications: copy.applications,
      reconciliations: copy.reconciliations,
      cleared: [...copy.cleared],
      memorized: [...copy.memorized.values()],
      counters: Object.fromEntries(COUNTERS.map((k) => [k, copy[k]])),
    },
  };
}

export function toText(c: Company): string {
  return JSON.stringify(toFile(c));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (what: string) => err<Company>('file.invalid', `This file is damaged or not a Daftar company (${what}).`, { what });

export function fromText(text: unknown): Result<Company> {
  if (typeof text !== 'string') return bad('not text');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return bad('not JSON');
  }
  return fromFile(data);
}

export function fromFile(data: unknown): Result<Company> {
  if (!isObj(data) || data.format !== FORMAT) return bad('format');
  if (data.version !== VERSION) return err('file.version', `This file was saved by a newer version of Daftar (format ${String(data.version)}).`);
  const f = data.company;
  if (!isObj(f)) return bad('company');
  const cur = currency(f.currency);
  if (!cur.ok) return bad('currency');
  if (typeof f.name !== 'string' || !f.name) return bad('name');
  if (f.language !== 'en' && f.language !== 'ar') return bad('language');
  if (typeof f.fiscalYearStartMonth !== 'number' || !Number.isInteger(f.fiscalYearStartMonth) || f.fiscalYearStartMonth < 1 || f.fiscalYearStartMonth > 12) return bad('fiscal year');
  if (f.closingDate !== null && !isIsoDate(f.closingDate)) return bad('closing date');
  const arrays = ['closingDateLog', 'accounts', 'entries', 'parties', 'items', 'documents', 'applications', 'reconciliations', 'cleared', 'memorized'] as const;
  for (const k of arrays) if (!Array.isArray(f[k])) return bad(k);
  if (!isObj(f.counters)) return bad('counters');

  const accounts = new Map<string, Account>();
  for (const a of f.accounts as Account[]) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.name !== 'string' || !isAccountType(a.type) || accounts.has(a.id)) return bad('account');
    accounts.set(a.id, a);
  }
  for (const a of accounts.values()) if (a.parentId !== null && !accounts.has(a.parentId)) return bad('account parent');
  if ([...accounts.values()].filter((a) => a.role === 'retained_earnings').length !== 1) return bad('retained earnings');

  const parties = new Map<string, Party>();
  for (const p of f.parties as Party[]) {
    if (!isObj(p) || typeof p.id !== 'string' || (p.kind !== 'customer' && p.kind !== 'vendor') || parties.has(p.id)) return bad('party');
    parties.set(p.id, p);
  }
  const items = new Map<string, Item>();
  for (const i of f.items as Item[]) {
    if (!isObj(i) || typeof i.id !== 'string' || items.has(i.id)) return bad('item');
    items.set(i.id, i);
  }

  const entries: Entry[] = [];
  const entryIds = new Set<number>();
  for (const e of f.entries as Entry[]) {
    if (!isObj(e) || !Number.isInteger(e.id) || entryIds.has(e.id) || !isIsoDate(e.date) || !Array.isArray(e.lines) || e.lines.length < 2) return bad('entry');
    let debits = 0;
    let credits = 0;
    const lines: Line[] = [];
    for (const l of e.lines as Line[]) {
      if (!isObj(l) || !accounts.has(l.accountId) || !isMinor(l.debit) || !isMinor(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0)) return bad(`entry ${e.id} line`);
      if (l.partyId !== null && !parties.has(l.partyId)) return bad(`entry ${e.id} party`);
      const t = accounts.get(l.accountId)!.type;
      if ((t === 'accounts_receivable' || t === 'accounts_payable') && (l.partyId === null || !e.source)) return bad(`entry ${e.id} receivable line`);
      debits += l.debit;
      credits += l.credit;
      lines.push(Object.freeze({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: String(l.memo ?? ''), partyId: l.partyId }));
    }
    if (debits !== credits || !Number.isSafeInteger(debits)) return bad(`entry ${e.id} does not balance`);
    entryIds.add(e.id);
    entries.push(Object.freeze({ id: e.id, date: e.date, memo: String(e.memo ?? ''), lines: Object.freeze(lines), reverses: e.reverses ?? null, source: e.source ? { kind: String(e.source.kind), id: Number(e.source.id) } : null }));
  }
  for (const e of entries) if (e.reverses !== null && !entryIds.has(e.reverses)) return bad(`entry ${e.id} reversal`);

  const documents = new Map<number, Doc>();
  for (const d of f.documents as Doc[]) {
    if (!isObj(d) || !Number.isInteger(d.id) || documents.has(d.id) || !isMinor(d.total) || (d.entryId !== null && !entryIds.has(d.entryId))) return bad('document');
    if (d.partyId !== null && !parties.has(d.partyId)) return bad(`document ${d.id} party`);
    documents.set(d.id, d);
  }
  for (const a of f.applications as Application[]) {
    if (!isObj(a) || !documents.has(a.sourceId) || !documents.has(a.targetId) || !isMinor(a.amount) || a.amount <= 0) return bad('application');
  }
  const cleared = new Map<string, number>();
  for (const pair of f.cleared as [string, number][]) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !Number.isInteger(pair[1])) return bad('cleared');
    const [entryId, index] = pair[0].split(':').map(Number);
    const e = entries.find((x) => x.id === entryId);
    if (!e || index === undefined || !e.lines[index]) return bad('cleared line');
    cleared.set(pair[0], pair[1]);
  }
  const counters: Record<string, number> = {};
  for (const k of COUNTERS) {
    const v = f.counters[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return bad(`counter ${k}`);
    counters[k] = v;
  }
  if (Math.max(0, ...entryIds) >= counters.nextEntryId! || Math.max(0, ...documents.keys()) >= counters.nextDocId!) return bad('counters behind data');

  const company: Company = {
    name: f.name,
    currency: cur.value,
    language: f.language,
    fiscalYearStartMonth: f.fiscalYearStartMonth,
    closingDate: f.closingDate as string | null,
    closingDateLog: f.closingDateLog as Company['closingDateLog'],
    accounts,
    entries,
    parties,
    items,
    documents,
    applications: f.applications as Application[],
    reconciliations: f.reconciliations as Reconciliation[],
    cleared,
    memorized: new Map((f.memorized as Memorized[]).map((m) => [m.id, m])),
    nextAccountId: counters.nextAccountId!,
    nextEntryId: counters.nextEntryId!,
    nextPartyId: counters.nextPartyId!,
    nextItemId: counters.nextItemId!,
    nextDocId: counters.nextDocId!,
    nextApplicationId: counters.nextApplicationId!,
    nextReconciliationId: counters.nextReconciliationId!,
    nextMemorizedId: counters.nextMemorizedId!,
  };
  return ok(company);
}
