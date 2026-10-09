import { describe, expect, it } from "vitest";

import { API_ERROR_MESSAGES } from "../../../shared/api-error-messages.ts";
import { ApiError } from "../../../shared/errors.ts";
import { auditSnapshots } from "../domain/audit-snapshot.ts";

describe("scheduling error codes", () => {
  it("answer with their status and both languages", () => {
    expect(new ApiError("service_name_taken").status).toBe(409);
    expect(new ApiError("schedule_overlap").status).toBe(409);
    expect(new ApiError("provider_not_bookable").status).toBe(400);
    expect(new ApiError("provider_not_in_branch").status).toBe(400);
    expect(API_ERROR_MESSAGES.schedule_overlap.message_ar).toMatch(/[؀-ۿ]/);
  });
});

describe("scheduling audit snapshots (PRD §4.11 allowlists)", () => {
  it("a service shows its names, duration and status only", () => {
    const after = { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 30, status: "active", x: 1 };
    expect(auditSnapshots("clinic_service", { before: null, after }).after).toEqual({
      nameAr: "ليزر",
      nameEn: "Laser",
      durationMinutes: 30,
      status: "active",
    });
  });

  it("time off never shows its note; a booking change shows the two booking fields", () => {
    const off = { providerName: "Dr A", startsAt: "s", endsAt: "e", cancelled: false, note: "x" };
    expect(
      auditSnapshots("provider_time_off", { before: null, after: off }).after,
    ).not.toHaveProperty("note");
    const shown = auditSnapshots("provider_time_off", { before: null, after: off }).after;
    expect(shown).toMatchObject({ startsAt: "s", endsAt: "e" });
    const user = { fullName: "A", acceptsAppointments: true, defaultDurationMinutes: 20 };
    expect(auditSnapshots("user", { before: null, after: user }).after).toEqual(user);
  });
});

describe("time-off instants in the audit dialog (Codex r1)", () => {
  it("keeps an ISO instant under startsAt / endsAt, and still scrubs digits typed there", () => {
    const after = {
      providerName: "Dr A",
      startsAt: "2026-10-11T06:00:00.000Z",
      endsAt: "2026-10-12T06:00:00.000Z",
      cancelled: false,
    };
    const shown = auditSnapshots("provider_time_off", { before: null, after }).after;
    expect(shown).toMatchObject({ startsAt: after.startsAt, endsAt: after.endsAt });
    const typed = { ...after, startsAt: "call 99998888" };
    const scrubbed = auditSnapshots("provider_time_off", { before: null, after: typed }).after;
    expect(JSON.stringify(scrubbed)).not.toContain("99998888");
  });
});
