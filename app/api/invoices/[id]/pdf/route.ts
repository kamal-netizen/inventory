import { requireWarehouse } from "@/lib/auth";
import { fileDate, safeFilename } from "@/lib/format";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoiceWithLines } from "@/lib/queries";

export async function GET(_request: Request, context: RouteContext<"/api/invoices/[id]/pdf">) {
  const warehouse = await requireWarehouse();
  const { id } = await context.params;

  const found = await getInvoiceWithLines(warehouse.key, Number(id));
  if (!found) return new Response("Not found", { status: 404 });

  const pdf = await buildInvoicePdf({
    warehouseName: warehouse.name,
    invoice: found.invoice,
    lines: found.lines,
    units: found.units,
    logo: warehouse.logo,
  });

  // [warehouse] [SO no] [date] — e.g. "Muscle Fusion 46984 17-09-2026.pdf"
  const filename = `${safeFilename(
    [warehouse.name, found.invoice.ref, fileDate(found.invoice.created_at)].join(" ")
  )}.pdf`;

  // ASCII fallback first, then the exact UTF-8 name for browsers that read it.
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "");

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
