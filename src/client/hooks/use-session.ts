import { useEffect, useState } from "preact/hooks";
import { authClient, type Session } from "../auth-client";

export interface SessionState {
  session: Session | null;
  isPending: boolean;
}

// Bridges better-auth's vanilla client `useSession` nanostores atom into
// Preact state. The vanilla client (see auth-client.ts) is framework
// agnostic -- `useSession` is a plain atom with `.get()` / `.subscribe()`,
// not a React/Preact hook -- so this hook subscribes on mount and unwraps
// it into normal Preact state for components to consume.
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(() => {
    const current = authClient.useSession.get();
    return { session: current.data ?? null, isPending: current.isPending };
  });

  useEffect(() => {
    const unsubscribe = authClient.useSession.subscribe((value) => {
      setState({ session: value.data ?? null, isPending: value.isPending });
    });
    return unsubscribe;
  }, []);

  return state;
}
