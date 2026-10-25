# Daftar — instructions for agents

Daftar is a clean-room, open-source, offline-first accounting app for small businesses,
targeting QuickBooks Desktop parity in workflow, plus what QuickBooks never did well: Arabic and
right-to-left, 3-decimal currencies, and a file that stays yours. The roadmap and the current limits
are in [`README.md`](README.md). Public text (README, issues, posts) is English.

## Correctness outranks everything
People will run real businesses on this. A wrong number is worse than a missing feature.
- **Money is an integer in the currency's minor unit** (JOD/KWD/BHD = 3 decimals, USD/EUR = 2).
  Never `number` arithmetic on fractional money, never floats in storage.
- **Only two things round, both half away from zero with BigInt:** a line's quantity × rate, and a
  line's VAT (`core/vat.ts`, per the UAE Executive Regulation Art. 61 and FTA clarification VATP006:
  per line, to the nearest fils). Nothing else is ever rounded.
- **VAT comes from tax codes, never from a line on a VAT account.** A document's entry holds exactly
  the VAT its lines compute; reverse-charge VAT sits on both the output and the input account. VAT
  accounts are top-level, childless, and never receive or pay money directly.
- **Every document's entry is rebuilt from the document** (`postingFor`) when it is posted and again
  by the integrity check, which compares them line by line. `execute` runs the integrity check after
  every change and undoes a change that fails it, so no command can leave a company that will not open.
- **Every journal entry balances** (sum of debits = sum of credits, per currency) or is rejected.
- **Reports are derived from posted entries only.** No stored balance that can drift.
- **Posted entries are never edited or deleted.** Corrections are reversing entries.
  Posted entries are frozen objects; commands hand out copies, never live state.
- **Closed periods stay closed.** Moving the closing date earlier needs `reopen: true` and is logged;
  the fiscal year cannot change while closed periods hold entries.
- **Every report agrees with every other at every date.** The general ledger restarts income and
  expense accounts each fiscal year and shows each closed year's profit on Retained Earnings, so
  its closing balances equal the trial balance (property-tested).
- **Receivables and payables move only through documents** (invoices, bills, payments, credits).
  A plain journal entry cannot touch them, and a document's entry is undone only by voiding the
  document. So A/R = customer balances = open invoices − unapplied credits at every date (fuzzed).
- **Sums are checked.** A total beyond exact integer range is refused (`amount.too_large`), never rounded.
- **Golden books:** `core/test/golden/` holds companies computed by hand (the IIF golden file is
  inline in `core/test/iif.test.ts`). Every report must match them to the minor unit. A change that moves a golden number is a bug until proven otherwise.
- Property tests: thousands of random valid transactions → trial balance always zero.

## Never crash, never lose data
- Errors are values (`Result`-style); a failed command leaves the company file unchanged.
- Writes are transactional. Automatic backups before migrations and on close.
- Input from files and imports is hostile: validate, clamp, never trust.

## Clean room
- Sources: Intuit's **public** help pages, the published IIF format, and files QuickBooks exports
  (Excel, CSV, IIF). Never read, decompile or reverse-engineer QuickBooks binaries or the `.QBW` format.
- Never copy code from GPL/AGPL projects (Frappe Books, GnuCash, ERPNext, Odoo, Akaunting…).
  Reading their public issue trackers to learn what users ask for is fine.
- No Intuit icons, images, templates, fonts or wording beyond feature names. All assets original or
  openly licensed, each with a row in `ATTRIBUTION.md`.
- "QuickBooks" appears only to describe compatibility, with a not-affiliated notice.

## Architecture
| Layer | Folder | Job |
|---|---|---|
| core | `core/` | money, accounts, journal, documents, reports. Pure TypeScript, no UI, no I/O |
| store | `store/` | company file (JSON) save/load; every load must pass `core/integrity.ts` |
| commands | `core/commands/` | every user action is a named command with typed params |
| app | `app/` | UI (web; same build runs in the browser and in the desktop shell) |
| import | `core/import/` | QuickBooks IIF in and out, opening balances and lists from CSV |
| catalog | `catalog/` | QuickBooks Desktop feature list mapped to command ids → parity number |

- **Everything is a command.** Buttons, menus, CLI and tests all dispatch by command id.
- **Parity is measured.** `catalog/` lists QuickBooks Desktop features; a script prints live/total;
  a test keeps the number from falling.

## Quality gates
Before every commit: typecheck, tests, golden books, parity floor. Commit after each piece that works,
with the milestone id in the message (`M1: trial balance`).
