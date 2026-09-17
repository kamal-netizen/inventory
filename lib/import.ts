import "server-only";
import ExcelJS from "exceljs";
import type { ImportCandidate } from "./queries";

/**
 * Reads a stock list out of a spreadsheet.
 *
 * Deliberately forgiving, because real files are messy: a single column, headers
 * written as "ItemName", a title line above the table, blank separator rows, and
 * brand names sitting on their own row acting as section headings.
 */

export interface ImportProblem {
  row: number;
  message: string;
}

export interface ParsedSheet {
  rows: ImportCandidate[];
  problems: ImportProblem[];
  headers: string[];
  /** Columns the file actually had. Missing ones must not overwrite existing data. */
  hasQuantity: boolean;
  hasLowStock: boolean;
  brandSource: "column" | "headings" | "none";
  /** Rows treated as section headings, so the preview can show what was assumed. */
  detectedBrands: string[];
}

export class ImportError extends Error {}

const ALIASES = {
  brand: ["brand", "brands", "company", "manufacturer", "make", "supplier"],
  name: [
    "product",
    "product name",
    "products",
    "name",
    "item",
    "item name",
    "items",
    "description",
    "particulars",
    "title",
  ],
  flavor: ["flavour", "flavor", "variant", "variants", "type", "pack", "size", "weight"],
  quantity: [
    "quantity",
    "qty",
    "stock",
    "in stock",
    "count",
    "units",
    "closing stock",
    "balance",
    "qty in hand",
    "on hand",
  ],
  lowStockAt: [
    "low stock",
    "low stock at",
    "low",
    "alert",
    "alert at",
    "alert below",
    "minimum",
    "min",
    "min stock",
    "reorder",
    "reorder level",
    "warn below",
  ],
} as const;

const MAX_ROWS = 20000;

/** "ItemName" and "item_name" both need to land on "item name". */
function normalise(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const value = cell.value;
  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    // Formula results, rich text and hyperlinks all box the real value.
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}

/** Blank counts as 0. Anything non-numeric is reported rather than guessed at. */
function readNumber(text: string): number | null {
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function loadWorkbook(file: Buffer, filename: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(filename)) {
      const { Readable } = await import("node:stream");
      await workbook.csv.read(Readable.from(file));
    } else {
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    }
  } catch {
    throw new ImportError("That file could not be opened. Save it as .xlsx or .csv and try again.");
  }
  return workbook;
}

