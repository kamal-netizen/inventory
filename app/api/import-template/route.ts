import { requireWarehouse } from "@/lib/auth";
import { buildTemplate } from "@/lib/import";

export async function GET() {
  // Signed in only — the template is harmless, but every route stays behind the PIN.
  await requireWarehouse();

  const file = await buildTemplate();
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="stock-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
