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

const state: State = {
  company: null,
  companyId: null,
  route: { screen: 'home' },
  lang: (pref('daftar.lang', navigator.language.startsWith('ar') ? 'ar' : 'en') as Lang),
  theme: (pref('daftar.theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as Theme),
  saving: false,
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

let saveTimer: number | undefined;
function scheduleSave(): void {
  state.saving = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const c = state.company;
    if (c && state.companyId) await storage.save({ id: state.companyId, name: c.name, savedAt: new Date().toISOString(), text: toText(c) });
    state.saving = false;
    notify();
  }, 250);
}

// The one door to the books.
export function run<T = unknown>(id: string, params: Record<string, unknown> = {}): Result<T> {
  const c = state.company;
  if (!c) return { ok: false, error: { code: 'company.none', message: 'No company is open.' } };
  const r = execute(c, id, params) as Result<T>;
  if (r.ok && COMMANDS.get(id)?.mutates) {
    scheduleSave();
    notify();
  }
  return r;
}

export function openCompany(c: Company, id = `c-${Date.now().toString(36)}`): void {
  state.company = c;
  state.companyId = id;
  state.route = { screen: 'home' };
  if (!pref('daftar.lang', '')) {
    state.lang = c.language;
    setLang(c.language);
  }
  scheduleSave();
  notify();
}

export async function openStored(id: string): Promise<Result<Company>> {
  const rec = await storage.load(id);
  if (!rec) return { ok: false, error: { code: 'company.missing', message: 'That company is no longer on this computer.' } };
  const c = fromText(rec.text);
  if (c.ok) {
    state.company = c.value;
    state.companyId = id;
    state.route = { screen: 'home' };
    notify();
  }
  return c;
}

export function closeCompany(): void {
  state.company = null;
  state.companyId = null;
  notify();
}

export const listStored = storage.list;
