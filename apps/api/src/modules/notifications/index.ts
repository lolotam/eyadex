// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { NotificationsModule } from "./notifications.module.ts";
export type { EvolutionApi } from "./ports/evolution-api.ts";
// The queue and history adapters: appointments and medical bind them to their own ports (ADR-0031).
export {
  PgAppointmentNotifications,
  PgVisitNotifications,
} from "./persistence/pg-notification-queue.ts";
export { PATIENT_NOTIFICATION_REQUESTED } from "./events/published.ts";
