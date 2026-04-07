import type { Metadata } from "next";
import Link from "next/link";
import { logoutAdmin } from "./auth-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Cyprus Rally",
  description: "Manage championship content and the public results page.",
};

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/results-page", label: "Page Information" },
] as const;

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex">
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-400">
              Cyprus Rally Events Results
            </p>
            <p className="text-sm font-semibold">Admin</p>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 p-3">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <Link
              href="/"
              className="block rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              ← Public site
            </Link>
            <form action={logoutAdmin} className="mt-2">
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <main className="min-h-screen flex-1 pl-56">
          <div className="mx-auto max-w-4xl px-6 py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
