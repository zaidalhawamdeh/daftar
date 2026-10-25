// One form for every document with lines: estimates, invoices, sales receipts and credit memos on the
// sales side; purchase orders, bills, vendor credits and expenses on the purchase side.

import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import type { PurchaseKind, SalesKind } from '../../../core/documents.ts';
import { formatAmount } from '../../../core/money.ts';
import { lineAmount, parseQuantity } from '../../../core/quantity.ts';
import { ITEM_TAX_CODES, TAX_CODES, lineTax, type TaxCode } from '../../../core/vat.ts';
import { t } from '../i18n.ts';
import { docName, taxCodeName } from '../labels.ts';
import { go, run } from '../state.ts';
import { AccountSelect, AmountInput, DateInput, Field, ItemSelect, Money, PartySelect, ProblemBox, parseMoney, today, useOutcome } from '../ui.tsx';

type Kind = SalesKind | PurchaseKind;

interface Config {
  side: 'sales' | 'purchase';
  command: string;
  partyRequired: boolean;
  money?: 'depositToId' | 'payFromId';
  due?: boolean;
  expires?: boolean;
  numberLabel: string;
  memorize: boolean;
}

const CONFIG: Record<Kind, Config> = {
  estimate: { side: 'sales', command: 'estimate.create', partyRequired: true, expires: true, numberLabel: 'Number', memorize: false },
  invoice: { side: 'sales', command: 'invoice.create', partyRequired: true, due: true, numberLabel: 'Number', memorize: true },
  sales_receipt: { side: 'sales', command: 'salesReceipt.create', partyRequired: false, money: 'depositToId', numberLabel: 'Number', memorize: true },
  credit_memo: { side: 'sales', command: 'creditMemo.create', partyRequired: true, numberLabel: 'Number', memorize: false },
  purchase_order: { side: 'purchase', command: 'purchaseOrder.create', partyRequired: true, numberLabel: 'Number', memorize: false },
  bill: { side: 'purchase', command: 'bill.create', partyRequired: true, due: true, numberLabel: 'Number', memorize: true },
  vendor_credit: { side: 'purchase', command: 'vendorCredit.create', partyRequired: true, numberLabel: 'Number', memorize: false },
  expense: { side: 'purchase', command: 'expense.create', partyRequired: false, money: 'payFromId', numberLabel: 'Number', memorize: true },
};

interface LineRow {
  itemId: string;
  accountId: string;
  description: string;
  quantity: string;
  rate: string;
  taxCode: TaxCode;
}

const blank = (): LineRow => ({ itemId: '', accountId: '', description: '', quantity: '1', rate: '', taxCode: 'SR' });

