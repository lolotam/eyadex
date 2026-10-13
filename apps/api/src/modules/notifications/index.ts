// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { NotificationsModule } from "./notifications.module.ts";
export type { EvolutionApi } from "./ports/evolution-api.ts";
export type { MetaApi } from "./ports/meta-api.ts";
// The queue and history adapters: appointments and medical bind them to their own ports (ADR-0031).
export {
  PgAppointmentNotifications,
  PgVisitNotifications,
} from "./persistence/pg-notification-queue.ts";
export { PATIENT_NOTIFICATION_REQUESTED } from "./events/published.ts";
// Meta's status webhook signs the raw bytes: startApi keeps them for that one route (spec §7.2).
export { registerMetaWebhookBody } from "./http/meta-raw-body.ts";
