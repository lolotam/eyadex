import type {
  MessageKind,
  MessageLanguage,
  NotificationChannel,
} from "@eyadex/contracts/notifications";
import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";

import { lockClinicProvider } from "../../invitation-mail/persistence/pg-clinic-provider-lock.ts";
import type {
  LedgerOutcome,
  LockedNotification,
  NotificationStore,
  ReadyNotification,
} from "../ports/notification-store.ts";
import { lockWhatsappChannel } from "./pg-channel-lock.ts";
import { readAppointment, readInvoice, readVisit, userOfMembership } from "./pg-subject-reads.ts";
import { readNotificationSettings } from "./settings-row.ts";

const PRESCRIPTION_SENT = "patient.prescription_sent";

type LedgerRow = {
  id: string;
  kind: MessageKind;
  channel: NotificationChannel;
  status: "queued" | "sent" | "skipped" | "failed";
  patient_id: string;
  subject_type: "appointment" | "visit" | "invoice";
  subject_id: string;
  subject_at: string | null;
  requested_by: string | null;
  last_error: string | null;
};

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/**
 * الدفتر على pool الـ `eyadex_app` تحت `withTenant` (0056، RLS). ترتيب الأقفال ثابت: صف الدفتر، ثم
 * العيادة والإعدادات والمراجع والموعد أو الزيارة، ثم صفّي المزود (الأساسي قبل البديل) لصف إيميل أو صف
 * قناة واتساب (0057) لصف واتساب. الـ API بيضيف صفوف دفتر جديدة بس ومابيعدّلش صف موجود، فمفيش ترتيب
 * معكوس.
 */
export class PgNotificationStore implements NotificationStore {
  readonly #db: Database;
  readonly #ids: IdGenerator;

  constructor(db: Database, ids: IdGenerator) {
    this.#db = db;
    this.#ids = ids;
  }

