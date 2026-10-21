// Use what is left of a payment or credit against more invoices (or bills).

import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { openBalance, unapplied } from '../../../core/documents.ts';
import { formatAmount } from '../../../core/money.ts';
import { t } from '../i18n.ts';
import { docName } from '../labels.ts';
import { go, run } from '../state.ts';
import { AmountInput, DateInput, Field, Money, ProblemBox, badAmount, parseMoney, today, useOutcome } from '../ui.tsx';

export function ApplyCredit({ c, side, sourceId: initial }: { c: Company; side: 'customer' | 'vendor'; sourceId?: number | undefined }) {
  const out = useOutcome();
  const sourceKinds = side === 'customer' ? ['payment', 'credit_memo'] : ['bill_payment', 'vendor_credit'];
  const sources = [...c.documents.values()].filter((d) => sourceKinds.includes(d.kind) && !d.voided && unapplied(c, d) > 0);
  const [sourceId, setSourceId] = useState<number | null>(initial ?? sources[0]?.id ?? null);
  const [date, setDate] = useState(today());
  const [applied, setApplied] = useState<Record<number, string>>({});
  const source = sourceId !== null ? c.documents.get(sourceId) : undefined;
  const targets = source
    ? [...c.documents.values()].filter((d) => d.kind === (side === 'customer' ? 'invoice' : 'bill') && d.partyId === source.partyId && !d.voided && openBalance(c, d) > 0)
    : [];
  const save = () => {
    if (!source) return;
    const bad = badAmount(c, ...Object.values(applied));
    if (bad) return out.fail(bad);
    const applications = Object.entries(applied).map(([id, v]) => ({ docId: Number(id), amount: parseMoney(c, v) })).filter((a) => a.amount);
    const r = run(side === 'customer' ? 'ar.apply' : 'ap.apply', { sourceId: source.id, date, applications });
    if (!r.ok) return out.fail(r.error);
    go('docs', { kind: source.kind });
  };
  return (
    <div>
      <h1>{t('Apply credit')}</h1>
      <div class="card">
        <div class="fields">
          <Field label={t('Credit')} wide>
            <select value={sourceId ?? ''} onChange={(e) => { setSourceId(Number((e.target as HTMLSelectElement).value)); setApplied({}); }}>
              {sources.map((d) => (
                <option key={d.id} value={d.id}>
                  {docName(d.kind)} {d.number} · {c.parties.get(d.partyId ?? '')?.name} · {formatAmount(unapplied(c, d), c.currency)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Date')}><DateInput value={date} onInput={setDate} /></Field>
        </div>
        {source && (
          <div class="table-wrap">
            <table>
              <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th class="n">{t('Open balance')}</th><th class="n">{t('Apply')}</th></tr></thead>
              <tbody>
                {targets.map((d) => (
                  <tr key={d.id}>
                    <td>{d.number}</td>
                    <td class="num">{d.date}</td>
                    <td class="n"><Money c={c} value={openBalance(c, d)} /></td>
                    <td style={{ width: '150px' }}>
                      <AmountInput c={c} value={applied[d.id] ?? ''} onInput={(v) => setApplied({ ...applied, [d.id]: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ProblemBox p={out.problem} />
        <div class="row" style={{ marginTop: 'var(--s3)' }}><button class="primary" onClick={save} disabled={!source}>{t('Apply')}</button></div>
      </div>
    </div>
  );
}
