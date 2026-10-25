// A document ready to print or save as PDF from the browser. For a VAT-registered company an invoice
// or sales receipt prints as a full tax invoice (Executive Regulation Article 59(1)) and a credit memo
// as a tax credit note (Article 60): the supplier's and the recipient's name, address and TRN, a
// sequential number, the date, per line the unit price, quantity, value excluding VAT, rate and VAT,
// and the totals in AED.

import type { Company } from '../../../core/company.ts';
import type { Doc } from '../../../core/documents.ts';
import { formatQuantity } from '../../../core/quantity.ts';
import { VAT_PERCENT, docTax, lineNet } from '../../../core/vat.ts';
import { lang, t } from '../i18n.ts';
import { docName } from '../labels.ts';
import { go } from '../state.ts';
import { Money } from '../ui.tsx';

const L = (en: string, ar: string) => (lang() === 'ar' ? ar : en);

// A tax invoice or tax credit note is for a taxable supply (standard or zero-rated) by a registrant;
// documents from before the registration, or wholly exempt or out of scope, are plain invoices.
const taxable = (d: Doc) => d.lines.some((l) => l.taxCode === 'SR' || l.taxCode === 'ZR');

function title(c: Company, d: Doc): [string, string] {
  if (c.vat && taxable(d) && (d.kind === 'invoice' || d.kind === 'sales_receipt')) return ['Tax Invoice', 'فاتورة ضريبية'];
  if (c.vat && taxable(d) && d.kind === 'credit_memo') return ['Tax Credit Note', 'إشعار دائن ضريبي'];
  if (d.kind === 'estimate') return ['Quotation', 'عرض سعر'];
  return [docName(d.kind), docName(d.kind)];
}

export const PRINTABLE = new Set(['estimate', 'invoice', 'sales_receipt', 'credit_memo']);

