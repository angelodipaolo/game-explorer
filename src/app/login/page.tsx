import Link from "next/link";
import { loginErrorMessage, safeNext } from "@/lib/auth";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false, follow: false } };

/**
 * The owner's sign-in page, and the only login this app has — there is no
 * public account to make.
 *
 * A plain `<form method="post">`: no client component, no JavaScript needed,
 * and the browser's password manager sees a normal login form, which is what
 * makes this bearable on a phone. One field, a 44px target, `autoFocus` so the
 * keyboard is already up.
 *
 * `next` comes from `src/proxy.ts` when it turned an owner-only page away, and
 * is re-sanitised here and again in the route: a redirect target is the one
 * thing on this page an attacker could choose.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  // A code from a fixed set, never the query string's own text — see LOGIN_ERRORS.
  const error = loginErrorMessage(params.error);
  const { canEdit, enforced } = await readViewer();

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 pb-safe">
      <div className="nes-stripe mb-6 h-1" aria-hidden />
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Game <span className="text-nes-grey">Explorer</span>
      </h1>
      <p className="mt-1 text-sm text-muted">Sign in to add tags, codes, runs and journal entries. Browsing needs no account.</p>

      {canEdit ? (
        <div className="mt-6 rounded-xl border border-border bg-surface p-4" data-testid="already-signed-in">
          <p className="text-sm">You are signed in{enforced ? "" : " — this server has no auth configured, so everything is editable"}.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href={next} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">
              Continue
            </Link>
            {enforced ? (
              <form method="post" action="/api/auth/logout">
                <input type="hidden" name="next" value="/" />
                <button type="submit" className="min-h-11 rounded-xl border border-border px-4 text-sm text-muted hover:border-muted hover:text-text" data-testid="sign-out">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : (
        <form method="post" action="/api/auth/login" className="mt-6" data-testid="login-form">
          <input type="hidden" name="next" value={next} />
          <label className="block text-sm text-muted" htmlFor="password">
            Password
          </label>
          {/* `autoComplete="current-password"` with no username field is what
              tells iOS Safari to offer the saved password. */}
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base outline-none focus:border-accent"
            data-testid="password"
          />
          {error ? (
            <p className="mt-2 text-sm text-bad" role="alert" data-testid="login-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="mt-4 min-h-12 w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink" data-testid="sign-in">
            Sign in
          </button>
        </form>
      )}

      <Link href="/" className="mt-8 inline-flex min-h-11 items-center text-sm text-muted hover:text-text">
        ← Back to the shelf
      </Link>
    </main>
  );
}
