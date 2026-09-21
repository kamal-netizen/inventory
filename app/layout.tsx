import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * The app is named here, and the name travels further than the page does — the
 * tab bar, browser history, bookmarks, the phone's app switcher and the home
 * screen, including on the signed-out keypad at /login. That is a deliberate
 * choice to name the business rather than the bare "Stock" this used to say.
 *
 * It is worth knowing it cuts against d8bea34, which keeps the sign-in screen
 * itself bare so it "reveals nothing — not who uses the app, not that there are
 * two of them". The keypad still shows nothing; the tab above it now does.
 *
 * No `icons` key, on purpose. Declaring one disables the file convention
 * entirely, and app/icon.svg, app/apple-icon.png and app/favicon.ico are how
 * the icons are set. See scripts/icons.mjs.
 */
export const metadata: Metadata = {
  // `template` decorates child routes only, never the segment that declares it,
  // so `default` is what `/` itself shows. The page name leads, because a tab
  // is narrow and truncates from the right — "History · JNK…" stays readable.
  title: {
    default: "JNK & Muscle Fusion Inventory",
    template: "%s · JNK & Muscle Fusion Inventory",
  },
  description: "Stock and delivery notes for JNK Warehouse and Muscle Fusion",

  // Lets iOS keep it full screen once it is added to the home screen, which is
  // how this gets used on the warehouse phones. The title here is the label
  // under the icon, where there is only room for one short word.
  appleWebApp: { capable: true, title: "Inventory", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // --color-surface, matching the sticky header that sits directly under the
  // browser chrome on a phone. Not --color-page, which only shows further down.
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
