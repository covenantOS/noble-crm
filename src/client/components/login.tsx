import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { LogIn } from "lucide-preact";
import { authClient } from "../auth-client";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || "Invalid email or password");
      }
      // On success, better-auth's session atom updates and the app
      // re-renders into the main layout via useSession().
    } catch (err) {
      setError((err as Error).message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="login-screen">
      <form class="login-card" onSubmit={handleSubmit}>
        <div class="sidebar-brand-icon login-icon">
          <LogIn size={18} />
        </div>
        <h1 class="login-title">Field Scheduler</h1>
        <p class="login-subtitle">Sign in to continue</p>

        <div class="form-group full-width">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autocomplete="username"
            required
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="form-group full-width">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autocomplete="current-password"
            required
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </div>

        {error && <div class="login-error">{error}</div>}

        <button type="submit" class="btn btn-primary login-submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
