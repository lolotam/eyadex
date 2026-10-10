import {
  CalendarCheck,
  CheckCircle2,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { AppointmentStatus } from "@eyadex/contracts/appointments";

/** Status = icon + label + subtle tint, never colour alone (CLAUDE.architecture.md §4). */
export const STATUS_LOOK: Record<AppointmentStatus, { icon: LucideIcon; tint: string }> = {
  booked: { icon: CalendarCheck, tint: "border-primary/30 bg-primary/10" },
  arrived: { icon: UserCheck, tint: "border-sky-500/30 bg-sky-500/10" },
  completed: { icon: CheckCircle2, tint: "border-emerald-500/30 bg-emerald-500/10" },
  no_show: { icon: UserX, tint: "border-amber-500/30 bg-amber-500/10" },
  cancelled: { icon: XCircle, tint: "border-muted-foreground/30 bg-muted" },
};
