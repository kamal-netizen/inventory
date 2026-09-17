import "server-only";
import PDFDocument from "pdfkit";
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

export function buildInvoicePdf(input: {
  warehouseName: string;
  invoice: Invoice;
  lines: MovementRow[];
  units: number;
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

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(warehouseName, MARGIN, MARGIN);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(MUTED)
    .text("DELIVERY NOTE", MARGIN, doc.y + 2, { characterSpacing: 1.2 });

  const headerTop = MARGIN;
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(cancelled ? MUTED : INK)
    .text(invoice.ref, MARGIN, headerTop, { width: contentWidth, align: "right" });

  if (cancelled) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(DANGER)
      .text("CANCELLED", MARGIN, doc.y + 2, { width: contentWidth, align: "right" });
  }

  doc.moveDown(1.6);
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
