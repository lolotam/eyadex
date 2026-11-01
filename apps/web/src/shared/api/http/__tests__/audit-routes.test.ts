import { describe, expect, it } from "vitest";
import type { ClinicAuditListQuery, PlatformAuditListQuery } from "@eyadex/contracts/audit";
import type { Persona } from "@eyadex/contracts/session";
import { CLINIC, clientWith, code, page, TS, USER } from "./fetch-stub";

const ADMIN: Persona = { kind: "clinic_admin", clinicId: CLINIC, memberId: USER };
const P: Persona = { kind: "platform_admin", clinicId: null, memberId: null };

const clinicItem = {
  id: USER,
  at: TS,
  actorName: "Admin",
  action: "branch.updated",
  entity: "branch",
  category: "administrative",
  entityId: null,
  before: { nameEn: "Old" },
  after: { nameEn: "New" },
};
const platformItem = {
  id: USER,
  at: TS,
  actorName: "staff",
  action: "clinic.feature_changed",
  source: "platform",
  entity: "clinic",
  category: "administrative",
  entityId: CLINIC,
  clinicId: CLINIC,
  clinicNameAr: "ع",
  clinicNameEn: "C",
  before: { module: "patients", enabled: false },
  after: { module: "patients", enabled: true },
};
const clinicQuery: ClinicAuditListQuery = {
  cursor: null,
  limit: 20,
  actor: "  sara ",
  action: null,
  from: "2026-01-01",
  to: null,
  entity: "branch",
  category: null,
};
const platformQuery: PlatformAuditListQuery = {
  cursor: "abc_-",
  limit: 50,
  actor: "",
  action: "clinic.created",
  from: null,
  to: "2026-01-31",
  entity: null,
  source: "platform",
  clinicId: CLINIC,
};

describe("wired audit methods", () => {
  it.each(["administrative", "patient_access"])(
    "reads a completed finance export in the clinic audit as %s",
    async (category) => {
      const item = {
        ...clinicItem,
        action: "finance_report.exported",
        entity: "finance_report_export",
        category,
        entityId: USER,
        before: null,
        after: {
          report: "outstanding",
          from: "2026-01-01",
          to: "2026-01-31",
          branchIds: [CLINIC],
          rowCount: 3,
        },
      };
      const h = clientWith(() => ({ body: page([item]) }));
      expect(await h.api.audit.clinicList(ADMIN, { ...clinicQuery, entity: null })).toEqual(
        page([item]),
      );
    },
  );

  it("refuses a finance export in the platform audit even when it is administrative", async () => {
    const item = {
      ...platformItem,
      action: "finance_report.exported",
      entity: "finance_report_export",
    };
    const h = clientWith(() => ({ body: page([item]) }));
    expect((await code(h.api.audit.platformList(P, platformQuery))).code).toBe("unknown");
  });

  it("clinicList GETs /v1/clinic/audit with the set filters only, same-origin credentials", async () => {
    const h = clientWith(() => ({ body: page([clinicItem]) }));
    const result = await h.api.audit.clinicList(ADMIN, clinicQuery);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      method: "GET",
      url: "/api/v1/clinic/audit?limit=20&actor=sara&from=2026-01-01&entity=branch",
      credentials: "same-origin",
      body: undefined,
    });
    expect(result).toEqual(page([clinicItem]));
  });

  it("platformList GETs /v1/platform/audit with cursor, source and clinic", async () => {
    const h = clientWith(() => ({ body: page([platformItem]) }));
    const result = await h.api.audit.platformList(P, platformQuery);
    expect(h.calls[0]).toMatchObject({
      method: "GET",
      url: `/api/v1/platform/audit?cursor=abc_-&limit=50&action=clinic.created&to=2026-01-31&source=platform&clinicId=${CLINIC}`,
      credentials: "same-origin",
    });
    expect(result.items).toEqual([platformItem]);
  });

  it("platformClinicOptions GETs /v1/platform/audit/clinics", async () => {
    const options = [{ id: CLINIC, nameAr: "ع", nameEn: "C" }];
    const h = clientWith(() => ({ body: options }));
    expect(await h.api.audit.platformClinicOptions(P)).toEqual(options);
    expect(h.calls[0]).toMatchObject({
      method: "GET",
      url: "/api/v1/platform/audit/clinics",
      credentials: "same-origin",
    });
  });

  it("an answer with a field outside the contract is refused, never shown", async () => {
    const leaky = { ...clinicItem, civilId: "x" };
    const h = clientWith(() => ({ body: page([leaky]) }));
    expect((await code(h.api.audit.clinicList(ADMIN, clinicQuery))).code).toBe("unknown");
    const patient = { ...platformItem, category: "patient_access" };
    const p = clientWith(() => ({ body: page([patient]) }));
    expect((await code(p.api.audit.platformList(P, platformQuery))).code).toBe("unknown");
  });

  it("keeps the API's named references as the detail dialog reads them, null names included", async () => {
    const after = {
      roleId: { id: USER, nameAr: "ر", nameEn: "R" },
      branchIds: [
        { id: CLINIC, nameAr: "ف", nameEn: "B" },
        { id: USER, nameAr: null, nameEn: null },
      ],
    };
    const h = clientWith(() => ({ body: page([{ ...clinicItem, before: null, after }]) }));
    const result = await h.api.audit.clinicList(ADMIN, clinicQuery);
    expect(result.items[0]?.after).toEqual(after);
  });

  it("an API error keeps its code", async () => {
    const h = clientWith(() => ({
      status: 403,
      body: { code: "forbidden", message_ar: "ممنوع", message_en: "Forbidden" },
    }));
    expect((await code(h.api.audit.clinicList(ADMIN, clinicQuery))).code).toBe("forbidden");
  });
});
