import type { Metadata } from "next";
import { loginAdmin } from "../auth-actions";

export const metadata: Metadata = {
  title: "Admin Login — Cyprus Rally",
};

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function AdminLoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const hasError = sp.error === "1";
  const next = sp.next?.startsWith("/admin") ? sp.next : "/admin";

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-6 sm:px-6 sm:py-10">
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-400">
            Cyprus Rally Events Results
          </p>
          <h1 className="mt-2 text-xl font-semibold">Admin Login</h1>
          {hasError ? (
            <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              Invalid username or password.
            </p>
          ) : null}
          <form action={loginAdmin} className="mt-4 space-y-4">
            <input type="hidden" name="next" value={next} />
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Username
              </label>
              <input
                name="username"
                required
                autoComplete="username"
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Password
              </label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-600"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
