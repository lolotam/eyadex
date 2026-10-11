import { createHash } from "node:crypto";

import type { Attachment, AttachmentList } from "@eyadex/contracts/attachments";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import {
  acceptedAttachmentType,
  attachmentName,
  attachmentStorageKey,
} from "../../domain/attachment-rules.ts";
import {
  medicalReach,
  medicalReachCovers,
  visitReachSees,
  visitViewReach,
  type FileAccess,
  type MedicalActor,
} from "../../domain/visit-rules.ts";
import {
  activeAttachmentsOfPatient,
  archiveAttachment,
  findAttachment,
  insertAttachment,
  visitForAttachment,
  type AttachmentRow,
} from "../../persistence/pg-attachment-store.ts";
import type { BlobStore } from "../../ports/blob-store.ts";
import type { MedicalPatient } from "../../ports/medical-patient-reader.ts";
import {
  attachmentBlobRef,
  attachmentNameRef,
  attachmentViews,
  redactedAttachmentView,
} from "../../queries/attachment-views.ts";
import { auditMedical, type MedicalDeps } from "../medical-deps.ts";
import { readContext, reachFile } from "../visit-access.ts";

/** A file as the multipart route read it: whole, within the size limit. */
export interface UploadedFile {
  readonly fileName: string;
  readonly declaredType: string;
  readonly bytes: Buffer;
  readonly visitId: string | null;
}

/** A downloaded attachment: the plaintext and what the response headers need. */
export interface AttachmentDownload {
  readonly name: string;
  readonly contentType: Attachment["contentType"];
  readonly bytes: Buffer;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * مرفقات المراجع (P2-10، spec §6): رفع وقايمة وتنزيل وأرشفة. المحتوى بيتشفّر في الـ API قبل ما يخرج
 * للمخزن ومربوط بالعيادة والمرفق، واسم الملف ظرف في الجدول؛ الرفع والتنزيل والأرشفة كل واحد بيكتب صف
 * `patient_access` من غير اسم ولا بايتات. `own` = مراجعين الفاعل بس.
 */
export class Attachments {
  constructor(
    private readonly deps: MedicalDeps,
    private readonly blobs: BlobStore,
  ) {}

  /**
   * يرفع ملف (`attachment.uploaded`). الفحص بيحصل مرتين: قبل ما المحتوى يخرج للمخزن (عشان طلب مرفوض
   * مايسيبش ملف)، وتاني تحت الأقفال قبل الصف، من غير ما الـ transaction تمسك أقفال وقت الرفع.
   *
   * @param actor الفاعل
   * @param patientId الملف
   * @param file الملف والزيارة لو فيه
   * @returns المرفق
   */
  async upload(actor: MedicalActor, patientId: string, file: UploadedFile): Promise<Attachment> {
    const { db, ids, cipher, clock } = this.deps;
    await db.withTenant(actor.clinicId, (tx) =>
      this.uploadTarget(tx, actor, patientId, file, false),
    );
    const contentType = acceptedAttachmentType(file.declaredType, file.bytes);
    if (contentType === null) throw new ApiError("attachment_type");
    const id = ids.newId();
    const storageKey = attachmentStorageKey(actor.clinicId, id);
    const sealed = cipher.sealBytes(actor.clinicId, attachmentBlobRef(id), file.bytes);
    // A blob whose row then fails to commit stays behind as ciphertext no row points at.
    await this.blobs.put(storageKey, Buffer.from(sealed, "utf8"));
    return db.withTenant(actor.clinicId, async (tx) => {
      const branchId = await this.uploadTarget(tx, actor, patientId, file, true);
      const name = attachmentName(file.fileName);
      await insertAttachment(tx, actor.clinicId, {
        id,
        patientId,
        visitId: file.visitId,
        storageKey,
        contentType,
        sizeBytes: file.bytes.length,
        sha256: sha256(file.bytes),
        nameEnc: cipher.seal(actor.clinicId, attachmentNameRef(id), name),
        uploadedBy: actor.membershipId,
        now: clock.now(),
      });
      await this.audit(tx, actor, "attachment.uploaded", id, branchId, ["file"]);
      return this.view(tx, actor, await this.stored(tx, actor, id));
    });
  }

