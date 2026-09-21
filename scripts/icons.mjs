// Draws the app icon and rasterises every size the browsers and phones want.
//
//   npm run icons
//
// One glyph, defined once below, written out as:
//   app/icon.svg              the tab icon; Next serves it and computes the <link>
//   app/apple-icon.png        180px, iOS home screen (iOS will not take an SVG)
//   app/favicon.ico           16/32/48, the legacy slot and the one browsers guess at
//   public/icon-192.png       referenced by app/manifest.ts
//   public/icon-512.png       same, for the Android install prompt and splash
//   public/icon-maskable.png  512 full-bleed, so Android can crop it to any shape
//
// Committed rather than generated at request time, for the same reason as
// scripts/logo-png.mjs: sharp is only here because Next.js brings it, and
// nothing in production should depend on it.
//
// Deliberately NOT a warehouse logo. Two warehouses share this app, so either
// mark would be wrong half the time — and an icon shows up in tab bars,
// bookmarks, history and the home screen, which is further than the sign-in
// screen is allowed to reach. d8bea34: "the login screen is a bare keypad that
// reveals nothing — not who uses the app, not that there are two of them."
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

/** --color-brand from app/globals.css. */
const BRAND = "#0c7a52";
const WHITE = "#ffffff";

/**
 * A taped parcel, straight on.
 *
 * Solid tile rather than a line drawing: at 16px a stroke thinner than a pixel
 * either disappears or turns to mush, while a filled shape stays a shape. The
 * only detail is the tape and the flap seam, which are wide enough to survive.
 *
 * @param inset how far to pull the parcel off the edges, in viewBox units.
 *   0 for the square icon; larger for maskable, where Android may crop to a
 *   circle and anything outside the middle 80% can be cut away.
 */
function glyph(inset = 0) {
  const s = (n) => +(n * (1 - inset / 32)).toFixed(2);
  const c = (n) => +(32 + (n - 32) * (1 - inset / 32)).toFixed(2);

  return [
    `<rect x="${c(14)}" y="${c(19)}" width="${s(36)}" height="${s(28)}" rx="${s(3)}" fill="${WHITE}"/>`,
    `<rect x="${c(14)}" y="${c(26.5)}" width="${s(36)}" height="${s(4)}" fill="${BRAND}"/>`,
    `<rect x="${c(30)}" y="${c(19)}" width="${s(4)}" height="${s(7.5)}" fill="${BRAND}"/>`,
  ].join("\n  ");
}

/** Rounded tile for the browser; full bleed for maskable, which gets cropped. */
function svg({ radius, inset }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Stock">
  <rect width="64" height="64"${radius ? ` rx="${radius}"` : ""} fill="${BRAND}"/>
  ${glyph(inset)}
</svg>
`;
}

const TILE = svg({ radius: 14, inset: 0 });
const MASKABLE = svg({ radius: 0, inset: 8 });

/** Oversample then downscale — it is what smooths the edges. See logo-png.mjs. */
async function png(source, size) {
  return sharp(Buffer.from(source), { density: Math.round((72 * size * 3) / 64) })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Wraps PNGs in an ICO container.
 *
 * sharp cannot write .ico and the format does not need a dependency: the file is
 * a 6-byte header, one 16-byte directory entry per image, then the images
 * themselves. PNG payloads inside an ICO have been read by every browser since
 * IE11, so there is no BMP encoding to do.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for true colour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await fs.writeFile(path.join("app", "icon.svg"), TILE);

await fs.writeFile(path.join("app", "apple-icon.png"), await png(TILE, 180));
await fs.writeFile(path.join("public", "icon-192.png"), await png(TILE, 192));
await fs.writeFile(path.join("public", "icon-512.png"), await png(TILE, 512));
await fs.writeFile(path.join("public", "icon-maskable.png"), await png(MASKABLE, 512));

await fs.writeFile(
  path.join("app", "favicon.ico"),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(TILE, size) }))))
);

console.log("icons written: app/icon.svg, app/apple-icon.png, app/favicon.ico, public/icon-*.png");
