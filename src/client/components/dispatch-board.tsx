import { useEffect, useRef, useState } from "preact/hooks";
import { DayPilot } from "@daypilot/daypilot-lite-javascript";
import { useApp } from "../context";
import { formatTime } from "../format";
import { ChevronLeft, ChevronRight } from "lucide-preact";

// Resource calendar: one column per active technician, jobs rendered as
// draggable event cards positioned by scheduled_date/scheduled_time.
// Library choice: DayPilot Lite for JavaScript (@daypilot/daypilot-lite-
// javascript, Apache-2.0, zero runtime deps). Verified before adding it as
// a dependency (not assumed from the build plan, which was dated):
//   - Confirmed on npm the real current package is
//     "@daypilot/daypilot-lite-javascript" (NOT "daypilot-pro-lite" or
//     "@daypilot/daypilot-lite-js", both of which 404 on the registry).
//   - Confirmed genuine Apache-2.0 by downloading the actual tarball and
//     reading LICENSE.txt (not just trusting the npm metadata tag), and
//     confirmed the resource/column view + drag-and-drop are documented
//     Lite (free) features, not gated behind a Pro paywall -- the
//     package's own README lists "Resource calendar for scheduling
//     multiple resources side by side" and "Drag and drop event moving and
//     resizing" under its top-level Features list, and its .d.ts exposes
//     `viewType: "Resources"` + `columns` + `onEventMoved` directly on the
//     free DayPilot.Calendar class (no separate Scheduler/Pro import).
//   - The alternative considered was vkurko/calendar (@event-calendar/core,
//     MIT, also fully-featured resource+drag-drop for free) -- also a
//     legitimate choice, but it's built as a Svelte 5 component
//     (`"svelte": "^5.55.5"` peer dep in its package.json) with a
//     standalone-bundle escape hatch that's less proven/documented for
//     framework-agnostic imperative use. DayPilot Lite is plain
//     JavaScript/TypeScript with an imperative DOM API and literally zero
//     npm dependencies, which is a more natural fit for this Preact
//     (non-Svelte) codebase than pulling in a Svelte runtime bundle.
//
// DAY/WEEK/MONTH TOGGLE (multi-day jobs pass), verified against the actual
// installed package's .d.ts (daypilot-javascript.min.d.ts), not assumed:
//   - `DayPilot.Calendar.viewType` DOES support "Day" | "Days" | "Week" |
//     "WorkWeek" | "Resources" -- but "Resources" (the per-technician column
//     board this component uses) is its OWN distinct viewType, mutually
//     exclusive with Day/Days/Week. There's no combined "resources x
//     multi-day-scale" mode in Calendar -- switching viewType away from
//     "Resources" drops the per-technician columns entirely and switches to
//     a plain single/multi-day time-grid instead.
//   - `DayPilot.Scheduler` (a separate class, also present in Lite, not
//     Pro-gated) DOES support `scale: "Day" | "Week"` with resource ROWS
//     (not columns) and natively spans multi-day events as a single bar --
//     this is the "next tier up" component that would give a proper
//     week/month resource view with real multi-day bars. Swapping Calendar
//     for Scheduler is a real rewrite of this component (different event/
//     resource API shape, row- instead of column-oriented), which is more
//     than a "toggle" -- out of scope for this pass.
//   - `DayPilot.Month` exists too, but has no resource/column concept at
//     all (a plain month grid), so it can't replace the per-technician
//     board either.
//   - Net: no clean Day/Week/Month toggle was added to the Resources board
//     in this pass. Multi-day jobs are instead made visually distinct here
//     (an end-date badge on the event card + tooltip, see
//     onBeforeEventRender/the events-building effect below) and in the List
//     view (schedule-view.tsx), which is the "next best thing" the build
//     instructions call for when a clean multi-scale resources view isn't
//     available in the Lite tier.

// Business-hours window the board renders (clamped from the full 24h span so
// early-morning/overnight dead hours don't waste vertical room).
const BUSINESS_BEGINS = 6;
const BUSINESS_ENDS = 20;

