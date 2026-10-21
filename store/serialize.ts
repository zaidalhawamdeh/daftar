// A company to and from plain JSON: the browser keeps it in IndexedDB, people keep it as a .daftar
// file. A file is hostile input: loading checks every entry balances and every reference resolves
// before handing the company to the core, and refreezes posted entries.

import type { Account } from '../core/accounts.ts';
import type { Reconciliation } from '../core/banking.ts';
import type { Company, Entry, Line } from '../core/company.ts';
import type { Application, Doc } from '../core/documents.ts';
import type { Item } from '../core/items.ts';
import type { Memorized } from '../core/memorized.ts';
import { checkIntegrity } from '../core/integrity.ts';
import { currency } from '../core/money.ts';
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
  try {
    return build(data);
  } catch (e) {
    return bad(`unreadable: ${String(e).slice(0, 60)}`);
  }
}

// Shape first, then the full integrity check the core relies on. Nothing reaches the caller unless
// both pass, so a file can never leave the core holding a state it could not have produced itself.
function build(data: unknown): Result<Company> {
  if (!isObj(data) || data.format !== FORMAT) return bad('format');
  if (data.version !== VERSION) return err('file.version', `This file was saved by a newer version of Daftar (format ${String(data.version)}).`);
  const f = data.company;
  if (!isObj(f)) return bad('company');
  const cur = currency(f.currency);
  if (!cur.ok) return bad('currency');
  if (f.language !== 'en' && f.language !== 'ar') return bad('language');
  const arrays = ['closingDateLog', 'accounts', 'entries', 'parties', 'items', 'documents', 'applications', 'reconciliations', 'cleared', 'memorized'] as const;
  for (const k of arrays) if (!Array.isArray(f[k])) return bad(k);
  if (!isObj(f.counters)) return bad('counters');
  const keyed = <T extends { id: unknown }>(rows: unknown[]): Map<any, T> | null => {
    const m = new Map<any, T>();
    for (const r of rows) {
      if (!isObj(r) || m.has(r.id)) return null;
      m.set(r.id, r as unknown as T);
    }
    return m;
  };
  const accounts = keyed<Account>(f.accounts as unknown[]);
  const parties = keyed<Party>(f.parties as unknown[]);
  const items = keyed<Item>(f.items as unknown[]);
  const documents = keyed<Doc>(f.documents as unknown[]);
  const memorized = keyed<Memorized>(f.memorized as unknown[]);
  if (!accounts || !parties || !items || !documents || !memorized) return bad('duplicate or malformed records');

  const entries: Entry[] = [];
  for (const e of f.entries as unknown[]) {
    if (!isObj(e) || !Array.isArray(e.lines)) return bad('entry');
    const lines = (e.lines as unknown[]).map((l) => {
      if (!isObj(l)) throw new Error('line');
      return Object.freeze({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo, partyId: l.partyId ?? null } as Line);
    });
    const src = e.source;
    entries.push(Object.freeze({
      id: e.id,
      date: e.date,
      memo: e.memo,
      lines: Object.freeze(lines),
      reverses: e.reverses ?? null,
      source: src === null || src === undefined ? null : isObj(src) ? { kind: src.kind, id: src.id } : src,
    } as Entry));
  }
  const cleared = new Map<string, number>();
  for (const pair of f.cleared as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'number') return bad('cleared');
    cleared.set(pair[0], pair[1]);
  }
  const counters = f.counters as Record<string, unknown>;
  const n = (k: string) => counters[k] as number;
  const company: Company = {
    name: f.name as string,
    currency: cur.value,
    language: f.language,
    fiscalYearStartMonth: f.fiscalYearStartMonth as number,
    closingDate: (f.closingDate ?? null) as string | null,
    closingDateLog: f.closingDateLog as Company['closingDateLog'],
    accounts,
    entries,
    parties,
    items,
    documents,
    applications: f.applications as Application[],
    reconciliations: f.reconciliations as Reconciliation[],
    cleared,
    memorized,
    nextAccountId: n('nextAccountId'),
    nextEntryId: n('nextEntryId'),
    nextPartyId: n('nextPartyId'),
    nextItemId: n('nextItemId'),
    nextDocId: n('nextDocId'),
    nextApplicationId: n('nextApplicationId'),
    nextReconciliationId: n('nextReconciliationId'),
    nextMemorizedId: n('nextMemorizedId'),
  };
  const sound = checkIntegrity(company);
  if (!sound.ok) return bad(String(sound.error.details?.what ?? sound.error.message));
  return ok(company);
}
