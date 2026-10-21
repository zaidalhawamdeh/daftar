// Building blocks shared by every screen.

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Account, AccountType } from '../../core/accounts.ts';
import type { Company } from '../../core/company.ts';
import type { Item } from '../../core/items.ts';
import { formatAmount, parseAmount, type Minor } from '../../core/money.ts';
import type { Party, PartyKind } from '../../core/parties.ts';
import type { Problem } from '../../core/result.ts';
import { problemText, t } from './i18n.ts';

// The person's own calendar day: in Amman at 01:30 on 1 April it is 1 April, not UTC's 31 March.
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Amount fields that hold something other than an amount stop the save, never become zero.
export function badAmount(c: Company, ...texts: string[]): Problem | null {
  for (const text of texts) if (text.trim() && parseMoney(c, text) === null) return { code: 'amount.invalid', message: `"${text}" is not an amount.` };
  return null;
}

export function Money({ c, value, blankZero = false }: { c: Company; value: Minor; blankZero?: boolean }) {
  if (blankZero && value === 0) return <span />;
  return <span class={`num${value < 0 ? ' neg' : ''}`}>{formatAmount(value, c.currency)}</span>;
}

export function ProblemBox({ p }: { p: Problem | null }) {
  if (!p) return null;
  return (
    <div class="problem" role="alert">
      {problemText(p)}
    </div>
  );
}

export function Field({ label, wide, children }: { label: string; wide?: boolean; children: ComponentChildren }) {
  return (
    <label class={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// Text in, minor units out. Arabic digits and separators are accepted; nothing is rounded.
export function parseMoney(c: Company, text: string): Minor | null {
  if (!text.trim()) return null;
  const r = parseAmount(text, c.currency);
  return r.ok ? r.value : null;
}

export function AmountInput({ c, value, onInput, label }: { c: Company; value: string; onInput: (v: string) => void; label?: string }) {
  const invalid = value.trim() !== '' && parseMoney(c, value) === null;
  return (
    <input
      class="amount"
      inputMode="decimal"
      value={value}
      aria-label={label}
      aria-invalid={invalid}
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      placeholder={formatAmount(0, c.currency)}
    />
  );
}

const typeOrder = (a: Account, b: Account) => (a.number || '~').localeCompare(b.number || '~', 'en', { numeric: true }) || a.name.localeCompare(b.name);

export function AccountSelect({ c, value, onChange, types, exclude, allowNone, label }: {
  c: Company;
  value: string;
  onChange: (v: string) => void;
  types?: AccountType[];
  exclude?: AccountType[];
  allowNone?: boolean;
  label?: string;
}) {
  const options = [...c.accounts.values()].filter((a) => a.active && (!types || types.includes(a.type)) && (!exclude || !exclude.includes(a.type))).sort(typeOrder);
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{allowNone ? t('None') : t('Choose…')}</option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>
          {a.number ? `${a.number} · ` : ''}
          {a.name}
        </option>
      ))}
    </select>
  );
}

export function PartySelect({ c, kind, value, onChange, allowNone }: { c: Company; kind: PartyKind; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const options = [...c.parties.values()].filter((p: Party) => p.kind === kind && p.active).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select value={value} aria-label={t(kind === 'customer' ? 'Customer' : 'Vendor')} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{allowNone ? t('None') : t('Choose…')}</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function ItemSelect({ c, side, value, onChange }: { c: Company; side: 'sales' | 'purchase'; value: string; onChange: (v: string) => void }) {
  const options = [...c.items.values()].filter((i: Item) => i.active && (side === 'sales' ? i.salesAccountId : i.purchaseAccountId)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select value={value} aria-label={t('Item')} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{t('Item')}…</option>
      {options.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </select>
  );
}

export function DateInput({ value, onInput, label }: { value: string; onInput: (v: string) => void; label?: string }) {
  return <input type="date" value={value} aria-label={label} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />;
}

export function Empty() {
  return <p class="muted">{t('Nothing here yet.')}</p>;
}

// A small hook for "save, then show what went wrong or that it worked".
export function useOutcome() {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return {
    problem,
    notice,
    fail: (p: Problem) => {
      setNotice(null);
      setProblem(p);
    },
    succeed: (msg: string) => {
      setProblem(null);
      setNotice(msg);
    },
    clear: () => {
      setProblem(null);
      setNotice(null);
    },
  };
}
