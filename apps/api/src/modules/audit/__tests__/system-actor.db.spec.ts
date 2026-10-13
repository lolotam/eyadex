import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import {
  APP,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { platformStaff } from "../../platform/__tests__/platform-staff.ts";
import { getList, seedAudit } from "./audit-fixtures.ts";

let h: Harness;
let clinic: Awaited<ReturnType<typeof clinicWithMembers>>;
let staff: Awaited<ReturnType<typeof platformStaff>>;
let auditId: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  clinic = await clinicWithMembers(h);
  staff = await platformStaff(h);
  auditId = await seedAudit(h, {
    clinicId: clinic.admin.clinicId,
    actorUserId: SYSTEM_ACTOR_ID,
    action: "clinic.whatsapp_disconnected",
    entityType: "clinic",
    createdAt: "2031-01-01T00:00:00Z",
    details: { transport: "evolution", reason: "connection_closed" },
  });
});
afterAll(async () => {
  await closeHarness(h);
});

describe("automatic WhatsApp audit actor over HTTP and real RLS", () => {
  it.each(["clinic", "platform"] as const)(
    "the %s list preserves the row and names Eyadex",
    async (area) => {
      for (const actorFilter of ["", "&actor=Eyadex"]) {
        const platform = area === "platform";
        const res = await getList(
          h,
          platform ? PLATFORM : APP,
          platform ? "/v1/platform/audit" : "/v1/clinic/audit",
          platform ? staff.cookie : clinic.admin.cookie,
          `action=clinic.whatsapp_disconnected${platform ? `&clinicId=${clinic.admin.clinicId}` : ""}${actorFilter}`,
        );
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json()).toMatchObject({
          total: 1,
          items: [{ id: auditId, actorName: "Eyadex", action: "clinic.whatsapp_disconnected" }],
        });
      }
    },
  );
});
