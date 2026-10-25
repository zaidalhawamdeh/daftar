import { useState } from 'preact/hooks';
import type { CashFlow, CashFlowSection } from '../../../core/cashflow.ts';
import type { Company } from '../../../core/company.ts';
import { fiscalYearStart } from '../../../core/dates.ts';
import type { BalanceSheet, LedgerAccount, ProfitAndLoss, ReportRow, Section, TrialBalance } from '../../../core/reports.ts';
import type { Aging, OpenDocs, PartyBalances } from '../../../core/subledger.ts';
import { EMIRATES, type VatReturn } from '../../../core/vat.ts';
import { lang, t } from '../i18n.ts';
import { emirateName, reportName, typeName } from '../labels.ts';
import { REPORTS } from '../routes.ts';
import { go, run } from '../state.ts';
import { DateInput, Field, Money, ProblemBox, today } from '../ui.tsx';

const RANGE = new Set(['profitAndLoss', 'cashFlow', 'generalLedger', 'vatReturn']);
const COMMAND: Record<string, string> = {
  profitAndLoss: 'report.profitAndLoss',
  balanceSheet: 'report.balanceSheet',
  cashFlow: 'report.cashFlow',
  trialBalance: 'report.trialBalance',
  generalLedger: 'report.generalLedger',
  arAging: 'report.arAging',
  apAging: 'report.apAging',
  customerBalances: 'report.customerBalances',
  vendorBalances: 'report.vendorBalances',
  openInvoices: 'report.openInvoices',
  unpaidBills: 'report.unpaidBills',
  vatReturn: 'report.vatReturn',
};

export function Reports({ c, report }: { c: Company; report: string }) {
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(fiscalYearStart(today(), c.fiscalYearStartMonth));
  const ranged = RANGE.has(report);
  const r = run(COMMAND[report]!, ranged ? { from, to } : { asOf: to });
  const subtitle = ranged ? `${from} → ${to}` : `${t('As of')} ${to}`;
  return (
    <div class="report">
      <div class="row no-print" style={{ marginBottom: 'var(--s4)' }}>
        <Field label={t('Reports')}>
          <select value={report} onChange={(e) => go('reports', { report: (e.target as HTMLSelectElement).value })}>
            {REPORTS.filter((id) => id !== 'vatReturn' || c.vat).map((id) => <option key={id} value={id}>{reportName(id)}</option>)}
          </select>
        </Field>
        {ranged && <Field label={t('From')}><DateInput value={from} onInput={setFrom} /></Field>}
        <Field label={ranged ? t('To') : t('As of')}><DateInput value={to} onInput={setTo} /></Field>
        <span class="spacer" />
        <button onClick={() => window.print()}>{t('Print')}</button>
      </div>
      <h1>{reportName(report)}</h1>
      <div class="sub">{c.name} · {subtitle} · {c.currency.code}</div>
      {!r.ok ? <ProblemBox p={r.error} /> : <Body c={c} report={report} data={r.value} />}
    </div>
  );
}

function Body({ c, report, data }: { c: Company; report: string; data: unknown }) {
  switch (report) {
    case 'profitAndLoss': return <PL c={c} r={data as ProfitAndLoss} />;
    case 'balanceSheet': return <BS c={c} r={data as BalanceSheet} />;
    case 'cashFlow': return <CF c={c} r={data as CashFlow} />;
    case 'trialBalance': return <TB c={c} r={data as TrialBalance} />;
    case 'generalLedger': return <GL c={c} r={data as LedgerAccount[]} />;
    case 'arAging':
    case 'apAging': return <AgingTable c={c} r={data as Aging} />;
    case 'customerBalances':
    case 'vendorBalances': return <Balances c={c} r={data as PartyBalances} />;
    case 'vatReturn': return <VatReturnTable c={c} r={data as VatReturn} />;
    default: return <OpenTable c={c} r={data as OpenDocs} />;
  }
}

const indent = (d: number) => `indent${Math.min(d + 1, 3)}`;

