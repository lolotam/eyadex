import { describe, expect, it } from "vitest";
import { arAppointments } from "@/shared/i18n/ar-appointments";
import { enAppointments } from "@/shared/i18n/en-appointments";

// Every appointments key exists in both languages, and the Arabic copy never says «المريض».
const keys = (node: unknown, prefix = ""): string[] =>
  typeof node === "object" && node !== null
    ? Object.entries(node).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
    : [prefix.slice(0, -1)];

describe("appointments strings", () => {
  it("have the same keys in ar and en", () => {
    expect(keys(arAppointments).sort()).toEqual(keys(enAppointments).sort());
  });
  it("include the A4 views", () => {
    for (const key of ["views.week", "views.month", "views.queue", "queue.empty", "month.count"]) {
      expect(keys(arAppointments)).toContain(`appointments.${key}`);
    }
  });
  it("never say المريض in Arabic", () => {
    expect(JSON.stringify(arAppointments)).not.toMatch(/المريض|المرضى/);
  });
});
