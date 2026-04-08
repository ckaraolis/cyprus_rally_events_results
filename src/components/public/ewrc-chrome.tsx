import Link from "next/link";
import type { SiteSettings } from "@/lib/rally/types";
import { ThemeToggle } from "./theme-toggle";

export function EwrcChrome({
  site,
  children,
}: {
  site: SiteSettings;
  children: React.ReactNode;
}) {
  return (
    <div className="ewrc-page min-h-full bg-[var(--ewrc-bg)] text-[var(--ewrc-fg)]">
      <header className="sticky top-0 z-50 border-b border-[var(--ewrc-border)] bg-[var(--ewrc-header-bg)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <Link href="/" className="group flex items-baseline gap-2">
            <span className="font-ewrc-heading text-lg font-bold tracking-tight text-[var(--ewrc-heading)] sm:text-xl">
              {site.resultsPageTitle}
            </span>
            <span className="hidden text-xs font-medium uppercase tracking-widest text-[var(--ewrc-muted)] sm:inline">
              Results
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-sm sm:gap-4">
            <ThemeToggle />
            <Link
              href="/"
              className="text-[var(--ewrc-nav)] transition-colors hover:text-[var(--ewrc-brand)]"
            >
              Home
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-[var(--ewrc-border)] bg-[var(--ewrc-footer-bg)] py-6 text-center text-xs text-[var(--ewrc-muted-3)]">
        <p>{site.resultsPageSubtitle}</p>
      </footer>
    </div>
  );
}
