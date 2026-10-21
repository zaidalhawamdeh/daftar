import { useState } from 'preact/hooks';
import type { ClearableLine } from '../../../core/banking.ts';
import type { Company } from '../../../core/company.ts';
import { t } from '../i18n.ts';
import { docName } from '../labels.ts';
import { run } from '../state.ts';
import { AccountSelect, AmountInput, DateInput, Field, Money, ProblemBox, parseMoney, today, useOutcome } from '../ui.tsx';

export function Reconcile({ c }: { c: Company }) {
  const out = useOutcome();
  const [accountId, setAccountId] = useState('');
  const [statementDate, setStatementDate] = useState(today());
  const [ending, setEnding] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const cand = accountId ? run<{ beginningBalance: number; lines: ClearableLine[] }>('bank.candidates', { accountId, statementDate }) : null;
  const lines = cand?.ok ? cand.value.lines : [];
  const beginning = cand?.ok ? cand.value.beginningBalance : 0;
  const cleared = lines.filter((l) => ticked.has(l.key)).reduce((s, l) => s + l.amount, 0);
  const endingMinor = parseMoney(c, ending);
  const difference = endingMinor === null ? null : endingMinor - beginning - cleared;
  const history = c.reconciliations.filter((r) => r.accountId === accountId && !r.undone);

  const toggle = (k: string) => {
    const n = new Set(ticked);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setTicked(n);
  };
  const finish = () => {
    const r = run('bank.reconcile', { accountId, statementDate, endingBalance: endingMinor, lineKeys: [...ticked] });
    if (!r.ok) return out.fail(r.error);
    setTicked(new Set());
    setEnding('');
    out.succeed(t('Reconciled.'));
  };
  const undo = () => {
    const r = run('bank.undoReconciliation', { accountId });
    if (!r.ok) out.fail(r.error);
    else out.clear();
  };
  return (
    <div>
      <h1>{t('Reconcile')}</h1>
      <div class="card">
        <div class="fields">
          <Field label={t('Account')} wide><AccountSelect c={c} value={accountId} onChange={(v) => { setAccountId(v); setTicked(new Set()); }} types={['bank', 'credit_card']} /></Field>
          <Field label={t('Statement date')}><DateInput value={statementDate} onInput={setStatementDate} /></Field>
          <Field label={t('Statement ending balance')}><AmountInput c={c} value={ending} onInput={setEnding} /></Field>
        </div>
        {accountId && (
          <>
            <p class="muted">{t('Tick every line that appears on your statement.')}</p>
            <div class="table-wrap">
              <table>
                <thead><tr><th /><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Number')}</th><th>{t('Memo')}</th><th class="n">{t('Amount')}</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td><input type="checkbox" checked={ticked.has(l.key)} aria-label={`${l.date} ${l.memo}`} onChange={() => toggle(l.key)} /></td>
                      <td class="num">{l.date}</td>
                      <td>{l.kind === 'journal' ? t('Journal entry') : l.kind === 'void' ? t('Voided') : docName(l.kind as never)}</td>
                      <td>{l.number}</td>
                      <td class="muted">{l.memo}</td>
                      <td class="n"><Money c={c} value={l.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div class="cards" style={{ marginTop: 'var(--s4)' }}>
              <div class="card stat"><div class="label">{t('Beginning balance')}</div><div class="value"><Money c={c} value={beginning} /></div></div>
              <div class="card stat"><div class="label">{t('Cleared')}</div><div class="value"><Money c={c} value={cleared} /></div></div>
              <div class="card stat"><div class="label">{t('Difference')}</div><div class="value">{difference === null ? '—' : <Money c={c} value={difference} />}</div></div>
            </div>
            <ProblemBox p={out.problem} />
            {out.notice && <div class="notice" role="status">{out.notice}</div>}
            <div class="row">
              <button class="primary" onClick={finish} disabled={difference !== 0}>{t('Finish reconciliation')}</button>
              <span class="spacer" />
              {history.length > 0 && <button onClick={undo}>{t('Undo last reconciliation')} ({history.at(-1)!.statementDate})</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
