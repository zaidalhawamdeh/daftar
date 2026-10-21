import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import type { Item, ItemType } from '../../../core/items.ts';
import { formatAmount } from '../../../core/money.ts';
import { t } from '../i18n.ts';
import { run } from '../state.ts';
import { AccountSelect, AmountInput, Empty, Field, Money, ProblemBox, badAmount, parseMoney, useOutcome } from '../ui.tsx';

const ITEM_TYPES: [ItemType, string][] = [['service', 'Service'], ['non_inventory', 'Non-inventory part'], ['other_charge', 'Other charge']];

export function Items({ c }: { c: Company }) {
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const rows = [...c.items.values()].filter((i) => showInactive || i.active).sort((a, b) => a.name.localeCompare(b.name));
  const acct = (id: string | null) => (id ? c.accounts.get(id)?.name ?? '' : '');
  return (
    <div>
      <div class="row">
        <h1>{t('Items')}</h1>
        <span class="spacer" />
        <label class="check"><input type="checkbox" checked={showInactive} onChange={() => setShowInactive(!showInactive)} /> {t('Show inactive')}</label>
        <button class="primary" onClick={() => setEditing('new')}>{t('New')}</button>
      </div>
      {editing && <ItemForm c={c} item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      {rows.length === 0 ? <Empty /> : (
        <div class="table-wrap">
          <table>
            <thead><tr><th>{t('Name')}</th><th>{t('Type')}</th><th class="n">{t('Sales price')}</th><th>{t('Sales account')}</th><th class="n">{t('Cost')}</th><th>{t('Purchase account')}</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} class={i.active ? '' : 'void'}>
                  <td>{i.name}</td>
                  <td class="muted">{t(ITEM_TYPES.find(([k]) => k === i.type)?.[1] ?? '')}</td>
                  <td class="n"><Money c={c} value={i.price} blankZero /></td>
                  <td>{acct(i.salesAccountId)}</td>
                  <td class="n"><Money c={c} value={i.cost} blankZero /></td>
                  <td>{acct(i.purchaseAccountId)}</td>
                  <td class="n">
                    <button class="small" onClick={() => setEditing(i)}>{t('Edit')}</button>{' '}
                    <button class="small" onClick={() => run('item.setActive', { id: i.id, active: !i.active })}>{i.active ? t('Make inactive') : t('Make active')}</button>
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

function ItemForm({ c, item, onDone }: { c: Company; item: Item | null; onDone: () => void }) {
  const out = useOutcome();
  const [type, setType] = useState<ItemType>(item?.type ?? 'service');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item && item.price ? formatAmount(item.price, c.currency, { grouping: false }) : '');
  const [cost, setCost] = useState(item && item.cost ? formatAmount(item.cost, c.currency, { grouping: false }) : '');
  const [salesAccountId, setSales] = useState(item?.salesAccountId ?? '');
  const [purchaseAccountId, setPurchase] = useState(item?.purchaseAccountId ?? '');
  const save = (e: Event) => {
    e.preventDefault();
    const bad = badAmount(c, price, cost);
    if (bad) return out.fail(bad);
    const params = { type, name, description, price: parseMoney(c, price) ?? 0, cost: parseMoney(c, cost) ?? 0, salesAccountId: salesAccountId || null, purchaseAccountId: purchaseAccountId || null };
    const r = item ? run('item.update', { id: item.id, ...params, type: undefined }) : run('item.create', params);
    if (!r.ok) return out.fail(r.error);
    onDone();
  };
  return (
    <form class="card" style={{ marginBottom: 'var(--s4)' }} onSubmit={save}>
      <div class="fields">
        <Field label={t('Type')}>
          <select value={type} disabled={!!item} onChange={(e) => setType((e.target as HTMLSelectElement).value as ItemType)}>
            {ITEM_TYPES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </Field>
        <Field label={t('Name')} wide><input value={name} required onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label={t('Description')} wide><input value={description} onInput={(e) => setDescription((e.target as HTMLInputElement).value)} /></Field>
        <Field label={t('Sales price')}><AmountInput c={c} value={price} onInput={setPrice} /></Field>
        <Field label={t('Sales account')}><AccountSelect c={c} value={salesAccountId} onChange={setSales} types={['income', 'other_income']} allowNone /></Field>
        <Field label={t('Cost')}><AmountInput c={c} value={cost} onInput={setCost} /></Field>
        <Field label={t('Purchase account')}><AccountSelect c={c} value={purchaseAccountId} onChange={setPurchase} exclude={['accounts_receivable', 'accounts_payable']} allowNone /></Field>
      </div>
      <ProblemBox p={out.problem} />
      <div class="row">
        <button class="primary" type="submit">{t('Save')}</button>
        <button type="button" onClick={onDone}>{t('Cancel')}</button>
      </div>
    </form>
  );
}
