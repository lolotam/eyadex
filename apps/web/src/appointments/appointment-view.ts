import { useNavigate, useSearch } from "@tanstack/react-router";

/** The four views of the appointments page (slice A4), kept in the URL as `view=`. */
export const APPOINTMENT_VIEWS = ["day", "week", "month", "queue"] as const;
export type AppointmentView = (typeof APPOINTMENT_VIEWS)[number];

export const parseAppointmentView = (raw: unknown): AppointmentView =>
  APPOINTMENT_VIEWS.find((v) => v === raw) ?? "day";

/** The current view from the URL and a setter that writes it back (replacing the history entry). */
export function useAppointmentView(): [AppointmentView, (view: AppointmentView) => void] {
  const search = useSearch({ strict: false }) as { view?: unknown };
  const navigate = useNavigate();
  const view = parseAppointmentView(search.view);
  const setView = (next: AppointmentView) =>
    void navigate({ to: "/clinic/appointments", search: { view: next }, replace: true });
  return [view, setView];
}