// Turn a job's technician/brand hex color into a pale tinted background so
// event cards read as soft tinted chips, not full-saturation neon slabs.
// Falls back to the Noble navy accent when no color is present or parseable.
function tint(hex: string | null | undefined, alpha: number): string {
  const fallback = `rgba(26, 43, 74, ${alpha})`;
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function DispatchBoard() {
  const { technicianLookup, scheduleJobs, setScheduleRange, updateJob, navigate, setError } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<DayPilot.Calendar | null>(null);
  // Default to TODAY (the audit opened the board on an empty past day). The
  // app-wide "today" is the local calendar day, matched to how the List view
  // and dashboard compute it.
  const [day, setDay] = useState(() => new DayPilot.Date().toString("yyyy-MM-dd"));

  // Init once.
  useEffect(() => {
    if (!containerRef.current) return;
    const calendar = new DayPilot.Calendar(containerRef.current, {
      viewType: "Resources",
      startDate: day,
      headerDateFormat: "dddd, MMMM d, yyyy",
      cellDuration: 30,
      cellHeight: 26,
      businessBeginsHour: BUSINESS_BEGINS,
      businessEndsHour: BUSINESS_ENDS,
      // "BusinessHoursNoScroll" sizes the grid to the business band (6am-8pm)
      // and drops the scroll, so a 6am-8pm shop isn't dominated by dead
      // overnight rows (plain "BusinessHours" still scrolls a full 0-24h grid).
      heightSpec: "BusinessHoursNoScroll",
      timeFormat: "Clock12Hours",
      durationBarVisible: true,
      eventBorderRadius: 8,
      eventMoveHandling: "Update",
      eventResizeHandling: "Disabled",
      eventClickHandling: "Enabled",
      onEventClick: (args) => {
        const jobId = args.e.id();
        navigate(`/jobs/${jobId}`);
      },
      // Restyle every event card into a soft Noble chip: pale tinted
      // background, a saturated colored left bar, dark readable text, and a
      // 3-line html body (time · customer · service). The tech/brand color
      // travels on the event's `tags`.
      onBeforeEventRender: (args) => {
        const tags = (args.data.tags || {}) as { color?: string; time?: string; customer?: string; service?: string; endDateLabel?: string };
        const color = tags.color || "#1a2b4a";
        args.data.backColor = tint(color, 0.14);
        args.data.borderColor = tint(color, 0.34);
        args.data.barColor = color;
        args.data.barBackColor = tint(color, 0.28);
        args.data.fontColor = "#1c2536";
        args.data.borderRadius = 8;
        args.data.padding = 6;
        const time = tags.time ? escapeHtml(tags.time) : "";
        const customer = tags.customer ? escapeHtml(tags.customer) : "";
        const service = tags.service ? escapeHtml(tags.service) : "";
        // DayPilot Lite's Resources view is a single-day board (see the
        // module comment below for what Lite does/doesn't support here) --
        // a multi-day job still only renders on its start day, so it gets a
        // small "through <end date>" badge instead of a spanning bar.
        const endBadge = tags.endDateLabel
          ? `<div style="font-weight:700;font-size:9.5px;color:${color};text-transform:uppercase;letter-spacing:0.02em;">↦ through ${escapeHtml(tags.endDateLabel)}</div>`
          : "";
        args.data.html =
          `<div style="font-weight:700;font-size:11px;color:#5a6472;font-variant-numeric:tabular-nums;">${time}</div>` +
          `<div style="font-weight:600;font-size:12.5px;color:#1c2536;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${customer}</div>` +
          (service ? `<div style="font-size:11px;color:#5a6472;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${service}</div>` : "") +
          endBadge;
      },
      // Fires after a drag completes. newResource is the technician column
      // id (technician id or "unassigned") the card was dropped on;
      // newStart carries both the new date and time slot. This calls the
      // existing PUT /api/jobs/{id} endpoint (updateJob) with the new
      // technician_id/scheduled_date/scheduled_time -- no new server
      // endpoint, updateJob already supports partial updates to exactly
      // these fields.
      onEventMoved: async (args) => {
        const jobId = Number(args.e.id());
        const newTechnicianId = args.newResource === "unassigned" ? null : Number(args.newResource);
        const newDate = args.newStart.toString("yyyy-MM-dd");
        const newTime = args.newStart.toString("HH:mm");
        try {
          await updateJob(jobId, {
            technician_id: newTechnicianId,
            scheduled_date: newDate,
            scheduled_time: newTime,
          } as never);
        } catch (err) {
          setError((err as Error).message);
        }
      },
    });
    calendar.init();
    calendarRef.current = calendar;
    return () => {
      calendar.dispose();
      calendarRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the calendar's columns in sync with active technicians, plus a
  // fixed "Unassigned" column so unassigned jobs are still visible/
  // draggable onto a real technician.
  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;
    calendar.update({
      columns: [
        ...technicianLookup.map((t) => ({ id: String(t.id), name: t.name })),
        { id: "unassigned", name: "Unassigned" },
      ],
    });
  }, [technicianLookup]);

  // Keep the calendar's visible date in sync with `day`.
  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;
    calendar.update({ startDate: day });
  }, [day]);

  // Keep the schedule data range in sync with the visible day (single-day
  // board view, fetched the same way the List view fetches its range).
  useEffect(() => {
    setScheduleRange(day, day);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render jobs for the visible day as calendar events. Multi-day jobs
  // (end_date set and after scheduled_date) only render on their START day
  // -- DayPilot Lite's Resources view is a single-day board with no native
  // "span N days" concept (see the module comment above), so a spanning bar
  // isn't possible here. They get an end-date badge instead (see
  // onBeforeEventRender's endDateLabel handling) rather than silently
  // disappearing from the board on their later days.
  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;
    const dayJobs = scheduleJobs.filter((j) => j.scheduled_date === day);
    const events = dayJobs.map((j) => {
      const start = new DayPilot.Date(`${j.scheduled_date}T${(j.scheduled_time || "09:00").padEnd(5, "0")}:00`);
      const end = start.addMinutes(j.duration || 60);
      const color = j.technician_color || j.service_type_color || "#1a2b4a";
      const isMultiDay = !!j.end_date && j.end_date !== j.scheduled_date;
      return {
        id: j.id,
        text: `${j.customer_name || "—"}${j.service_type_name ? " · " + j.service_type_name : ""}`,
        start,
        end,
        resource: j.technician_id ? String(j.technician_id) : "unassigned",
        // Styling + multi-line html are applied in onBeforeEventRender using
        // these tags (keeps the color/label logic in one place).
        tags: {
          color,
          time: formatTime(j.scheduled_time),
          customer: j.customer_name || "—",
          service: j.service_type_name || "",
          endDateLabel: isMultiDay ? j.end_date! : undefined,
        },
        toolTip: `${j.identifier} — ${j.customer_name || ""} (${j.status})${isMultiDay ? ` — multi-day, through ${j.end_date}` : ""}`,
      };
    });
    calendar.update({ events });
  }, [scheduleJobs, day]);

  const shiftDay = (delta: number) => {
    const d = new DayPilot.Date(day).addDays(delta);
    setDay(d.toString("yyyy-MM-dd"));
  };

  const goToday = () => setDay(new DayPilot.Date().toString("yyyy-MM-dd"));

  return (
    <div>
      <div class="page-header-right" style={{ marginBottom: 12 }}>
        <button class="btn" onClick={goToday}>Today</button>
        <button class="btn btn-icon" onClick={() => shiftDay(-1)}><ChevronLeft size={16} /></button>
        <span style={{ fontSize: 14, fontWeight: 600, minWidth: 220, textAlign: "center" }}>
          {new Date(day + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button class="btn btn-icon" onClick={() => shiftDay(1)}><ChevronRight size={16} /></button>
      </div>
      <div class="card dispatch-board" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={containerRef} />
      </div>
    </div>
  );
}
