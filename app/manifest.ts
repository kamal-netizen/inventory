import type { MetadataRoute } from "next";

/**
 * What a phone installs when someone adds this to their home screen.
 *
 * That is the primary way this app gets used — a warehouse phone, opened one
 * handed, next to the shelves — so it is worth it opening as an app rather than
 * a browser tab with an address bar eating the top of a small screen.
 *
 * Next serves this at /manifest.webmanifest and links it from every page with
 * no further wiring; it exists because the file exists.
 *
 * This file is readable without signing in, and `name` is what shows under the
 * icon on the home screen, so it carries the business name for the same reason
 * the page titles now do.
 *
 * `short_name` is what a launcher actually renders under an icon — roughly a
 * dozen characters before it is cut — so the full name would arrive as
 * "JNK & Muscl…". "Inventory" says what it is and survives the crop.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JNK & Muscle Fusion Inventory",
    short_name: "Inventory",
    description: "Stock and delivery notes for JNK Warehouse and Muscle Fusion",
    start_url: "/",

    // No browser chrome once installed. Portrait because every screen in this
    // app is a single column built for a phone held upright.
    display: "standalone",
    orientation: "portrait",

    // --color-page, so the splash behind the icon matches the page that follows
    // it, and --color-surface for the status bar, matching the sticky header.
    background_color: "#f4f6f8",
    theme_color: "#ffffff",

    // 192 and 512 are what Android asks for; the maskable one is full bleed so
    // the launcher can crop it to whatever shape the device uses without
    // clipping the parcel. All three come from scripts/icons.mjs.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
