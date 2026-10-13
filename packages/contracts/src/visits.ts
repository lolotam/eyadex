import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";
import { attachmentSchema } from "./attachments.ts";

/** P2-6: a draft is editable; signing locks it; a cancelled draft is kept, never deleted. */
export const VISIT_STATUSES = ["draft", "signed", "cancelled"] as const;
export const visitStatusSchema = z.enum(VISIT_STATUSES);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

export const VISIT_CANCEL_REASONS = ["opened_by_mistake", "patient_left", "other"] as const;
export const visitCancelReasonSchema = z.enum(VISIT_CANCEL_REASONS);
export type VisitCancelReason = z.infer<typeof visitCancelReasonSchema>;

const clinicalText = (max: number) =>
  z
    .string()
    .transform(stripInvisibleControls)
    .pipe(z.string().trim().max(max, "validation.tooLong"));
const required = (max: number) => clinicalText(max).pipe(z.string().min(1, "validation.required"));

/** `POST /v1/visits` (Idempotency-Key): from an arrived appointment, or a walk-in (P2-2). */
export const visitStartSchema = z.union([
  z.object({ appointmentId: idSchema }).strict(),
  z.object({ patientId: idSchema, branchId: idSchema }).strict(),
]);
export type VisitStartInput = z.infer<typeof visitStartSchema>;

/** `PUT /v1/visits/:id/note` — draft only, the visit's provider only (P2-3). */
export const visitNoteInputSchema = z
  .object({
    complaint: clinicalText(4000).nullable(),
    examination: clinicalText(8000).nullable(),
    assessment: clinicalText(8000).nullable(),
    plan: clinicalText(8000).nullable(),
  })
  .strict();
export type VisitNoteInput = z.infer<typeof visitNoteInputSchema>;

/**
 * ICD-10-CM code shape: a letter, two letters-or-digits (FY2027 added QA0…), optional dot and up to four
 * more.
 */
export const icd10CodeSchema = z
  .string()
  .regex(/^[A-Z][0-9A-Z][0-9A-Z](\.[0-9A-Z]{1,4})?$/, "validation.icd10");

/** P2-8: per diagnosis the doctor picks an ICD-10-CM code (its title kept as text) or free text. */
export const diagnosisInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("icd10"), code: icd10CodeSchema, text: required(500) }).strict(),
  z.object({ kind: z.literal("text"), text: required(500) }).strict(),
]);
export type DiagnosisInput = z.infer<typeof diagnosisInputSchema>;
export const visitDiagnosesInputSchema = z
  .object({ items: z.array(diagnosisInputSchema).max(20) })
  .strict();

/** P2-9, P2-F2: one prescribed medicine; the name is typed or picked from the clinic list. */
export const prescriptionItemInputSchema = z
  .object({
    medicine: required(200),
    dose: clinicalText(100),
    frequency: clinicalText(100),
    duration: clinicalText(100),
    note: clinicalText(300).nullable(),
  })
  .strict();
export type PrescriptionItemInput = z.infer<typeof prescriptionItemInputSchema>;
export const visitPrescriptionInputSchema = z
  .object({ items: z.array(prescriptionItemInputSchema).max(30) })
  .strict();

export const visitAddendumInputSchema = z.object({ body: required(8000) }).strict();
export const visitCancelSchema = z
  .object({ reason: visitCancelReasonSchema, note: clinicalText(300).nullable() })
  .strict();

/** A visit's metadata: what `view:visits:*` shows (the front desk sees only this, P2-K4). */
export const visitSummarySchema = z
  .object({
    id: idSchema,
    patientId: idSchema,
    branchId: idSchema,
    providerMembershipId: idSchema,
    providerName: z.string(),
    appointmentId: idSchema.nullable(),
    status: visitStatusSchema,
    startedAt: z.string().datetime(),
    signedAt: z.string().datetime().nullable(),
    /** The assessment's first 160 characters; `null` without `view:medical:*`. */
    preview: z.string().nullable(),
    /** Why a cancelled draft was cancelled: a fixed choice, metadata (`null` unless cancelled). */
    cancelReason: visitCancelReasonSchema.nullable(),
  })
  .strict();
export type VisitSummary = z.infer<typeof visitSummarySchema>;

