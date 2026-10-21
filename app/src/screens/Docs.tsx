import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { openBalance, unapplied, type DocKind } from '../../../core/documents.ts';
import { t } from '../i18n.ts';
import { docName, docsName } from '../labels.ts';
import { go, run } from '../state.ts';
import { Empty, Money, ProblemBox, today, useOutcome } from '../ui.tsx';

const NEW_SCREEN: Partial<Record<DocKind, [string, Record<string, unknown>]>> = {
  estimate: ['sales-form', { kind: 'estimate' }],
  invoice: ['sales-form', { kind: 'invoice' }],
  sales_receipt: ['sales-form', { kind: 'sales_receipt' }],
  credit_memo: ['sales-form', { kind: 'credit_memo' }],
  purchase_order: ['purchase-form', { kind: 'purchase_order' }],
  bill: ['purchase-form', { kind: 'bill' }],
  vendor_credit: ['purchase-form', { kind: 'vendor_credit' }],
  expense: ['purchase-form', { kind: 'expense' }],
  payment: ['settle-form', { kind: 'payment' }],
  bill_payment: ['settle-form', { kind: 'bill_payment' }],
  transfer: ['transfer', {}],
};

const OPEN_KINDS = new Set<DocKind>(['invoice', 'bill']);
const CREDIT_KINDS = new Set<DocKind>(['payment', 'credit_memo', 'bill_payment', 'vendor_credit']);

export function Docs({ c, kind }: { c: Company; kind: DocKind }) {
  const out = useOutcome();
  const [confirm, setConfirm] = useState<number | null>(null);
  const docs = [...c.documents.values()].filter((d) => d.kind === kind).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const name = (id: string | null) => (id ? c.parties.get(id)?.name ?? '' : '');
  const act = (id: string, params: Record<string, unknown>) => {
    const r = run(id, params);
    if (!r.ok) out.fail(r.error);
    else out.clear();
    setConfirm(null);
  };
  const newTarget = NEW_SCREEN[kind];
  const showOpen = OPEN_KINDS.has(kind) || CREDIT_KINDS.has(kind);
  return (
    <div>
      <div class="row">
        <h1>{docsName(kind)}</h1>
        <span class="spacer" />
        {newTarget && <button class="primary" onClick={() => go(newTarget[0], newTarget[1])}>{t('New')} · {docName(kind)}</button>}
      </div>
      <ProblemBox p={out.problem} />
      {docs.length === 0 ? <Empty /> : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Date')}</th><th>{t('Number')}</th><th>{t('Name')}</th><th>{t('Memo')}</th>
                <th class="n">{t('Total')}</th>{showOpen && <th class="n">{CREDIT_KINDS.has(kind) ? t('Unapplied') : t('Open balance')}</th>}
                <th>{t('Status')}</th><th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const open = OPEN_KINDS.has(kind) ? openBalance(c, d) : CREDIT_KINDS.has(kind) ? unapplied(c, d) : 0;
                const status = d.voided ? t('Voided') : d.status === 'closed' ? t('Closed') : OPEN_KINDS.has(kind) ? (open === 0 ? t('Paid') : t('Open')) : d.status === 'open' ? t('Open') : '';
                return (
                  <tr key={d.id} class={d.voided ? 'void' : ''}>
                    <td class="num">{d.date}</td>
                    <td>{d.number}</td>
                    <td>{name(d.partyId)}</td>
                    <td class="muted">{d.memo}</td>
                    <td class="n"><Money c={c} value={d.total} /></td>
                    {showOpen && <td class="n"><Money c={c} value={open} blankZero /></td>}
                    <td>{status}</td>
                    <td class="n">
                      {!d.voided && kind === 'estimate' && d.status === 'open' && <button class="small" onClick={() => act('estimate.toInvoice', { docId: d.id, date: today() })}>{t('Convert to invoice')}</button>}
                      {!d.voided && kind === 'purchase_order' && d.status === 'open' && <button class="small" onClick={() => act('purchaseOrder.toBill', { docId: d.id, date: today() })}>{t('Receive as bill')}</button>}
                      {!d.voided && CREDIT_KINDS.has(kind) && open > 0 && (
                        <button class="small" onClick={() => go('apply-credit', { side: kind === 'payment' || kind === 'credit_memo' ? 'customer' : 'vendor', sourceId: d.id })}>{t('Apply credit')}</button>
                      )}{' '}
                      {!d.voided && (confirm === d.id ? (
                        <>
                          <button class="small danger" onClick={() => act('document.void', { docId: d.id })}>{t('Void')} ✓</button>{' '}
                          <button class="small" onClick={() => setConfirm(null)}>{t('Cancel')}</button>
                        </>
                      ) : (
                        <button class="small" onClick={() => setConfirm(d.id)}>{t('Void')}</button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
