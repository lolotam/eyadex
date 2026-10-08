import type { CreateClinicRequest, CreateClinicResponse } from "@eyadex/contracts/onboarding";
import { DatabaseError, type Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestHash,
} from "../../../../shared/idempotency.ts";
import { appendOutboxEvent } from "../../../../shared/outbox.ts";
import { writePlatformAudit } from "../../../../shared/platform-audit.ts";
import type { SecretSealer } from "@eyadex/secrets";
import { checkNewClinic } from "../../domain/new-clinic.ts";
import { trialEndsAt } from "../../domain/trial.ts";
import { insertNewClinic } from "../../persistence/pg-new-clinic-writer.ts";
import type { Clock } from "../../ports/clock.ts";
import type { FirstAdminProvisioner } from "../../ports/first-admin-provisioner.ts";

/** اللي الـ use case محتاجه — كله متحقن، مفيش ساعة ولا random جوه. */
export interface CreateClinicDeps {
  /** الـ pool على `eyadex_platform`. */
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly provisioner: FirstAdminProvisioner;
  readonly sealer: SecretSealer;
}

/** الأمر: مين بيطلب، بأي مفتاح، وبإيه. */
export interface CreateClinicCommand {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly input: CreateClinicRequest;
}

export const ADMIN_INVITED_EVENT = "clinic.admin_invited";

/**
 * ONB-01: عيادة + أدوار النظام + دعوة أول أدمن (hash بس) + حجز الإيميل + سجل المنصة + حدث outbox،
 * في transaction واحدة (`withNewTenant`). أي فشل → مفيش أي حاجة اتكتبت، حتى مفتاح الـ idempotency.
 */
export class CreateClinicWithAdmin {
  constructor(private readonly deps: CreateClinicDeps) {}

  async execute(command: CreateClinicCommand): Promise<CreateClinicResponse> {
    const { db, clock, ids, provisioner, sealer } = this.deps;
    const { input, actorUserId } = command;
    const now = clock.now();
    const scope = `platform:create-clinic:${actorUserId}`;
    const hash = requestHash(input);
    try {
      return await db.withNewTenant(async (tx, clinicId) => {
        const claim = await claimIdempotencyKey<CreateClinicResponse>(
          tx,
          scope,
          command.idempotencyKey,
          hash,
          now,
        );
        if (claim.kind === "replay") return claim.response;
        if (claim.kind === "conflict") throw new ApiError("idempotency_conflict");

        // A relative trial is resolved once, on the server clock; the key makes a retry replay it.
        const expiry =
          input.trialDays === undefined
            ? new Date(input.expiresAt ?? Number.NaN)
            : trialEndsAt(input.trialDays, input.timezone, now);
        const check = checkNewClinic(input.slug, expiry, now);
        if (!check.ok) throw new ApiError(check.code);

        await insertNewClinic(tx, clinicId, { ...input, expiresAt: expiry }, ids.newId(), now);
        const invited = await provisioner.provision(tx, {
          clinicId,
          actorUserId,
          fullName: input.admin.fullName,
          email: input.admin.email,
          now,
        });
        if (invited.kind === "email_taken") throw new ApiError("email_taken");

        const expiresAt = invited.expiresAt.toISOString();
        await writePlatformAudit(tx, {
          id: ids.newId(),
          actorUserId,
          action: "clinic.created",
          clinicId,
          // Allowlist: no token, no hash, nothing secret (PRD §4.11).
          details: {
            after: {
              slug: input.slug,
              nameAr: input.nameAr,
              nameEn: input.nameEn,
              specialty: input.specialty,
              status: input.status,
              expiresAt: expiry.toISOString(),
              maxUsers: input.maxUsers,
              maxBranches: input.maxBranches,
              modules: input.modules,
              firstAdmin: { invitationId: invited.invitationId, email: input.admin.email },
            },
          },
          createdAt: now,
        });

        const eventId = ids.newId();
        await appendOutboxEvent(tx, {
          id: eventId,
          clinicId,
          type: ADMIN_INVITED_EVENT,
          payload: {
            clinicId,
            invitationId: invited.invitationId,
            email: input.admin.email,
            fullName: input.admin.fullName,
            language: input.defaultLanguage,
            clinicNameAr: input.nameAr,
            clinicNameEn: input.nameEn,
            expiresAt,
            // Only the worker (same key) can open it, and only inside this event (ADR-0006).
            sealedToken: sealer.seal(invited.token, eventId),
          },
          createdAt: now,
        });

        const response: CreateClinicResponse = {
          clinicId,
          slug: input.slug,
          invitation: { id: invited.invitationId, email: input.admin.email, expiresAt },
        };
        await completeIdempotencyKey(tx, scope, command.idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (error instanceof DatabaseError && error.constraint === "clinics_slug_key") {
        throw new ApiError("slug_taken");
      }
      throw error;
    }
  }
}