function Rows({ c, rows }: { c: Company; rows: ReportRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.accountId}>
          <td class={indent(r.depth)}>{r.number && <><bdi class="num">{r.number}</bdi> · </>}<bdi>{r.name}</bdi></td>
          <td class="n"><Money c={c} value={r.depth === 0 ? r.total : r.amount} /></td>
        </tr>
      ))}
    </>
  );
}

function Line({ c, label, value, strong }: { c: Company; label: string; value: number; strong?: boolean }) {
  return (
    <tr class={strong ? 'sub' : ''}>
      <td>{label}</td>
      <td class="n"><Money c={c} value={value} /></td>
    </tr>
  );
}

function SectionRows({ c, title, s }: { c: Company; title: string; s: Section }) {
  if (!s.rows.length) return null;
  return (
    <>
      <tr><td colSpan={2}><strong>{title}</strong></td></tr>
      <Rows c={c} rows={s.rows} />
      <Line c={c} label={lang() === 'ar' ? `مجموع ${title}` : `Total ${title}`} value={s.total} />
    </>
  );
}

const L = (en: string, ar: string) => (lang() === 'ar' ? ar : en);

function PL({ c, r }: { c: Company; r: ProfitAndLoss }) {
  return (
    <div class="table-wrap"><table><tbody>
      <SectionRows c={c} title={L('Income', 'الإيرادات')} s={r.income} />
      <SectionRows c={c} title={L('Cost of Goods Sold', 'تكلفة البضاعة المباعة')} s={r.costOfGoodsSold} />
      <Line c={c} label={L('Gross Profit', 'مجمل الربح')} value={r.grossProfit} strong />
      <SectionRows c={c} title={L('Expenses', 'المصاريف')} s={r.expenses} />
      <Line c={c} label={L('Net Operating Income', 'صافي الربح التشغيلي')} value={r.netOperatingIncome} strong />
      <SectionRows c={c} title={L('Other Income', 'إيرادات أخرى')} s={r.otherIncome} />
      <SectionRows c={c} title={L('Other Expenses', 'مصاريف أخرى')} s={r.otherExpenses} />
      <Line c={c} label={L('Net Income', 'صافي الربح')} value={r.netIncome} strong />
    </tbody></table></div>
  );
}

function BS({ c, r }: { c: Company; r: BalanceSheet }) {
  const side = (title: string, s: BalanceSheet['assets']) => (
    <>
      <tr><td colSpan={2}><strong>{title}</strong></td></tr>
      {s.groups.map((g) => (
        <>
          <tr><td class="indent1 muted">{typeName(g.type)}</td><td /></tr>
          <Rows c={c} rows={g.rows.map((x) => ({ ...x, depth: x.depth + 1 }))} />
        </>
      ))}
    </>
  );
  return (
    <div class="table-wrap"><table><tbody>
      {side(L('Assets', 'الأصول'), r.assets)}
      <Line c={c} label={L('Total Assets', 'مجموع الأصول')} value={r.assets.total} strong />
      {side(L('Liabilities', 'الالتزامات'), r.liabilities)}
      <Line c={c} label={L('Total Liabilities', 'مجموع الالتزامات')} value={r.liabilities.total} />
      {side(L('Equity', 'حقوق الملكية'), { groups: r.equity.groups, total: r.equity.total })}
      <tr><td class="indent2">{L('Retained Earnings', 'الأرباح المحتجزة')}</td><td class="n"><Money c={c} value={r.equity.extra.retainedEarnings} /></td></tr>
      <tr><td class="indent2">{L('Net Income', 'صافي الربح')}</td><td class="n"><Money c={c} value={r.equity.extra.netIncome} /></td></tr>
      <Line c={c} label={L('Total Equity', 'مجموع حقوق الملكية')} value={r.equity.total} />
      <Line c={c} label={L('Total Liabilities & Equity', 'مجموع الالتزامات وحقوق الملكية')} value={r.totalLiabilitiesAndEquity} strong />
    </tbody></table></div>
  );
}

