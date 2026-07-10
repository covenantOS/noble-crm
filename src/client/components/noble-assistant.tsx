import { useEffect, useRef, useState } from "preact/hooks";
import { Sparkles, X, Send } from "lucide-preact";
import { api } from "../api";
import { useApp } from "../context";

type Action = { label: string; href?: string; kind?: string };
type Msg = { role: "user" | "assistant"; text: string; actions?: Action[]; help?: string[] };

export function NobleAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate, activeBrandId } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{
    role: "assistant",
    text: "Noble Assistant — keyless mode. Ask about overdue invoices, today's jobs, open estimates, or say “digest”. Full Claude drafting unlocks when ANTHROPIC_API_KEY is set.",
    help: [
      "overdue invoices",
      "jobs today",
      "open estimates",
      "digest",
      "find [name]",
    ],
  }]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const body: { message: string; brand_id?: string } = { message };
      if (activeBrandId !== null) body.brand_id = String(activeBrandId);
      const res = await api<{
        reply: string;
        actions?: Action[];
        help?: string[];
        mode: string;
      }>("POST", "/api/assistant", body);
      setMsgs((m) => [...m, {
        role: "assistant",
        text: res.reply,
        actions: res.actions,
        help: res.help,
      }]);
    } catch (err) {
      setMsgs((m) => [...m, {
        role: "assistant",
        text: err instanceof Error ? err.message : "Assistant failed",
      }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div class="assistant-panel" role="dialog" aria-label="Noble Assistant">
      <div class="assistant-header">
        <div class="assistant-title">
          <Sparkles size={16} />
          <span>Noble Assistant</span>
          <span class="assistant-mode">keyless</span>
        </div>
        <button class="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close assistant">
          <X size={16} />
        </button>
      </div>
      <div class="assistant-body">
        {msgs.map((m, i) => (
          <div key={i} class={`assistant-msg ${m.role}`}>
            <p>{m.text}</p>
            {m.actions && m.actions.length > 0 && (
              <div class="assistant-actions">
                {m.actions.map((a, j) => (
                  <button
                    key={j}
                    class="btn btn-sm"
                    onClick={() => {
                      if (a.href) {
                        navigate(a.href);
                        onClose();
                      } else if (a.kind === "digest") {
                        send("digest");
                      }
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {m.help && (
              <div class="assistant-chips">
                {m.help.map((h) => (
                  <button key={h} class="assistant-chip" onClick={() => send(h)}>{h}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        class="assistant-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          placeholder="Ask about jobs, AR, estimates…"
          disabled={busy}
        />
        <button type="submit" class="btn btn-primary btn-sm" disabled={busy || !input.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
