import type {
  MailProviderRequest,
  MailProvidersResponse,
  MailProviderView,
} from "@eyadex/contracts/mail-provider";
import type {
  MailProviderSlot,
  NotificationSettings,
  PatientNotificationList,
} from "@eyadex/contracts/notifications";
import type { Persona } from "@eyadex/contracts/session";

/** Patient email notifications (phase 3 N1, docs/specs/notifications-design.md §5). */
export interface NotificationsApi {
  /** view:clinic_settings:clinic; a clinic that never saved gets the defaults. */
  getSettings(persona: Persona): Promise<NotificationSettings>;
  /** update:clinic_settings:clinic. */
  updateSettings(persona: Persona, input: NotificationSettings): Promise<NotificationSettings>;
  /** view:clinic_settings:clinic: both slots, never a credential. */
  mailProviders(persona: Persona): Promise<MailProvidersResponse>;
  /** update:clinic_settings:clinic; a fallback without a primary is `validation`. */
  setMailProvider(
    persona: Persona,
    slot: MailProviderSlot,
    input: MailProviderRequest,
    idempotencyKey: string,
  ): Promise<MailProviderView>;
  /** update:clinic_settings:clinic; the primary while a fallback exists is `validation`. */
  removeMailProvider(persona: Persona, slot: MailProviderSlot): Promise<void>;
  /** update:clinic_settings:clinic; no provider is `not_found`, the cooldown `rate_limited`. */
  testMailProvider(persona: Persona, slot: MailProviderSlot, idempotencyKey: string): Promise<void>;
  /** The appointment's view scope (else not_found). */
  appointmentHistory(persona: Persona, appointmentId: string): Promise<PatientNotificationList>;
  /** The visit's view scope (else not_found). */
  visitHistory(persona: Persona, visitId: string): Promise<PatientNotificationList>;
}
