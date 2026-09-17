import { redirect } from "next/navigation";
import { getWarehouse } from "@/lib/auth";
import { BottomNav, SideNav } from "@/components/nav";
import LogoutButton from "@/components/logout-button";
import { ToastProvider } from "@/components/toast";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // The only gate. Every page below this is signed in, and `warehouse` is the
  // key that every query filters on.
  const warehouse = await getWarehouse();
  if (!warehouse) redirect("/login");

  return (
    <ToastProvider>
      <div className="flex">
        <SideNav warehouseName={warehouse.name} />

        <div className="min-w-0 flex-1">
          {/* Phones get a title bar instead of the sidebar. */}
          <header className="sticky top-0 z-30 border-b border-line bg-surface md:hidden">
            <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
              <span className="truncate text-[17px] font-semibold">{warehouse.name}</span>
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
