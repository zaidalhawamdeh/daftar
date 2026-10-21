// Receive a payment from a customer, or pay a vendor's bills: choose the name, tick what it settles.

import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { openBalance } from '../../../core/documents.ts';
import { formatAmount } from '../../../core/money.ts';
import { t } from '../i18n.ts';
import { docName } from '../labels.ts';
import { go, run } from '../state.ts';
import { AccountSelect, AmountInput, DateInput, Field, Money, PartySelect, ProblemBox, badAmount, parseMoney, today, useOutcome } from '../ui.tsx';

export function Settle({ c, kind }: { c: Company; kind: 'payment' | 'bill_payment' }) {
  const customer = kind === 'payment';
  const out = useOutcome();
  const [partyId, setPartyId] = useState('');
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [applied, setApplied] = useState<Record<number, string>>({});
  const open = [...c.documents.values()]
    .filter((d) => d.kind === (customer ? 'invoice' : 'bill') && d.partyId === partyId && !d.voided && d.date <= date)
    .map((d) => ({ d, open: openBalance(c, d) }))
    .filter((x) => x.open > 0)
    .sort((a, b) => ((a.d.dueDate ?? '') < (b.d.dueDate ?? '') ? -1 : 1));
  const appliedTotal = Object.values(applied).reduce((s, v) => s + (parseMoney(c, v) ?? 0), 0);
  const fmt = (m: number) => formatAmount(m, c.currency, { grouping: false });

  const toggle = (id: number, max: number) => {
    const next = { ...applied };
    if (next[id] !== undefined) delete next[id];
    else next[id] = fmt(max);
    setApplied(next);
  };
  const save = () => {
    const bad = badAmount(c, amount, ...Object.values(applied));
    if (bad) return out.fail(bad);
    const total = amount.trim() ? parseMoney(c, amount) : appliedTotal;
    if (total === null) return out.fail({ code: 'amount.invalid', message: `"${amount}" is not an amount.` });
    const applications = Object.entries(applied).map(([id, v]) => ({ docId: Number(id), amount: parseMoney(c, v) })).filter((a) => a.amount);
    const r = run(customer ? 'payment.receive' : 'bill.pay', {
      ...(customer ? { customerId: partyId, depositToId: account } : { vendorId: partyId, payFromId: account }),
      date,
      amount: total,
      memo,
      applications,
    });
    if (!r.ok) return out.fail(r.error);
    go('docs', { kind });
  };

  return (
    <div>
      <div class="row">
        <h1>{t(customer ? 'Receive payments' : 'Pay bills')}</h1>
        <span class="spacer" />
        <button onClick={() => go('docs', { kind })}>{t(customer ? 'Payments' : 'Bill payment')}</button>
      </div>
      <div class="card">
        <div class="fields">
          <Field label={t(customer ? 'Customer' : 'Vendor')} wide>
            <PartySelect c={c} kind={customer ? 'customer' : 'vendor'} value={partyId} onChange={(v) => { setPartyId(v); setApplied({}); }} />
          </Field>
          <Field label={t(customer ? 'Deposit to' : 'Pay from')}>
            <AccountSelect c={c} value={account} onChange={setAccount} types={customer ? ['bank', 'other_current_asset'] : ['bank', 'credit_card']} />
          </Field>
          <Field label={t('Date')}><DateInput value={date} onInput={setDate} /></Field>
          <Field label={t('Amount')}><AmountInput c={c} value={amount} onInput={setAmount} /></Field>
        </div>
        {partyId && (
          <div class="table-wrap">
            <table>
              <thead><tr><th /><th>{docName(customer ? 'invoice' : 'bill')}</th><th>{t('Date')}</th><th>{t('Due date')}</th><th class="n">{t('Total')}</th><th class="n">{t('Open balance')}</th><th class="n">{t('Apply')}</th></tr></thead>
              <tbody>
                {open.length === 0 && <tr><td colSpan={7} class="muted">{t('Nothing here yet.')}</td></tr>}
                {open.map(({ d, open: o }) => (
                  <tr key={d.id}>
                    <td><input type="checkbox" checked={applied[d.id] !== undefined} aria-label={d.number} onChange={() => toggle(d.id, o)} /></td>
                    <td>{d.number}</td>
                    <td class="num">{d.date}</td>
                    <td class="num">{d.dueDate}</td>
                    <td class="n"><Money c={c} value={d.total} /></td>
                    <td class="n"><Money c={c} value={o} /></td>
                    <td style={{ width: '150px' }}>{applied[d.id] !== undefined && <AmountInput c={c} value={applied[d.id]!} onInput={(v) => setApplied({ ...applied, [d.id]: v })} />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={6}>{t('Applied')}</td><td class="n"><Money c={c} value={appliedTotal} /></td></tr></tfoot>
            </table>
          </div>
        )}
        <div class="fields" style={{ marginTop: 'var(--s3)' }}>
          <Field label={t('Memo')} wide><input value={memo} onInput={(e) => setMemo((e.target as HTMLInputElement).value)} /></Field>
        </div>
        <ProblemBox p={out.problem} />
        <div class="row"><button class="primary" onClick={save}>{t('Save')}</button></div>
      </div>
    </div>
  );
}
