import type {
  WhatsappChannelView,
  WhatsappCoexistenceRequest,
  WhatsappConnectRequest,
  WhatsappQrResponse,
} from "@eyadex/contracts/whatsapp";
import type { Persona } from "@eyadex/contracts/session";

/**
 * The clinic's WhatsApp channel (phase 3 N2, docs/specs/notifications-design.md §7.1). Reads need
 * view:clinic_settings:clinic, every change update:clinic_settings:clinic. A server without WhatsApp
 * configured answers `unavailable` (see `isWhatsappUnavailable`).
 */
export interface WhatsappApi {
  channel(persona: Persona): Promise<WhatsappChannelView>;
  /** Evolution link: records the risk acceptance once and answers the QR to scan. */
  connect(persona: Persona, input: WhatsappConnectRequest): Promise<WhatsappQrResponse>;
  /** Refreshes the QR; turns `pending` into `connected` once the phone has scanned it. */
  qr(persona: Persona): Promise<WhatsappQrResponse>;
  disconnect(persona: Persona): Promise<void>;
  /** Meta credentials (the token is write-only: omitted = kept) and one template per kind. */
  saveCoexistence(persona: Persona, input: WhatsappCoexistenceRequest): Promise<void>;
}
