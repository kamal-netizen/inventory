# Stock

Warehouse stock tracking for **JNK Warehouse** and **Muscle Fusion**. Two warehouses,
two PINs, completely separate stock. Desktop-first, and it still works on a phone.

## Running it

```bash
npm run dev
```

Everything configurable lives in `.env` — PINs, warehouse names, where the database
file goes.

## Logging in

One screen: a number pad. The PIN both identifies the warehouse and signs you in, so
nothing on that screen reveals who uses the app.

The live PINs are in `.env` as `PIN_JNK` and `PIN_MUSCLE_FUSION`, which is the only
place they exist — deliberately not here, because this file is in the repository.
Change one by editing `.env` and restarting.

After a first successful entry the device stays signed in for 60 days.

Five wrong PINs locks that device for 15 minutes, then an hour, then a day:

```bash
npm run unlock
```

## What it does

- **Stock list** — every product grouped by brand, searchable by product, brand or
  flavour. Low-stock items turn amber and sort to the top. Click a row to open it.
- **Product** — brand, name, flavour, quantity and low-stock alert. Typing a new
  quantity is recorded in History as a correction, never a silent rewrite.
- **Import from Excel** — upload a .xlsx or .csv, see exactly what will be added or
  changed, then confirm. Covers the awkward real-world cases: a single column, headers
  like `ItemName`, blank separator rows, and brand names sitting on their own row as
  section headings. A blank template is one click away.
- **New invoice** — search, pick, enter quantity, repeat; add the invoice/SO number and
  save. All lines commit in one transaction. An unfinished invoice survives navigating
  away or reloading.
- **Invoices** — every invoice ever raised, kept permanently. Searchable by number or
  customer, paged 50 at a time. Open one to see its lines, download a PDF, or cancel it
  (which puts all its stock back and marks it cancelled rather than deleting it).
- **History** — the full movement log, newest first, grouped by day and paged. Invoice
  lines link through to the stored invoice. Undo any manual change. Nothing is ever
  deleted.

Stock can never go negative, and products are hidden rather than deleted so old
invoices keep making sense.

## Import rules

- Only a **product name** column is required. Missing columns are left alone rather
  than zeroed, so re-importing a catalogue with no quantity column never wipes stock.
- Products are matched on **brand + name + flavour**, case-insensitively.
- Rows sitting alone above a group of products are treated as **brand headings**. The
  preview lists what it found and lets you turn that off.

## Layout

```
app/
  login/                     number pad
  api/import-template/       blank .xlsx download
  api/invoices/[id]/pdf/     invoice PDF
  (app)/                     everything behind the PIN
    page.tsx                 stock list
    products/                add, edit, import
    invoice/new/             new invoice
    invoices/                stored invoices + detail
    history/                 movement log + undo
lib/
  config.ts                  reads warehouses from .env (server only)
  db.ts                      SQLite connection + migrations
  queries.ts                 all data access — every query filtered by warehouse
  auth.ts                    PIN check, session cookie, lockout
  import.ts                  spreadsheet parsing
  invoice-pdf.ts             PDF generation
```

`lib/queries.ts` is the isolation boundary: every function takes a warehouse key and
filters on it, so no query can read across warehouses.

## The invoice PDF

A one-page A4 note: warehouse name, invoice number, date, customer, every line with its
brand and quantity, and a total. It carries no prices, so it is labelled a stock issue
note rather than a tax invoice.

The file downloads as `[warehouse] [SO no] [date].pdf`, e.g.
`Muscle Fusion 46984 17-09-2026.pdf`.

## Dates

All dates and times display in `NEXT_PUBLIC_TIMEZONE` from `.env`, currently
`Asia/Dubai`. Timestamps are stored in UTC, so changing that setting re-displays
existing records correctly rather than rewriting anything.

## The database

One SQLite file at `data/inventory.db`. Back it up by copying that file. Schema changes
go in the `MIGRATIONS` array in `lib/db.ts` — append a new entry, never edit an existing
one.

To start over with an empty database, stop the app and delete `data/`.
