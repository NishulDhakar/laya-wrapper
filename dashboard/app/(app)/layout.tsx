import { Nav } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { verifySession } from "@/lib/session";

import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await verifySession();
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b border-line p-4 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-3 pt-1">
          <div className="font-semibold">laya-hub</div>
          <div className="text-xs text-muted">Decision API admin</div>
        </div>
        <Nav />
        <div className="mt-auto hidden space-y-2 md:block">
          <ThemeToggle />
          <form action={logout}>
            <button type="submit" className="btn btn-sm w-full">
              Sign out
            </button>
          </form>
          <p className="px-1 pt-2 text-[11px] leading-snug text-muted">Built on Laya by Convai Innovations (Apache 2.0)</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      <div className="flex gap-2 border-t border-line p-4 md:hidden">
        <ThemeToggle />
        <form action={logout} className="w-full">
          <button type="submit" className="btn btn-sm w-full">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
