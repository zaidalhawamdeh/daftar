// Chart of accounts. Account types are standard accounting categories; each belongs to one class,
// and the class decides the normal balance and where the account lands in reports.

export type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type AccountType =
  | 'bank'
  | 'accounts_receivable'
  | 'other_current_asset'
  | 'fixed_asset'
  | 'other_asset'
  | 'accounts_payable'
  | 'credit_card'
  | 'other_current_liability'
  | 'long_term_liability'
  | 'equity'
  | 'income'
  | 'cost_of_goods_sold'
  | 'expense'
  | 'other_income'
  | 'other_expense';

export interface AccountTypeInfo {
  class: AccountClass;
  order: number;
  label: { en: string; ar: string };
}

export const ACCOUNT_TYPES: Record<AccountType, AccountTypeInfo> = {
  bank: { class: 'asset', order: 10, label: { en: 'Bank', ar: 'بنك ونقد' } },
  accounts_receivable: { class: 'asset', order: 20, label: { en: 'Accounts Receivable', ar: 'ذمم مدينة' } },
  other_current_asset: { class: 'asset', order: 30, label: { en: 'Other Current Asset', ar: 'أصول متداولة أخرى' } },
  fixed_asset: { class: 'asset', order: 40, label: { en: 'Fixed Asset', ar: 'أصول ثابتة' } },
  other_asset: { class: 'asset', order: 50, label: { en: 'Other Asset', ar: 'أصول أخرى' } },
  accounts_payable: { class: 'liability', order: 60, label: { en: 'Accounts Payable', ar: 'ذمم دائنة' } },
  credit_card: { class: 'liability', order: 70, label: { en: 'Credit Card', ar: 'بطاقة ائتمان' } },
  other_current_liability: { class: 'liability', order: 80, label: { en: 'Other Current Liability', ar: 'التزامات متداولة أخرى' } },
  long_term_liability: { class: 'liability', order: 90, label: { en: 'Long Term Liability', ar: 'التزامات طويلة الأجل' } },
  equity: { class: 'equity', order: 100, label: { en: 'Equity', ar: 'حقوق الملكية' } },
  income: { class: 'income', order: 110, label: { en: 'Income', ar: 'إيرادات' } },
  cost_of_goods_sold: { class: 'expense', order: 120, label: { en: 'Cost of Goods Sold', ar: 'تكلفة البضاعة المباعة' } },
  expense: { class: 'expense', order: 130, label: { en: 'Expense', ar: 'مصاريف' } },
  other_income: { class: 'income', order: 140, label: { en: 'Other Income', ar: 'إيرادات أخرى' } },
  other_expense: { class: 'expense', order: 150, label: { en: 'Other Expense', ar: 'مصاريف أخرى' } },
};

export function isAccountType(t: unknown): t is AccountType {
  return typeof t === 'string' && Object.hasOwn(ACCOUNT_TYPES, t);
}

export function classOf(t: AccountType): AccountClass {
  return ACCOUNT_TYPES[t].class;
}

export function normalSide(t: AccountType): 'debit' | 'credit' {
  const c = classOf(t);
  return c === 'asset' || c === 'expense' ? 'debit' : 'credit';
}

// The one account the system owns: prior years' profit lands here on the balance sheet.
export type AccountRole = 'retained_earnings';

export interface Account {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  active: boolean;
  role: AccountRole | null;
}

export const MAX_DEPTH = 5;
