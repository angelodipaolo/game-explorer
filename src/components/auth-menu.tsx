import type { Viewer } from "@/lib/viewer";

/**
 * The sign-in affordance, deliberately small and out of the way.
 *
 * It lives in the filter sheet's footer and the platform drawer's footer
 * rather than the header: the public is not being invited to log in, the owner
 * just needs a way to. On a server with no auth configured (`npm run dev`)
 * there is nothing to sign in or out of, so it renders nothing at all.
 *
 * Plain `<a>` and a form post rather than a router navigation: what changes on
 * sign-in is server-rendered on every page, so a full load is the point.
 */
export function AuthMenu({ viewer, className }: { viewer: Viewer; className?: string }) {
  if (!viewer.enforced) return null;
  const link = "min-h-11 text-xs text-faint underline underline-offset-2 hover:text-muted";
  return (
    <div className={className} data-testid="auth-menu">
      {viewer.canEdit ? (
        <form method="post" action="/api/auth/logout">
          <input type="hidden" name="next" value="/" />
          <button type="submit" className={link} data-testid="sign-out">
            Sign out
          </button>
        </form>
      ) : (
        <a href="/login" className={link} data-testid="sign-in-link">
          Sign in
        </a>
      )}
    </div>
  );
}
