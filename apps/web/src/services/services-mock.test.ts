import { beforeEach, describe, expect, it } from "vitest";
import {
  PLATFORM,
  api,
  as,
  clinicIdAt,
  getState,
  resetMockData,
} from "@/shared/api/mock/mock-test-kit";
import { errorCodeOf } from "@/shared/api/api-error";

const admin = () => as("clinic_admin");
const page = { cursor: null, limit: 50, status: null };
const svc = (name: string, minutes = 30) => ({
  nameAr: `خدمة ${name}`,
  nameEn: `Service ${name}`,
  durationMinutes: minutes,
});
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );

beforeEach(() => resetMockData());

describe("services (D-12) in the mock, as the API", () => {
  it("lists the seeded services and creates one with one audit row; a replay returns it", async () => {
    expect((await api.scheduling.listServices(admin(), page)).total).toBe(3);
    const key = crypto.randomUUID();
    const made = await api.scheduling.createService(admin(), svc("a"), key);
    expect(await api.scheduling.createService(admin(), svc("a"), key)).toEqual(made);
    expect(await fails(api.scheduling.createService(admin(), svc("b"), key))).toBe(
      "idempotency_conflict",
    );
    const rows = getState().clinicAudit.filter((e) => e.entityId === made.id);
    expect(rows.map((e) => [e.action, e.entity, e.category])).toEqual([
      ["service.created", "clinic_service", "administrative"],
    ]);
  });

  it("names are unique per language ignoring case and spaces; 5–480 minutes", async () => {
    await api.scheduling.createService(admin(), svc("dup"), crypto.randomUUID());
    const dup = { ...svc("x"), nameEn: " SERVICE DUP " };
    expect(await fails(api.scheduling.createService(admin(), dup, crypto.randomUUID()))).toBe(
      "service_name_taken",
    );
    expect(
      await fails(api.scheduling.createService(admin(), svc("y", 4), crypto.randomUUID())),
    ).toBe("validation");
  });

  it("deactivate and reactivate keep the service (no delete)", async () => {
    const made = await api.scheduling.createService(admin(), svc("s"), crypto.randomUUID());
    expect((await api.scheduling.deactivateService(admin(), made.id)).status).toBe("inactive");
    expect((await api.scheduling.reactivateService(admin(), made.id)).status).toBe("active");
  });

  it("NEGATIVE: no services key is forbidden; the module off is module_disabled first", async () => {
    expect(await fails(api.scheduling.listServices(as("technician"), page))).toBe("forbidden");
    await api.platform.setClinicFeature(PLATFORM, clinicIdAt(0), "appointments", false);
    expect(await fails(api.scheduling.listServices(as("technician"), page))).toBe(
      "module_disabled",
    );
    expect(await fails(api.scheduling.listServices(admin(), page))).toBe("module_disabled");
  });
});

describe("the platform audit (ADR-0026 §8)", () => {
  it("NEGATIVE: never shows the module's configuration rows", async () => {
    await api.scheduling.createService(admin(), svc("p"), crypto.randomUUID());
    const query = {
      cursor: null,
      limit: 100,
      actor: "",
      action: null,
      from: null,
      to: null,
      entity: null,
      source: null,
      clinicId: null,
    };
    const items = (await api.audit.platformList(PLATFORM, query)).items;
    expect(items.some((e) => e.action.startsWith("service."))).toBe(false);
  });
});

describe("booking profile (D-1, D-15)", () => {
  it("defaults to not bookable, 20 minutes; the admin changes it with one audit row", async () => {
    // A receptionist of the seed: not seeded as bookable (only doctors are).
    const member = getState().members.find((m) => {
      const role = getState().roles.find((r) => r.id === m.roleId);
      return (
        m.clinicId === clinicIdAt(0) && m.status === "active" && role?.systemKey === "receptionist"
      );
    })!;
    expect(await api.scheduling.getBookingProfile(admin(), member.id)).toEqual({
      memberId: member.id,
      acceptsAppointments: false,
      defaultDurationMinutes: 20,
    });
    const input = { acceptsAppointments: true, defaultDurationMinutes: 40 };
    expect(await api.scheduling.setBookingProfile(admin(), member.id, input)).toEqual({
      memberId: member.id,
      ...input,
    });
    const rows = getState().clinicAudit.filter((e) => e.action === "user.booking_changed");
    expect(rows).toHaveLength(1);
    expect(
      await fails(api.scheduling.setBookingProfile(as("receptionist"), member.id, input)),
    ).toBe("forbidden");
  });

  it("NEGATIVE: only a clinic admin changes an admin's booking settings, as the API (ADR-0012 §15)", async () => {
    const editor = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    editor.permissions.push("view:users:clinic", "update:users:clinic");
    const adminMember = getState().members.find((m) => {
      const role = getState().roles.find((r) => r.id === m.roleId);
      return m.clinicId === clinicIdAt(0) && role?.systemKey === "clinic_admin";
    })!;
    const input = { acceptsAppointments: true, defaultDurationMinutes: 30 };
    expect(
      await fails(api.scheduling.setBookingProfile(as("receptionist"), adminMember.id, input)),
    ).toBe("forbidden");
  });
});
