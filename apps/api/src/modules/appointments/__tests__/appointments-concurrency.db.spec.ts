import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { code } from "./scheduling-fixtures.ts";

// Spec §4 rule 3, D-13, §8: the overlap check and the insert run under the provider lock in one
// transaction, so two bookings racing for one provider and slot can never both pass.
let h: Harness;
let C: BookingClinic;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
});
afterAll(async () => {
  await closeHarness(h);
});

describe("two simultaneous bookings for one provider and slot", () => {
  it("exactly one succeeds; the other is appointment_overlap", async () => {
    const [p1, p2] = [
      await addPatient(h, C.clinicId, C.branchD),
      await addPatient(h, C.clinicId, C.branchD),
    ];
    for (let round = 0; round < 3; round += 1) {
      const startsAt = at("2027-04-04", `${String(9 + round).padStart(2, "0")}:00`);
      const results = await Promise.all([
        book(h, C.admin.cookie, bookingBody(C, p1, startsAt)),
        book(h, C.admin.cookie, bookingBody(C, p2, startsAt)),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(results.map(code).filter(Boolean)).toEqual(["appointment_overlap"]);
      const rows = await h.owner`SELECT count(*)::int AS n FROM appointments
                                 WHERE clinic_id = ${C.clinicId} AND starts_at = ${startsAt}::timestamptz`;
      expect(rows[0]!["n"]).toBe(1);
    }
  });
});
