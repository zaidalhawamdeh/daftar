import { useState } from 'preact/hooks';
import { ACCOUNT_TYPES, normalSide, type Account, type AccountType } from '../../../core/accounts.ts';
import type { Company } from '../../../core/company.ts';
import { balancesBetween } from '../../../core/reports.ts';
import { t } from '../i18n.ts';
import { typeName } from '../labels.ts';
import { run } from '../state.ts';
import { AccountSelect, Field, Money, ProblemBox, today, useOutcome } from '../ui.tsx';

const TYPES = (Object.keys(ACCOUNT_TYPES) as AccountType[]).sort((a, b) => ACCOUNT_TYPES[a].order - ACCOUNT_TYPES[b].order);

export function Accounts({ c }: { c: Company }) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const bal = balancesBetween(c, null, today());
  const depth = (a: Account): number => (a.parentId ? 1 + depth(c.accounts.get(a.parentId)!) : 0);
  // Tree order: each account followed by its sub-accounts.
  const ordered: Account[] = [];
  const kids = (pid: string | null) =>
    [...c.accounts.values()]
      .filter((a) => a.parentId === pid && (showInactive || a.active))
      .sort((a, b) => ACCOUNT_TYPES[a.type].order - ACCOUNT_TYPES[b.type].order || (a.number || '~').localeCompare(b.number || '~', 'en', { numeric: true }));
  const walk = (pid: string | null) => kids(pid).forEach((a) => (ordered.push(a), walk(a.id)));
  walk(null);
  const balanceOf = (a: Account) => {
    const v = bal.ok ? (bal.value.get(a.id) ?? 0) : 0;
    return normalSide(a.type) === 'debit' || v === 0 ? v : -v;
  };

  return (
    <div>
      <div class="row">
        <h1>{t('Chart of accounts')}</h1>
        <span class="spacer" />
        <label class="check"><input type="checkbox" checked={showInactive} onChange={() => setShowInactive(!showInactive)} /> {t('Show inactive')}</label>
        <button class="primary" onClick={() => setEditing('new')}>{t('New')}</button>
      </div>
      {editing && <AccountForm c={c} account={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>{t('Number')}</th><th>{t('Name')}</th><th>{t('Type')}</th><th class="n">{t('Balance')}</th><th /></tr>
          </thead>
          <tbody>
            {ordered.map((a) => (
              <tr key={a.id} class={a.active ? '' : 'void'}>
                <td class="num">{a.number}</td>
                <td class={`indent${Math.min(depth(a), 3)}`}>{a.name}</td>
                <td class="muted">{typeName(a.type)}</td>
                <td class="n"><Money c={c} value={balanceOf(a)} blankZero /></td>
                <td class="n">
                  <button class="small" onClick={() => setEditing(a)}>{t('Edit')}</button>{' '}
                  {!a.role && (
                    <button class="small" onClick={() => run('account.setActive', { id: a.id, active: !a.active })}>
                      {a.active ? t('Make inactive') : t('Make active')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountForm({ c, account, onDone }: { c: Company; account: Account | null; onDone: () => void }) {
  const out = useOutcome();
  const [name, setName] = useState(account?.name ?? '');
  const [number, setNumber] = useState(account?.number ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'expense');
  const [parentId, setParentId] = useState(account?.parentId ?? '');
  const save = (e: Event) => {
    e.preventDefault();
    const params = { name, number, type, parentId: parentId || null };
    const r = account ? run('account.update', { id: account.id, ...params }) : run('account.create', params);
    if (!r.ok) return out.fail(r.error);
    onDone();
  };
  const sameClass = TYPES.filter((x) => ACCOUNT_TYPES[x].class === ACCOUNT_TYPES[type].class);
  return (
    <form class="card" style={{ marginBottom: 'var(--s4)' }} onSubmit={save}>
      <div class="fields">
        <Field label={t('Name')} wide><input value={name} required onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label={t('Number')}><input value={number} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} /></Field>
        <Field label={t('Type')}>
          <select value={type} disabled={!!account?.role} onChange={(e) => setType((e.target as HTMLSelectElement).value as AccountType)}>
            {TYPES.map((x) => <option key={x} value={x}>{typeName(x)}</option>)}
          </select>
        </Field>
        <Field label={t('Parent account')}>
          <AccountSelect c={c} value={parentId} onChange={setParentId} types={sameClass} allowNone />
        </Field>
      </div>
      <ProblemBox p={out.problem} />
      <div class="row">
        <button class="primary" type="submit">{t('Save')}</button>
        <button type="button" onClick={onDone}>{t('Cancel')}</button>
      </div>
    </form>
  );
}
