import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import type { Party, PartyKind } from '../../../core/parties.ts';
import { partyBalances } from '../../../core/subledger.ts';
import { t } from '../i18n.ts';
import { go, run } from '../state.ts';
import { Empty, Field, Money, ProblemBox, today, useOutcome } from '../ui.tsx';

export function Parties({ c, kind }: { c: Company; kind: PartyKind }) {
  const [editing, setEditing] = useState<Party | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const bal = partyBalances(c, kind, today());
  const balanceOf = (id: string) => (bal.ok ? (bal.value.rows.find((r) => r.partyId === id)?.balance ?? 0) : 0);
  const rows = [...c.parties.values()].filter((p) => p.kind === kind && (showInactive || p.active)).sort((a, b) => a.name.localeCompare(b.name));
  const title = kind === 'customer' ? 'Customer list' : 'Vendor list';
  return (
    <div>
      <div class="row">
        <h1>{t(title)}</h1>
        <span class="spacer" />
        <label class="check"><input type="checkbox" checked={showInactive} onChange={() => setShowInactive(!showInactive)} /> {t('Show inactive')}</label>
        <button class="primary" onClick={() => setEditing('new')}>{t('New')}</button>
      </div>
      {editing && <PartyForm kind={kind} party={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      {rows.length === 0 ? <Empty /> : (
        <div class="table-wrap">
          <table>
            <thead><tr><th>{t('Name')}</th><th>{t('Phone')}</th><th>{t('Email')}</th><th class="n">{t('Terms (days)')}</th><th class="n">{t('Balance')}</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} class={p.active ? '' : 'void'}>
                  <td>{p.name}</td>
                  <td class="num">{p.phone}</td>
                  <td>{p.email}</td>
                  <td class="n num">{p.termsDays}</td>
                  <td class="n"><Money c={c} value={balanceOf(p.id)} blankZero /></td>
                  <td class="n">
                    <button class="small" onClick={() => go(kind === 'customer' ? 'sales-form' : 'purchase-form', { kind: kind === 'customer' ? 'invoice' : 'bill', partyId: p.id })}>
                      {t(kind === 'customer' ? 'Invoice' : 'Bill')}
                    </button>{' '}
                    <button class="small" onClick={() => setEditing(p)}>{t('Edit')}</button>{' '}
                    <button class="small" onClick={() => run(`${kind}.setActive`, { id: p.id, active: !p.active })}>{p.active ? t('Make inactive') : t('Make active')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PartyForm({ kind, party, onDone }: { kind: PartyKind; party: Party | null; onDone: () => void }) {
  const out = useOutcome();
  const [f, setF] = useState({
    name: party?.name ?? '',
    companyName: party?.companyName ?? '',
    phone: party?.phone ?? '',
    email: party?.email ?? '',
    address: party?.address ?? '',
    trn: party?.trn ?? '',
    termsDays: String(party?.termsDays ?? 0),
    notes: party?.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const save = (e: Event) => {
    e.preventDefault();
    const params = { ...f, termsDays: Number(f.termsDays) || 0 };
    const r = party ? run(`${kind}.update`, { id: party.id, ...params }) : run(`${kind}.create`, params);
    if (!r.ok) return out.fail(r.error);
    onDone();
  };
  return (
    <form class="card" style={{ marginBottom: 'var(--s4)' }} onSubmit={save}>
      <div class="fields">
        <Field label={t('Name')} wide><input value={f.name} required onInput={set('name')} /></Field>
        <Field label={t('Phone')}><input value={f.phone} onInput={set('phone')} /></Field>
        <Field label={t('Email')}><input type="email" value={f.email} onInput={set('email')} /></Field>
        <Field label={t('Terms (days)')}><input type="number" min="0" value={f.termsDays} onInput={set('termsDays')} /></Field>
        <Field label={t('Address')} wide><input value={f.address} onInput={set('address')} /></Field>
        <Field label={t('Tax Registration Number (TRN)')}><input value={f.trn} inputMode="numeric" placeholder="100…" onInput={set('trn')} /></Field>
        <Field label={t('Notes')} wide><input value={f.notes} onInput={set('notes')} /></Field>
      </div>
      <ProblemBox p={out.problem} />
      <div class="row">
        <button class="primary" type="submit">{t('Save')}</button>
        <button type="button" onClick={onDone}>{t('Cancel')}</button>
      </div>
    </form>
  );
}
