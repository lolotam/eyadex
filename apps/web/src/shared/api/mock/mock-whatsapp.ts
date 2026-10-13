import {
  whatsappCoexistenceRequestSchema,
  whatsappConnectRequestSchema,
  whatsappEmbeddedSignupRequestSchema,
} from "@eyadex/contracts/whatsapp";
import { ApiError, whatsappUnavailableError } from "../api-error";
import type { WhatsappApi } from "../whatsapp-client";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import { delay, getState, persist, type MockState } from "./mock-store";
import {
  MOCK_QR_DATA_URL,
  MOCK_PHONE_LAST4,
  MOCK_SCAN_DELAY_MS,
  MOCK_SIGNUP_CONFIG,
  channelOf,
  channelView,
  whatsappState,
} from "./mock-whatsapp-state";

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
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const parsed = whatsappConnectRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation", undefined, { acceptRisk: "required" });
      requireAvailable(db);
      const row = channelOf(db, clinic.id);
      if (row.transport === "coexistence" && row.status !== "disconnected")
        throw new ApiError("validation", undefined, { transport: "coexistence_linked" });
      // The risk is recorded once, with the version the admin read.
      if ((row.riskVersion ?? 0) < parsed.data.riskVersion) {
        row.riskAcceptedAt = new Date().toISOString();
        row.riskVersion = parsed.data.riskVersion;
        writeClinicAudit(db, {
          clinicId: clinic.id,
          actorName,
          action: "clinic.whatsapp_risk_accepted",
          entity: "clinic",
          entityId: clinic.id,
          before: null,
          after: { riskVersion: parsed.data.riskVersion },
        });
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
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const row = channelOf(db, clinic.id);
      if (row.transport === "evolution" && row.status === "pending") {
        requireAvailable(db);
        if (row.pendingSince !== null && Date.now() - row.pendingSince >= MOCK_SCAN_DELAY_MS) {
          row.status = "connected";
          row.phoneLast4 = MOCK_PHONE_LAST4;
          row.connectedAt = new Date().toISOString();
          row.pendingSince = null;
          writeClinicAudit(db, {
            clinicId: clinic.id,
            actorName,
            action: "clinic.whatsapp_connected",
            entity: "clinic",
            entityId: clinic.id,
            before: null,
            after: { transport: "evolution" },
          });
        }
      }
      persist();
      return {
        status: row.status,
        qrDataUrl: row.status === "pending" ? MOCK_QR_DATA_URL : null,
      };
    },

    async disconnect(persona) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const row = channelOf(db, clinic.id);
      if (row.status === "disconnected") return;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.whatsapp_disconnected",
        entity: "clinic",
        entityId: clinic.id,
        before: null,
        after: { transport: row.transport },
      });
      row.status = "disconnected";
      row.phoneLast4 = null;
      row.connectedAt = null;
      row.pendingSince = null;
      persist();
    },

    async saveCoexistence(persona, raw) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const parsed = whatsappCoexistenceRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      // Round 2: coexistence talks to Meta directly, so it works without Evolution configured.
      const row = channelOf(db, clinic.id);
      if (row.transport === "evolution" && row.status !== "disconnected")
        throw new ApiError("validation", undefined, { transport: "evolution_linked" });
      const token = parsed.data.accessToken ?? row.accessToken;
      // Write-only: kept when omitted on an update, required the first time.
      if (!token) throw new ApiError("validation", undefined, { accessToken: "required" });
      // The demo "Meta check": a token containing `invalid` is refused, as Meta would refuse it.
      if (token.includes("invalid"))
        throw new ApiError("validation", undefined, { accessToken: "meta_credentials_invalid" });
      const tokenChanged = token !== row.accessToken;
      const sameTemplates = Object.keys(row.templates).every((kind) => {
        const key = kind as keyof typeof row.templates;
        return (
          row.templates[key]?.name === parsed.data.templates[key]?.name &&
          row.templates[key]?.language === parsed.data.templates[key]?.language
        );
      });
      if (
        row.transport === "coexistence" &&
        row.status === "connected" &&
        !tokenChanged &&
        row.phoneNumberId === parsed.data.phoneNumberId &&
        row.businessAccountId === parsed.data.businessAccountId &&
        sameTemplates
      )
        return;
      const before = { status: row.status, templates: { ...row.templates } };
      row.accessToken = token;
      row.hasCredentials = true;
      row.phoneNumberId = parsed.data.phoneNumberId;
      row.businessAccountId = parsed.data.businessAccountId;
      row.templates = { ...parsed.data.templates };
      if (row.transport !== "coexistence" || row.status !== "connected") {
        row.transport = "coexistence";
        row.status = "connected";
        row.phoneLast4 = MOCK_PHONE_LAST4;
        row.connectedAt = new Date().toISOString();
        row.pendingSince = null;
      }
      row.lastError = null;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.whatsapp_coexistence_updated",
        entity: "clinic",
        entityId: clinic.id,
        before,
        after: { status: row.status, templates: row.templates, tokenChanged },
      });
      persist();
    },
  
    async signupConfig(persona) {
      await delay();
      authorize(getState(), persona, "update", "clinic_settings");
      return { ...MOCK_SIGNUP_CONFIG };
    },

    async embeddedSignup(persona, raw) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const parsed = whatsappEmbeddedSignupRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const row = channelOf(db, clinic.id);
      if (row.transport === "evolution" && row.status !== "disconnected")
        throw new ApiError("validation", undefined, { transport: "evolution_linked" });
      // Demo codes (brief N3 §3): each stands for one of Meta's answers.
      if (parsed.data.code === "two_step")
        throw new ApiError("validation", undefined, { phoneNumberId: "meta_two_step_enabled" });
      if (parsed.data.code === "used")
        throw new ApiError("validation", undefined, { phoneNumberId: "number_in_use" });
      if (parsed.data.code === "expired")
        throw new ApiError("validation", undefined, { code: "meta_code_invalid" });
      const before = { status: row.status };
      row.transport = "coexistence";
      row.status = "connected";
      row.hasCredentials = true;
      row.accessToken = "demo-exchanged-token";
      row.phoneNumberId = parsed.data.phoneNumberId;
      row.businessAccountId = parsed.data.wabaId;
      row.phoneLast4 = MOCK_PHONE_LAST4;
      row.connectedAt = new Date().toISOString();
      row.pendingSince = null;
      row.lastError = null;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.whatsapp_coexistence_updated",
        entity: "clinic",
        entityId: clinic.id,
        before,
        after: { status: row.status, tokenChanged: true },
      });
      persist();
      return channelView(row);
    },
  };
}
