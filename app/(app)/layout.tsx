import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getWarehouse } from "@/lib/auth";
import { db } from "@/lib/db";
import { BottomNav, SideNav } from "@/components/nav";
import LogoutButton from "@/components/logout-button";
import { ToastProvider } from "@/components/toast";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  /**
   * Wait for a real request before anything below runs.
   *
   * `next build` prerenders every route it can, and a prerender has no request
   * and no DATABASE_URL — so the probe below would throw and fail the build.
   * Pages that read data escape prerendering on their own, by reading cookies
   * or by exporting `dynamic`, but a page of pure markup like /products/import
   * has nothing to escape with. The requirement belongs to this layout, not to
   * each page under it, so this is where it is stated.
   */
  await connection();

  /**
   * Prove the database is there before anything else, including the redirect.
   *
   * This is what a deploy's health check actually tests. It probes `/`, and for
   * a signed-out visitor `/` used to redirect to /login without reading
   * anything — so a build with no database answered 307, was declared healthy,
   * took live traffic and served 500s on every page that did real work.
   *
   * Cheap after the first request: db() hands back an already-resolved pool, so
   * this is an await on a settled promise. When it is not there, `/` fails
   * instead of redirecting, the health check sees 500, and the deploy rolls
   * back to the version that worked.
   */
  await db();

  // The only gate. Every page below this is signed in, and `warehouse` is the
  // key that every query filters on.
  const warehouse = await getWarehouse();
  if (!warehouse) redirect("/login");

  return (
    <ToastProvider>
      <div className="flex">
        <SideNav warehouseName={warehouse.name} logo={warehouse.logo} />

        <div className="min-w-0 flex-1">
          {/* Phones get a title bar instead of the sidebar. */}
          <header className="sticky top-0 z-30 border-b border-line bg-surface md:hidden">
            <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 py-3">
              {warehouse.logo && (
                // Decorative: the name beside it already says which warehouse
                // this is, so a screen reader announcing it twice adds nothing.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={warehouse.logo} alt="" className="h-8 w-8 shrink-0 object-contain" />
              )}
              <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">
                {warehouse.name}
              </span>
              <LogoutButton />
            </div>
          </header>

          <main
            className="mx-auto min-h-[calc(100dvh-136px)] max-w-md px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-4
                       md:min-h-dvh md:max-w-5xl md:px-8 md:pb-12 md:pt-8"
          >
            {children}
          </main>
        </div>
      </div>

      <BottomNav />
    </ToastProvider>
  );
}
