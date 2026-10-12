import {
  whatsappCoexistenceRequestSchema,
  whatsappConnectRequestSchema,
} from "@eyadex/contracts/whatsapp";
import { ApiError, whatsappUnavailableError } from "../api-error";
import type { WhatsappApi } from "../whatsapp-client";
import { authorize } from "./mock-actor";
import { delay, getState, persist, type MockState } from "./mock-store";
import {
  MOCK_QR_DATA_URL,
  channelOf,
  channelView,
  whatsappState,
} from "./mock-whatsapp-state";

// TODO(spec): the audit catalogue (packages/contracts/src/audit.ts) has no WhatsApp actions yet
// (spec §7.1 names clinic.whatsapp_risk_accepted), so the mock writes no audit row for them.

function requireAvailable(db: MockState) {
  if (whatsappState(db).unavailable) throw whatsappUnavailableError();
}

export function createMockWhatsapp(): WhatsappApi {
  return {
    async channel(persona) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "clinic_settings");
      const view = channelView(channelOf(db, clinic.id));
      persist();
      return view;
    },

    async connect(persona, raw) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "update", "clinic_settings");
      const parsed = whatsappConnectRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation", undefined, { acceptRisk: "required" });
      requireAvailable(db);
      const row = channelOf(db, clinic.id);
      // The risk is recorded once, with the version the admin read.
      if (!row.riskAcceptedAt) {
        row.riskAcceptedAt = new Date().toISOString();
        row.riskVersion = parsed.data.riskVersion;
      }
      if (row.transport === "evolution" && row.status === "connected") {
        persist();
        return { status: "connected", qrDataUrl: null };
      }
      row.transport = "evolution";
      row.status = "pending";
      row.phoneLast4 = null;
      row.connectedAt = null;
      row.lastError = null;
      row.pendingSince = Date.now();
      persist();
      return { status: "pending", qrDataUrl: MOCK_QR_DATA_URL };
    },

    async qr(persona) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "clinic_settings");
      requireAvailable(db);
      const row = channelOf(db, clinic.id);
      persist();
      return {
        status: row.status,
        qrDataUrl: row.status === "pending" ? MOCK_QR_DATA_URL : null,
      };
    },

    async disconnect(persona) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "update", "clinic_settings");
      const row = channelOf(db, clinic.id);
      row.status = "disconnected";
      row.phoneLast4 = null;
      row.connectedAt = null;
      row.pendingSince = null;
      persist();
    },

    async saveCoexistence(persona, raw) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "update", "clinic_settings");
      const parsed = whatsappCoexistenceRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const row = channelOf(db, clinic.id);
      const token = parsed.data.accessToken ?? row.accessToken;
      // Write-only: kept when omitted on an update, required the first time.
      if (!token) throw new ApiError("validation", undefined, { accessToken: "required" });
      row.accessToken = token;
      row.hasCredentials = true;
      row.phoneNumberId = parsed.data.phoneNumberId;
      row.businessAccountId = parsed.data.businessAccountId;
      row.templates = { ...parsed.data.templates };
      // TODO(spec): the mock treats saved Meta credentials as a live link; the API may verify first.
      if (row.transport !== "coexistence" || row.status !== "connected") {
        row.transport = "coexistence";
        row.status = "connected";
        row.phoneLast4 = null;
        row.connectedAt = new Date().toISOString();
        row.pendingSince = null;
      }
      row.lastError = null;
      persist();
    },
  };
}
