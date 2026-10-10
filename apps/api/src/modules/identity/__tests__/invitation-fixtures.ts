import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { PLATFORM_DATABASE } from "../../../shared/platform-database.ts";
import { SecretSealer } from "@eyadex/secrets";
import {
  CLOCK,
  CreateClinicWithAdmin,
  FIRST_ADMIN_PROVISIONER,
  type FirstAdminProvisioner,
} from "../../tenancy/index.ts";
import { call, APP, type Harness } from "../auth/__tests__/auth-http-harness.ts";

/** A clinic made by slice 3a's use case; the raw token is caught from the provisioner's answer. */
export async function clinicWithInvite(h: Harness) {
  const real = h.app.get<FirstAdminProvisioner>(FIRST_ADMIN_PROVISIONER);
  let token = "";
  const tag = randomUUID().slice(0, 8);
  const email = `invitee-${tag}@example.test`;
  const useCase = new CreateClinicWithAdmin({
    db: h.app.get<Database>(PLATFORM_DATABASE),
    clock: h.app.get(CLOCK),
    ids: systemUuidV7(),
    provisioner: {
      provision: async (tx, request) => {
        const result = await real.provision(tx, request);
        if (result.kind === "invited") token = result.token;
        return result;
      },
    },
    sealer: new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!),
  });
  const created = await useCase.execute({
    actorUserId: randomUUID(),
    idempotencyKey: randomUUID(),
    input: {
      nameAr: "عيادة القبول",
      nameEn: "Acceptance Clinic",
      slug: `acc-${tag}`,
      specialty: "general",
      defaultLanguage: "en",
      timezone: "Asia/Kuwait",
      status: "trial",
      expiresAt: "2099-01-01T00:00:00Z",
      maxUsers: 5,
      maxBranches: 3,
      modules: { patients: true, appointments: false, medical: false },
      admin: { fullName: "Invited Admin", email },
    },
  });
  return { token, email, clinicId: created.clinicId, invitationId: created.invitation.id };
}

/** A doctor invitation limited to one branch, written as the owner (it is exempt from 0017). */
export async function branchInvite(h: Harness, clinicId: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const id = randomUUID();
  const branchId = randomUUID();
  const email = `doctor-${id.slice(0, 8)}@example.test`;
  const [role] = await h.owner`
    SELECT id FROM roles WHERE clinic_id = ${clinicId} AND system_key = 'doctor'`;
  await h.owner`INSERT INTO branches VALUES (${clinicId}, ${branchId}, 'فرع', 'Branch', true, now(), now())`;
  await h.owner`INSERT INTO email_reservations VALUES
    (${email}, 'invitation', ${clinicId}, ${id}, now() + interval '7 days', now())`;
  await h.owner`INSERT INTO invitations VALUES (${clinicId}, ${id}, ${email}, 'Branch Doctor',
    ${role!["id"]}, false, 'pending', now() + interval '7 days', ${randomUUID()}, ${hash}, now(), NULL)`;
  await h.owner`INSERT INTO invitation_branches VALUES (${clinicId}, ${randomUUID()}, ${id}, ${branchId})`;
  return { token, email, branchId, roleId: role!["id"] as string, invitationId: id };
}

export const strongPassword = () => `Pw-${randomBytes(12).toString("base64url")}`;

// A fresh address per call unless a test pins one: the per-IP limit must not leak between tests.
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;

export const accept = (h: Harness, token: string, password: string, host = APP, ip = randomIp()) =>
  call(h, { url: "/v1/invitations/accept", host, body: { token, password }, ip });

export const inspect = (h: Harness, token: string, host = APP, ip = randomIp()) =>
  call(h, { url: "/v1/invitations/inspect", host, body: { token }, ip });
