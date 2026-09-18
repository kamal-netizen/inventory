import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Left for Node to require rather than bundled: pdfkit reads font files off
  // disk at runtime, and exceljs is large enough that bundling it is waste.
  serverExternalPackages: ["exceljs", "pdfkit"],

  experimental: {
    // Spreadsheet uploads go through a Server Action; the 1 MB default is too small.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
