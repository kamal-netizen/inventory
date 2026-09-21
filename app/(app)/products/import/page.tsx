import type { Metadata } from "next";
import PageHeader from "@/components/page-header";
import ImportForm from "./import-form";

export const metadata: Metadata = { title: "Import from Excel" };

export default function ImportPage() {
  return (
    <div className="md:max-w-2xl">
      <PageHeader title="Import from Excel" />
      <ImportForm />
    </div>
  );
}
