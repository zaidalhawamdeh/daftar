// The open company and the interface state. Every change to the books goes through `run`, which
// calls the core's `execute` and, when the command changed something, saves the company.

import { useEffect, useState } from 'preact/hooks';
import { COMMANDS, execute } from '../../core/commands.ts';
import type { Company } from '../../core/company.ts';
import type { Result } from '../../core/result.ts';
import { fromText, toText } from '../../store/serialize.ts';
import { setLang, type Lang } from './i18n.ts';
import * as storage from './storage.ts';

export type Theme = 'light' | 'dark';

export interface Route {
  screen: string;
  params?: Record<string, unknown>;
}

interface State {
  company: Company | null;
  companyId: string | null;
  route: Route;
  lang: Lang;
  theme: Theme;
  saving: boolean;
  saveError: string | null; // the last save failed; shown until a save succeeds
  elsewhere: boolean; // this company was changed in another tab; this tab stops writing
  version: number; // bumps on every change so screens re-read the books
}

const pref = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: preferences simply are not kept */
  }
};

// A link may name the language (the Arabic page on the website opens the app with ?lang=ar). It is
// only a default: a language the person chose here always wins.
const asked = new URLSearchParams(location.search).get('lang');
const linkLang: Lang | null = asked === 'ar' || asked === 'en' ? asked : null;

const state: State = {
  company: null,
  companyId: null,
  route: { screen: 'home' },
  lang: (pref('daftar.lang', linkLang ?? (navigator.language.startsWith('ar') ? 'ar' : 'en')) as Lang),
  theme: (pref('daftar.theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as Theme),
  saving: false,
  saveError: null,
  elsewhere: false,
  version: 0,
};

const listeners = new Set<() => void>();
const notify = () => {
  state.version++;
  for (const l of listeners) l();
};

export function useApp(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}

export function applyPreferences(): void {
  setLang(state.lang);
  document.documentElement.dataset.theme = state.theme;
}

export function setLanguage(l: Lang): void {
  state.lang = l;
  remember('daftar.lang', l);
  setLang(l);
  notify();
}

export function setTheme(t: Theme): void {
  state.theme = t;
  remember('daftar.theme', t);
  document.documentElement.dataset.theme = t;
  notify();
}

export function go(screen: string, params?: Record<string, unknown>): void {
  state.route = params ? { screen, params } : { screen };
  notify();
  window.scrollTo(0, 0);
}

// Saving. Changes are written shortly after they happen; anything pending is written before the
// company is closed or switched, and the page warns before it is closed with work unsaved. Two tabs
// on one company would overwrite each other, so a tab that sees another tab save stops writing.
const tabId = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('daftar') : null;
channel?.addEventListener('message', (e: MessageEvent<{ id: string; tab: string }>) => {
  if (e.data?.id === state.companyId && e.data.tab !== tabId) {
    state.elsewhere = true;
    notify();
  }
});

let saveTimer: number | undefined;
let pending: { id: string; text: string; name: string } | null = null;
let inFlight = 0;

async function writePending(): Promise<void> {
  window.clearTimeout(saveTimer);
  const job = pending;
  pending = null;
  if (!job) return;
  inFlight++;
  try {
    await storage.save({ id: job.id, name: job.name, savedAt: new Date().toISOString(), text: job.text });
    channel?.postMessage({ id: job.id, tab: tabId });
    state.saveError = null;
  } catch (e) {
    state.saveError = String((e as Error)?.message ?? e);
    pending = pending ?? job; // keep it for the next try
  } finally {
    inFlight--;
    state.saving = pending !== null || inFlight > 0;
    notify();
  }
}

function scheduleSave(): void {
  const c = state.company;
  if (!c || !state.companyId) return;
  // Capture the text now: a later switch of company can never write this company under another id.
  pending = { id: state.companyId, name: c.name, text: toText(c) };
  state.saving = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void writePending(), 250);
}

export const flush = writePending;

window.addEventListener('beforeunload', (e) => {
  if (pending || inFlight) {
    void writePending();
    e.preventDefault();
  }
});
window.addEventListener('pagehide', () => void writePending());

// The one door to the books.
export function run<T = unknown>(id: string, params: Record<string, unknown> = {}): Result<T> {
  const c = state.company;
  if (!c) return { ok: false, error: { code: 'company.none', message: 'No company is open.' } };
  if (state.elsewhere && COMMANDS.get(id)?.mutates) {
    return { ok: false, error: { code: 'company.elsewhere', message: 'This company was changed in another tab. Reload to continue here.' } };
  }
  const r = execute(c, id, params) as Result<T>;
  if (r.ok && COMMANDS.get(id)?.mutates) {
    scheduleSave();
    notify();
  }
  return r;
}

// Run a command on a copy of the books to see what it would do. Nothing is changed or saved.
export function preview<T = unknown>(id: string, params: Record<string, unknown> = {}): Result<T> {
  const c = state.company;
  if (!c) return { ok: false, error: { code: 'company.none', message: 'No company is open.' } };
  return execute(structuredClone(c), id, params) as Result<T>;
}

export async function openCompany(c: Company, id = `c-${Date.now().toString(36)}`): Promise<void> {
  await writePending();
  state.company = c;
  state.elsewhere = false;
  state.companyId = id;
  state.route = { screen: 'home' };
  if (!pref('daftar.lang', '') && !linkLang) {
    state.lang = c.language;
    setLang(c.language);
  }
  scheduleSave();
  notify();
}

export async function openStored(id: string): Promise<Result<Company>> {
  await writePending();
  const rec = await storage.load(id);
  if (!rec) return { ok: false, error: { code: 'company.missing', message: 'That company is no longer on this computer.' } };
  const c = fromText(rec.text);
  if (c.ok) {
    state.company = c.value;
    state.companyId = id;
    state.elsewhere = false;
    state.route = { screen: 'home' };
    notify();
  }
  return c;
}

export async function closeCompany(): Promise<void> {
  await writePending();
  state.company = null;
  state.companyId = null;
  notify();
}

// Put an earlier version back as the current state of the open company. The version being replaced
// is saved first, so this too can be undone.
export async function restoreBackup(key: number): Promise<Result<Company>> {
  const rec = await storage.loadBackup(key);
  if (!rec || rec.id !== state.companyId) return { ok: false, error: { code: 'backup.missing', message: 'That version is no longer available.' } };
  const c = fromText(rec.text);
  if (!c.ok) return c;
  await writePending();
  state.company = c.value;
  scheduleSave();
  notify();
  return c;
}

export const listStored = storage.list;
export const listBackups = storage.listBackups;