function CF({ c, r }: { c: Company; r: CashFlow }) {
  const block = (title: string, s: CashFlowSection) => (
    <>
      <tr><td colSpan={2}><strong>{title}</strong></td></tr>
      {s.rows.map((x) => <tr key={x.accountId}><td class="indent1">{x.number ? `${x.number} · ` : ''}{x.name}</td><td class="n"><Money c={c} value={x.amount} /></td></tr>)}
    </>
  );
  return (
    <div class="table-wrap"><table><tbody>
      <tr><td colSpan={2}><strong>{L('Operating activities', 'الأنشطة التشغيلية')}</strong></td></tr>
      <tr><td class="indent1">{L('Net Income', 'صافي الربح')}</td><td class="n"><Money c={c} value={r.netIncome} /></td></tr>
      {r.operating.rows.map((x) => <tr key={x.accountId}><td class="indent1">{x.number ? `${x.number} · ` : ''}{x.name}</td><td class="n"><Money c={c} value={x.amount} /></td></tr>)}
      <Line c={c} label={L('Net cash from operating activities', 'صافي النقد من الأنشطة التشغيلية')} value={r.netOperating} />
      {block(L('Investing activities', 'الأنشطة الاستثمارية'), r.investing)}
      <Line c={c} label={L('Net cash from investing activities', 'صافي النقد من الأنشطة الاستثمارية')} value={r.investing.total} />
      {block(L('Financing activities', 'الأنشطة التمويلية'), r.financing)}
      <Line c={c} label={L('Net cash from financing activities', 'صافي النقد من الأنشطة التمويلية')} value={r.financing.total} />
      <Line c={c} label={L('Net change in cash', 'صافي التغير في النقد')} value={r.netChange} strong />
      <Line c={c} label={L('Cash at beginning of period', 'النقد في بداية الفترة')} value={r.cashAtBeginning} />
      <Line c={c} label={L('Cash at end of period', 'النقد في نهاية الفترة')} value={r.cashAtEnd} strong />
    </tbody></table></div>
  );
}

function TB({ c, r }: { c: Company; r: TrialBalance }) {
  return (
    <div class="table-wrap"><table>
      <thead><tr><th>{t('Account')}</th><th class="n">{t('Debit')}</th><th class="n">{t('Credit')}</th></tr></thead>
      <tbody>{r.rows.map((x) => <tr key={x.accountId}><td>{x.number ? `${x.number} · ` : ''}{x.name}</td><td class="n"><Money c={c} value={x.debit} blankZero /></td><td class="n"><Money c={c} value={x.credit} blankZero /></td></tr>)}</tbody>
      <tfoot><tr><td>{t('Total')}</td><td class="n"><Money c={c} value={r.totalDebit} /></td><td class="n"><Money c={c} value={r.totalCredit} /></td></tr></tfoot>
    </table></div>
  );
}

function GL({ c, r }: { c: Company; r: LedgerAccount[] }) {
  return (
    <div class="table-wrap"><table>
      <thead><tr><th>{t('Date')}</th><th>{t('Memo')}</th><th class="n">{t('Debit')}</th><th class="n">{t('Credit')}</th><th class="n">{t('Balance')}</th></tr></thead>
      <tbody>
        {r.map((a) => (
          <>
            <tr class="sub" key={a.accountId}><td colSpan={4}>{a.number ? `${a.number} · ` : ''}{a.name}</td><td class="n"><Money c={c} value={a.opening} /></td></tr>
            {a.lines.map((l, i) => (
              <tr key={`${a.accountId}-${i}`}><td class="num">{l.date}</td><td>{l.memo}</td><td class="n"><Money c={c} value={l.debit} blankZero /></td><td class="n"><Money c={c} value={l.credit} blankZero /></td><td class="n"><Money c={c} value={l.balance} /></td></tr>
            ))}
          </>
        ))}
      </tbody>
    </table></div>
  );
}

function AgingTable({ c, r }: { c: Company; r: Aging }) {
  return (
    <div class="table-wrap"><table>
      <thead><tr><th>{t('Name')}</th>{r.labels.map((l) => <th class="n" key={l}>{l === 'Current' ? L('Current', 'حالي') : l}</th>)}<th class="n">{t('Total')}</th></tr></thead>
      <tbody>{r.rows.map((x) => <tr key={x.partyId}><td>{x.name}</td>{x.buckets.map((b, i) => <td class="n" key={i}><Money c={c} value={b} blankZero /></td>)}<td class="n"><Money c={c} value={x.total} /></td></tr>)}</tbody>
      <tfoot><tr><td>{t('Total')}</td>{r.totals.map((b, i) => <td class="n" key={i}><Money c={c} value={b} /></td>)}<td class="n"><Money c={c} value={r.total} /></td></tr></tfoot>
    </table></div>
  );
}

