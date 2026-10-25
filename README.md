# Daftar

**Open-source accounting for small businesses that stays on your computer.** Daftar follows the
workflows people know from QuickBooks Desktop (invoices, bills, payments, bank reconciliation, the
standard reports) and runs in the browser or installs as an app, with no account, no server and no
internet needed.

*Daftar (دفتر) is Arabic for "ledger".*

![Home](docs/images/home.png)

> **Status: early.** The accounting core is complete for a service business and heavily tested,
> with UAE VAT; inventory, other countries' taxes, multiple currencies and payroll are not built yet
> (see [Roadmap](#roadmap)).
> Read the [limits](#what-it-does-not-do-yet) before trusting it with real books.

## Why

QuickBooks Desktop has been moving to subscriptions: in September 2024 Intuit stopped selling Pro
Plus, Premier Plus and Mac Plus to new US customers. The main open-source desktop alternative,
Frappe Books, archived its desktop app in October 2026 in favour of a self-hosted web version.
Daftar is for people who want a desktop-style program they own, whose file stays on their own
computer, that works the way small-business bookkeepers already work.

## What it does

- **Sales:** estimates, invoices, sales receipts, credit memos; receive payments and apply them to
  several invoices; partial payments; overpayments kept as customer credit.
- **Purchases:** purchase orders, bills, vendor credits, pay bills, checks and expenses, transfers.
- **Banking:** reconcile bank and credit card accounts against a statement; undo the last
  reconciliation; reconciliation report.
- **Reports:** profit and loss, balance sheet, statement of cash flows, trial balance, general
  ledger, A/R and A/P aging, customer and vendor balances, open invoices, unpaid bills.
- **Recurring transactions:** memorize an invoice, bill or expense and run it weekly, monthly,
  quarterly or yearly.
- **Moving in:** import QuickBooks lists from IIF, opening balances from CSV reports (trial
  balance, open invoices, unpaid bills), and customer, vendor, item and account lists from CSV.
  Transactions in IIF files made by other programs are imported too. Export to IIF.
- **UAE VAT:** register the company (TRN, emirate, address, effective date); standard-rated,
  zero-rated, exempt, out-of-scope and reverse-charge lines; prices with or without VAT; printable
  tax invoices (Executive Regulation Article 59) and tax credit notes that name the invoice they
  correct and give the reason (Article 60); and the VAT 201 return box by box. VAT is worked out per
  line and rounded to the nearest fils, as the FTA's clarification VATP006 describes. After filing,
  one click closes the books through the end of the period, so nothing can change what was filed.
  Assumptions: the date of supply is the document date; no discounts; standard-rated sales go under
  the emirate currently set (the business's establishment); VAT on purchases is worked out per line,
  so it can differ by a fils from a supplier's document that rounds on the total.
- **Arabic and English**, right-to-left and left-to-right, light and dark. Three-decimal currencies
  (JOD, KWD, BHD, OMR) are first-class; Arabic digits are accepted in every amount.
- **Every action is a named command** (press <kbd>Ctrl</kbd>+<kbd>K</kbd>), so anything a person
  can do, a script or an AI agent can do through the same door.

| | |
|---|---|
| ![Invoice](docs/images/invoice.png) | ![Reconcile, dark](docs/images/reconcile-dark.png) |
| ![Profit and loss in Arabic](docs/images/reports-arabic.png) | |

## How correctness is enforced

People will run real businesses on this, so a wrong number is treated as worse than a missing
feature. The rules are written down in [`CLAUDE.md`](CLAUDE.md) and checked by tests:

- Money is an integer count of the currency's smallest unit. Nothing is ever a float, and only two
  things are rounded, half away from zero with BigInt: quantity × rate, and each line's VAT.
- Every journal entry balances or is refused. Posted entries are never edited or deleted; mistakes
  are reversed or voided. Closed periods stay closed.
- Receivables and payables move only through documents, so receivables always equal the customer
  balances and the open invoices minus unapplied credits, at every date.
- Every report is computed from the journal; nothing is stored that could drift.
- **Golden books:** a bakery in Jordanian dinars, a design studio in US dollars, and a QuickBooks
  IIF file were computed by hand before their tests ran; every report must match them to the last
  fils or cent.
- **Property tests:** random companies (120 companies × 60 operations for the receivables tie, up
  to 300 for the journal) keep every identity: trial balance, balance sheet, cash flow, the
  three-way receivables tie, reconciliation, IIF round trip.
- **Adversarial review:** after each milestone a separate agent tried to break the numbers. Every
  confirmed finding was fixed; those in the accounting core each have a regression test
  (`core/test/refuted*.test.ts`), and interface fixes were checked in the browser.
- **Integrity check:** `core/integrity.ts` verifies every assumption the core makes, including that
  each document's entry is exactly what the document posts, line by line. A company file must pass
  it to open, every command is checked against it before its change is kept, and every random test
  asserts it.

138 tests run in about six seconds: `npm test`.

## Try it

Requires Node 24.

```bash
npm install
npm run dev
```

Open the printed address and choose **Try the sample company**. For a production build that works
offline (Chrome and Edge can also install it from the address bar):

```bash
npm run build
npx vite preview app
```

To build the Windows installer (`release/Daftar-Setup-<version>.exe`) and check the packaged program:

```bash
npm run dist:win
node scripts/desktop-smoke.ts
```

The installer is not code-signed yet, so Windows SmartScreen warns before the first run.

Your company is saved in the browser on your computer (IndexedDB), with the last 20 versions kept.
Browsers can still clear site data (Safari does for sites left unused for a while), so
**Settings → *Download backup file* is your real backup**: it saves a `.daftar` file you can keep
anywhere.

`npm run screenshots` drives the Edge installed on Windows; set `DAFTAR_BROWSER` to another
Chromium-based browser's path elsewhere.

### Moving from QuickBooks Desktop

QuickBooks Desktop exports lists to IIF but not transactions, so you bring your lists and your
balances on the day you switch:

1. In QuickBooks: *File → Utilities → Export → Lists to IIF Files*. In Daftar, on a new company
   with an empty chart of accounts: *Company → Import → QuickBooks file (IIF)*, check the preview,
   then import.
2. In QuickBooks, export these reports as CSV on your start date: *Trial Balance*, *Open
   Invoices*, *Unpaid Bills*. In Daftar: *Company → Import → Opening balances (CSV)*.

IIF files that do contain transactions (made by other programs) are imported too: a transaction
that matches a document (invoice, bill, payment, check…) becomes that document, with each line as
quantity 1 × its amount; anything else comes in exactly through an *Import clearing* account that
nets to zero. IIF does not record which payment paid which invoice, so payments are applied to the
oldest open invoices. Exporting to IIF and importing back reproduces the trial balance and every
party balance when both companies use the same fiscal-year start, which IIF does not carry.

## What it does not do yet

Inventory quantities and costing · VAT outside the UAE · in UAE VAT: imports through customs
(Boxes 6 and 7), partial or blocked input tax, zero-rated services received under the reverse
charge, supplies where the customer accounts for the VAT, the profit margin scheme, designated
zones, a change of emirate between periods, and electronic invoicing · multiple currencies · payroll · several users on one company · bank feeds ·
budgets · a logo and letterhead on printed documents ·
editing a posted invoice or bill (void it and enter it again) · deposit slips and Undeposited Funds
(create the account, receive payments into it, then transfer) · exporting reports to CSV or Excel
(they can be printed) · a Frappe Books importer (its file format is defined by AGPL code, which this
clean-room project does not read).

The basic chart of accounts includes Inventory, Sales Tax Payable and Payroll Liabilities so a
chart moved from QuickBooks lines up; the features behind them are not built yet.

The QuickBooks feature list in [`catalog/`](catalog/PARITY.md) (57 of 150 features delivered) was
drafted from general knowledge of the product and is not yet checked entry by entry against
Intuit's public help pages.

## Roadmap

UAE electronic invoicing (Peppol, PINT AE; mandatory for most businesses from July 2027 under
Ministerial Decision No. 244 of 2025) · VAT for Saudi Arabia, including its e-invoicing · inventory ·
multiple currencies · statements · a signed installer, and macOS and Linux packages · several users.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) first: it is the working agreement for people and agents alike. Every
change comes with tests; anything that touches numbers comes with a golden-book or property test.

```bash
npm run check   # typecheck, tests, parity floor
```

## Clean room

Daftar is written from scratch. No code is taken from QuickBooks or from any GPL/AGPL project.
QuickBooks file support is based on Intuit's published IIF format and on files QuickBooks exports.
All icons and images are original.

QuickBooks is a trademark of Intuit Inc. Daftar is an independent project and is not affiliated
with, sponsored by or endorsed by Intuit; the name is used only to describe compatibility.

## License

[Apache License 2.0](LICENSE). Copyright © 2026 Zaid Alhawamdeh Technology; see [`NOTICE`](NOTICE).
