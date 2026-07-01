// Shared display formatters. The API stores/returns raw values (ISO dates,
// minutes, decimal dollars); the UI should never show those raw. Import from
// here everywhere a date/duration/money is rendered.

// "2026-07-01" -> "Jul 1, 2026". Parses as a plain calendar date (no TZ shift).
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// "2026-07-01" -> "Wed, Jul 1" (no year — for schedule headers etc.)
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// A stored "created_at"/"updated_at" (UTC "YYYY-MM-DD HH:MM:SS") -> "Jul 1, 2026, 2:30 PM" in Tampa time.
export function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return "—";
  // D1 stores as "YYYY-MM-DD HH:MM:SS" (UTC). Make it ISO so Date parses it as UTC.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

// "14:00" -> "2:00 PM"
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  let h = +m[1];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

// minutes -> "45 min" / "1 hr" / "1 hr 30 min" / "8 hrs"
export function formatDuration(mins: number | null | undefined): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hrs = `${h} hr${h === 1 ? "" : "s"}`;
  return m ? `${hrs} ${m} min` : hrs;
}

// 3370.5 -> "$3,370.50"
export function formatMoney(n: number | null | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
