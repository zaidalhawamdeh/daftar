// Products and services. An item knows which account its sales and its purchases post to, and its
// default price and cost.

import { classOf } from './accounts.ts';
import { cleanName, isObject, type Company } from './company.ts';
import { isMinor, type Minor } from './money.ts';
import { err, ok, type Result } from './result.ts';
import { ITEM_TAX_CODES, type TaxCode } from './vat.ts';

export type ItemType = 'service' | 'non_inventory' | 'other_charge';
const ITEM_TYPES: readonly ItemType[] = ['service', 'non_inventory', 'other_charge'];

export interface Item {
  id: string;
  type: ItemType;
  name: string;
  description: string;
  price: Minor; // default sales rate
  cost: Minor; // default purchase rate
  salesAccountId: string | null;
  purchaseAccountId: string | null;
  taxCode: TaxCode | null; // default VAT code on lines; null means standard rate
  active: boolean;
}

export interface ItemInput {
  type?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  cost?: unknown;
  salesAccountId?: unknown;
  purchaseAccountId?: unknown;
  taxCode?: unknown;
}

const NOT_POSTABLE = new Set(['accounts_receivable', 'accounts_payable']);

function rate(v: unknown, what: string): Result<Minor> {
  if (v === undefined || v === null) return ok(0);
  if (!isMinor(v) || v < 0) return err('item.rate_invalid', `${what} must be a whole, non-negative number of minor units.`);
  return ok(v);
}

function account(c: Company, v: unknown, side: 'sales' | 'purchase'): Result<string | null> {
  if (v === undefined || v === null || v === '') return ok(null);
  const a = typeof v === 'string' ? c.accounts.get(v) : undefined;
  if (!a) return err('item.account_missing', `The ${side} account does not exist.`);
  if (!a.active) return err('item.account_inactive', `"${a.name}" is inactive.`);
  if (NOT_POSTABLE.has(a.type)) return err('item.account_type', `An item cannot post to "${a.name}".`);
  if (side === 'sales' && classOf(a.type) !== 'income') return err('item.account_class', `Sales should post to an income account, not "${a.name}".`);
  return ok(a.id);
}

function taxCodeOf(v: unknown): Result<TaxCode | null> {
  if (v === undefined || v === null || v === '') return ok(null);
  if (typeof v !== 'string' || !(ITEM_TAX_CODES as readonly string[]).includes(v)) return err('item.tax_code_invalid', 'Tax code is SR, ZR, EX or OS.');
  return ok(v as TaxCode);
}

function uniqueName(c: Company, name: string, selfId: string | null): Result<string> {
  const k = name.toLowerCase();
  for (const i of c.items.values()) if (i.id !== selfId && i.name.toLowerCase() === k) return err('item.name_taken', `An item named "${i.name}" already exists.`);
  return ok(name);
}

function description(v: unknown): Result<string> {
  if (v === undefined || v === null) return ok('');
  if (typeof v !== 'string' || v.length > 1000) return err('item.description_invalid', 'Description is text up to 1000 characters.');
  return ok(v.trim());
}

export function createItem(c: Company, input: ItemInput): Result<Item> {
  if (!isObject(input)) return err('item.invalid', 'Item details are missing.');
  const type = input.type ?? 'service';
  if (typeof type !== 'string' || !ITEM_TYPES.includes(type as ItemType)) return err('item.type_invalid', 'Item type is service, non_inventory or other_charge.');
  const name = cleanName(input.name, 100, 'item name');
  if (!name.ok) return name;
  const unique = uniqueName(c, name.value, null);
  if (!unique.ok) return unique;
  const desc = description(input.description);
  if (!desc.ok) return desc;
  const price = rate(input.price, 'Price');
  if (!price.ok) return price;
  const cost = rate(input.cost, 'Cost');
  if (!cost.ok) return cost;
  const sales = account(c, input.salesAccountId, 'sales');
  if (!sales.ok) return sales;
  const purchase = account(c, input.purchaseAccountId, 'purchase');
  if (!purchase.ok) return purchase;
  if (!sales.value && !purchase.value) return err('item.no_account', 'An item needs a sales account, a purchase account, or both.');
  const taxCode = taxCodeOf(input.taxCode);
  if (!taxCode.ok) return taxCode;
  const item: Item = {
    id: `i-${c.nextItemId++}`,
    type: type as ItemType,
    name: name.value,
    description: desc.value,
    price: price.value,
    cost: cost.value,
    salesAccountId: sales.value,
    purchaseAccountId: purchase.value,
    taxCode: taxCode.value,
    active: true,
  };
  c.items.set(item.id, item);
  return ok(item);
}

export function updateItem(c: Company, id: unknown, input: ItemInput): Result<Item> {
  const i = typeof id === 'string' ? c.items.get(id) : undefined;
  if (!i) return err('item.missing', 'Item does not exist.');
  if (!isObject(input)) return err('item.invalid', 'Item details are missing.');
  if (input.type !== undefined && input.type !== i.type) return err('item.type_locked', 'An item keeps its type.');
  const name = input.name === undefined ? ok(i.name) : cleanName(input.name, 100, 'item name');
  if (!name.ok) return name;
  const unique = uniqueName(c, name.value, i.id);
  if (!unique.ok) return unique;
  const desc = input.description === undefined ? ok(i.description) : description(input.description);
  if (!desc.ok) return desc;
  const price = input.price === undefined ? ok(i.price) : rate(input.price, 'Price');
  if (!price.ok) return price;
  const cost = input.cost === undefined ? ok(i.cost) : rate(input.cost, 'Cost');
  if (!cost.ok) return cost;
  const sales = input.salesAccountId === undefined ? ok(i.salesAccountId) : account(c, input.salesAccountId, 'sales');
  if (!sales.ok) return sales;
  const purchase = input.purchaseAccountId === undefined ? ok(i.purchaseAccountId) : account(c, input.purchaseAccountId, 'purchase');
  if (!purchase.ok) return purchase;
  if (!sales.value && !purchase.value) return err('item.no_account', 'An item needs a sales account, a purchase account, or both.');
  const taxCode = input.taxCode === undefined ? ok(i.taxCode) : taxCodeOf(input.taxCode);
  if (!taxCode.ok) return taxCode;
  Object.assign(i, { taxCode: taxCode.value, name: name.value, description: desc.value, price: price.value, cost: cost.value, salesAccountId: sales.value, purchaseAccountId: purchase.value });
  return ok(i);
}

export function setItemActive(c: Company, id: unknown, active: unknown): Result<Item> {
  const i = typeof id === 'string' ? c.items.get(id) : undefined;
  if (!i) return err('item.missing', 'Item does not exist.');
  if (typeof active !== 'boolean') return err('item.active_invalid', 'Active must be true or false.');
  i.active = active;
  return ok(i);
}

export function findItem(c: Company, key: unknown): Item | undefined {
  if (typeof key !== 'string') return undefined;
  const byId = c.items.get(key);
  if (byId) return byId;
  const k = key.trim().toLowerCase();
  for (const i of c.items.values()) if (i.name.toLowerCase() === k) return i;
  return undefined;
}