function Balances({ c, r }: { c: Company; r: PartyBalances }) {
  return (
    <div class="table-wrap"><table>
      <thead><tr><th>{t('Name')}</th><th class="n">{t('Balance')}</th></tr></thead>
      <tbody>{r.rows.map((x) => <tr key={x.partyId}><td>{x.name}</td><td class="n"><Money c={c} value={x.balance} /></td></tr>)}</tbody>
      <tfoot><tr><td>{t('Total')}</td><td class="n"><Money c={c} value={r.total} /></td></tr></tfoot>
    </table></div>
  );
}

function OpenTable({ c, r }: { c: Company; r: OpenDocs }) {
  return (
    <div class="table-wrap"><table>
      <thead><tr><th>{t('Name')}</th><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Due date')}</th><th class="n">{t('Total')}</th><th class="n">{t('Open balance')}</th></tr></thead>
      <tbody>{r.rows.map((x) => <tr key={x.docId}><td>{x.name}</td><td>{x.number}</td><td class="num">{x.date}</td><td class="num">{x.dueDate}</td><td class="n"><Money c={c} value={x.total} /></td><td class="n"><Money c={c} value={x.open} /></td></tr>)}</tbody>
      <tfoot><tr><td colSpan={5}>{t('Total')}</td><td class="n"><Money c={c} value={r.total} /></td></tr></tfoot>
    </table></div>
  );
}