/** `GET /v1/patients/:id/visits?cursor=` — the list; note search is a POST (R2-1). */
export const visitListQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
  })
  .strict();
export const visitListSchema = z
  .object({
    items: z.array(visitSummarySchema),
    nextCursor: z.string().nullable(),
    can: z.object({ search: z.boolean(), start: z.boolean() }).strict(),
  })
  .strict();
export type VisitList = z.infer<typeof visitListSchema>;

/** `POST /v1/patients/:id/visits/search` — the query travels in the body, never the URL (R2-1, P2-F4). */
export const visitSearchSchema = z
  .object({
    q: z.string().transform(stripInvisibleControls).pipe(z.string().trim().min(1).max(100)),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type VisitSearchInput = z.infer<typeof visitSearchSchema>;

/** `GET /v1/visits/walk-in-branches` — the active branches where the caller may start a walk-in (R3). */
export const walkInBranchesSchema = z
  .object({
    items: z.array(z.object({ id: idSchema, nameAr: z.string(), nameEn: z.string() }).strict()),
  })
  .strict();

/** `POST /v1/visits/walk-in-candidates` — a name or file number, in the body (R3, R2-4). */
export const walkInSearchSchema = z
  .object({
    branchId: idSchema,
    q: z.string().transform(stripInvisibleControls).pipe(z.string().trim().min(2).max(60)),
  })
  .strict();
export type WalkInSearchInput = z.infer<typeof walkInSearchSchema>;
export const walkInCandidatesSchema = z
  .object({
    items: z
      .array(
        z
          .object({ patientId: idSchema, fullName: z.string(), fileNumber: z.number().int() })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type WalkInCandidates = z.infer<typeof walkInCandidatesSchema>;

export const diagnosisSchema = z
  .object({
    position: z.number().int(),
    kind: z.enum(["icd10", "text"]),
    code: z.string().nullable(),
    text: z.string(),
  })
  .strict();
export const prescriptionItemSchema = prescriptionItemInputSchema.extend({
  position: z.number().int(),
});
export const addendumSchema = z
  .object({
    id: idSchema,
    authorName: z.string(),
    body: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();

/** `GET /v1/visits/:id` — `content` is `null` without `view:medical:*`; reading it is audited. */
export const visitDetailSchema = z
  .object({
    visit: visitSummarySchema,
    /** Shown on the visit page without `view:patients:*` (R3): name, file number, branch names only. */
    patient: z.object({ fullName: z.string(), fileNumber: z.number().int() }).strict(),
    branch: z.object({ nameAr: z.string(), nameEn: z.string() }).strict(),
    content: z
      .object({
        note: z
          .object({
            complaint: z.string().nullable(),
            examination: z.string().nullable(),
            assessment: z.string().nullable(),
            plan: z.string().nullable(),
          })
          .strict(),
        diagnoses: z.array(diagnosisSchema),
        prescription: z.array(prescriptionItemSchema),
        addenda: z.array(addendumSchema),
        attachments: z.array(attachmentSchema),
        /** The free cancellation note: clinical text, so it travels only with the content. */
        cancelNote: z.string().nullable(),
      })
      .strict()
      .nullable(),
    can: z
      .object({
        edit: z.boolean(),
        sign: z.boolean(),
        cancel: z.boolean(),
        addAddendum: z.boolean(),
        /**
         * Upload or archive the visit's attachments: the attachment rule (`update:medical:*` reaching
         * the patient, an active file), not the provider's edit rule, so a signed visit still takes one.
         */
        attach: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type VisitDetail = z.infer<typeof visitDetailSchema>;

/** `GET /v1/visits/:id/prescription/print` — audited. */
export const prescriptionPrintSchema = z
  .object({
    clinic: z.object({ nameAr: z.string(), nameEn: z.string() }).strict(),
    branch: z.object({ nameAr: z.string(), nameEn: z.string() }).strict(),
    patient: z.object({ fullName: z.string(), fileNumber: z.number().int() }).strict(),
    providerName: z.string(),
    startedAt: z.string().datetime(),
    signedAt: z.string().datetime().nullable(),
    items: z.array(prescriptionItemSchema),
  })
  .strict();
export type PrescriptionPrint = z.infer<typeof prescriptionPrintSchema>;

export const visitWriteResponseSchema = z.object({ visit: visitDetailSchema }).strict();