  /**
   * المرفقات النشطة للمراجع، الأحدث الأول، أو مرفقات زيارة منه (R1-14)، ومعاها `can`: قاعدة الكتابة
   * بتاعة الفاعل على الملف زي ما `upload` و`archive` بيقرروها (وصول التعديل بيغطي المراجع، والرفع
   * كمان لملف نشط). القايمة بتفك أسامي الملفات (معلومة طبية)، فبتكتب صف `attachment.listed` على الملف
   * في نفس الـ transaction، من غير أي اسم.
   *
   * @param actor الفاعل
   * @param patientId الملف
   * @param visitId الزيارة (اختياري)
   * @returns القايمة وقاعدة الرفع والأرشفة
   */
  list(
    actor: MedicalActor,
    patientId: string,
    visitId: string | undefined,
  ): Promise<AttachmentList> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { patient, file } = await reachFile(
        this.deps.patients,
        tx,
        actor,
        "view",
        patientId,
        false,
      );
      const writes = medicalReachCovers(medicalReach(actor, "update"), file);
      const rows = await activeAttachmentsOfPatient(tx, actor.clinicId, patientId, visitId);
      const views = await attachmentViews(readContext(this.deps, tx), actor.clinicId, rows);
      await auditMedical(tx, this.deps, actor, {
        action: "attachment.listed",
        entityType: "patient",
        entityId: patient.id,
        branchId: patient.registrationBranchId,
      });
      return { items: views, can: { upload: writes && patient.active, archive: writes } };
    });
  }

  /**
   * ينزّل المحتوى مفكوك (`attachment.downloaded`) بعد ما يتأكد إن الـ SHA-256 بتاعه هو اللي اتسجّل. الـ
   * transaction مابتستناش المخزن: الفحص الأول، وبعد الفك فحص تاني والسجل، والمحتوى مابيطلعش إلا بعده.
   *
   * @param actor الفاعل
   * @param attachmentId المرفق
   * @returns الاسم والنوع والبايتات
   */
  async download(actor: MedicalActor, attachmentId: string): Promise<AttachmentDownload> {
    const { db, cipher } = this.deps;
    const { clinicId } = actor;
    const row = await db.withTenant(clinicId, (tx) => this.downloadable(tx, actor, attachmentId));
    const sealed = await this.blobs.get(row.storageKey);
    const bytes = cipher.openBytes(clinicId, attachmentBlobRef(row.id), sealed.toString("utf8"));
    if (sha256(bytes) !== row.sha256) throw new Error("attachment content does not match its hash");
    await db.withTenant(clinicId, async (tx) => {
      await this.downloadable(tx, actor, attachmentId);
      const branchId = await this.branchOf(tx, actor, row);
      await this.audit(tx, actor, "attachment.downloaded", row.id, branchId);
    });
    return {
      name: cipher.open(clinicId, attachmentNameRef(row.id), row.nameEnc),
      contentType: row.contentType,
      bytes,
    };
  }

  /**
   * يأرشف المرفق (`attachment.archived`): بيختفي من القوايم ومابيتمسحش. المؤرشف بيرد `not_found` زي
   * التنزيل، فإعادة الأرشفة مابترجعش اسمه المفكوك من غير أثر في السجل. الاسم المفكوك واسم اللي رفعه
   * بيرجعوا بس لو وصول العرض بيغطي المراجع؛ غير كده (`update:medical:clinic` مع `view:medical:own` على
   * مراجع مش بتاعه) الاتنين `""` لأن العقد محتاج `name`.
   *
   * @param actor الفاعل
   * @param attachmentId المرفق
   * @returns المرفق بعد الأرشفة، من غير الأسامي لو الفاعل مايقدرش يقراه
   */
  archive(actor: MedicalActor, attachmentId: string): Promise<Attachment> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { row, file } = await this.reachable(tx, actor, "update", attachmentId, true);
      // Checked under the row lock, so of two racing archives only one answers the name (Codex PR #68).
      if (row.status !== "active") throw new ApiError("not_found");
      await archiveAttachment(tx, actor.clinicId, row.id, this.deps.clock.now());
      const branchId = await this.branchOf(tx, actor, row);
      await this.audit(tx, actor, "attachment.archived", row.id, branchId, ["status"]);
      const archived = await this.stored(tx, actor, row.id);
      return medicalReachCovers(medicalReach(actor, "view"), file)
        ? this.view(tx, actor, archived)
        : redactedAttachmentView(archived);
    });
  }

  // The file is the caller's to write and active; the visit, when named, is one of this patient's that
  // the caller can see (R1-15), else `attachment_patient_mismatch`. `lock` takes the visit row then the
  // patient row FOR SHARE (ADR-0027), both referenced by the INSERT. Answers the audit row's branch.
  private async uploadTarget(
    tx: Tx,
    actor: MedicalActor,
    patientId: string,
    file: UploadedFile,
    lock: boolean,
  ): Promise<string> {
    const visit =
      file.visitId === null
        ? null
        : await visitForAttachment(tx, actor.clinicId, file.visitId, lock);
    const target = await reachFile(this.deps.patients, tx, actor, "update", patientId, lock);
    const { patient } = target;
    if (!patient.active) throw new ApiError("patient_inactive");
    if (file.visitId === null) return patient.registrationBranchId;
    // TODO(spec): a cancelled or signed visit still takes an attachment until the owner decides.
    const seen = visit !== null && visitReachSees(visitViewReach(actor), visit, target.file.own);
    if (!seen || visit.patientId !== patientId) throw new ApiError("attachment_patient_mismatch");
    return visit.branchId;
  }

  // An attachment of a patient inside the caller's reach for the action, else not_found; with the
  // caller's relation to that file.
  private async reachable(
    tx: Tx,
    actor: MedicalActor,
    action: "view" | "update",
    attachmentId: string,
    lock: boolean,
  ): Promise<{ row: AttachmentRow; file: FileAccess }> {
    if (medicalReach(actor, action) === null) throw new ApiError("forbidden");
    const row = await findAttachment(tx, actor.clinicId, attachmentId, lock);
    if (row === null) throw new ApiError("not_found");
    const { file } = await reachFile(this.deps.patients, tx, actor, action, row.patientId, false);
    return { row, file };
  }

  private async stored(tx: Tx, actor: MedicalActor, id: string): Promise<AttachmentRow> {
    const row = await findAttachment(tx, actor.clinicId, id);
    if (row === null) throw new ApiError("not_found");
    return row;
  }

  private async view(tx: Tx, actor: MedicalActor, row: AttachmentRow): Promise<Attachment> {
    const [attachment] = await attachmentViews(readContext(this.deps, tx), actor.clinicId, [row]);
    return attachment!;
  }

  // An active attachment the caller may read. TODO(spec): an archived one answers not_found (no
  // download) until the owner decides otherwise.
  private async downloadable(
    tx: Tx,
    actor: MedicalActor,
    attachmentId: string,
  ): Promise<AttachmentRow> {
    const { row } = await this.reachable(tx, actor, "view", attachmentId, false);
    if (row.status !== "active") throw new ApiError("not_found");
    return row;
  }

  // The audit row's branch: the visit's when the file is on one, else the file's registration branch.
  private async branchOf(tx: Tx, actor: MedicalActor, row: AttachmentRow): Promise<string | null> {
    if (row.visitId !== null) {
      const visit = await visitForAttachment(tx, actor.clinicId, row.visitId, false);
      return visit?.branchId ?? null;
    }
    const patient = await this.deps.patients.find(tx, actor.clinicId, row.patientId);
    return patient?.registrationBranchId ?? null;
  }

  private audit(
    tx: Tx,
    actor: MedicalActor,
    action: string,
    attachmentId: string,
    branchId: string | null,
    changed?: readonly string[],
  ) {
    return auditMedical(tx, this.deps, actor, {
      action,
      entityType: "attachment",
      entityId: attachmentId,
      branchId,
      ...(changed === undefined ? {} : { changed }),
    });
  }
}