export function DocForm({ c, kind, partyId: initialParty }: { c: Company; kind: Kind; partyId?: string | undefined }) {
  const cfg = CONFIG[kind];
  const out = useOutcome();
  const [partyId, setPartyId] = useState(initialParty ?? '');
  const [date, setDate] = useState(today());
  const [number, setNumber] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [moneyAccount, setMoneyAccount] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineRow[]>([blank(), blank()]);
  const [memorizing, setMemorizing] = useState(false);
  const [inclusive, setInclusive] = useState(false);
  const [refId, setRefId] = useState('');
  const vatOn = c.vat !== null;
  const codes = cfg.side === 'sales' ? ITEM_TAX_CODES : TAX_CODES;
  const refKind = kind === 'credit_memo' ? 'invoice' : kind === 'vendor_credit' ? 'bill' : null;
  const refs = refKind ? [...c.documents.values()].filter((d) => d.kind === refKind && !d.voided && d.partyId === partyId).sort((a, b) => b.date.localeCompare(a.date)) : [];

  const setLine = (i: number, patch: Partial<LineRow>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, itemId: string) => {
    const item = c.items.get(itemId);
    const rate = item ? (cfg.side === 'sales' ? item.price : item.cost) : 0;
    setLine(i, { itemId, description: item?.description ?? lines[i]!.description, rate: item ? (rate ? formatAmount(rate, c.currency, { grouping: false }) : '') : lines[i]!.rate, taxCode: item?.taxCode ?? lines[i]!.taxCode });
  };
  // A blank rate on an item line means the item's own price, exactly as the core will post it.
  const rateOf = (l: LineRow): number | null => {
    if (l.rate.trim()) return parseMoney(c, l.rate);
    const item = l.itemId ? c.items.get(l.itemId) : undefined;
    return item ? (cfg.side === 'sales' ? item.price : item.cost) : null;
  };
  const amountOf = (l: LineRow): number | null => {
    const q = parseQuantity(l.quantity || '1');
    const r = rateOf(l);
    if (!q.ok || r === null) return null;
    const a = lineAmount(q.value, r);
    return a.ok ? a.value : null;
  };
  const used = lines.filter((l) => l.itemId || l.accountId || l.rate.trim() || l.description.trim());
  // The same arithmetic the core posts: VAT per line, rounded to the fils.
  const taxOf = (l: LineRow) => lineTax(amountOf(l) ?? 0, vatOn ? l.taxCode : null, inclusive);
  const sums = used.reduce((s, l) => {
    const x = taxOf(l);
    return { net: s.net + x.net, vat: s.vat + (l.taxCode === 'SR' ? x.tax : 0), rc: s.rc + (l.taxCode === 'RC' ? x.tax : 0), total: s.total + x.payable };
  }, { net: 0, vat: 0, rc: 0, total: 0 });
  const total = sums.total;

  const params = (): Record<string, unknown> | null => {
    const built = [];
    for (const l of used) {
      if (!l.itemId && !l.accountId) {
        out.fail({ code: 'line.account_missing', message: 'Choose an item or an account on every line.' });
        return null;
      }
      const rate = parseMoney(c, l.rate);
      if (l.rate.trim() && rate === null) {
        out.fail({ code: 'amount.invalid', message: `"${l.rate}" is not an amount.` });
        return null;
      }
      built.push({ ...(l.itemId ? { itemId: l.itemId } : { accountId: l.accountId }), description: l.description, quantity: l.quantity || '1', ...(rate !== null ? { rate } : {}), ...(vatOn ? { taxCode: l.taxCode } : {}) });
    }
    return {
      ...(cfg.side === 'sales' ? { customerId: partyId || null } : { vendorId: partyId || null }),
      date,
      ...(number.trim() ? { number: number.trim() } : {}),
      ...(cfg.due && dueDate ? { dueDate } : {}),
      ...(cfg.expires && dueDate ? { expiresOn: dueDate } : {}),
      ...(cfg.money ? { [cfg.money]: moneyAccount } : {}),
      memo,
      ...(vatOn ? { taxInclusive: inclusive } : {}),
      ...(refKind && refId ? { refId: Number(refId) } : {}),
      lines: built,
    };
  };

  const save = (andNew: boolean) => {
    const p = params();
    if (!p) return;
    const r = run<{ number: string }>(cfg.command, p);
    if (!r.ok) return out.fail(r.error);
    if (andNew) {
      setLines([blank(), blank()]);
      setNumber('');
      setMemo('');
      setDueDate('');
      out.succeed(`${docName(kind)} ${r.value.number} ✓`);
    } else {
      go('docs', { kind });
    }
  };

  return (
    <div>
      <h1>{docName(kind)}</h1>
      <div class="card">
        <div class="fields">
          <Field label={t(cfg.side === 'sales' ? 'Customer' : 'Vendor')} wide>
            <PartySelect c={c} kind={cfg.side === 'sales' ? 'customer' : 'vendor'} value={partyId} onChange={setPartyId} allowNone={!cfg.partyRequired} />
          </Field>
          {cfg.money && (
            <Field label={t(cfg.money === 'depositToId' ? 'Deposit to' : 'Pay from')}>
              <AccountSelect c={c} value={moneyAccount} onChange={setMoneyAccount} types={cfg.money === 'depositToId' ? ['bank', 'other_current_asset'] : ['bank', 'credit_card']} />
            </Field>
          )}
          <Field label={t('Date')}><DateInput value={date} onInput={setDate} /></Field>
          <Field label={t(cfg.numberLabel)}><input value={number} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} placeholder="auto" /></Field>
          {(cfg.due || cfg.expires) && <Field label={t('Due date')}><DateInput value={dueDate} onInput={setDueDate} /></Field>}
          {refKind && (
            <Field label={t(refKind === 'invoice' ? 'For invoice' : 'For bill')}>
              <select value={refId} onChange={(e) => setRefId((e.target as HTMLSelectElement).value)}>
                <option value="">{t('None')}</option>
                {refs.map((d) => <option key={d.id} value={d.id}>{`${d.number || '—'} · ${d.date} · ${formatAmount(d.total, c.currency)}`}</option>)}
              </select>
            </Field>
          )}
        </div>
        {vatOn && (
          <label class="check" style={{ marginBottom: 'var(--s3)' }}>
            <input type="checkbox" checked={inclusive} onChange={() => setInclusive(!inclusive)} /> {t('Prices include VAT')}
          </label>
        )}

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: vatOn ? '16%' : '20%' }}>{t('Item')}</th>
                <th style={{ width: vatOn ? '17%' : '20%' }}>{t('Account')}</th>
                <th>{t('Description')}</th>
                <th class="n" style={{ width: '9%' }}>{t('Quantity')}</th>
                <th class="n" style={{ width: '13%' }}>{t('Rate')}</th>
                {vatOn && <th style={{ width: '15%' }}>{t('VAT')}</th>}
                <th class="n" style={{ width: '13%' }}>{t('Amount')}</th>
                <th style={{ width: '40px' }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const a = amountOf(l);
                const item = l.itemId ? c.items.get(l.itemId) : undefined;
                return (
                  <tr key={i}>
                    <td><ItemSelect c={c} side={cfg.side} value={l.itemId} onChange={(v) => pickItem(i, v)} /></td>
                    <td>
                      {item ? (
                        <span class="muted">{c.accounts.get((cfg.side === 'sales' ? item.salesAccountId : item.purchaseAccountId) ?? '')?.name}</span>
                      ) : (
                        <AccountSelect c={c} value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} exclude={['accounts_receivable', 'accounts_payable']} label={t('Account')} noVat />
                      )}
                    </td>
                    <td><input value={l.description} aria-label={t('Description')} onInput={(e) => setLine(i, { description: (e.target as HTMLInputElement).value })} /></td>
                    <td><input class="amount" value={l.quantity} aria-label={t('Quantity')} aria-invalid={!!l.quantity && !parseQuantity(l.quantity).ok} onInput={(e) => setLine(i, { quantity: (e.target as HTMLInputElement).value })} /></td>
                    <td><AmountInput c={c} value={l.rate} label={t('Rate')} onInput={(v) => setLine(i, { rate: v })} /></td>
                    {vatOn && (
                      <td>
                        <select value={l.taxCode} aria-label={t('VAT')} onChange={(e) => setLine(i, { taxCode: (e.target as HTMLSelectElement).value as TaxCode })}>
                          {codes.map((code) => <option key={code} value={code}>{taxCodeName(code)}</option>)}
                        </select>
                      </td>
                    )}
                    <td class="n">{a !== null && (l.itemId || l.accountId) ? <Money c={c} value={a} /> : l.rate.trim() || l.itemId ? <span class="neg">?</span> : ''}</td>
                    <td><button class="small" type="button" aria-label={t('Remove line')} onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blank()])}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {vatOn && (
                <>
                  <tr><td colSpan={6} class="n muted">{t('Subtotal before VAT')}</td><td class="n"><Money c={c} value={sums.net} /></td><td /></tr>
                  <tr><td colSpan={6} class="n muted">{t('VAT')}</td><td class="n"><Money c={c} value={sums.vat} /></td><td /></tr>
                  {sums.rc > 0 && <tr><td colSpan={6} class="n muted">{t('Reverse-charge VAT (not paid to the vendor)')}</td><td class="n"><Money c={c} value={sums.rc} /></td><td /></tr>}
                </>
              )}
              <tr>
                <td colSpan={vatOn ? 6 : 5}><button class="small" type="button" onClick={() => setLines([...lines, blank()])}>{t('Add line')}</button></td>
                <td class="n"><Money c={c} value={total} /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="fields" style={{ marginTop: 'var(--s3)' }}>
          <Field label={t('Memo')} wide><input value={memo} onInput={(e) => setMemo((e.target as HTMLInputElement).value)} /></Field>
        </div>
        <ProblemBox p={out.problem} />
        {out.notice && <div class="notice" role="status">{out.notice}</div>}
        <div class="row">
          <button class="primary" onClick={() => save(false)}>{t('Save')}</button>
          <button onClick={() => save(true)}>{t('Save and new')}</button>
          {cfg.memorize && <button onClick={() => setMemorizing(!memorizing)}>{t('Memorize')}</button>}
          <span class="spacer" />
          <button onClick={() => go('docs', { kind })}>{t('Cancel')}</button>
        </div>
        {memorizing && <MemorizeForm c={c} command={cfg.command} build={params} onDone={() => setMemorizing(false)} />}
      </div>
    </div>
  );
}

