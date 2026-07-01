import { useEffect, useRef, useState } from "preact/hooks";
import { DayPilot } from "@daypilot/daypilot-lite-javascript";
import { useApp } from "../context";
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
export function DispatchBoard() {
  const { technicianLookup, scheduleJobs, scheduleStart, setScheduleRange, updateJob, navigate, setError } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<DayPilot.Calendar | null>(null);
  const [day, setDay] = useState(scheduleStart);

  // Init once.
  useEffect(() => {
    if (!containerRef.current) return;
    const calendar = new DayPilot.Calendar(containerRef.current, {
      viewType: "Resources",
      startDate: day,
      headerDateFormat: "dddd, MMMM d, yyyy",
      cellDuration: 30,
      businessBeginsHour: 7,
      businessEndsHour: 19,
      eventMoveHandling: "Update",
      eventResizeHandling: "Disabled",
      eventClickHandling: "Enabled",
      onEventClick: (args) => {
        const jobId = args.e.id();
        navigate(`/jobs/${jobId}`);
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

  // Render jobs for the visible day as calendar events.
  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;
    const dayJobs = scheduleJobs.filter((j) => j.scheduled_date === day);
    const events = dayJobs.map((j) => {
      const start = new DayPilot.Date(`${j.scheduled_date}T${(j.scheduled_time || "09:00").padEnd(5, "0")}:00`);
      const end = start.addMinutes(j.duration || 60);
      return {
        id: j.id,
        text: `${j.customer_name || "—"}${j.service_type_name ? " · " + j.service_type_name : ""}`,
        start,
        end,
        resource: j.technician_id ? String(j.technician_id) : "unassigned",
        backColor: j.technician_color || j.service_type_color || "#16a34a",
        toolTip: `${j.identifier} — ${j.customer_name || ""} (${j.status})`,
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
      <div class="card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={containerRef} style={{ height: "70vh" }} />
      </div>
    </div>
  );
}