  whileLocked<T>(
    clinicId: string,
    notificationId: string,
    use: (state: LockedNotification) => Promise<T>,
  ): Promise<T> {
    return this.#db.withTenant(clinicId, async (tx) => {
      // subject_at as full-precision text: the moved check compares every microsecond PostgreSQL stores.
      const [ledger] = await rows<LedgerRow>(
        tx,
        sql`SELECT id, kind, channel, status, patient_id, subject_type, subject_id,
                   to_json(subject_at) #>> '{}' AS subject_at, requested_by, last_error
            FROM patient_notifications WHERE clinic_id = ${clinicId} AND id = ${notificationId}
            FOR UPDATE`,
      );
      if (ledger === undefined) return use({ kind: "missing" });
      if (ledger.status !== "queued") return use({ kind: "settled" });
      return use({ kind: "ready", ...(await this.#read(tx, clinicId, ledger)) });
    });
  }

  async #read(tx: Tx, clinicId: string, ledger: LedgerRow): Promise<ReadyNotification> {
    const [clinic] = await rows<{
      name_ar: string;
      name_en: string;
      default_language: MessageLanguage;
      timezone: string;
    }>(
      tx,
      sql`SELECT name_ar, name_en, default_language, timezone FROM clinics
          WHERE id = ${clinicId} FOR SHARE`,
    );
    if (clinic === undefined) throw new Error("clinic row not visible");
    const settings = await readNotificationSettings(tx, clinicId, true);
    const [patient] = await rows<{
      email: string | null;
      phone: string;
      message_language: MessageLanguage | null;
      notifications_opt_out: boolean;
    }>(
      tx,
      sql`SELECT email, phone, message_language, notifications_opt_out FROM patients
          WHERE clinic_id = ${clinicId} AND id = ${ledger.patient_id} FOR SHARE`,
    );
    if (patient === undefined) throw new Error("patient row not visible");
    const appointment =
      ledger.subject_type === "appointment" && ledger.subject_at !== null
        ? await readAppointment(tx, clinicId, ledger.subject_id, ledger.subject_at)
        : null;
    const visit =
      ledger.subject_type === "visit" ? await readVisit(tx, clinicId, ledger.subject_id) : null;
    const invoice =
      ledger.subject_type === "invoice" ? await readInvoice(tx, clinicId, ledger.subject_id) : null;
    // The actor of a degradation audit row: whoever asked for the message, else whoever booked the
    // appointment (a reminder has no requester) or signed the visit.
    const requester =
      ledger.requested_by === null
        ? null
        : await userOfMembership(tx, clinicId, ledger.requested_by);
    const actor = requester ?? appointment?.createdByUserId ?? visit?.signerUserId ?? null;
    // A WhatsApp row has no provider chain: it locks the clinic's channel instead (spec §7.1).
    const email = ledger.channel === "email";
    const lock = (slot: "primary" | "fallback") =>
      actor === null || !email ? null : lockClinicProvider(tx, clinicId, actor, this.#ids, slot);
    const primary = await lock("primary");
    const fallback = await lock("fallback");
    const whatsapp = email ? null : await lockWhatsappChannel(tx, clinicId, this.#ids);
    return {
      ledger: {
        id: ledger.id,
        kind: ledger.kind,
        channel: ledger.channel,
        patientId: ledger.patient_id,
        subjectId: ledger.subject_id,
        lastError: ledger.last_error,
      },
      clinic: {
        nameAr: clinic.name_ar,
        nameEn: clinic.name_en,
        language: clinic.default_language,
        timeZone: clinic.timezone,
      },
      settings,
      patient: {
        email: patient.email,
        phone: patient.phone,
        language: patient.message_language,
        optedOut: patient.notifications_opt_out,
      },
      appointment,
      visit,
      invoice,
      providers: { primary, fallback },
      whatsapp,
      record: (outcome) => this.#record(tx, clinicId, ledger.id, outcome),
      auditPrescriptionSent: async (at) => {
        if (visit === null) return;
        // Ids only: never a medicine name, never the address the message went to.
        await tx.execute(
          sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
                entity_id, branch_id, details, created_at)
              VALUES (${clinicId}, ${this.#ids.newId()}, ${visit.signerUserId}, ${PRESCRIPTION_SENT},
                'patient_access', 'patient', ${ledger.patient_id}, ${visit.branchId},
                ${JSON.stringify({ visitId: visit.visitId })}::jsonb, ${at.toISOString()}::timestamptz)`,
        );
      },
      revokeInvoiceLinks: async (at) => {
        await tx.execute(
          sql`UPDATE invoice_links SET revoked_at = ${at.toISOString()}::timestamptz
              WHERE clinic_id = ${clinicId} AND notification_id = ${ledger.id} AND revoked_at IS NULL`,
        );
      },
    };
  }

  async #record(tx: Tx, clinicId: string, id: string, outcome: LedgerOutcome): Promise<void> {
    const at = outcome.at.toISOString();
    const row = sql`clinic_id = ${clinicId} AND id = ${id} AND status = 'queued'`;
    if (outcome.kind === "sent") {
      await tx.execute(
        sql`UPDATE patient_notifications SET status = 'sent', route = ${outcome.route},
              provider_message_id = ${outcome.messageId ?? null},
              sent_at = ${at}::timestamptz, last_error = NULL, updated_at = ${at}::timestamptz WHERE ${row}`,
      );
    } else if (outcome.kind === "skipped") {
      await tx.execute(
        sql`UPDATE patient_notifications SET status = 'skipped', skip_reason = ${outcome.reason},
              updated_at = ${at}::timestamptz WHERE ${row}`,
      );
    } else {
      await tx.execute(
        sql`UPDATE patient_notifications
            SET status = ${outcome.final ? "failed" : "queued"}, attempts = ${outcome.attempts},
                last_error = ${outcome.error.slice(0, 120)}, updated_at = ${at}::timestamptz
            WHERE ${row}`,
      );
    }
  }
}
