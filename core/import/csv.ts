// CSV as spreadsheets save it: quoted fields with doubled quotes, commas, semicolons or tabs,
// CRLF or LF, an optional byte-order mark. Headers are matched loosely so a file saved from an
// English or Arabic spreadsheet both work.

export interface Table {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  const [headers = [], ...rest] = rows;
  return { headers: headers.map((h) => h.trim()), rows: rest.map((r) => r.map((f) => f.trim())) };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.:#]+/g, '');

// Index of the first header matching any of the names (case, spacing and punctuation ignored).
export function column(t: Table, names: string[]): number {
  const wanted = names.map(norm);
  return t.headers.findIndex((h) => wanted.includes(norm(h)));
}
