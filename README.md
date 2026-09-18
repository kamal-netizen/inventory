# Stock

Warehouse stock tracking for **JNK Warehouse** and **Muscle Fusion**. Two warehouses,
two PINs, completely separate stock. Desktop-first, and it still works on a phone.

## Running it

Needs a PostgreSQL database. Point `DATABASE_URL` in `.env` at it and:

```bash
npm run dev
```

The schema is created on the first query — there is no separate migrate step.
Everything else configurable lives in `.env` too: PINs, warehouse names, logos.

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
  flavour, filterable by brand and by whether there is any. Low-stock items turn amber
  and sort to the top. Rendered 50 at a time; search still covers the whole list.
- **Product** — brand, name, flavour, quantity and low-stock alert. Typing a new
  quantity is recorded in History as a correction, never a silent rewrite.
- **Import from Excel** — upload a .xlsx or .csv, see exactly what will be added or
  changed, then confirm. Covers the awkward real-world cases: a single column, headers
  like `ItemName`, blank separator rows, and brand names sitting on their own row as
  section headings. A blank template is one click away.
- **New delivery note** — search, pick, enter quantity, repeat. The number is offered
  for you, carried on from the last one. All lines commit in one transaction, and an
  unfinished note survives navigating away or reloading.
- **Delivery notes** — every note ever raised, kept permanently. Searchable by number or
  customer, paged 50 at a time. Open one to see its lines, download a PDF, or cancel it
  (which puts all its stock back and marks it cancelled rather than deleting it).
- **History** — the full movement log, newest first, grouped by day and paged. Note
  lines link through to the stored document. Undo any manual change. Nothing is ever
  deleted.

Stock can never go negative, and products are hidden rather than deleted so old
delivery notes keep making sense.

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
  api/invoices/[id]/pdf/     delivery note PDF
  (app)/                     everything behind the PIN
    page.tsx                 stock list
    products/                add, edit, import
    invoice/new/             new delivery note
    invoices/                stored delivery notes + detail
    history/                 movement log + undo
lib/
  config.ts                  reads warehouses from .env (server only)
  db.ts                      Postgres pool, migrations, transaction helper
  queries.ts                 all data access — every query filtered by warehouse
  auth.ts                    PIN check, session cookie, lockout
  import.ts                  spreadsheet parsing
  invoice-pdf.ts             PDF generation
```

`lib/queries.ts` is the isolation boundary: every function takes a warehouse key and
filters on it, so no query can read across warehouses.

## The delivery note PDF

A one-page A4 note: the warehouse logo and name, note number, date, customer, every line
with its brand and quantity, and a total. It carries no prices, so it says plainly that
it is not a tax invoice.

pdfkit draws PNG and JPEG and never SVG, so `npm run logos` rasterises each logo once
and the result is committed. Re-run it after replacing one.

The file downloads as `[warehouse] [SO no] [date].pdf`, e.g.
`Muscle Fusion 46984 17-09-2026.pdf`.

## Dates

All dates and times display in `NEXT_PUBLIC_TIMEZONE` from `.env`, currently
`Asia/Dubai`. Timestamps are stored in UTC, so changing that setting re-displays
existing records correctly rather than rewriting anything.

## The database

PostgreSQL, reached through `DATABASE_URL`. In production the deployment platform
injects it, which requires the project's database to allow direct connections —
without that the app has no database to talk to and will not start.

This was SQLite in a file until the app moved onto a platform that rebuilds the
container on every deploy. The file lived inside the container, so every deploy
threw it away along with everything in it. That is the whole reason for Postgres:
the data has to outlive the container.

Schema changes go in the `MIGRATIONS` array in `lib/db.ts` — append a new entry,
never edit an existing one. They run on first query, inside an advisory lock, so
several instances starting together cannot race each other.

Every write that touches more than one row goes through `transaction()` in
`lib/db.ts`, and everything inside it must use the client it is handed. Reaching
for `query()` instead takes a different connection from the pool and lands outside
the transaction — which is how an all-or-nothing delivery note quietly becomes a
partial one.