export async function parseSheet(
  file: Buffer,
  filename: string,
  options: { useHeadingsAsBrands?: boolean } = {}
): Promise<ParsedSheet> {
  const useHeadings = options.useHeadingsAsBrands ?? true;
  const workbook = await loadWorkbook(file, filename);

  const sheet = workbook.worksheets.find((candidate) => candidate.rowCount > 1);
  if (!sheet) throw new ImportError("That file has no sheet with any rows in it.");

  const width = Math.max(sheet.columnCount, 1);
  const textAt = (row: number, column: number) => cellText(sheet.getRow(row).getCell(column));
  const rowTexts = (row: number) =>
    Array.from({ length: width }, (_, index) => textAt(row, index + 1));

  // The header is the first row in which some cell names the product column.
  // Looking for a known word (rather than "a row with several cells") is what
  // makes a single-column sheet work.
  let headerRow = 0;
  let headers: string[] = [];

  for (let n = 1; n <= Math.min(sheet.rowCount, 20); n++) {
    const texts = rowTexts(n);
    const namesAColumn = texts.some((text) => {
      const key = normalise(text);
      return key.length > 1 && (ALIASES.name as readonly string[]).includes(key);
    });
    if (namesAColumn) {
      headerRow = n;
      headers = texts;
      break;
    }
  }

  if (headerRow === 0) {
    const firstRow = rowTexts(1).filter(Boolean).join(", ");
    throw new ImportError(
      `Could not find a product name column. The first row should be a heading like "Product name" — ` +
        `this file starts with: ${firstRow || "(an empty row)"}.`
    );
  }

  const columnOf = (field: keyof typeof ALIASES): number => {
    const wanted = ALIASES[field] as readonly string[];
    const exact = headers.findIndex((header) => wanted.includes(normalise(header)));
    if (exact !== -1) return exact + 1;
    // Partial match second, so "Low stock" is never claimed by the "stock" alias.
    const partial = headers.findIndex((header) => {
      const key = normalise(header);
      return key.length > 2 && wanted.some((alias) => key.includes(alias));
    });
    return partial === -1 ? 0 : partial + 1;
  };

  const columns = {
    brand: columnOf("brand"),
    name: columnOf("name"),
    flavor: columnOf("flavor"),
    quantity: columnOf("quantity"),
    lowStockAt: columnOf("lowStockAt"),
  };

  const hasQuantity = columns.quantity !== 0;
  const hasLowStock = columns.lowStockAt !== 0;

  // Pre-read the name column so heading detection can look at its neighbours.
  const names: string[] = [];
  for (let n = headerRow + 1; n <= sheet.rowCount; n++) names[n] = textAt(n, columns.name);

  const isHeading = (n: number): boolean => {
    if (!useHeadings || columns.brand !== 0) return false;
    if (!names[n]) return false;
    // A heading sits alone: blank line above (or it is the first row), product below.
    const aboveBlank = n === headerRow + 1 || !names[n - 1];
    const belowFilled = Boolean(names[n + 1]);
    if (!aboveBlank || !belowFilled) return false;
    // A row carrying a number is stock, not a heading.
    if (hasQuantity && textAt(n, columns.quantity)) return false;
    return true;
  };

  const rows: ImportCandidate[] = [];
  const problems: ImportProblem[] = [];
  const detectedBrands: string[] = [];
  const seen = new Map<string, number>();

  let currentBrand = "";

  for (let n = headerRow + 1; n <= sheet.rowCount; n++) {
    if (rows.length >= MAX_ROWS) {
      problems.push({
        row: n,
        message: `Stopped at ${MAX_ROWS} products — split the file and import the rest after.`,
      });
      break;
    }

    const name = names[n] ?? "";
    const flavor = columns.flavor ? textAt(n, columns.flavor) : "";
    const quantityText = hasQuantity ? textAt(n, columns.quantity) : "";
    const lowText = hasLowStock ? textAt(n, columns.lowStockAt) : "";

    // Blank rows are separators, not errors.
    if (!name && !flavor && !quantityText && !lowText) continue;

    if (isHeading(n)) {
      currentBrand = name;
      detectedBrands.push(name);
      continue;
    }

    if (!name) {
      problems.push({ row: n, message: "No product name" });
      continue;
    }

    const quantity = readNumber(quantityText);
    if (quantity === null) {
      problems.push({ row: n, message: `“${quantityText}” is not a number` });
      continue;
    }
    if (quantity < 0) {
      problems.push({ row: n, message: "Quantity cannot be negative" });
      continue;
    }

    const lowStockAt = readNumber(lowText);
    if (lowStockAt === null || lowStockAt < 0) {
      problems.push({ row: n, message: `“${lowText}” is not a valid alert level` });
      continue;
    }

    const brand = columns.brand ? textAt(n, columns.brand) : currentBrand;

    const key = `${brand.toLowerCase()}|${name.toLowerCase()}|${flavor.toLowerCase()}`;
    const earlier = seen.get(key);
    if (earlier) {
      problems.push({ row: n, message: `Same product already on row ${earlier}` });
      continue;
    }
    seen.set(key, n);

    rows.push({ row: n, brand, name, flavor, quantity, lowStockAt });
  }

  if (rows.length === 0) {
    throw new ImportError(
      problems.length > 0
        ? "No usable rows — every line in that file had a problem."
        : "That file has headings but no product rows under them."
    );
  }

  return {
    rows,
    problems,
    headers: headers.filter(Boolean),
    hasQuantity,
    hasLowStock,
    brandSource: columns.brand ? "column" : detectedBrands.length > 0 ? "headings" : "none",
    detectedBrands,
  };
}

/** A blank sheet with the right headings, so nobody has to guess the format. */
export async function buildTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stock");

  sheet.columns = [
    { header: "Brand", key: "brand", width: 24 },
    { header: "Product name", key: "name", width: 40 },
    { header: "Flavour", key: "flavor", width: 20 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Alert below", key: "low", width: 14 },
  ];

  const head = sheet.getRow(1);
  head.font = { bold: true };
  head.height = 22;
  head.alignment = { vertical: "middle" };

  sheet.addRow({ brand: "Optimum Nutrition", name: "Gold Standard Whey 2 LB", flavor: "Chocolate", quantity: 42, low: 10 });
  sheet.addRow({ brand: "Optimum Nutrition", name: "Gold Standard Whey 2 LB", flavor: "Vanilla", quantity: 18, low: 10 });
  sheet.addRow({ brand: "Kirkland", name: "Glucosamine Chondroitin 220 Tablets", flavor: "", quantity: 7, low: 15 });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
