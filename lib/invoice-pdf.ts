import "server-only";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { formatFullDate, formatTime, productLabel } from "./format";
import type { MovementRow } from "./queries";
import type { Invoice } from "./types";

/**
 * A printable record of what left the warehouse against one invoice number.
 *
 * There are no prices anywhere in this app, so this is a dispatch note rather
 * than a tax invoice, and it says so rather than implying a financial document.
 */

const INK = "#121820";
const MUTED = "#66707d";
const LINE = "#d8dee6";
const BRAND = "#0c7a52";
const DANGER = "#c02626";

const MARGIN = 50;
const QTY_WIDTH = 70;
const LOGO = 42;

/**
 * The raster sibling of a logo, or null if there isn't one.
 *
 * pdfkit draws PNG and JPEG, never SVG, so the screens' .svg is no use here.
 * `npm run logos` writes a .png beside each .svg in public/; this finds it.
 * Returning null rather than throwing is deliberate — a missing logo must cost
 * a picture, not the document.
 */
function logoFile(webPath: string): string | null {
  if (!webPath) return null;
  const png = path.join(
    process.cwd(),
    "public",
    path.basename(webPath).replace(/\.svgz?$/i, ".png")
  );
  return fs.existsSync(png) ? png : null;
}

export function buildInvoicePdf(input: {
  warehouseName: string;
  invoice: Invoice;
  lines: MovementRow[];
  units: number;
  /** Web path of the warehouse logo, e.g. "/jnk-logo.svg". Optional. */
  logo?: string;
}): Promise<Buffer> {
  const { warehouseName, invoice, lines, units } = input;
  const cancelled = invoice.status === "cancelled";

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: `Delivery note ${invoice.ref}`,
      Author: warehouseName,
      Subject: `Stock issued against ${invoice.ref}`,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const right = doc.page.width - MARGIN;
  const contentWidth = right - MARGIN;

  /* ------------------------------- header ------------------------------- */

  const logoPath = logoFile(input.logo ?? "");
  let textLeft = MARGIN;

  if (logoPath) {
    try {
      doc.image(logoPath, MARGIN, MARGIN, { fit: [LOGO, LOGO] });
      textLeft = MARGIN + LOGO + 14;
    } catch {
      // A corrupt image is not worth failing a delivery note over.
    }
  }

  const textWidth = right - textLeft;

  // The name and the line under it come to roughly 34pt; centre that against
  // the logo rather than letting both start at the margin, which leaves the
  // text riding high beside it.
  const nameTop = logoPath ? MARGIN + (LOGO - 34) / 2 : MARGIN + 1;

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(warehouseName, textLeft, nameTop, {
    width: textWidth - 110,
  });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(MUTED)
    .text("DELIVERY NOTE", textLeft, doc.y + 2, { characterSpacing: 1.2 });

  const afterName = doc.y;

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(cancelled ? MUTED : INK)
    .text(invoice.ref, textLeft, MARGIN, { width: textWidth, align: "right" });

  if (cancelled) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(DANGER)
      .text("CANCELLED", textLeft, doc.y + 2, { width: textWidth, align: "right" });
  }

  // Clear whichever column ran longest — the logo, the name, or the number —
  // rather than trusting moveDown after text that was written out of order.
  doc.y = Math.max(afterName, doc.y, MARGIN + (logoPath ? LOGO : 0)) + 18;
  rule(doc, doc.y, right);

  /* -------------------------------- meta -------------------------------- */

  const metaTop = doc.y + 16;
  meta(doc, MARGIN, metaTop, "Date", `${formatFullDate(invoice.created_at)}, ${formatTime(invoice.created_at)}`);
  meta(doc, MARGIN + contentWidth / 2, metaTop, "Customer", invoice.customer || "—");

  const secondRow = metaTop + 34;
  meta(doc, MARGIN, secondRow, "Products", String(lines.length));
  meta(doc, MARGIN + contentWidth / 2, secondRow, "Total units", String(units));

  doc.y = secondRow + 34;
  rule(doc, doc.y, right);

  /* ------------------------------- table -------------------------------- */

  doc.y += 14;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  doc.text("ITEM", MARGIN, doc.y, { width: contentWidth - QTY_WIDTH, continued: false });
  doc.text("QTY", right - QTY_WIDTH, doc.y - doc.currentLineHeight(), {
    width: QTY_WIDTH,
    align: "right",
  });

  doc.y += 6;
  rule(doc, doc.y, right);
  doc.y += 10;

  for (const line of lines) {
    // Start a fresh page before a row would run off the bottom.
    if (doc.y > doc.page.height - MARGIN - 70) {
      doc.addPage();
      doc.y = MARGIN;
    }

    const top = doc.y;

    if (line.product_brand) {
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(MUTED)
        .text(line.product_brand.toUpperCase(), MARGIN, top, {
          width: contentWidth - QTY_WIDTH,
          characterSpacing: 0.8,
        });
    }

    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor(INK)
      .text(productLabel(line.product_name, line.product_flavor), MARGIN, doc.y + 1, {
        width: contentWidth - QTY_WIDTH - 10,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(INK)
      .text(String(Math.abs(line.change)), right - QTY_WIDTH, top + (line.product_brand ? 8 : 1), {
        width: QTY_WIDTH,
        align: "right",
      });

    doc.y = Math.max(doc.y, top) + 10;
    rule(doc, doc.y - 5, right, "#eef1f5");
  }

  /* ------------------------------- total -------------------------------- */

  doc.y += 6;
  rule(doc, doc.y, right);
  doc.y += 10;

  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
  const totalTop = doc.y;
  doc.text("Total units", MARGIN, totalTop, { width: contentWidth - QTY_WIDTH });
  doc.text(String(units), right - QTY_WIDTH, totalTop, { width: QTY_WIDTH, align: "right" });

  if (cancelled) {
    doc.y += 24;
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(DANGER)
      .text(
        `This note was cancelled${
          invoice.cancelled_at ? ` on ${formatFullDate(invoice.cancelled_at)}` : ""
        } and all ${units} units were returned to stock.`,
        MARGIN,
        doc.y,
        { width: contentWidth }
      );
  }

  /* ------------------------------- footer ------------------------------- */

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      "Quantities are units issued from stock. This note does not show prices and is not a tax invoice.",
      MARGIN,
      doc.page.height - MARGIN - 12,
      { width: contentWidth }
    );

  doc.end();
  return done;
}

function rule(doc: PDFKit.PDFDocument, y: number, right: number, colour = LINE) {
  doc.save().strokeColor(colour).lineWidth(0.8).moveTo(MARGIN, y).lineTo(right, y).stroke().restore();
}

function meta(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string) {
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, y, {
    characterSpacing: 0.8,
  });
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(value, x, y + 12, { width: 220 });
}

export { BRAND };
