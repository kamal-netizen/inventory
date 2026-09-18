// Rasterises the warehouse logos to PNG for the delivery note PDF.
//
//   npm run logos
//
// pdfkit draws PNG and JPEG, not SVG, so the PDF cannot use the .svg files the
// screens use. Doing this once and committing the result keeps image processing
// out of the request path and out of the production dependencies — sharp is
// only here because Next.js already brings it, and nothing at runtime needs it.
//
// Re-run after replacing a logo.
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

/** Tall enough to stay crisp at the ~36pt the PDF draws it, printed. */
const HEIGHT = 400;

/** Render this many times over, then downscale — it is what smooths the edges. */
const OVERSAMPLE = 3;

const logos = ["jnk-logo", "muscle-fusion-logo"];

for (const name of logos) {
  const from = path.join("public", `${name}.svg`);
  const to = path.join("public", `${name}.png`);

  const svg = await fs.readFile(from);

  // Density is DPI against the SVG's own units, so a fixed value rasterises a
  // 2000-unit artboard 3.5x larger than a 566-unit one — past sharp's pixel
  // limit for the big one. Derive it per file from the viewBox instead.
  const viewBox = /viewBox="[\d.]+ [\d.]+ [\d.]+ ([\d.]+)"/.exec(svg.toString("utf8"));
  const units = viewBox ? Number(viewBox[1]) : 512;
  const density = Math.round((72 * HEIGHT * OVERSAMPLE) / units);

  const out = await sharp(svg, { density })
    .resize({ height: HEIGHT, fit: "inside" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await fs.writeFile(to, out);

  const { width, height } = await sharp(out).metadata();
  console.log(
    `${to.padEnd(34)} ${String(width).padStart(4)}x${height}  ` +
      `${String((out.length / 1024).toFixed(0)).padStart(4)} KB  (viewBox ${units}, density ${density})`
  );
}
