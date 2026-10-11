import type { MedicalProfile, MedicalProfileInput } from "@eyadex/contracts/medical-profile";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import {
  changedFields,
  medicalReach,
  medicalReachCovers,
  sectionValue,
  type FileAccess,
  type MedicalActor,
} from "../../domain/visit-rules.ts";
import {
  findProfile,
  lockProfile,
  PROFILE_COLUMN,
  PROFILE_SECTIONS,
  insertProfile,
  updateProfile,
  type ProfileSection,
  type StoredProfile,
} from "../../persistence/pg-profile-store.ts";
import type { MedicalPatient } from "../../ports/medical-patient-reader.ts";
import { auditMedical, openOrNull, sealOrNull, type MedicalDeps } from "../medical-deps.ts";
import { reachFile } from "../visit-access.ts";

type Sections = Record<ProfileSection, string | null>;

const TABLE = "patient_medical_profiles";
const EMPTY: Sections = {
  allergies: null,
  chronicConditions: null,
  currentMedications: null,
  surgicalHistory: null,
  familyHistory: null,
};

/**
 * الملف الطبي للمراجع (P2-7): خمس أقسام نص حر مشفّرة، بيتقرا بـ `view:medical:*` ويتكتب بـ
 * `update:medical:*` (`own` = مراجعين الفاعل بس). كل فتح وكل حفظ بيكتب صف `patient_access` واحد، والحفظ
 * فيه أسماء الأقسام اللي اتغيرت بس.
 */
export class MedicalProfileChanges {
  constructor(private readonly deps: MedicalDeps) {}

  /**
   * يفتح الملف الطبي (`medical_profile.opened`). مراجع من غير ملف = خمس أقسام `null`.
   *
   * @param actor الفاعل
   * @param patientId الملف
   * @returns الأقسام وآخر حفظ
   */
  open(actor: MedicalActor, patientId: string): Promise<MedicalProfile> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { patient, file } = await reachFile(
        this.deps.patients,
        tx,
        actor,
        "view",
        patientId,
        false,
      );
      const answer = await this.answer(tx, actor, patient, file);
      await this.audit(tx, actor, patient, "medical_profile.opened", undefined);
      return answer;
    });
  }

  /**
   * يحفظ الأقسام الخمسة كلها (`PUT` بيستبدل). نفس القيم = من غير كتابة، بس بيتسجّل كفتح للملف لأن الرد فيه المحتوى.
   *
   * @param actor الفاعل
   * @param patientId الملف
   * @param input الأقسام بعد `medicalProfileInputSchema`
   * @returns الملف بعد الحفظ
   */
  save(
    actor: MedicalActor,
    patientId: string,
    input: MedicalProfileInput,
  ): Promise<MedicalProfile> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { clinicId } = actor;
      // ADR-0029: the file's own lock first, then the patient row its INSERT references (ADR-0027).
      await lockProfile(tx, clinicId, patientId);
      const { patient, file } = await reachFile(
        this.deps.patients,
        tx,
        actor,
        "update",
        patientId,
        true,
      );
      if (!patient.active) throw new ApiError("patient_inactive");
      const stored = await findProfile(tx, clinicId, patientId, true);
      const before = this.opened(clinicId, stored);
      const after = Object.fromEntries(
        PROFILE_SECTIONS.map((s) => [s, sectionValue(input[s])]),
      ) as Sections;
      const changed = changedFields(before, after);
      if (changed.length > 0) {
        const id = stored?.id ?? this.deps.ids.newId();
        const sections = Object.fromEntries(
          PROFILE_SECTIONS.map((s) => [
            s,
            sealOrNull(
              this.deps.cipher,
              clinicId,
              { table: TABLE, column: PROFILE_COLUMN[s], rowId: id },
              after[s],
            ),
          ]),
        ) as Sections;
        const write = {
          profile: { id, patientId, sections },
          updatedBy: actor.membershipId,
          now: this.deps.clock.now(),
        };
        await (stored === null ? insertProfile : updateProfile)(tx, clinicId, write);
        await this.audit(tx, actor, patient, "medical_profile.saved", changed);
      } else {
        // The answer still carries the five decrypted sections, so a no-op save is a read and leaves
        // the same patient_access trail as GET (Codex P2 PR #68).
        await this.audit(tx, actor, patient, "medical_profile.opened", undefined);
      }
      return this.answer(tx, actor, patient, file);
    });
  }

  private opened(clinicId: string, stored: StoredProfile | null): Sections {
    if (stored === null) return EMPTY;
    return Object.fromEntries(
      PROFILE_SECTIONS.map((s) => [
        s,
        openOrNull(
          this.deps.cipher,
          clinicId,
          { table: TABLE, column: PROFILE_COLUMN[s], rowId: stored.id },
          stored.sections[s],
        ),
      ]),
    ) as Sections;
  }

  private async answer(
    tx: Tx,
    actor: MedicalActor,
    patient: MedicalPatient,
    file: FileAccess,
  ): Promise<MedicalProfile> {
    const stored = await findProfile(tx, actor.clinicId, patient.id);
    const author =
      stored === null
        ? undefined
        : (await this.deps.members.findMany(tx, actor.clinicId, [stored.updatedBy])).get(
            stored.updatedBy,
          );
    return {
      profile: this.opened(actor.clinicId, stored),
      updatedAt: stored === null ? null : new Date(stored.updatedAt).toISOString(),
      updatedByName: author?.fullName ?? null,
      // An archived file refuses every save (`patient_inactive`): no edit offered (Codex PR #68).
      can: {
        update: patient.active && medicalReachCovers(medicalReach(actor, "update"), file),
      },
    };
  }

  // The file has one row per patient, so the patient id names it in the log (the row may not exist yet).
  private audit(
    tx: Tx,
    actor: MedicalActor,
    patient: MedicalPatient,
    action: string,
    changed: readonly string[] | undefined,
  ) {
    return auditMedical(tx, this.deps, actor, {
      action,
      entityType: "medical_profile",
      entityId: patient.id,
      branchId: patient.registrationBranchId,
      ...(changed === undefined ? {} : { changed }),
    });
  }
}
