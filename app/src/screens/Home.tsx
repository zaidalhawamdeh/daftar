import type { Company } from '../../../core/company.ts';
import { fiscalYearStart } from '../../../core/dates.ts';
import { balancesBetween, profitAndLoss } from '../../../core/reports.ts';
import { aging, partyBalances } from '../../../core/subledger.ts';
import { t } from '../i18n.ts';
import { go } from '../state.ts';
import { Money, today } from '../ui.tsx';

export function Home({ c }: { c: Company }) {
  const d = today();
  const bal = balancesBetween(c, null, d);
  const cash = bal.ok ? [...c.accounts.values()].filter((a) => a.type === 'bank').reduce((s, a) => s + (bal.value.get(a.id) ?? 0), 0) : 0;
  const ar = partyBalances(c, 'customer', d);
  const ap = partyBalances(c, 'vendor', d);
  const pl = profitAndLoss(c, fiscalYearStart(d, c.fiscalYearStartMonth), d);
  const ag = aging(c, 'customer', d);
  const overdue = ag.ok ? ag.value.items.filter((i) => i.kind === 'invoice' && i.daysPastDue > 0) : [];
  const stats: [string, number][] = [
    ['Cash in bank', cash],
    ['Customers owe you', ar.ok ? ar.value.total : 0],
    ['You owe vendors', ap.ok ? ap.value.total : 0],
    ['Profit this year', pl.ok ? pl.value.netIncome : 0],
  ];
  return (
    <div>
      <h1>{c.name}</h1>
      <div class="cards">
        {stats.map(([label, v]) => (
          <div class="card stat" key={label}>
            <div class="label">{t(label)}</div>
            <div class="value"><Money c={c} value={v} /></div>
          </div>
        ))}
      </div>
      <h2>{t('Quick actions')}</h2>
      <div class="row">
        <button class="primary" onClick={() => go('sales-form', { kind: 'invoice' })}>{t('Invoice')}</button>
        <button onClick={() => go('settle-form', { kind: 'payment' })}>{t('Receive payments')}</button>
        <button onClick={() => go('purchase-form', { kind: 'bill' })}>{t('Bill')}</button>
        <button onClick={() => go('settle-form', { kind: 'bill_payment' })}>{t('Pay bills')}</button>
        <button onClick={() => go('purchase-form', { kind: 'expense' })}>{t('Expense')}</button>
        <button onClick={() => go('reconcile')}>{t('Reconcile')}</button>
        <button onClick={() => go('reports', { report: 'profitAndLoss' })}>{t('Reports')}</button>
      </div>
      <h2>{t('Overdue invoices')} ({overdue.length})</h2>
      {overdue.length > 0 && (
        <div class="table-wrap">
          <table>
            <thead><tr><th>{t('Customer')}</th><th>{t('Number')}</th><th>{t('Due date')}</th><th class="n">{t('Open balance')}</th></tr></thead>
            <tbody>
              {overdue.map((i) => (
                <tr key={i.docId}><td>{i.name}</td><td>{i.number}</td><td>{i.dueDate}</td><td class="n"><Money c={c} value={i.open} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
