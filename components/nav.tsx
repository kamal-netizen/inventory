"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./logout-button";

const TABS = [
  {
    href: "/",
    label: "Stock",
    short: "Stock",
    exact: true,
    icon: (
      <>
        <rect x="3" y="4" width="18" height="6" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
      </>
    ),
  },
  {
    href: "/invoice/new",
    label: "New invoice",
    short: "New",
    exact: true,
    icon: (
      <>
        <path d="M6 3h9l3 3v15H6V3Z" />
        <path d="M12 10v7M8.5 13.5h7" />
      </>
    ),
  },
  {
    href: "/invoices",
    label: "Invoices",
    short: "Invoices",
    exact: false,
    icon: (
      <>
        <path d="M8 3h11v18l-2.5-1.7L14 21l-2.5-1.7L9 21V3Z" />
        <path d="M11.5 8h4M11.5 12h4" />
        <path d="M5 6v13" />
      </>
    ),
  },
  {
    href: "/history",
    label: "History",
    short: "History",
    exact: false,
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
  },
];

function isActive(pathname: string, href: string, exact: boolean) {
  // "/invoices" and "/invoice/new" share a prefix, so the new-invoice tab
  // matches exactly rather than by prefix.
  return exact ? pathname === href : pathname.startsWith(href);
}

function Icon({ paths, active }: { paths: React.ReactNode; active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

/** Desktop: a fixed sidebar. Hidden on phones. */
export function SideNav({ warehouseName }: { warehouseName: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
      <div className="mb-6 px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Warehouse</p>
        <p className="mt-1 text-[19px] font-semibold leading-tight">{warehouseName}</p>
      </div>

      <nav className="flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href, tab.exact);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors ${
                active ? "bg-brand-soft text-brand" : "text-muted hover:bg-page hover:text-ink"
              }`}
            >
              <Icon paths={tab.icon} active={active} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center justify-between rounded-xl px-3 py-1">
        <span className="text-[13px] text-muted">Signed in</span>
        <LogoutButton />
      </div>
    </aside>
  );
}

/** Phones: a bottom tab bar. Hidden from tablet width up. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href, tab.exact);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                active ? "text-brand" : "text-muted"
              }`}
            >
              <Icon paths={tab.icon} active={active} />
              {tab.short}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