function MemorizeForm({ command, build, onDone }: { c: Company; command: string; build: () => Record<string, unknown> | null; onDone: () => void }) {
  const out = useOutcome();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('');
  const [nextDate, setNextDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const save = () => {
    const p = build();
    if (!p) return;
    const { date: _drop, number: _n, dueDate: _d, ...params } = p;
    const r = run('memorized.create', { name, command, params, frequency: frequency || null, ...(frequency ? { nextDate } : {}), ...(endDate ? { endDate } : {}) });
    if (!r.ok) return out.fail(r.error);
    out.succeed('✓');
    onDone();
  };
  return (
    <div class="card" style={{ marginTop: 'var(--s3)' }}>
      <div class="fields">
        <Field label={t('Name')} wide><input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label={t('Frequency')}>
          <select value={frequency} onChange={(e) => setFrequency((e.target as HTMLSelectElement).value)}>
            <option value="">{t('Not scheduled')}</option>
            <option value="weekly">{t('Weekly')}</option>
            <option value="monthly">{t('Monthly')}</option>
            <option value="quarterly">{t('Quarterly')}</option>
            <option value="yearly">{t('Yearly')}</option>
          </select>
        </Field>
        {frequency && <Field label={t('Next date')}><DateInput value={nextDate} onInput={setNextDate} /></Field>}
        {frequency && <Field label={t('End date')}><DateInput value={endDate} onInput={setEndDate} /></Field>}
      </div>
      <ProblemBox p={out.problem} />
      <button class="primary" onClick={save}>{t('Memorize')}</button>
    </div>
  );
}
