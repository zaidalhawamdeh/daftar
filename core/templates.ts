// Starting charts of accounts. Our own wording, in English and Arabic.

import type { AccountType } from './accounts.ts';

export interface TemplateAccount {
  number: string;
  name: { en: string; ar: string };
  type: AccountType;
  parent?: string;
}

export const BASIC_CHART: readonly TemplateAccount[] = [
  { number: '1000', name: { en: 'Cash on Hand', ar: 'الصندوق' }, type: 'bank' },
  { number: '1010', name: { en: 'Checking Account', ar: 'الحساب الجاري' }, type: 'bank' },
  { number: '1200', name: { en: 'Accounts Receivable', ar: 'الذمم المدينة' }, type: 'accounts_receivable' },
  { number: '1300', name: { en: 'Inventory', ar: 'المخزون' }, type: 'other_current_asset' },
  { number: '1350', name: { en: 'Prepaid Expenses', ar: 'مصاريف مدفوعة مقدماً' }, type: 'other_current_asset' },
  { number: '1500', name: { en: 'Furniture and Equipment', ar: 'الأثاث والمعدات' }, type: 'fixed_asset' },
  { number: '1590', name: { en: 'Accumulated Depreciation', ar: 'مجمع الاستهلاك' }, type: 'fixed_asset' },
  { number: '2000', name: { en: 'Accounts Payable', ar: 'الذمم الدائنة' }, type: 'accounts_payable' },
  { number: '2100', name: { en: 'Credit Card', ar: 'بطاقة الائتمان' }, type: 'credit_card' },
  { number: '2200', name: { en: 'Sales Tax Payable', ar: 'ضريبة المبيعات المستحقة' }, type: 'other_current_liability' },
  { number: '2300', name: { en: 'Payroll Liabilities', ar: 'مستحقات الرواتب' }, type: 'other_current_liability' },
  { number: '2700', name: { en: 'Loans Payable', ar: 'القروض' }, type: 'long_term_liability' },
  { number: '3000', name: { en: "Owner's Capital", ar: 'رأس المال' }, type: 'equity' },
  { number: '3100', name: { en: "Owner's Draws", ar: 'مسحوبات المالك' }, type: 'equity' },
  { number: '3200', name: { en: 'Opening Balance Equity', ar: 'حقوق ملكية الأرصدة الافتتاحية' }, type: 'equity' },
  { number: '4000', name: { en: 'Sales', ar: 'المبيعات' }, type: 'income' },
  { number: '4100', name: { en: 'Service Income', ar: 'إيرادات الخدمات' }, type: 'income' },
  { number: '4900', name: { en: 'Sales Discounts', ar: 'خصومات المبيعات' }, type: 'income' },
  { number: '5000', name: { en: 'Cost of Goods Sold', ar: 'تكلفة البضاعة المباعة' }, type: 'cost_of_goods_sold' },
  { number: '6000', name: { en: 'Rent', ar: 'الإيجار' }, type: 'expense' },
  { number: '6100', name: { en: 'Salaries and Wages', ar: 'الرواتب والأجور' }, type: 'expense' },
  { number: '6200', name: { en: 'Utilities', ar: 'الكهرباء والماء' }, type: 'expense' },
  { number: '6300', name: { en: 'Telephone and Internet', ar: 'الهاتف والإنترنت' }, type: 'expense' },
  { number: '6400', name: { en: 'Office Supplies', ar: 'لوازم مكتبية' }, type: 'expense' },
  { number: '6500', name: { en: 'Advertising', ar: 'الإعلان' }, type: 'expense' },
  { number: '6600', name: { en: 'Fuel and Transport', ar: 'المحروقات والمواصلات' }, type: 'expense' },
  { number: '6700', name: { en: 'Depreciation', ar: 'الاستهلاك' }, type: 'expense' },
  { number: '6800', name: { en: 'Professional Fees', ar: 'أتعاب مهنية' }, type: 'expense' },
  { number: '7000', name: { en: 'Interest Income', ar: 'إيرادات الفوائد' }, type: 'other_income' },
  { number: '8000', name: { en: 'Bank Charges', ar: 'العمولات البنكية' }, type: 'other_expense' },
];
