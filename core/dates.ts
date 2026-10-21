// Dates are calendar days written YYYY-MM-DD. ISO strings sort correctly as text.

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// First day of the fiscal year that contains `date`.
export function fiscalYearStart(date: string, startMonth: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${m >= startMonth ? y : y - 1}-${pad(startMonth)}-01`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Whole days from a to b (positive when b is later).
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

// The same day `months` later, kept on `anchorDay` and clamped to the end of shorter months
// (31 Jan → 28 Feb → 31 Mar).
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return `${pad(ny, 4)}-${pad(nm)}-${pad(day)}`;
}

export function dayBefore(date: string): string {
  return addDays(date, -1);
}
