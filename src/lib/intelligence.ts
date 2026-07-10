// Pure owner-intelligence helpers (C3 / C14). No I/O — unit-test friendly.
// Keyless assistant intents map natural language → structured actions.

export type AssistantIntent =
  | { kind: "overdue_invoices" }
  | { kind: "today_jobs" }
  | { kind: "open_estimates" }
  | { kind: "awaiting_signature" }
  | { kind: "search"; q: string }
  | { kind: "navigate"; path: string; label: string }
  | { kind: "digest" }
  | { kind: "help" }
  | { kind: "unknown"; original: string };

export interface DigestInputs {
  collectedLast7DaysCents: number;
  collectedPrev7DaysCents: number;
  overdueCount: number;
  overdueCents: number;
  openEstimatesCount: number;
  openEstimatesCents: number;
  todayJobsCount: number;
  signedLast24h: number;
  brandLabel: string;
}

export interface DigestSentence {
  text: string;
  href: string;
  tone: "neutral" | "good" | "warn" | "danger";
}

export function fromCentsMoney(cents: number): string {
  const dollars = (cents || 0) / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Build plain-English digest lines. Empty buckets are skipped. */
export function buildDigestSentences(input: DigestInputs): DigestSentence[] {
  const out: DigestSentence[] = [];
  const delta = input.collectedLast7DaysCents - input.collectedPrev7DaysCents;
  if (input.collectedLast7DaysCents > 0 || input.collectedPrev7DaysCents > 0) {
    const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const deltaAbs = fromCentsMoney(Math.abs(delta));
    const tail =
      dir === "flat"
        ? "about even with the prior week"
        : `${dir} ${deltaAbs} vs the prior week`;
    out.push({
      text: `You collected ${fromCentsMoney(input.collectedLast7DaysCents)} in the last 7 days — ${tail}.`,
      href: "/invoices",
      tone: delta >= 0 ? "good" : "warn",
    });
  }
  if (input.overdueCount > 0) {
    out.push({
      text: `${input.overdueCount} invoice${input.overdueCount === 1 ? "" : "s"} overdue totaling ${fromCentsMoney(input.overdueCents)}.`,
      href: "/invoices",
      tone: "danger",
    });
  }
  if (input.openEstimatesCount > 0) {
    out.push({
      text: `${input.openEstimatesCount} estimate${input.openEstimatesCount === 1 ? "" : "s"} awaiting a response (${fromCentsMoney(input.openEstimatesCents)} pipeline).`,
      href: "/estimates",
      tone: "warn",
    });
  }
  if (input.todayJobsCount > 0) {
    out.push({
      text: `${input.todayJobsCount} job${input.todayJobsCount === 1 ? "" : "s"} on the board today.`,
      href: "/schedule",
      tone: "neutral",
    });
  }
  if (input.signedLast24h > 0) {
    out.push({
      text: `${input.signedLast24h} estimate${input.signedLast24h === 1 ? "" : "s"} signed in the last 24 hours.`,
      href: "/estimates",
      tone: "good",
    });
  }
  if (out.length === 0) {
    out.push({
      text: `${input.brandLabel} is quiet right now — no overdue invoices, open estimates, or jobs today.`,
      href: "/",
      tone: "neutral",
    });
  }
  return out;
}

/** Rule-based intent matcher — keyless Noble Assistant brain. */
export function matchAssistantIntent(raw: string): AssistantIntent {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return { kind: "help" };

  if (/^(help|what can you|commands|\?)$/.test(q) || q.includes("what can you do")) {
    return { kind: "help" };
  }
  if (/(overdue|past due|late invoice|ar\b|receivable)/.test(q)) {
    return { kind: "overdue_invoices" };
  }
  if (/(today.?s? jobs|jobs today|what.?s on (the )?(board|schedule)|schedule today)/.test(q)) {
    return { kind: "today_jobs" };
  }
  if (/(awaiting|waiting).*(sign|response)|unsigned|open estimate|pipeline/.test(q)) {
    return { kind: "awaiting_signature" };
  }
  if (/estimate/.test(q) && /(open|sent|pending)/.test(q)) {
    return { kind: "open_estimates" };
  }
  if (/(digest|summary|how (am i|are we) doing|monday|money brief|recap)/.test(q)) {
    return { kind: "digest" };
  }
  if (/(go to |open |show me )?(dispatch|schedule)/.test(q)) {
    return { kind: "navigate", path: "/schedule", label: "Schedule" };
  }
  if (/(go to |open )?(customers|clients)/.test(q)) {
    return { kind: "navigate", path: "/customers", label: "Customers" };
  }
  if (/(go to |open )?invoices?/.test(q)) {
    return { kind: "navigate", path: "/invoices", label: "Invoices" };
  }
  if (/(go to |open )?estimates?/.test(q)) {
    return { kind: "navigate", path: "/estimates", label: "Estimates" };
  }
  if (/(go to |open )?jobs?/.test(q) && !/today/.test(q)) {
    return { kind: "navigate", path: "/jobs", label: "Jobs" };
  }

  // "find X" / "search X" / bare name-ish query
  const find = q.match(/^(find|search|look up|lookup)\s+(.+)$/);
  if (find) return { kind: "search", q: find[2] };
  if (q.length >= 2 && q.length <= 40 && !/[?]/.test(q)) {
    return { kind: "search", q: raw.trim() };
  }

  return { kind: "unknown", original: raw.trim() };
}

export const ASSISTANT_HELP = [
  "Try: \"overdue invoices\", \"jobs today\", \"open estimates\"",
  "\"digest\" for a money brief",
  "\"find Henderson\" to search",
  "\"go to schedule\" to navigate",
  "Connect ANTHROPIC_API_KEY later for full conversational drafting — this keyless mode already runs the same actions.",
];

export interface AgentCapability {
  id: string;
  method: string;
  path: string;
  description: string;
  brand_scoped: boolean;
}

export function agentCapabilities(): AgentCapability[] {
  return [
    { id: "stats", method: "GET", path: "/api/stats", description: "Dashboard KPIs", brand_scoped: true },
    { id: "search", method: "GET", path: "/api/search", description: "Global search customers/jobs/estimates/invoices", brand_scoped: true },
    { id: "today", method: "GET", path: "/api/today", description: "Owner Today: jobs, estimates, overdue AR", brand_scoped: true },
    { id: "digest", method: "GET", path: "/api/digest", description: "Narrative money/ops digest", brand_scoped: true },
    { id: "assistant", method: "POST", path: "/api/assistant", description: "Keyless intent assistant (Claude-ready)", brand_scoped: true },
    { id: "customers", method: "GET", path: "/api/customers", description: "List customers", brand_scoped: true },
    { id: "jobs", method: "GET", path: "/api/jobs", description: "List jobs", brand_scoped: true },
    { id: "estimates", method: "GET", path: "/api/estimates", description: "List estimates", brand_scoped: true },
    { id: "invoices", method: "GET", path: "/api/invoices", description: "List invoices", brand_scoped: true },
    { id: "demo_status", method: "GET", path: "/api/demo/status", description: "Demo workspace status", brand_scoped: false },
    { id: "demo_reset", method: "POST", path: "/api/demo/reset", description: "Reset demo workspace (admin)", brand_scoped: false },
  ];
}