// The boxes of the FTA's VAT 201 return, in its order. Boxes the books cannot know (tourist refunds,
// imports through customs) are shown empty and say so.
function VatReturnTable({ c, r }: { c: Company; r: VatReturn }) {
  const row = (box: string, label: string, amount: number | null, vat: number | null, strong = false) => (
    <tr class={strong ? 'sub' : ''} key={box}>
      <td class="num">{box}</td>
      <td>{label}</td>
      <td class="n">{amount === null ? '' : <Money c={c} value={amount} />}</td>
      <td class="n">{vat === null ? '' : <Money c={c} value={vat} />}</td>
    </tr>
  );
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  return (
    <>
      <p class="muted">{L(`Tax Registration Number ${c.vat?.trn ?? ''} · standard-rated supplies are reported under ${emirateName(r.emirate)}, where the business is established.`, `رقم التسجيل الضريبي ${c.vat?.trn ?? ''} · تُدرَج التوريدات الخاضعة للنسبة الأساسية في ${emirateName(r.emirate)}، حيث مقرّ المنشأة.`)}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>{L('Box', 'الخانة')}</th><th>{L('Description', 'البيان')}</th><th class="n">{L('Amount (AED)', 'المبلغ (درهم)')}</th><th class="n">{L('VAT (AED)', 'الضريبة (درهم)')}</th></tr></thead>
        <tbody>
          <tr><td colSpan={4}><strong>{L('VAT on sales and all other outputs', 'ضريبة القيمة المضافة على المبيعات وجميع المخرجات الأخرى')}</strong></td></tr>
          {EMIRATES.map((e, i) => row(`1${letters[i]}`, L(`Standard rated supplies in ${emirateName(e)}`, `التوريدات الخاضعة للنسبة الأساسية في ${emirateName(e)}`), r.box1[e].amount, r.box1[e].vat))}
          {row('2', L('Tax refunds provided to tourists (not kept in these books)', 'المبالغ المستردة للسياح (لا تُسجَّل في هذه الدفاتر)'), null, null)}
          {row('3', L('Supplies subject to the reverse charge provisions', 'التوريدات الخاضعة لآلية الاحتساب العكسي'), r.box3.amount, r.box3.vat)}
          {row('4', L('Zero rated supplies', 'التوريدات الخاضعة للنسبة الصفرية'), r.box4, null)}
          {row('5', L('Exempt supplies', 'التوريدات المعفاة'), r.box5, null)}
          {row('6', L('Goods imported into the UAE (pre-filled by the FTA from customs)', 'السلع المستوردة إلى الدولة (تعبّئها الهيئة من بيانات الجمارك)'), null, null)}
          {row('7', L('Adjustments to goods imported into the UAE', 'التعديلات على السلع المستوردة إلى الدولة'), null, null)}
          {row('8', L('Totals', 'المجاميع'), r.box8.amount, r.box8.vat, true)}
          <tr><td colSpan={4}><strong>{L('VAT on expenses and all other inputs', 'ضريبة القيمة المضافة على المصروفات وجميع المدخلات الأخرى')}</strong></td></tr>
          {row('9', L('Standard rated expenses', 'النفقات الخاضعة للنسبة الأساسية'), r.box9.amount, r.box9.vat)}
          {row('10', L('Supplies subject to the reverse charge provisions', 'التوريدات الخاضعة لأحكام آلية الاحتساب العكسي'), r.box10.amount, r.box10.vat)}
          {row('11', L('Totals', 'المجاميع'), r.box11.amount, r.box11.vat, true)}
          <tr><td colSpan={4}><strong>{L('Net VAT due', 'صافي الضريبة المستحقة')}</strong></td></tr>
          {row('12', L('Total value of due tax for the period', 'إجمالي قيمة الضريبة المستحقة عن الفترة'), null, r.box12)}
          {row('13', L('Total value of recoverable tax for the period', 'إجمالي قيمة الضريبة القابلة للاسترداد عن الفترة'), null, r.box13)}
          {row('14', r.box14 >= 0 ? L('Payable tax for the period', 'الضريبة المستحقة الدفع عن الفترة') : L('Recoverable tax for the period (refund or carry forward)', 'الضريبة القابلة للاسترداد عن الفترة (استرداد أو ترحيل)'), null, r.box14, true)}
        </tbody>
      </table></div>
      {(r.otherEntries.output !== 0 || r.otherEntries.input !== 0) && (
        <p class="muted" style={{ marginTop: 'var(--s3)' }}>
          {L('Journal entries on the VAT accounts in this period, not part of the return (a payment to the FTA, a correction): output', 'قيود يومية على حسابات الضريبة في هذه الفترة، ليست جزءاً من الإقرار (دفعة للهيئة، تصحيح): المخرجات')} <Money c={c} value={r.otherEntries.output} /> · {L('input', 'المدخلات')} <Money c={c} value={r.otherEntries.input} />
        </p>
      )}
      <FileReturn c={c} to={r.to} />
      <p class="muted" style={{ marginTop: 'var(--s3)' }}>{L(`${r.documents.length} documents counted, by document date. Check the figures before filing; not modelled: imports through customs, partial or blocked input tax, the profit margin scheme and designated zones.`, `احتُسبت ${r.documents.length} مستندات حسب تاريخها. راجع الأرقام قبل التقديم؛ لا يشمل التقرير: الاستيراد عبر الجمارك، والاسترداد الجزئي أو المحظور لضريبة المدخلات، ونظام هامش الربح، والمناطق المحددة.`)}</p>
    </>
  );
}

// After the return is filed, close the books through the end of the period, so nothing dated in it can
// change what was filed (corrections then go in a later return, as the FTA expects).
function FileReturn({ c, to }: { c: Company; to: string }) {
  const done = c.closingDate !== null && c.closingDate >= to;
  return (
    <div class="row no-print" style={{ marginTop: 'var(--s3)' }}>
      {done ? (
        <span class="notice">{L(`The books are closed through ${c.closingDate}; this period can no longer change.`, `الدفاتر مقفلة حتى ${c.closingDate}؛ هذه الفترة لم تعد تتغيّر.`)}</span>
      ) : (
        <button onClick={() => { const r = run('company.setClosingDate', { date: to }); if (!r.ok) alert(r.error.message); }}>
          {L(`Filed this return? Close the books through ${to}`, `قدّمت هذا الإقرار؟ أقفل الدفاتر حتى ${to}`)}
        </button>
      )}
    </div>
  );
}
