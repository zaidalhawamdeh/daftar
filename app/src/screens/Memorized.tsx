import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import type { Memorized as M } from '../../../core/memorized.ts';
import { t } from '../i18n.ts';
import { run } from '../state.ts';
import { DateInput, Empty, Field, ProblemBox, today, useOutcome } from '../ui.tsx';

const FREQ: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export function Memorized({ c }: { c: Company }) {
  const out = useOutcome();
  const [asOf, setAsOf] = useState(today());
  const [runDate, setRunDate] = useState(today());
  const list = [...c.memorized.values()].sort((a, b) => a.name.localeCompare(b.name));
  const act = (id: string, params: Record<string, unknown>, done?: (v: unknown) => string) => {
    const r = run(id, params);
    if (!r.ok) return out.fail(r.error);
    out.succeed(done ? done(r.value) : '✓');
  };
  return (
    <div>
      <h1>{t('Memorized transactions')}</h1>
      <div class="card" style={{ marginBottom: 'var(--s4)' }}>
        <div class="row">
          <Field label={t('As of')}><DateInput value={asOf} onInput={setAsOf} /></Field>
          <button class="primary" style={{ alignSelf: 'flex-end' }} onClick={() => act('memorized.runDue', { asOf }, (v) => `✓ ${(v as unknown[]).length}`)}>{t('Enter due transactions')}</button>
          <span class="spacer" />
          <Field label={t('Date')}><DateInput value={runDate} onInput={setRunDate} /></Field>
        </div>
        <ProblemBox p={out.problem} />
        {out.notice && <div class="notice" role="status">{out.notice}</div>}
      </div>
      {list.length === 0 ? <Empty /> : (
        <div class="table-wrap">
          <table>
            <thead><tr><th>{t('Name')}</th><th>{t('Type')}</th><th>{t('Frequency')}</th><th>{t('Next date')}</th><th>{t('End date')}</th><th>{t('Status')}</th><th /></tr></thead>
            <tbody>
              {list.map((m: M) => (
                <tr key={m.id} class={m.active ? '' : 'void'}>
                  <td>{m.name}</td>
                  <td class="muted">{m.command.split('.')[0]}</td>
                  <td>{m.frequency ? t(FREQ[m.frequency]!) : t('Not scheduled')}</td>
                  <td class="num">{m.nextDate ?? ''}</td>
                  <td class="num">{m.endDate ?? ''}</td>
                  <td>{m.active ? t('Active') : t('Inactive')}</td>
                  <td class="n">
                    <button class="small" onClick={() => act('memorized.run', { id: m.id, date: runDate })}>{t('Enter now')}</button>{' '}
                    {m.frequency && <button class="small" onClick={() => act('memorized.setActive', { id: m.id, active: !m.active })}>{m.active ? t('Pause') : t('Resume')}</button>}{' '}
                    <button class="small danger" onClick={() => act('memorized.delete', { id: m.id })}>{t('Delete')}</button>
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