export function PrintDoc({ c, docId }: { c: Company; docId: number }) {
  const d = c.documents.get(docId);
  if (!d || !PRINTABLE.has(d.kind)) return <p class="muted">{t('Nothing here yet.')}</p>;
  const party = d.partyId ? c.parties.get(d.partyId) : undefined;
  const [en, ar] = title(c, d);
  const sums = docTax(d);
  const vatOn = !!c.vat && d.lines.some((l) => l.taxCode !== null);
  const ref = d.refId !== null ? c.documents.get(d.refId) : undefined;
  const refNet = ref ? docTax(ref).net : 0;
  // Earlier credits against the same invoice already lowered its value (Art. 60(1)(e)).
  const before = ref ? [...c.documents.values()].filter((x) => x.refId === ref.id && !x.voided && x.id !== d.id && (x.date < d.date || (x.date === d.date && x.id < d.id))).reduce((s, x) => s + docTax(x).net, 0) : 0;
  const isTax = title(c, d)[0].startsWith('Tax');
  const missingAddress = isTax && !!party?.trn && !party.address;
  return (
    <div class="print-doc">
      <div class="row no-print" style={{ marginBottom: 'var(--s4)' }}>
        <button class="primary" onClick={() => window.print()}>{t('Print')}</button>
        <button onClick={() => go('docs', { kind: d.kind })}>{t('Cancel')}</button>
        <span class="muted">{L('Choose "Save as PDF" in the print window to keep a PDF.', 'اختر «حفظ بصيغة PDF» من نافذة الطباعة لحفظ نسخة PDF.')}</span>
      </div>
      {missingAddress && <div class="problem no-print" role="alert">{L('The customer is registered for VAT: a tax invoice must show their address. Add it in the customer list.', 'الزبون مسجّل في الضريبة: الفاتورة الضريبية يجب أن تذكر عنوانه. أضفه في قائمة الزبائن.')}</div>}
      <div class="sheet">
        <header class="sheet-head">
          <div>
            <div class="sheet-title">{en === ar ? en : <><bdi lang="en">{en}</bdi> <span class="muted">|</span> <bdi lang="ar">{ar}</bdi></>}</div>
            {d.voided && <div class="neg"><strong>{L('VOID', 'ملغاة')}</strong></div>}
          </div>
          <div class="sheet-from">
            <strong>{c.name}</strong>
            {c.vat && <div>{c.vat.address}</div>}
            {c.vat && <div>{L('TRN', 'الرقم الضريبي')}: <bdi class="num">{c.vat.trn}</bdi></div>}
          </div>
        </header>

        <div class="sheet-meta">
          <div>
            <div class="muted">{L('Bill to', 'إلى')}</div>
            <strong>{party?.name ?? L('Cash customer', 'زبون نقدي')}</strong>
            {party?.address && <div>{party.address}</div>}
            {party?.trn && <div>{L('TRN', 'الرقم الضريبي')}: <bdi class="num">{party.trn}</bdi></div>}
          </div>
          <table class="sheet-facts">
            <tbody>
              <tr><td class="muted">{L('Number', 'الرقم')}</td><td><bdi class="num">{d.number}</bdi></td></tr>
              <tr><td class="muted">{L('Date of issue', 'تاريخ الإصدار')}</td><td><bdi class="num">{d.date}</bdi></td></tr>
              {d.dueDate && d.kind === 'invoice' && <tr><td class="muted">{L('Due date', 'تاريخ الاستحقاق')}</td><td><bdi class="num">{d.dueDate}</bdi></td></tr>}
              {d.dueDate && d.kind === 'estimate' && <tr><td class="muted">{L('Valid until', 'صالح حتى')}</td><td><bdi class="num">{d.dueDate}</bdi></td></tr>}
              <tr><td class="muted">{L('Currency', 'العملة')}</td><td>{c.currency.code}</td></tr>
            </tbody>
          </table>
        </div>

        {d.kind === 'credit_memo' && (
          <div class="sheet-note">
            {ref ? (
              <>
                <div>{L(`Relates to tax invoice ${ref.number} of ${ref.date}.`, `يتعلق بالفاتورة الضريبية رقم ${ref.number} بتاريخ ${ref.date}.`)}</div>
                <table class="sheet-facts">
                  <tbody>
                    <tr><td class="muted">{L('Value on the tax invoice', 'القيمة في الفاتورة الضريبية')}</td><td class="n"><Money c={c} value={refNet} /></td></tr>
                    {before > 0 && <tr><td class="muted">{L('Earlier tax credit notes', 'إشعارات دائنة سابقة')}</td><td class="n"><Money c={c} value={-before} /></td></tr>}
                    <tr><td class="muted">{L('Correct value', 'القيمة الصحيحة')}</td><td class="n"><Money c={c} value={refNet - before - sums.net} /></td></tr>
                    <tr><td class="muted">{L('Difference', 'الفرق')}</td><td class="n"><Money c={c} value={sums.net} /></td></tr>
                    {vatOn && <tr><td class="muted">{L('VAT on the difference', 'الضريبة على الفرق')}</td><td class="n"><Money c={c} value={sums.vat} /></td></tr>}
                  </tbody>
                </table>
              </>
            ) : null}
            {d.memo && <div>{L('Reason', 'السبب')}: {d.memo}</div>}
          </div>
        )}

        <table class="sheet-lines">
          <thead>
            <tr>
              <th>{L('Description', 'البيان')}</th>
              <th class="n">{L('Quantity', 'الكمية')}</th>
              <th class="n">{d.taxInclusive ? L('Unit price incl. VAT', 'سعر الوحدة شامل الضريبة') : L('Unit price', 'سعر الوحدة')}</th>
              <th class="n">{vatOn ? L('Amount excl. VAT', 'المبلغ دون الضريبة') : L('Amount', 'المبلغ')}</th>
              {vatOn && <th class="n">{L('VAT rate', 'نسبة الضريبة')}</th>}
              {vatOn && <th class="n">{L('VAT', 'الضريبة')}</th>}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description || (l.itemId ? c.items.get(l.itemId)?.name : c.accounts.get(l.accountId)?.name)}</td>
                <td class="n num">{formatQuantity(l.quantity)}</td>
                <td class="n"><Money c={c} value={l.rate} /></td>
                <td class="n"><Money c={c} value={lineNet(d, l)} /></td>
                {vatOn && <td class="n num">{l.taxCode === 'SR' ? `${VAT_PERCENT}%` : l.taxCode === 'ZR' ? '0%' : l.taxCode === 'EX' ? L('Exempt', 'معفى') : L('Out of scope', 'خارج النطاق')}</td>}
                {vatOn && <td class="n"><Money c={c} value={l.taxCode === 'SR' ? l.tax : 0} /></td>}
              </tr>
            ))}
          </tbody>
        </table>

        <table class="sheet-totals">
          <tbody>
            {vatOn && <tr><td>{L('Total excluding VAT', 'المجموع دون الضريبة')}</td><td class="n"><Money c={c} value={sums.net} /></td></tr>}
            {vatOn && <tr><td>{L(`VAT ${VAT_PERCENT}%`, `ضريبة القيمة المضافة ${VAT_PERCENT}٪`)}</td><td class="n"><Money c={c} value={sums.vat} /></td></tr>}
            <tr class="sub"><td>{L(`Total (${c.currency.code})`, `المجموع (${c.currency.code})`)}</td><td class="n"><Money c={c} value={d.total} /></td></tr>
          </tbody>
        </table>

        {d.memo && d.kind !== 'credit_memo' && <p class="muted">{d.memo}</p>}
      </div>
    </div>
  );
}
