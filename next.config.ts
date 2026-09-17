import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: let Node require it instead of bundling it
  serverExternalPackages: ["better-sqlite3", "exceljs", "pdfkit"],

  experimental: {
    // Spreadsheet uploads go through a Server Action; the 1 MB default is too small.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
