// better-auth client for the Preact app.
//
// better-auth's package.json "exports" map has no React/Vue/Svelte-specific
// subpath that fits Preact directly -- it ships "./react", "./vue",
// "./svelte", "./solid", "./lynx" framework adapters plus a framework-
// agnostic "./client" (vanilla) entry backed by nanostores atoms. Preact is
// React-compatible via preact/compat for *components*, but better-auth's
// "./react" adapter wraps its atoms in an actual `useSyncExternalStore`
// React hook -- not something preact/compat shims. Rather than relying on
// React-hook aliasing, this project uses the vanilla "./client" entry: its
// `useSession` is a plain nanostores atom (`.get()` / `.subscribe()`), which
// is trivial to bridge into a Preact hook (see use-session.ts) without
// pulling in React at all.
//
// Same-origin in both dev (vite proxies /api -> the Worker) and prod (the
// Worker serves both API and static assets), so baseURL "" is sufficient --
// no CORS configuration needed. basePath defaults to "/api/auth", matching
// where the handler is mounted in src/server/index.ts.
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
});

export type Session = typeof authClient.$Infer.Session;
